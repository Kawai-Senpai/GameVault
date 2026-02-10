use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupInfo {
    pub id: String,
    pub game_id: String,
    pub game_name: String,
    pub display_name: String,
    pub collection_id: Option<String>,
    pub source_path: String,
    pub backup_time: String,
    pub content_hash: String,
    pub file_count: usize,
    pub total_size: u64,
    pub compressed_size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub backup_id: String,
    pub file_path: String,
    pub file_size: u64,
    pub compressed_size: u64,
    pub content_hash: String,
    pub skipped_duplicate: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreResult {
    pub success: bool,
    pub files_restored: usize,
    pub message: String,
}

/// Compute SHA-256 hash of a directory's contents for deduplication
fn compute_directory_hash(dir: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut entries: Vec<PathBuf> = WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect();

    entries.sort();

    for entry in entries {
        // Hash relative path
        let rel = entry.strip_prefix(dir).unwrap_or(&entry);
        hasher.update(rel.to_string_lossy().as_bytes());

        // Hash file contents
        let mut file = fs::File::open(&entry)?;
        let mut buffer = vec![0u8; 8192];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Get total size of a directory
fn dir_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .sum()
}

/// Create a compressed backup of a game's save directory
#[tauri::command]
pub async fn create_backup(
    backup_dir: String,
    game_id: String,
    game_name: String,
    save_path: String,
    display_name: String,
    collection_id: Option<String>,
    check_duplicates: bool,
) -> Result<BackupResult, String> {
    let save_dir = PathBuf::from(&save_path);
    if !save_dir.exists() {
        return Err(format!("Save directory not found: {}", save_path));
    }

    // Compute content hash for deduplication
    let content_hash = compute_directory_hash(&save_dir).map_err(|e| e.to_string())?;

    // Check for duplicates if requested
    if check_duplicates {
        let game_backup_dir =
            PathBuf::from(&backup_dir).join(format!("{}_{}", sanitize_name(&game_name), &game_id));
        if game_backup_dir.exists() {
            // Check existing backups for matching hash
            if let Ok(entries) = fs::read_dir(&game_backup_dir) {
                for entry in entries.flatten() {
                    if entry
                        .path()
                        .extension()
                        .map(|e| e == "zip")
                        .unwrap_or(false)
                    {
                        if let Ok(info) = read_backup_metadata(&entry.path()) {
                            if info.content_hash == content_hash {
                                return Ok(BackupResult {
                                    success: true,
                                    backup_id: info.id,
                                    file_path: entry.path().to_string_lossy().to_string(),
                                    file_size: 0,
                                    compressed_size: 0,
                                    content_hash,
                                    skipped_duplicate: true,
                                    message:
                                        "Backup skipped — saves haven't changed since last backup"
                                            .to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let backup_id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let game_dir_name = format!("{}_{}", sanitize_name(&game_name), &game_id);
    let game_backup_dir = PathBuf::from(&backup_dir).join(&game_dir_name);
    fs::create_dir_all(&game_backup_dir).map_err(|e| e.to_string())?;

    let zip_filename = format!("{}_{}.zip", &game_id, &timestamp);
    let zip_path = game_backup_dir.join(&zip_filename);

    // Create zip with maximum compression
    let file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(9));

    let total_size = dir_size(&save_dir);
    let mut file_count = 0usize;

    // Walk the save directory and add all files
    for entry in WalkDir::new(&save_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let rel_path = entry.path().strip_prefix(&save_dir).unwrap_or(entry.path());
        let rel_str = rel_path.to_string_lossy().replace('\\', "/");

        zip.start_file(&rel_str, options)
            .map_err(|e| e.to_string())?;
        let mut f = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
        let mut buffer = Vec::new();
        f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        zip.write_all(&buffer).map_err(|e| e.to_string())?;
        file_count += 1;
    }

    // Write backup metadata into the zip
    let info = BackupInfo {
        id: backup_id.clone(),
        game_id: game_id.clone(),
        game_name: game_name.clone(),
        display_name: display_name.clone(),
        collection_id: collection_id.clone(),
        source_path: save_path.clone(),
        backup_time: Utc::now().to_rfc3339(),
        content_hash: content_hash.clone(),
        file_count,
        total_size,
        compressed_size: 0, // Will update after closing
    };

    let info_json = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    zip.start_file("_backup_info.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(info_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;

    let compressed_size = fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);

    Ok(BackupResult {
        success: true,
        backup_id,
        file_path: zip_path.to_string_lossy().to_string(),
        file_size: total_size,
        compressed_size,
        content_hash,
        skipped_duplicate: false,
        message: format!(
            "Backup created successfully — {} files, {:.1} MB compressed",
            file_count,
            compressed_size as f64 / 1_048_576.0
        ),
    })
}

/// Restore a backup to its original save location
#[tauri::command]
pub async fn restore_backup(
    zip_path: String,
    restore_path: String,
    create_safety_backup: bool,
    backup_dir: Option<String>,
    game_id: Option<String>,
    game_name: Option<String>,
) -> Result<RestoreResult, String> {
    let zip_file = PathBuf::from(&zip_path);
    if !zip_file.exists() {
        return Err(format!("Backup file not found: {}", zip_path));
    }

    let restore_dir = PathBuf::from(&restore_path);

    // Create safety backup before restoring
    if create_safety_backup && restore_dir.exists() {
        if let (Some(dir), Some(gid), Some(gname)) = (&backup_dir, &game_id, &game_name) {
            let _ = create_backup(
                dir.clone(),
                gid.clone(),
                gname.clone(),
                restore_path.clone(),
                "_pre_restore_safety_backup".to_string(),
                None,
                false,
            )
            .await;
        }
    }

    // Clear existing saves
    if restore_dir.exists() {
        // Only remove files, keep directory structure
        for entry in WalkDir::new(&restore_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let _ = fs::remove_file(entry.path());
        }
    }

    fs::create_dir_all(&restore_dir).map_err(|e| e.to_string())?;

    // Extract zip
    let file = fs::File::open(&zip_file).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut files_restored = 0usize;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        // Skip metadata file
        if name == "_backup_info.json" {
            continue;
        }

        let out_path = restore_dir.join(&name);

        // Create parent directories
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Extract file
        let mut outfile = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        files_restored += 1;
    }

    Ok(RestoreResult {
        success: true,
        files_restored,
        message: format!("Successfully restored {} files", files_restored),
    })
}

/// Delete a backup zip file
#[tauri::command]
pub async fn delete_backup(zip_path: String) -> Result<bool, String> {
    let path = PathBuf::from(&zip_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

/// Rename a backup (update metadata inside zip)
#[tauri::command]
pub async fn rename_backup(zip_path: String, new_name: String) -> Result<bool, String> {
    let path = PathBuf::from(&zip_path);
    if !path.exists() {
        return Err("Backup file not found".to_string());
    }

    // Read existing zip
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    // Create temp file
    let temp_path = path.with_extension("tmp");
    let temp_file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut new_zip = zip::ZipWriter::new(temp_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(9));

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        if name == "_backup_info.json" {
            // Update the display name in metadata
            let mut content = String::new();
            entry
                .read_to_string(&mut content)
                .map_err(|e| e.to_string())?;
            if let Ok(mut info) = serde_json::from_str::<BackupInfo>(&content) {
                info.display_name = new_name.clone();
                let updated = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
                new_zip
                    .start_file("_backup_info.json", options)
                    .map_err(|e| e.to_string())?;
                new_zip
                    .write_all(updated.as_bytes())
                    .map_err(|e| e.to_string())?;
            }
        } else {
            new_zip
                .start_file(&name, options)
                .map_err(|e| e.to_string())?;
            let mut buffer = Vec::new();
            entry.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            new_zip.write_all(&buffer).map_err(|e| e.to_string())?;
        }
    }

    new_zip.finish().map_err(|e| e.to_string())?;

    // Replace original with temp
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &path).map_err(|e| e.to_string())?;

    Ok(true)
}

/// Read backup metadata from a zip file
fn read_backup_metadata(zip_path: &Path) -> Result<BackupInfo> {
    let file = fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    if let Ok(mut entry) = archive.by_name("_backup_info.json") {
        let mut content = String::new();
        entry.read_to_string(&mut content)?;
        let info: BackupInfo = serde_json::from_str(&content)?;
        return Ok(info);
    }

    anyhow::bail!("No backup metadata found in zip")
}

/// Get info from a backup zip file
#[tauri::command]
pub async fn get_backup_info(zip_path: String) -> Result<BackupInfo, String> {
    let path = PathBuf::from(&zip_path);
    read_backup_metadata(&path).map_err(|e| e.to_string())
}

/// Get folder size in bytes
#[tauri::command]
pub async fn get_folder_size(path: String) -> Result<u64, String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Ok(0);
    }
    Ok(dir_size(&dir))
}

/// Open a directory in the system file browser
#[tauri::command]
pub async fn open_backup_directory(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if dir.exists() {
        open::that(&dir).map_err(|e| e.to_string())?;
    } else {
        return Err("Directory not found".to_string());
    }
    Ok(())
}

/// Open save directory in the system file browser
#[tauri::command]
pub async fn open_save_directory(path: String) -> Result<(), String> {
    let expanded = expand_env_vars(&path);
    let dir = PathBuf::from(&expanded);
    if dir.exists() {
        open::that(&dir).map_err(|e| e.to_string())?;
    } else {
        return Err(format!("Save directory not found: {}", expanded));
    }
    Ok(())
}

/// Sanitize a game name for use as a directory name
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Scan a backup directory for existing backups and return their metadata
#[derive(Debug, Serialize, Deserialize)]
pub struct ScannedBackup {
    pub id: String,
    pub game_id: String,
    pub game_name: String,
    pub display_name: String,
    pub collection_id: Option<String>,
    pub source_path: String,
    pub backup_time: String,
    pub content_hash: String,
    pub file_count: usize,
    pub file_size: u64,
    pub compressed_size: u64,
    pub file_path: String,
}

#[tauri::command]
pub async fn scan_backup_directory(backup_dir: String) -> Result<Vec<ScannedBackup>, String> {
    let dir = PathBuf::from(&backup_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut discovered: Vec<ScannedBackup> = Vec::new();

    // Walk subdirectories (each should be a game folder: <GameName>_<gameId>)
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        // Walk zip files inside the game folder
        let game_dir = entry.path();
        if let Ok(zips) = fs::read_dir(&game_dir) {
            for zip_entry in zips.flatten() {
                let zip_path = zip_entry.path();
                if zip_path
                    .extension()
                    .map(|e| e == "zip")
                    .unwrap_or(false)
                {
                    // Try to read _backup_info.json from the zip
                    if let Ok(info) = read_backup_metadata(&zip_path) {
                        let compressed_size =
                            fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
                        discovered.push(ScannedBackup {
                            id: info.id,
                            game_id: info.game_id,
                            game_name: info.game_name,
                            display_name: info.display_name,
                            collection_id: info.collection_id,
                            source_path: info.source_path,
                            backup_time: info.backup_time,
                            content_hash: info.content_hash,
                            file_count: info.file_count,
                            file_size: info.total_size,
                            compressed_size,
                            file_path: zip_path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    // Sort by backup time descending
    discovered.sort_by(|a, b| b.backup_time.cmp(&a.backup_time));

    Ok(discovered)
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
        // Try to find Steam installation
        if let Ok(program_files) = std::env::var("PROGRAMFILES(X86)") {
            let steam_userdata = PathBuf::from(&program_files).join("Steam").join("userdata");
            if steam_userdata.exists() {
                // Find the first user directory
                if let Ok(entries) = fs::read_dir(&steam_userdata) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            let user_dir = entry.path();
                            result =
                                result.replace("%STEAM_USERDATA%", &user_dir.to_string_lossy());
                            break;
                        }
                    }
                }
            }
        }
    }

    // Handle %GAME_INSTALL% (not expandable, return as-is)
    result
}
