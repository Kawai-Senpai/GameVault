use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct PerfSystem {
    pub cpu_percent: f32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_percent: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct PerfProcess {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PerfGpu {
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct PerformanceSnapshot {
    pub system: PerfSystem,
    pub gpu: Option<PerfGpu>,
    pub target: Option<PerfProcess>,
    pub top: Vec<PerfProcess>,
}

#[cfg(target_os = "windows")]
mod gpu_windows {
    use once_cell::sync::Lazy;
    use std::{ptr, sync::Mutex};

    use winapi::shared::minwindef::DWORD;
    use winapi::um::pdh::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhEnumObjectItemsW,
        PdhGetFormattedCounterValue, PdhOpenQueryW, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
        PDH_FMT_COUNTERVALUE,
    };

    const PDH_OK: i32 = 0;

    fn to_wide(s: &str) -> Vec<u16> {
        use std::os::windows::prelude::OsStrExt;
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    #[derive(Debug)]
    pub struct GpuQuery {
        query: PDH_HQUERY,
        counters: Vec<PDH_HCOUNTER>,
        primed: bool,
    }

    // PDH handles are opaque pointers. We guard all access behind a Mutex,
    // and only use them in blocking code (no .await while holding locks).
    unsafe impl Send for GpuQuery {}
    unsafe impl Sync for GpuQuery {}

    impl Drop for GpuQuery {
        fn drop(&mut self) {
            unsafe {
                if !self.query.is_null() {
                    let _ = PdhCloseQuery(self.query);
                }
            }
        }
    }

    impl GpuQuery {
        fn init() -> Option<Self> {
            unsafe {
                let mut query: PDH_HQUERY = ptr::null_mut();
                if PdhOpenQueryW(ptr::null(), 0, &mut query) != PDH_OK {
                    return None;
                }

                // Enumerate GPU Engine instances
                let object = to_wide("GPU Engine");

                let mut counter_list_size: DWORD = 0;
                let mut instance_list_size: DWORD = 0;
                // First call to get buffer sizes
                let _ = PdhEnumObjectItemsW(
                    ptr::null_mut(),
                    ptr::null_mut(),
                    object.as_ptr(),
                    ptr::null_mut(),
                    &mut counter_list_size,
                    ptr::null_mut(),
                    &mut instance_list_size,
                    0,
                    0,
                );

                if instance_list_size == 0 {
                    let _ = PdhCloseQuery(query);
                    return None;
                }

                let mut counter_buf: Vec<u16> = vec![0; counter_list_size as usize];
                let mut instance_buf: Vec<u16> = vec![0; instance_list_size as usize];

                let status = PdhEnumObjectItemsW(
                    ptr::null_mut(),
                    ptr::null_mut(),
                    object.as_ptr(),
                    counter_buf.as_mut_ptr(),
                    &mut counter_list_size,
                    instance_buf.as_mut_ptr(),
                    &mut instance_list_size,
                    0,
                    0,
                );
                if status != PDH_OK {
                    let _ = PdhCloseQuery(query);
                    return None;
                }

                // instance_buf is MULTI_SZ (NUL-separated strings, double-NUL terminated)
                let mut instances: Vec<String> = Vec::new();
                let mut start = 0usize;
                for i in 0..instance_buf.len() {
                    if instance_buf[i] == 0 {
                        if i == start {
                            break;
                        }
                        let slice = &instance_buf[start..i];
                        let s = String::from_utf16_lossy(slice);
                        if !s.trim().is_empty() {
                            instances.push(s);
                        }
                        start = i + 1;
                    }
                }

                // Prefer 3D engines to match what users expect as "GPU usage"
                let instances: Vec<String> = instances
                    .into_iter()
                    .filter(|s| s.to_lowercase().contains("engtype_3d"))
                    .collect();

                if instances.is_empty() {
                    let _ = PdhCloseQuery(query);
                    return None;
                }

                let mut counters: Vec<PDH_HCOUNTER> = Vec::new();
                for inst in instances {
                    let path = format!(r#"\\GPU Engine({})\\Utilization Percentage"#, inst);
                    let wide = to_wide(&path);
                    let mut counter: PDH_HCOUNTER = ptr::null_mut();
                    if PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &mut counter) == PDH_OK
                    {
                        counters.push(counter);
                    }
                }

                if counters.is_empty() {
                    let _ = PdhCloseQuery(query);
                    return None;
                }

                Some(Self {
                    query,
                    counters,
                    primed: false,
                })
            }
        }

        fn sample_percent(&mut self) -> Option<f64> {
            unsafe {
                if PdhCollectQueryData(self.query) != PDH_OK {
                    return None;
                }
            }

            if !self.primed {
                // First sample isn't reliable for rate counters
                std::thread::sleep(std::time::Duration::from_millis(120));
                unsafe {
                    if PdhCollectQueryData(self.query) != PDH_OK {
                        return None;
                    }
                }
                self.primed = true;
            }

            let mut max_v: f64 = 0.0;
            for c in &self.counters {
                unsafe {
                    let mut val: PDH_FMT_COUNTERVALUE = std::mem::zeroed();
                    let mut _type: DWORD = 0;
                    if PdhGetFormattedCounterValue(*c, PDH_FMT_DOUBLE, &mut _type, &mut val)
                        != PDH_OK
                    {
                        continue;
                    }
                    let v = *val.u.doubleValue();
                    if v.is_finite() {
                        max_v = max_v.max(v);
                    }
                }
            }

            // Clamp into a sane range
            if max_v < 0.0 {
                max_v = 0.0;
            }
            if max_v > 100.0 {
                max_v = 100.0;
            }
            Some(max_v)
        }
    }

    static GPU_QUERY: Lazy<Mutex<Option<GpuQuery>>> = Lazy::new(|| Mutex::new(None));

    pub fn gpu_usage_percent() -> Option<f32> {
        let mut guard = GPU_QUERY.lock().ok()?;
        if guard.is_none() {
            *guard = GpuQuery::init();
        }
        let q = guard.as_mut()?;
        let v = q.sample_percent()?;
        Some(v as f32)
    }
}

#[tauri::command]
pub async fn get_performance_snapshot(
    pid: Option<u32>,
    top_n: Option<u32>,
) -> Result<PerformanceSnapshot, String> {
    fn build_snapshot(pid: Option<u32>, top_n: Option<u32>) -> Result<PerformanceSnapshot, String> {
        use once_cell::sync::Lazy;
        use std::sync::Mutex;
        use sysinfo::{Pid, ProcessesToUpdate, System};

        static SYS: Lazy<Mutex<System>> = Lazy::new(|| {
            let mut s = System::new_all();
            s.refresh_all();
            Mutex::new(s)
        });

        let mut system = SYS
            .lock()
            .map_err(|_| "Perf system lock poisoned".to_string())?;

        // Refresh the minimal parts we need
        system.refresh_cpu_usage();
        system.refresh_memory();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let cpu = system.global_cpu_usage();
        let mem_total_kb = system.total_memory();
        let mem_used_kb = system.used_memory();
        // sysinfo 0.33: total_memory() and used_memory() return bytes directly
        let mem_total_bytes = mem_total_kb;
        let mem_used_bytes = mem_used_kb;
        let mem_percent = if mem_total_bytes > 0 {
            (mem_used_bytes as f32 / mem_total_bytes as f32) * 100.0
        } else {
            0.0
        };

        let mut processes: Vec<PerfProcess> = system
            .processes()
            .iter()
            .map(|(p, proc_)| {
                let exe_path = proc_
                    .exe()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                // sysinfo 0.33: process.memory() returns bytes directly
                let mem_bytes = proc_.memory() as u64;
                PerfProcess {
                    pid: p.as_u32(),
                    name: proc_.name().to_string_lossy().to_string(),
                    exe_path,
                    cpu_percent: proc_.cpu_usage(),
                    memory_bytes: mem_bytes,
                }
            })
            .collect();

        processes.sort_by(|a, b| b.cpu_percent.total_cmp(&a.cpu_percent));
        let top_n = top_n.unwrap_or(8).min(24) as usize;
        let top = processes.iter().take(top_n).cloned().collect::<Vec<_>>();

        let target = pid.and_then(|pid| {
            let p = system.process(Pid::from_u32(pid))?;
            let exe_path = p
                .exe()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            // sysinfo 0.33: process.memory() returns bytes directly
            let mem_bytes = p.memory() as u64;
            Some(PerfProcess {
                pid,
                name: p.name().to_string_lossy().to_string(),
                exe_path,
                cpu_percent: p.cpu_usage(),
                memory_bytes: mem_bytes,
            })
        });

        let gpu = {
            #[cfg(target_os = "windows")]
            {
                let usage = gpu_windows::gpu_usage_percent();
                usage.map(|u| PerfGpu { usage_percent: u })
            }

            #[cfg(not(target_os = "windows"))]
            {
                None
            }
        };

        Ok(PerformanceSnapshot {
            system: PerfSystem {
                cpu_percent: cpu,
                memory_total_bytes: mem_total_bytes,
                memory_used_bytes: mem_used_bytes,
                memory_percent: mem_percent,
            },
            gpu,
            target,
            top,
        })
    }

    tauri::async_runtime::spawn_blocking(move || build_snapshot(pid, top_n))
        .await
        .map_err(|e| e.to_string())?
}
