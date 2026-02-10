use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
            let steam_userdata = PathBuf::from(&program_files)
                .join("Steam")
                .join("userdata");
            if steam_userdata.exists() {
                if let Ok(entries) = fs::read_dir(&steam_userdata) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            result = result.replace(
                                "%STEAM_USERDATA%",
                                &entry.path().to_string_lossy(),
                            );
                            break;
                        }
                    }
                }
            }
        }
    }

    result
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
    let file_path = app.dialog().file()
        .add_filter("Executables", &["exe", "bat", "cmd", "lnk"])
        .add_filter("All Files", &["*"])
        .set_title("Select Game Executable")
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

/// Open a folder picker dialog
#[tauri::command]
pub async fn pick_folder_path(app: tauri::AppHandle, title: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file()
        .set_title(&title)
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

/// Open a file picker for images
#[tauri::command]
pub async fn pick_image_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app.dialog().file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .set_title("Select Image")
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

/// Get the app's data directory
#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}
