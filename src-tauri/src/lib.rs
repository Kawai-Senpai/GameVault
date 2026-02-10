mod backup;
mod games;
mod screenshots;
mod keymapper;
mod tray;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:gamevault.db",
                    vec![
                        // Migration 1: Core tables
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "Create core tables",
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
                                    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
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
                                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_model', 'openai/gpt-4o-mini');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('overlay_shortcut', 'Shift+Tab');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('screenshot_shortcut', 'F12');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('quick_backup_shortcut', 'Ctrl+Shift+B');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('setup_complete', 'false');

                                -- New settings defaults
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_backup_enabled', 'false');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_backup_interval_minutes', '30');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('max_backups_per_game', '10');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('compress_backups', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_backup_complete', 'true');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('launch_on_startup', 'false');
                                INSERT OR IGNORE INTO settings (key, value) VALUES ('minimize_to_tray', 'true');

                                -- Default shortcuts
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s1', 'toggle_overlay', 'Toggle Overlay', 'Shift+Tab', 1, 'overlay');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s2', 'take_screenshot', 'Take Screenshot', 'F12', 1, 'screenshots');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s3', 'quick_backup', 'Quick Backup', 'Ctrl+Shift+B', 1, 'backups');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s4', 'toggle_key_mappings', 'Toggle Key Mappings', 'Ctrl+Shift+K', 1, 'keymapper');
                                INSERT OR IGNORE INTO shortcuts (id, action_id, label, keys, is_global, category) VALUES ('s5', 'toggle_macros', 'Toggle Macros', 'Ctrl+Shift+M', 1, 'macros');
                            "#,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
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

            // Hide overlay window on startup
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
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
            // Game commands
            games::detect_installed_games,
            games::expand_env_path,
            games::check_path_exists,
            games::launch_game,
            games::pick_exe_path,
            games::pick_folder_path,
            games::pick_image_file,
            games::get_app_data_dir,
            // Screenshot commands
            screenshots::capture_screen,
            screenshots::capture_area,
            screenshots::save_screenshot_file,
            screenshots::generate_thumbnail,
            screenshots::open_screenshot,
            // Key mapper commands
            keymapper::simulate_key_press,
            keymapper::simulate_key_release,
            keymapper::simulate_key_tap,
            // AI commands
            ai_chat,
            // Overlay
            toggle_overlay,
            show_overlay,
            hide_overlay,
            set_overlay_position,
            // General
            get_version,
            check_for_updates,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GameVault");
}

// ─── Overlay Commands ──────────────────────────────────────────
#[tauri::command]
async fn toggle_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible().unwrap_or(false) {
            overlay.hide().map_err(|e| e.to_string())?;
        } else {
            overlay.show().map_err(|e| e.to_string())?;
            overlay.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.show().map_err(|e| e.to_string())?;
        overlay.set_focus().map_err(|e| e.to_string())?;
    }
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
async fn set_overlay_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: x as i32,
                y: y as i32,
            }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── General Commands ──────────────────────────────────────────
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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

    Ok(serde_json::json!({
        "current_version": current,
        "latest_version": latest_version,
        "update_available": latest_version != current,
        "release_url": json["html_url"].as_str().unwrap_or(""),
        "release_notes": json["body"].as_str().unwrap_or(""),
    }))
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

// ─── AI Chat Command ───────────────────────────────────────────
#[derive(serde::Deserialize)]
struct ChatMsg {
    role: String,
    content: String,
}

#[tauri::command]
async fn ai_chat(messages: Vec<ChatMsg>) -> Result<String, String> {
    // Placeholder: Returns a helpful local response.
    // In production, this would call OpenRouter/OpenAI API using
    // the user's configured API key from settings.
    let last = messages
        .last()
        .map(|m| m.content.as_str())
        .unwrap_or("")
        .to_lowercase();

    let response = if last.contains("save") && (last.contains("where") || last.contains("location")) {
        "Most PC game saves are found in:\n• %APPDATA% (Roaming)\n• %LOCALAPPDATA%\n• Documents\\My Games\\\n• Steam: steamapps\\common\\<game>\\saves\n\nUse GameVault's auto-detect to find them automatically."
    } else if last.contains("backup") {
        "Backup tips:\n1. Back up before major updates\n2. Use descriptive names for backups\n3. Enable auto-backup in Settings\n4. Test restores periodically\n5. Keep cloud + local copies"
    } else {
        "I can help with save locations, backup strategies, and gaming tips. What would you like to know?"
    };

    Ok(response.to_string())
}
