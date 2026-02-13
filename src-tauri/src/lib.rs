mod backup;
mod datadump;
mod games;
mod keymapper;
mod perf;
mod recording;
mod screenshots;
mod shortcuts;
mod tray;
mod window;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                use tauri_plugin_global_shortcut::{Shortcut as Sc, ShortcutState};
                if event.state() == ShortcutState::Pressed {
                    // Look up the action by re-parsing stored shortcut strings and comparing
                    let action_id = {
                        let state = app.state::<shortcuts::RegisteredShortcuts>();
                        let map = match state.map.lock() {
                            Ok(guard) => guard,
                            Err(poisoned) => poisoned.into_inner(),
                        };
                        map.iter().find_map(|(key_str, action)| {
                            if let Ok(s) = key_str.parse::<Sc>() {
                                if &s == shortcut {
                                    return Some(action.clone());
                                }
                            }
                            None
                        })
                    };
                    if let Some(action) = action_id {
                        shortcuts::handle_shortcut_action(app, &action);
                    }
                }
            })
            .build()
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:gamevault.db",
                    vec![
                        // Single consolidated migration - fresh DB
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "Create all tables",
                            sql: r#"
                                CREATE TABLE IF NOT EXISTS games (
                                    id TEXT PRIMARY KEY,
                                    name TEXT NOT NULL,
                                    developer TEXT DEFAULT '',
                                    steam_appid TEXT,
                                    cover_url TEXT,
                                    header_url TEXT,
                                    custom_cover_path TEXT,
                                    custom_header_path TEXT,
                                    save_paths TEXT NOT NULL DEFAULT '[]',
                                    extensions TEXT NOT NULL DEFAULT '[]',
                                    notes TEXT DEFAULT '',
                                    exe_path TEXT,
                                    is_custom INTEGER DEFAULT 0,
                                    is_detected INTEGER DEFAULT 0,
                                    is_favorite INTEGER DEFAULT 0,
                                    play_count INTEGER DEFAULT 0,
                                    total_playtime_seconds INTEGER DEFAULT 0,
                                    last_played_at TEXT,
                                    auto_backup_disabled INTEGER DEFAULT 0,
                                    added_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS backup_collections (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT NOT NULL,
                                    name TEXT NOT NULL,
                                    description TEXT DEFAULT '',
                                    max_backups INTEGER DEFAULT 10,
                                    color TEXT DEFAULT '#6366f1',
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
                                );

                                CREATE TABLE IF NOT EXISTS backups (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT NOT NULL,
                                    collection_id TEXT,
                                    display_name TEXT DEFAULT '',
                                    file_path TEXT NOT NULL,
                                    file_size INTEGER DEFAULT 0,
                                    compressed_size INTEGER DEFAULT 0,
                                    content_hash TEXT,
                                    source_path TEXT,
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    notes TEXT DEFAULT '',
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
                                    FOREIGN KEY (collection_id) REFERENCES backup_collections(id) ON DELETE SET NULL
                                );

                                CREATE TABLE IF NOT EXISTS screenshots (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT NOT NULL,
                                    file_path TEXT NOT NULL,
                                    thumbnail_path TEXT,
                                    title TEXT DEFAULT '',
                                    description TEXT DEFAULT '',
                                    tags TEXT NOT NULL DEFAULT '[]',
                                    width INTEGER DEFAULT 0,
                                    height INTEGER DEFAULT 0,
                                    file_size INTEGER DEFAULT 0,
                                    captured_at TEXT NOT NULL DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS recordings (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT NOT NULL,
                                    file_path TEXT NOT NULL,
                                    thumbnail_path TEXT DEFAULT '',
                                    title TEXT DEFAULT '',
                                    description TEXT DEFAULT '',
                                    tags TEXT NOT NULL DEFAULT '[]',
                                    width INTEGER DEFAULT 0,
                                    height INTEGER DEFAULT 0,
                                    file_size INTEGER DEFAULT 0,
                                    duration_seconds REAL DEFAULT 0,
                                    fps INTEGER DEFAULT 30,
                                    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS key_mappings (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT,
                                    name TEXT NOT NULL,
                                    description TEXT DEFAULT '',
                                    source_key TEXT NOT NULL,
                                    target_key TEXT NOT NULL,
                                    is_active INTEGER DEFAULT 1,
                                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS macros (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT,
                                    name TEXT NOT NULL,
                                    description TEXT DEFAULT '',
                                    trigger_key TEXT NOT NULL,
                                    actions TEXT NOT NULL DEFAULT '[]',
                                    delay_ms INTEGER DEFAULT 50,
                                    repeat_count INTEGER DEFAULT 1,
                                    is_active INTEGER DEFAULT 1,
                                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS shortcuts (
                                    id TEXT PRIMARY KEY,
                                    action_id TEXT NOT NULL UNIQUE,
                                    label TEXT NOT NULL,
                                    description TEXT DEFAULT '',
                                    keys TEXT NOT NULL,
                                    is_global INTEGER DEFAULT 0,
                                    is_active INTEGER DEFAULT 1,
                                    category TEXT DEFAULT 'general'
                                );

                                CREATE TABLE IF NOT EXISTS settings (
                                    key TEXT PRIMARY KEY,
                                    value TEXT NOT NULL,
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS ai_conversations (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT,
                                    title TEXT DEFAULT 'New Chat',
                                    source TEXT DEFAULT 'main',
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
                                );

                                CREATE TABLE IF NOT EXISTS ai_messages (
                                    id TEXT PRIMARY KEY,
                                    conversation_id TEXT NOT NULL,
                                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                                    content TEXT NOT NULL,
                                    image_paths TEXT DEFAULT '[]',
                                    metadata TEXT,
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
                                );

                                CREATE TABLE IF NOT EXISTS game_notes (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT NOT NULL,
                                    title TEXT NOT NULL DEFAULT 'Untitled Note',
                                    content TEXT NOT NULL DEFAULT '',
                                    color TEXT DEFAULT '#6366f1',
                                    is_pinned INTEGER DEFAULT 0,
                                    reminder_enabled INTEGER DEFAULT 0,
                                    remind_next_session INTEGER DEFAULT 0,
                                    remind_at TEXT,
                                    recurring_days INTEGER,
                                    last_reminded_at TEXT,
                                    last_shown_at TEXT,
                                    is_dismissed INTEGER DEFAULT 0,
                                    tags TEXT DEFAULT '[]',
                                    is_archived INTEGER DEFAULT 0,
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
                                );

                                CREATE INDEX IF NOT EXISTS idx_game_notes_reminders ON game_notes(game_id, reminder_enabled, is_dismissed);

                                CREATE TABLE IF NOT EXISTS play_sessions (
                                    id TEXT PRIMARY KEY,
                                    game_id TEXT NOT NULL,
                                    pid INTEGER,
                                    exe_path TEXT,
                                    started_at TEXT NOT NULL,
                                    ended_at TEXT NOT NULL,
                                    duration_seconds INTEGER NOT NULL,
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
                                );

                                CREATE INDEX IF NOT EXISTS idx_play_sessions_game_id ON play_sessions(game_id);

                                CREATE TABLE IF NOT EXISTS playtime_daily (
                                    game_id TEXT NOT NULL,
                                    day TEXT NOT NULL,
                                    duration_seconds INTEGER NOT NULL DEFAULT 0,
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    PRIMARY KEY (game_id, day),
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
                                );

                                -- Default settings
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_directory', '');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_detect_games', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_enabled', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('screenshots_directory', '');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_provider', 'openrouter');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_api_key', '');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_openrouter_api_key', '');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_openai_api_key', '');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_model', 'openai/gpt-5.2:online');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('overlay_shortcut', 'Ctrl+Shift+G');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('screenshot_shortcut', 'Ctrl+Shift+S');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('quick_backup_shortcut', 'Ctrl+Shift+B');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('setup_complete', 'false');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_backup_enabled', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_backup_interval_minutes', '30');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('max_backups_per_game', '10');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('compress_backups', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_backup_complete', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('launch_on_startup', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('minimize_to_tray', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('overlay_opacity', '92');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('recordings_directory', '');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('recording_fps', '30');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('recording_resolution', 'native');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('recording_quality', 'medium');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('recording_shortcut', 'F9');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ffmpeg_path', 'ffmpeg');

                                -- Default shortcuts
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s1', 'toggle_overlay', 'Toggle Overlay', 'Ctrl+Shift+G', 1, 'overlay');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s2', 'take_screenshot', 'Take Screenshot', 'Ctrl+Shift+S', 1, 'screenshots');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s3', 'quick_backup', 'Quick Backup', 'Ctrl+Shift+B', 1, 'backups');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s4', 'toggle_key_mappings', 'Toggle Key Mappings', 'Ctrl+Shift+K', 1, 'keymapper');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s5', 'toggle_macros', 'Toggle Macros', 'Ctrl+Shift+M', 1, 'macros');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s6', 'toggle_recording', 'Toggle Recording', 'F9', 1, 'recordings');
                            "#,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .manage(shortcuts::RegisteredShortcuts::default())
        .setup(|app| {
            // Build system tray
            tray::build_tray(app)?;

            // Set window icon from PNG (ensures correct icon even without full rebuild)
            if let Some(main_window) = app.get_webview_window("main") {
                let png_bytes = include_bytes!("../icons/icon.png");
                let img = image::load_from_memory(png_bytes).expect("Failed to decode icon");
                let rgba = img.to_rgba8();
                let (w, h) = rgba.dimensions();
                let icon = tauri::image::Image::new_owned(rgba.into_raw(), w, h);
                let _ = main_window.set_icon(icon);
            }

            // Hide overlay window on startup and apply no-activate flag
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
                // Apply WS_EX_NOACTIVATE so overlay never steals focus from games
                #[cfg(target_os = "windows")]
                window::apply_no_activate(&overlay);
            }

            tracing::info!("GameVault initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Backup commands
            backup::create_backup,
            backup::restore_backup,
            backup::delete_backup,
            backup::rename_backup,
            backup::get_backup_info,
            backup::get_folder_size,
            backup::open_backup_directory,
            backup::open_save_directory,
            backup::scan_backup_directory,
            backup::export_backup,
            backup::import_external_backup,
            // Game commands
            games::detect_installed_games,
            games::expand_env_path,
            games::check_path_exists,
            games::launch_game,
            games::pick_exe_path,
            games::pick_folder_path,
            games::pick_image_file,
            games::get_app_data_dir,
            games::list_running_windows,
            games::get_last_foreground_window,
            // Screenshot commands
            screenshots::capture_screen,
            screenshots::capture_area,
            screenshots::save_screenshot_file,
            screenshots::generate_thumbnail,
            screenshots::open_screenshot,
            // Recording commands
            recording::check_ffmpeg,
            recording::start_recording,
            recording::stop_recording,
            recording::get_recording_status,
            recording::open_recording,
            recording::delete_recording_file,
            recording::get_bundled_ffmpeg_path,
            recording::download_ffmpeg,
            recording::resolve_ffmpeg,
            // Key mapper commands
            keymapper::simulate_key_press,
            keymapper::simulate_key_release,
            keymapper::simulate_key_tap,
            // Shortcuts
            shortcuts::check_shortcuts_registered,
            shortcuts::get_registered_shortcuts,
            shortcuts::validate_shortcut_key,
            shortcuts::update_shortcuts,
            // Performance
            perf::get_performance_snapshot,
            // AI commands
            ai_chat,
            // Overlay
            toggle_overlay,
            show_overlay,
            hide_overlay,
            set_overlay_position,
            set_overlay_height,
            window::lock_overlay,
            window::unlock_overlay,
            // Startup behavior
            set_launch_on_startup,
            is_launch_on_startup_enabled,
            // Data dump
            datadump::export_vault_data,
            datadump::import_vault_data,
            // General
            get_version,
            check_for_updates,
            download_and_install_update,
            open_external_url,
        ])
        .on_window_event(|window, event| {
            // Intercept main-window close → hide to tray instead of destroying it
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building GameVault")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}

// ─── Overlay Commands ──────────────────────────────────────────

/// Show the overlay window without stealing focus from the current foreground app (game).
/// Uses direct Windows API: ShowWindow(SW_SHOWNOACTIVATE) to show without activation.
/// On other platforms: falls back to regular show().
pub fn show_overlay_no_activate(overlay: &tauri::WebviewWindow<tauri::Wry>) {
    #[cfg(target_os = "windows")]
    {
        window::show_no_activate(overlay);
        window::apply_no_activate(overlay);
        return;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = overlay.show();
    }
}

/// Position the overlay strip at top-center of the primary monitor
pub fn position_overlay_strip(overlay: &tauri::WebviewWindow<tauri::Wry>) {
    if let Ok(Some(monitor)) = overlay.primary_monitor() {
        let monitor_size = monitor.size();
        let scale = monitor.scale_factor();
        let strip_width: f64 = 700.0;
        let strip_height: f64 = 54.0;
        let x = ((monitor_size.width as f64 / scale) - strip_width) / 2.0;
        let y: f64 = 0.0; // top of screen

        let _ = overlay.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: strip_width,
            height: strip_height,
        }));
        let _ = overlay.set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x,
            y,
        }));
    }
}

fn ensure_overlay_window(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow<tauri::Wry>, String> {
    if let Some(existing) = app.get_webview_window("overlay") {
        return Ok(existing);
    }

    let overlay = tauri::WebviewWindowBuilder::new(
        app,
        "overlay",
        tauri::WebviewUrl::App("/?window=overlay".into()),
    )
    .title("Game Vault Overlay")
    .inner_size(700.0, 54.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .shadow(false)
    .build()
    .map_err(|e| e.to_string())?;

    // Apply WS_EX_NOACTIVATE so the recreated overlay never steals focus
    #[cfg(target_os = "windows")]
    window::apply_no_activate(&overlay);

    Ok(overlay)
}

#[tauri::command]
async fn toggle_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = ensure_overlay_window(&app)?;
    if overlay.is_visible().unwrap_or(false) {
        overlay.hide().map_err(|e| e.to_string())?;
    } else {
        games::cache_foreground_window_snapshot();
        position_overlay_strip(&overlay);
        show_overlay_no_activate(&overlay);
    }
    Ok(())
}

#[tauri::command]
async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = ensure_overlay_window(&app)?;
    games::cache_foreground_window_snapshot();
    position_overlay_strip(&overlay);
    show_overlay_no_activate(&overlay);
    Ok(())
}

#[tauri::command]
async fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_overlay_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let current_size = overlay.outer_size().map_err(|e| e.to_string())?;
        let scale = overlay
            .scale_factor()
            .map_err(|e| e.to_string())?;
        let current_width = current_size.width as f64 / scale;
        overlay
            .set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: current_width,
                height,
            }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_overlay_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay
            .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── General Commands ──────────────────────────────────────────
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Compare semver: returns true if `latest` is strictly newer than `current`.
fn is_version_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> (u64, u64, u64) {
        let parts: Vec<u64> = v
            .trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        (
            parts.first().copied().unwrap_or(0),
            parts.get(1).copied().unwrap_or(0),
            parts.get(2).copied().unwrap_or(0),
        )
    };
    let (lmaj, lmin, lpatch) = parse(latest);
    let (cmaj, cmin, cpatch) = parse(current);
    (lmaj, lmin, lpatch) > (cmaj, cmin, cpatch)
}

#[tauri::command]
async fn check_for_updates() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/repos/Kawai-Senpai/GameVault/releases/latest")
        .header("User-Agent", "GameVault")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let latest_version = json["tag_name"]
        .as_str()
        .unwrap_or("v0.0.0")
        .trim_start_matches('v');
    let current = env!("CARGO_PKG_VERSION");

    // Find the NSIS installer asset (.exe) for auto-update
    let mut download_url = String::new();
    let mut download_size: u64 = 0;
    if let Some(assets) = json["assets"].as_array() {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            // Look for NSIS installer (.exe) or .msi
            if name.ends_with(".exe") || name.ends_with(".msi") {
                download_url = asset["browser_download_url"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                download_size = asset["size"].as_u64().unwrap_or(0);
                break;
            }
        }
    }

    // Semantic version comparison (major.minor.patch)
    let is_newer = is_version_newer(latest_version, current);

    Ok(serde_json::json!({
        "current_version": current,
        "latest_version": latest_version,
        "update_available": is_newer,
        "release_url": json["html_url"].as_str().unwrap_or(""),
        "release_notes": json["body"].as_str().unwrap_or(""),
        "download_url": download_url,
        "download_size": download_size,
    }))
}

#[tauri::command]
async fn download_and_install_update(download_url: String) -> Result<String, String> {
    if download_url.is_empty() {
        return Err("No download URL provided".to_string());
    }

    // Determine file extension from URL
    let ext = if download_url.ends_with(".msi") {
        ".msi"
    } else {
        ".exe"
    };

    // Download to temp directory
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(format!("GameVault_update{}", ext));

    let client = reqwest::Client::new();
    let resp = client
        .get(&download_url)
        .header("User-Agent", "GameVault")
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    std::fs::write(&installer_path, &bytes)
        .map_err(|e| format!("Failed to save installer: {}", e))?;

    // Launch the installer
    let installer_str = installer_path.to_string_lossy().to_string();

    if ext == ".msi" {
        std::process::Command::new("msiexec")
            .args(["/i", &installer_str, "/passive"])
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
    } else {
        std::process::Command::new(&installer_str)
            .arg("/S") // NSIS silent install flag
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
    }

    Ok(installer_str)
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                KEY_SET_VALUE,
            )
            .map_err(|e| e.to_string())?;
        let value_name = "GameVault";

        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let value = format!("\"{}\"", exe.to_string_lossy());
            run_key
                .set_value(value_name, &value)
                .map_err(|e| e.to_string())?;
        } else {
            let _ = run_key.delete_value(value_name);
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
fn is_launch_on_startup_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                KEY_READ,
            )
            .map_err(|e| e.to_string())?;
        let value_name = "GameVault";
        let value: Result<String, _> = run_key.get_value(value_name);
        return Ok(value.is_ok());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

// ─── AI Chat Command ───────────────────────────────────────────
#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct ChatMsg {
    role: String,
    content: String,
}

#[tauri::command]
async fn ai_chat(_messages: Vec<ChatMsg>) -> Result<String, String> {
    Err("AI_NOT_CONFIGURED: Configure your provider and API key in Settings > AI Configuration.".to_string())
}
