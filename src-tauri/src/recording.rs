use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::fs;
use uuid::Uuid;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Global recording state
static RECORDING_PROCESS: Mutex<Option<RecordingState>> = Mutex::new(None);

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct RecordingState {
    child: Child,
    output_path: String,
    game_id: String,
    started_at: std::time::Instant,
    recordings_dir: String,
    ffmpeg_exe: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingResult {
    pub id: String,
    pub file_path: String,
    pub thumbnail_path: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub duration_seconds: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub duration_seconds: f64,
    pub output_path: String,
}

/// Resolve the best ffmpeg path: user-configured → bundled → system PATH
#[tauri::command]
pub async fn resolve_ffmpeg(app_handle: AppHandle, user_path: Option<String>) -> Result<String, String> {
    // 1. If user has configured a path and it works, use it
    if let Some(ref p) = user_path {
        if !p.is_empty() && p != "ffmpeg" {
            if test_ffmpeg_exe(p) {
                return Ok(p.clone());
            }
        }
    }

    // 2. Check bundled ffmpeg in app data dir
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let bundled = data_dir.join("ffmpeg").join("ffmpeg.exe");
    if bundled.exists() && test_ffmpeg_exe(&bundled.to_string_lossy()) {
        return Ok(bundled.to_string_lossy().to_string());
    }

    // 3. Check system PATH
    if test_ffmpeg_exe("ffmpeg") {
        return Ok("ffmpeg".to_string());
    }

    Err("FFmpeg not found. Please download it from Settings → Screen Recording → Auto-download FFmpeg".to_string())
}

fn test_ffmpeg_exe(exe: &str) -> bool {
    let mut cmd = Command::new(exe);
    cmd.arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

/// Check if ffmpeg is available at the given path or in PATH
#[tauri::command]
pub async fn check_ffmpeg(ffmpeg_path: Option<String>) -> Result<String, String> {
    let exe = ffmpeg_path.unwrap_or_else(|| "ffmpeg".to_string());
    let output = Command::new(&exe)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("FFmpeg not found at '{}': {}", exe, e))?;

    if !output.status.success() {
        return Err(format!("FFmpeg returned error: {}", output.status));
    }

    let version_str = String::from_utf8_lossy(&output.stdout);
    let first_line = version_str.lines().next().unwrap_or("ffmpeg (unknown version)");
    Ok(first_line.to_string())
}

/// Start screen recording using ffmpeg
#[tauri::command]
pub async fn start_recording(
    app_handle: AppHandle,
    recordings_dir: String,
    game_id: String,
    ffmpeg_path: Option<String>,
    fps: Option<u32>,
    resolution: Option<String>,
    quality: Option<String>,
) -> Result<String, String> {
    let mut state = RECORDING_PROCESS.lock().map_err(|e| e.to_string())?;
    if state.is_some() {
        return Err("Already recording".to_string());
    }

    let exe = ffmpeg_path.unwrap_or_else(|| "ffmpeg".to_string());
    let framerate = fps.unwrap_or(30);
    let qual = quality.unwrap_or_else(|| "medium".to_string());

    // Create output directory
    let dir = PathBuf::from(&recordings_dir).join(&game_id);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let filename = format!(
        "recording_{}.mp4",
        chrono::Utc::now().format("%Y%m%d_%H%M%S")
    );
    let output_path = dir.join(&filename);

    // Build ffmpeg command
    // -f gdigrab -i desktop: capture entire screen on Windows
    // -c:v libx264: H.264 codec
    // -preset: encoding speed vs quality tradeoff
    // -pix_fmt yuv420p: compatibility
    // -y: overwrite output
    let preset = match qual.as_str() {
        "low" => "ultrafast",
        "high" => "slow",
        _ => "veryfast", // medium (default) - good balance for gaming
    };

    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-f".to_string(),
        "gdigrab".to_string(),
        "-framerate".to_string(),
        framerate.to_string(),
    ];

    // Add resolution/video_size if specified
    if let Some(ref res) = resolution {
        if !res.is_empty() && res != "native" {
            args.push("-video_size".to_string());
            args.push(res.clone());
        }
    }

    args.extend_from_slice(&[
        "-i".to_string(),
        "desktop".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        preset.to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);

    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}. Is ffmpeg installed?", e))?;

    let out = output_path.to_string_lossy().to_string();
    *state = Some(RecordingState {
        child,
        output_path: out.clone(),
        game_id,
        started_at: std::time::Instant::now(),
        recordings_dir,
        ffmpeg_exe: exe.clone(),
    });

    // Emit event so all windows (overlay, main) sync state
    let _ = app_handle.emit("recording-state-changed", serde_json::json!({
        "is_recording": true,
        "output_path": out,
    }));

    Ok(out)
}

/// Stop the current recording and return the result
#[tauri::command]
pub async fn stop_recording(app_handle: AppHandle) -> Result<RecordingResult, String> {
    let mut state = RECORDING_PROCESS.lock().map_err(|e| e.to_string())?;
    let recording = state.take().ok_or("No active recording")?;

    let duration = recording.started_at.elapsed().as_secs_f64();
    let RecordingState {
        mut child,
        output_path,
        game_id,
        recordings_dir,
        ffmpeg_exe,
        ..
    } = recording;

    // Send 'q' to ffmpeg's stdin to gracefully stop
    if let Some(ref mut stdin) = child.stdin {
        let _ = stdin.write_all(b"q");
        let _ = stdin.flush();
    }

    // Wait for ffmpeg to finish (with timeout)
    let wait_result = std::thread::spawn(move || {
        child.wait()
    })
    .join()
    .map_err(|_| "Thread join error")?
    .map_err(|e| format!("ffmpeg exit error: {}", e))?;

    if !wait_result.success() {
        // Still might have produced a valid file, continue
        tracing::warn!("ffmpeg exited with status: {}", wait_result);
    }

    // Get file info
    let file_path = PathBuf::from(&output_path);
    if !file_path.exists() {
        return Err("Recording file was not created".to_string());
    }

    let file_size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

    // Get video dimensions and duration using ffprobe
    let (width, height, actual_duration) = get_video_info(&output_path, &ffmpeg_exe).unwrap_or((1920, 1080, duration));

    // Generate thumbnail from the first frame
    let thumbnail_path = generate_video_thumbnail(
        &output_path,
        &recordings_dir,
        &game_id,
        &ffmpeg_exe,
    )
    .unwrap_or_default();

    let id = Uuid::new_v4().to_string();

    // Emit event so all windows (overlay, main) sync state
    let _ = app_handle.emit("recording-state-changed", serde_json::json!({
        "is_recording": false,
    }));

    Ok(RecordingResult {
        id,
        file_path: output_path,
        thumbnail_path,
        width,
        height,
        file_size,
        duration_seconds: actual_duration,
    })
}

/// Get current recording status
#[tauri::command]
pub async fn get_recording_status() -> RecordingStatus {
    let state = RECORDING_PROCESS.lock().unwrap_or_else(|e| e.into_inner());
    match state.as_ref() {
        Some(recording) => RecordingStatus {
            is_recording: true,
            duration_seconds: recording.started_at.elapsed().as_secs_f64(),
            output_path: recording.output_path.clone(),
        },
        None => RecordingStatus {
            is_recording: false,
            duration_seconds: 0.0,
            output_path: String::new(),
        },
    }
}

/// Open a recording file with the system default player
#[tauri::command]
pub async fn open_recording(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

/// Delete a recording file from disk
#[tauri::command]
pub async fn delete_recording_file(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("Failed to delete recording: {}", e))?;
    }
    // Also try to delete thumbnail
    let parent = file.parent().unwrap_or(file.as_path());
    let fname = file.file_stem().unwrap_or_default().to_string_lossy();
    let thumb_path = parent.join("thumbnails").join(format!("thumb_{}.jpg", fname));
    if thumb_path.exists() {
        let _ = fs::remove_file(&thumb_path);
    }
    Ok(())
}

/// Get the bundled/downloaded ffmpeg path in the app data directory
#[tauri::command]
pub async fn get_bundled_ffmpeg_path(app_handle: AppHandle) -> Result<Option<String>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;
    let ffmpeg_dir = data_dir.join("ffmpeg");
    let ffmpeg_exe = ffmpeg_dir.join("ffmpeg.exe");

    if ffmpeg_exe.exists() {
        Ok(Some(ffmpeg_exe.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// Download a static ffmpeg build to the app data directory.
/// Uses the BtbN/FFmpeg-Builds GitHub release (gpl, shared).
/// Returns the path to ffmpeg.exe once downloaded and extracted.
#[tauri::command]
pub async fn download_ffmpeg(app_handle: AppHandle) -> Result<String, String> {

    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;
    let ffmpeg_dir = data_dir.join("ffmpeg");
    let ffmpeg_exe = ffmpeg_dir.join("ffmpeg.exe");

    // If already downloaded, return the path
    if ffmpeg_exe.exists() {
        return Ok(ffmpeg_exe.to_string_lossy().to_string());
    }

    fs::create_dir_all(&ffmpeg_dir).map_err(|e| format!("Failed to create ffmpeg dir: {}", e))?;

    // Download ffmpeg essentials from gyan.dev (~30MB zip with just ffmpeg.exe + ffprobe.exe)
    let url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
    let zip_path = ffmpeg_dir.join("ffmpeg-download.zip");

    // Use curl or PowerShell to download (available on all modern Windows)
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile", "-NonInteractive", "-Command",
        &format!(
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '{}' -OutFile '{}'",
            url,
            zip_path.to_string_lossy()
        ),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output()
        .map_err(|e| format!("Download failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed: {}", stderr));
    }

    if !zip_path.exists() {
        return Err("Download completed but file not found".to_string());
    }

    // Extract using PowerShell
    let mut extract_cmd = Command::new("powershell");
    extract_cmd.args([
        "-NoProfile", "-NonInteractive", "-Command",
        &format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            zip_path.to_string_lossy(),
            ffmpeg_dir.to_string_lossy()
        ),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    extract_cmd.creation_flags(CREATE_NO_WINDOW);

    let extract_output = extract_cmd.output()
        .map_err(|e| format!("Extraction failed: {}", e))?;

    if !extract_output.status.success() {
        let stderr = String::from_utf8_lossy(&extract_output.stderr);
        return Err(format!("Extraction failed: {}", stderr));
    }

    // The zip extracts to a subfolder. Find ffmpeg.exe recursively and move it up.
    let mut found_ffmpeg = None;

    fn find_exe(dir: &std::path::Path, name: &str) -> Option<PathBuf> {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(found) = find_exe(&path, name) {
                        return Some(found);
                    }
                } else if path.file_name().map(|n| n == name).unwrap_or(false) {
                    return Some(path);
                }
            }
        }
        None
    }

    if let Some(src) = find_exe(&ffmpeg_dir, "ffmpeg.exe") {
        fs::copy(&src, &ffmpeg_exe).map_err(|e| format!("Failed to copy ffmpeg.exe: {}", e))?;
        found_ffmpeg = Some(ffmpeg_exe.clone());
    }

    let ffprobe_dest = ffmpeg_dir.join("ffprobe.exe");
    if let Some(src) = find_exe(&ffmpeg_dir, "ffprobe.exe") {
        let _ = fs::copy(&src, &ffprobe_dest);
    }

    // Clean up: remove zip and extracted subdirectory
    let _ = fs::remove_file(&zip_path);
    // Remove the extracted subdirectory (everything except our copied exes)
    if let Ok(entries) = fs::read_dir(&ffmpeg_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }

    match found_ffmpeg {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("FFmpeg executable not found in the downloaded archive".to_string()),
    }
}

// ─── Internal helpers ────────────────────────────────────────

/// Get video dimensions and duration using ffprobe
fn get_video_info(video_path: &str, ffmpeg_exe: &str) -> Result<(u32, u32, f64), String> {
    // Derive ffprobe path from ffmpeg path
    let ffprobe_exe = if ffmpeg_exe == "ffmpeg" {
        "ffprobe".to_string()
    } else {
        let p = PathBuf::from(ffmpeg_exe);
        p.parent()
            .map(|dir| dir.join("ffprobe").to_string_lossy().to_string())
            .unwrap_or_else(|| "ffprobe".to_string())
    };
    let mut cmd = Command::new(&ffprobe_exe);
    cmd.args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration",
            "-show_entries", "format=duration",
            "-of", "csv=p=0:s=,",
            video_path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.trim().lines().collect();

    // Parse "width,height,duration" or "width,height\nduration"
    let mut width: u32 = 1920;
    let mut height: u32 = 1080;
    let mut duration: f64 = 0.0;

    for line in &lines {
        let parts: Vec<&str> = line.split(',').collect();
        match parts.len() {
            3 => {
                width = parts[0].trim().parse().unwrap_or(1920);
                height = parts[1].trim().parse().unwrap_or(1080);
                duration = parts[2].trim().parse().unwrap_or(0.0);
            }
            2 => {
                if let (Ok(w), Ok(h)) = (parts[0].trim().parse::<u32>(), parts[1].trim().parse::<u32>()) {
                    width = w;
                    height = h;
                }
            }
            1 => {
                if let Ok(d) = parts[0].trim().parse::<f64>() {
                    if d > 0.0 {
                        duration = d;
                    }
                }
            }
            _ => {}
        }
    }

    Ok((width, height, duration))
}

/// Generate a thumbnail from the first second of the video
fn generate_video_thumbnail(
    video_path: &str,
    recordings_dir: &str,
    game_id: &str,
    ffmpeg_exe: &str,
) -> Result<String, String> {
    let thumbs_dir = PathBuf::from(recordings_dir)
        .join(game_id)
        .join("thumbnails");
    fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    let video_name = PathBuf::from(video_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let thumb_path = thumbs_dir.join(format!("thumb_{}.jpg", video_name));

    let mut cmd = Command::new(ffmpeg_exe);
    cmd.args([
            "-y",
            "-i", video_path,
            "-ss", "00:00:01",
            "-vframes", "1",
            "-vf", "scale=320:-1",
            "-q:v", "5",
            thumb_path.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let status = cmd.spawn()
        .and_then(|mut c| c.wait())
        .map_err(|e| format!("Thumbnail generation failed: {}", e))?;

    if !status.success() {
        return Err("Failed to generate thumbnail".to_string());
    }

    Ok(thumb_path.to_string_lossy().to_string())
}
