use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameEntry {
    pub id: String,
    pub name: String,
    pub developer: String,
    pub steam_appid: Option<String>,
    pub cover_url: Option<String>,
    pub header_url: Option<String>,
    pub save_paths: Vec<String>,
    pub extensions: Vec<String>,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GameDatabase {
    pub games: Vec<GameEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectedGame {
    pub id: String,
    pub name: String,
    pub developer: String,
    pub steam_appid: Option<String>,
    pub cover_url: Option<String>,
    pub header_url: Option<String>,
    pub save_paths: Vec<String>,
    pub resolved_save_path: String,
    pub extensions: Vec<String>,
    pub notes: String,
    pub save_size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunningWindowInfo {
    pub pid: u32,
    pub title: String,
    pub process_name: String,
    pub exe_path: String,
    pub is_foreground: bool,
}

static LAST_FOREGROUND_WINDOW: Lazy<Mutex<Option<RunningWindowInfo>>> =
    Lazy::new(|| Mutex::new(None));

/// Expand Windows environment variables in a path
fn expand_env_vars(path: &str) -> String {
    let mut result = path.to_string();
    let vars = [
        ("APPDATA", "APPDATA"),
        ("LOCALAPPDATA", "LOCALAPPDATA"),
        ("USERPROFILE", "USERPROFILE"),
        ("PROGRAMFILES", "PROGRAMFILES"),
        ("PROGRAMFILES(X86)", "ProgramFiles(x86)"),
        ("PROGRAMDATA", "PROGRAMDATA"),
        ("HOMEDRIVE", "HOMEDRIVE"),
        ("HOMEPATH", "HOMEPATH"),
    ];

    for (placeholder, env_key) in &vars {
        let pattern = format!("%{}%", placeholder);
        if result.contains(&pattern) {
            if let Ok(val) = std::env::var(env_key) {
                result = result.replace(&pattern, &val);
            }
        }
    }

    // Handle Steam userdata path
    if result.contains("%STEAM_USERDATA%") {
        if let Ok(program_files) = std::env::var("ProgramFiles(x86)") {
            let steam_userdata = PathBuf::from(&program_files).join("Steam").join("userdata");
            if steam_userdata.exists() {
                if let Ok(entries) = fs::read_dir(&steam_userdata) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            result =
                                result.replace("%STEAM_USERDATA%", &entry.path().to_string_lossy());
                            break;
                        }
                    }
                }
            }
        }
    }

    result
}

#[cfg(target_os = "windows")]
mod windows_detect {
    use super::RunningWindowInfo;
    use std::collections::HashSet;
    use sysinfo::{Pid, ProcessesToUpdate, System};
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible,
    };

    struct WindowEnumContext {
        windows: Vec<(u32, String)>,
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }

        let length = unsafe { GetWindowTextLengthW(hwnd) };
        if length <= 0 {
            return 1;
        }

        let mut title_buf = vec![0u16; (length + 1) as usize];
        let copied = unsafe { GetWindowTextW(hwnd, title_buf.as_mut_ptr(), length + 1) };
        if copied <= 0 {
            return 1;
        }

        let title = String::from_utf16_lossy(&title_buf[..copied as usize])
            .trim()
            .to_string();
        if title.is_empty() || title.eq_ignore_ascii_case("program manager") {
            return 1;
        }

        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == 0 {
            return 1;
        }

        let ctx_ptr = lparam as *mut WindowEnumContext;
        if !ctx_ptr.is_null() {
            unsafe { (*ctx_ptr).windows.push((pid, title)) };
        }

        1
    }

    fn enum_visible_windows() -> Vec<(u32, String)> {
        let mut context = WindowEnumContext {
            windows: Vec::new(),
        };
        unsafe {
            EnumWindows(
                Some(enum_windows_proc),
                &mut context as *mut WindowEnumContext as LPARAM,
            );
        }
        context.windows
    }

    fn foreground_pid() -> Option<u32> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == 0 {
            None
        } else {
            Some(pid)
        }
    }

    fn looks_like_ours(process_name: &str, exe_path: &str, title: &str) -> bool {
        let process_name = process_name.to_lowercase();
        let exe_path = exe_path.to_lowercase();
        let title = title.to_lowercase();
        process_name.contains("gamevault")
            || exe_path.contains("gamevault")
            || title.contains("gamevault")
            || title.contains("toolbox")
    }

    pub fn list_running_windows() -> Vec<RunningWindowInfo> {
        let windows = enum_visible_windows();
        let foreground = foreground_pid();

        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let mut seen = HashSet::new();
        let mut items = Vec::new();

        for (pid, title) in windows {
            let process = system.process(Pid::from_u32(pid));
            let (process_name, exe_path) = if let Some(p) = process {
                let name = p.name().to_string_lossy().to_string();
                let exe = p
                    .exe()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default();
                (name, exe)
            } else {
                (format!("pid-{pid}"), String::new())
            };

            if looks_like_ours(&process_name, &exe_path, &title) {
                continue;
            }

            let dedupe_key = format!("{}::{}::{}", pid, exe_path, title);
            if !seen.insert(dedupe_key) {
                continue;
            }

            items.push(RunningWindowInfo {
                pid,
                title,
                process_name,
                exe_path,
                is_foreground: foreground == Some(pid),
            });
        }

        items.sort_by(|a, b| {
            b.is_foreground
                .cmp(&a.is_foreground)
                .then_with(|| a.process_name.cmp(&b.process_name))
                .then_with(|| a.title.cmp(&b.title))
        });
        items
    }
}

fn current_foreground_window() -> Option<RunningWindowInfo> {
    #[cfg(target_os = "windows")]
    {
        let list = windows_detect::list_running_windows();
        return list
            .iter()
            .find(|w| w.is_foreground)
            .cloned()
            .or_else(|| list.into_iter().next());
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

pub fn cache_foreground_window_snapshot() {
    if let Ok(mut guard) = LAST_FOREGROUND_WINDOW.lock() {
        *guard = current_foreground_window();
    }
}

/// Return a list of visible running windows for quick in-overlay game mapping.
#[tauri::command]
pub async fn list_running_windows() -> Result<Vec<RunningWindowInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(windows_detect::list_running_windows())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

/// Return the foreground window captured before the overlay was shown.
#[tauri::command]
pub fn get_last_foreground_window() -> Option<RunningWindowInfo> {
    if let Ok(guard) = LAST_FOREGROUND_WINDOW.lock() {
        if guard.is_some() {
            return guard.clone();
        }
    }
    current_foreground_window()
}

/// Detect installed games by checking if their save paths exist
#[tauri::command]
pub async fn detect_installed_games(games_json: String) -> Result<Vec<DetectedGame>, String> {
    let db: GameDatabase = serde_json::from_str(&games_json).map_err(|e| e.to_string())?;
    let mut detected = Vec::new();

    for game in &db.games {
        for save_path in &game.save_paths {
            // Skip paths we can't resolve
            if save_path.contains("%GAME_INSTALL%") {
                continue;
            }

            let expanded = expand_env_vars(save_path);
            let path = PathBuf::from(&expanded);

            if path.exists() {
                let save_size = walkdir::WalkDir::new(&path)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file())
                    .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
                    .sum();

                detected.push(DetectedGame {
                    id: game.id.clone(),
                    name: game.name.clone(),
                    developer: game.developer.clone(),
                    steam_appid: game.steam_appid.clone(),
                    cover_url: game.cover_url.clone(),
                    header_url: game.header_url.clone(),
                    save_paths: game.save_paths.clone(),
                    resolved_save_path: expanded,
                    extensions: game.extensions.clone(),
                    notes: game.notes.clone(),
                    save_size,
                });
                break; // Found a valid path, move to next game
            }
        }
    }

    Ok(detected)
}

/// Expand environment variables in a path and return the resolved path
#[tauri::command]
pub fn expand_env_path(path: String) -> String {
    expand_env_vars(&path)
}

/// Check if a path exists
#[tauri::command]
pub fn check_path_exists(path: String) -> bool {
    let expanded = expand_env_vars(&path);
    PathBuf::from(&expanded).exists()
}

/// Launch a game executable
#[tauri::command]
pub async fn launch_game(exe_path: String) -> Result<(), String> {
    let path = PathBuf::from(&exe_path);
    if !path.exists() {
        return Err(format!("Executable not found: {}", exe_path));
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new(&exe_path)
            .spawn()
            .map_err(|e| format!("Failed to launch game: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        open::that(&exe_path).map_err(|e| format!("Failed to launch game: {}", e))?;
    }

    Ok(())
}

/// Open a file picker to select a game executable
#[tauri::command]
pub async fn pick_exe_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .add_filter("Executables", &["exe", "bat", "cmd", "lnk"])
        .add_filter("All Files", &["*"])
        .set_title("Select Game Executable")
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

/// Open a folder picker dialog
#[tauri::command]
pub async fn pick_folder_path(
    app: tauri::AppHandle,
    title: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().set_title(&title).blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

/// Open a file picker for images
#[tauri::command]
pub async fn pick_image_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .set_title("Select Image")
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

/// Get the app's data directory
#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}
