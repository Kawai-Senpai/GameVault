use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Keys to exclude from settings export (security-sensitive)
const EXCLUDED_SETTINGS_KEYS: &[&str] = &[
    "ai_api_key",
    "ai_openrouter_api_key",
    "ai_openai_api_key",
];

/// The complete dump structure for GameVault data
#[derive(Debug, Serialize, Deserialize)]
pub struct GameVaultDump {
    pub format_version: u32,
    pub app_version: String,
    pub exported_at: String,
    pub games: Vec<serde_json::Value>,
    pub settings: Vec<serde_json::Value>,
    pub key_mappings: Vec<serde_json::Value>,
    pub macros: Vec<serde_json::Value>,
    pub shortcuts: Vec<serde_json::Value>,
    pub game_notes: Vec<serde_json::Value>,
    pub backup_collections: Vec<serde_json::Value>,
    pub backups_metadata: Vec<serde_json::Value>,
    pub play_sessions: Vec<serde_json::Value>,
    pub playtime_daily: Vec<serde_json::Value>,
    pub ai_conversations: Vec<serde_json::Value>,
    pub ai_messages: Vec<serde_json::Value>,
}

/// Get the SQLite database path used by tauri-plugin-sql
fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_dir.join("gamevault.db"))
}

/// Check if a table exists in the database
fn table_exists(conn: &rusqlite::Connection, table: &str) -> bool {
    conn.prepare(&format!(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='{}'",
        table
    ))
    .and_then(|mut stmt| stmt.query_row([], |_| Ok(())))
    .is_ok()
}

/// Read all rows from a table as generic JSON values
fn read_table(
    conn: &rusqlite::Connection,
    table: &str,
) -> Result<Vec<serde_json::Value>, String> {
    if !table_exists(conn, table) {
        return Ok(Vec::new());
    }

    let query = format!("SELECT * FROM {}", table);
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query for {}: {}", table, e))?;

    let column_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();

    let rows = stmt
        .query_map([], |row| {
            let mut map = serde_json::Map::new();
            for (i, col_name) in column_names.iter().enumerate() {
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => serde_json::Value::Number(n.into()),
                    rusqlite::types::Value::Real(f) => serde_json::Value::Number(
                        serde_json::Number::from_f64(f).unwrap_or_else(|| 0.into()),
                    ),
                    rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
                    rusqlite::types::Value::Blob(b) => {
                        use base64::Engine;
                        serde_json::Value::String(
                            base64::engine::general_purpose::STANDARD.encode(&b),
                        )
                    }
                };
                map.insert(col_name.clone(), json_val);
            }
            Ok(serde_json::Value::Object(map))
        })
        .map_err(|e| format!("Failed to query {}: {}", table, e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Row error in {}: {}", table, e))?);
    }
    Ok(result)
}

/// Filter out excluded settings (API keys)
fn filter_settings(settings: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    settings
        .into_iter()
        .filter(|row| {
            if let Some(key) = row.get("key").and_then(|k| k.as_str()) {
                !EXCLUDED_SETTINGS_KEYS.contains(&key)
            } else {
                true
            }
        })
        .collect()
}

// ─── Export Command ────────────────────────────────────────────

/// Export all GameVault data to a .gvdump file.
/// `file_path` is provided by the frontend (picked via tauri-plugin-dialog).
#[tauri::command]
pub async fn export_vault_data(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<serde_json::Value, String> {
    if file_path.is_empty() {
        return Err("No file path provided".to_string());
    }

    let db_path = get_db_path(&app)?;
    if !db_path.exists() {
        return Err("Database not found. No data to export.".to_string());
    }

    // Open DB read-only
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open database: {}", e))?;

    let games = read_table(&conn, "games")?;
    let settings_raw = read_table(&conn, "settings")?;
    let settings = filter_settings(settings_raw);
    let key_mappings = read_table(&conn, "key_mappings")?;
    let macros = read_table(&conn, "macros")?;
    let shortcuts = read_table(&conn, "shortcuts")?;
    let game_notes = read_table(&conn, "game_notes")?;
    let backup_collections = read_table(&conn, "backup_collections")?;
    let backups_metadata = read_table(&conn, "backups")?;
    let play_sessions = read_table(&conn, "play_sessions")?;
    let playtime_daily = read_table(&conn, "playtime_daily")?;
    let ai_conversations = read_table(&conn, "ai_conversations")?;
    let ai_messages = read_table(&conn, "ai_messages")?;

    let dump = GameVaultDump {
        format_version: 1,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        games,
        settings,
        key_mappings,
        macros,
        shortcuts,
        game_notes,
        backup_collections,
        backups_metadata,
        play_sessions,
        playtime_daily,
        ai_conversations,
        ai_messages,
    };

    let json = serde_json::to_string_pretty(&dump)
        .map_err(|e| format!("Failed to serialize data: {}", e))?;

    std::fs::write(&file_path, &json)
        .map_err(|e| format!("Failed to write dump file: {}", e))?;

    let file_size = json.len();

    Ok(serde_json::json!({
        "games": dump.games.len(),
        "settings": dump.settings.len(),
        "key_mappings": dump.key_mappings.len(),
        "macros": dump.macros.len(),
        "shortcuts": dump.shortcuts.len(),
        "game_notes": dump.game_notes.len(),
        "backup_collections": dump.backup_collections.len(),
        "backups_metadata": dump.backups_metadata.len(),
        "play_sessions": dump.play_sessions.len(),
        "playtime_daily": dump.playtime_daily.len(),
        "ai_conversations": dump.ai_conversations.len(),
        "ai_messages": dump.ai_messages.len(),
        "file_path": file_path,
        "file_size": file_size,
    }))
}

// ─── Import Command ────────────────────────────────────────────

/// Import GameVault data from a .gvdump file.
/// `file_path` is provided by the frontend (picked via tauri-plugin-dialog).
#[tauri::command]
pub async fn import_vault_data(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<serde_json::Value, String> {
    if file_path.is_empty() {
        return Err("No file path provided".to_string());
    }

    let json_str = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read dump file: {}", e))?;

    let dump: GameVaultDump = serde_json::from_str(&json_str)
        .map_err(|e| format!("Invalid dump file format: {}", e))?;

    if dump.format_version != 1 {
        return Err(format!(
            "Unsupported dump format version: {}. This app supports version 1.",
            dump.format_version
        ));
    }

    let db_path = get_db_path(&app)?;
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let mut imported = serde_json::Map::new();

    // Import games
    let c = upsert_rows(&conn, "games", &dump.games)?;
    imported.insert("games".into(), c.into());

    // Import settings (skip API key fields)
    let safe_settings: Vec<_> = dump
        .settings
        .iter()
        .filter(|row| {
            if let Some(key) = row.get("key").and_then(|k| k.as_str()) {
                !EXCLUDED_SETTINGS_KEYS.contains(&key)
            } else {
                true
            }
        })
        .cloned()
        .collect();
    let c = upsert_rows(&conn, "settings", &safe_settings)?;
    imported.insert("settings".into(), c.into());

    // Import key_mappings
    let c = upsert_rows(&conn, "key_mappings", &dump.key_mappings)?;
    imported.insert("key_mappings".into(), c.into());

    // Import macros
    let c = upsert_rows(&conn, "macros", &dump.macros)?;
    imported.insert("macros".into(), c.into());

    // Import shortcuts
    let c = upsert_rows(&conn, "shortcuts", &dump.shortcuts)?;
    imported.insert("shortcuts".into(), c.into());

    // Import game_notes
    let c = upsert_rows(&conn, "game_notes", &dump.game_notes)?;
    imported.insert("game_notes".into(), c.into());

    // Import backup_collections
    let c = upsert_rows(&conn, "backup_collections", &dump.backup_collections)?;
    imported.insert("backup_collections".into(), c.into());

    // Import backups metadata
    let c = upsert_rows(&conn, "backups", &dump.backups_metadata)?;
    imported.insert("backups_metadata".into(), c.into());

    // Import play_sessions (if table exists)
    if table_exists(&conn, "play_sessions") {
        let c = upsert_rows(&conn, "play_sessions", &dump.play_sessions)?;
        imported.insert("play_sessions".into(), c.into());
    }

    // Import playtime_daily (composite PK)
    if table_exists(&conn, "playtime_daily") {
        let c = upsert_playtime_daily(&conn, &dump.playtime_daily)?;
        imported.insert("playtime_daily".into(), c.into());
    }

    // Import AI conversations
    let c = upsert_rows(&conn, "ai_conversations", &dump.ai_conversations)?;
    imported.insert("ai_conversations".into(), c.into());

    // Import AI messages
    let c = upsert_rows(&conn, "ai_messages", &dump.ai_messages)?;
    imported.insert("ai_messages".into(), c.into());

    Ok(serde_json::Value::Object(imported))
}

// ─── Helpers ───────────────────────────────────────────────────

/// Get column names from a table via PRAGMA
fn get_table_columns(conn: &rusqlite::Connection, table: &str) -> Result<Vec<String>, String> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("PRAGMA failed for {}: {}", table, e))?;
    let cols = stmt
        .query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })
        .map_err(|e| format!("Failed to read columns for {}: {}", table, e))?;

    let mut result = Vec::new();
    for col in cols {
        result.push(col.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Upsert rows into a table using INSERT OR REPLACE.
/// Dynamically builds the SQL from the JSON keys, filtered against actual table columns.
fn upsert_rows(
    conn: &rusqlite::Connection,
    table: &str,
    rows: &[serde_json::Value],
) -> Result<usize, String> {
    if rows.is_empty() || !table_exists(conn, table) {
        return Ok(0);
    }

    // Get column names from the first row
    let first = rows[0]
        .as_object()
        .ok_or_else(|| format!("Invalid row data for table {}", table))?;
    let json_columns: Vec<&str> = first.keys().map(|k| k.as_str()).collect();

    // Filter against actual DB columns
    let table_cols = get_table_columns(conn, table)?;
    let valid_columns: Vec<&str> = json_columns
        .iter()
        .filter(|c| table_cols.contains(&c.to_string()))
        .copied()
        .collect();

    if valid_columns.is_empty() {
        return Ok(0);
    }

    let col_list = valid_columns.join(", ");
    let placeholders: Vec<String> = (1..=valid_columns.len())
        .map(|i| format!("?{}", i))
        .collect();
    let placeholder_list = placeholders.join(", ");

    let sql = format!(
        "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
        table, col_list, placeholder_list
    );

    let mut count = 0;
    for row in rows {
        if let Some(obj) = row.as_object() {
            let params: Vec<Box<dyn rusqlite::types::ToSql>> = valid_columns
                .iter()
                .map(|col| -> Box<dyn rusqlite::types::ToSql> {
                    match obj.get(*col) {
                        Some(serde_json::Value::String(s)) => Box::new(s.clone()),
                        Some(serde_json::Value::Number(n)) => {
                            if let Some(i) = n.as_i64() {
                                Box::new(i)
                            } else if let Some(f) = n.as_f64() {
                                Box::new(f)
                            } else {
                                Box::new(rusqlite::types::Null)
                            }
                        }
                        Some(serde_json::Value::Bool(b)) => Box::new(*b as i64),
                        Some(serde_json::Value::Null) | None => {
                            Box::new(rusqlite::types::Null)
                        }
                        Some(other) => Box::new(other.to_string()),
                    }
                })
                .collect();

            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();

            match conn.execute(&sql, param_refs.as_slice()) {
                Ok(_) => count += 1,
                Err(e) => {
                    tracing::warn!("Failed to upsert row into {}: {}", table, e);
                }
            }
        }
    }
    Ok(count)
}

/// Upsert playtime_daily rows (composite PK: game_id + day)
fn upsert_playtime_daily(
    conn: &rusqlite::Connection,
    rows: &[serde_json::Value],
) -> Result<usize, String> {
    if rows.is_empty() {
        return Ok(0);
    }

    let sql = "INSERT OR REPLACE INTO playtime_daily (game_id, day, duration_seconds, updated_at) VALUES (?1, ?2, ?3, ?4)";
    let mut count = 0;
    for row in rows {
        if let Some(obj) = row.as_object() {
            let game_id = obj
                .get("game_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let day = obj.get("day").and_then(|v| v.as_str()).unwrap_or("");
            let duration = obj
                .get("duration_seconds")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let updated = obj
                .get("updated_at")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if !game_id.is_empty() && !day.is_empty() {
                match conn.execute(sql, rusqlite::params![game_id, day, duration, updated]) {
                    Ok(_) => count += 1,
                    Err(e) => {
                        tracing::warn!("Failed to upsert playtime_daily: {}", e);
                    }
                }
            }
        }
    }
    Ok(count)
}
