use base64::Engine;
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct ScreenshotResult {
    pub id: String,
    pub file_path: String,
    pub thumbnail_path: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
}

/// Capture the entire screen
#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    let screens = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if screens.is_empty() {
        return Err("No monitors found".to_string());
    }

    // Capture the primary monitor
    let primary = &screens[0];
    let img = primary.capture_image().map_err(|e| e.to_string())?;

    // Encode as PNG base64
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Capture a specific area of the screen
#[tauri::command]
pub async fn capture_area(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let screens = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if screens.is_empty() {
        return Err("No monitors found".to_string());
    }

    let primary = &screens[0];
    let img = primary.capture_image().map_err(|e| e.to_string())?;

    // Crop the image
    let cropped = image::imageops::crop_imm(&img, x, y, width, height).to_image();

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    cropped
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Save a screenshot to disk (from base64 data)
#[tauri::command]
pub async fn save_screenshot_file(
    screenshots_dir: String,
    game_id: String,
    base64_data: String,
    filename: Option<String>,
) -> Result<ScreenshotResult, String> {
    let dir = PathBuf::from(&screenshots_dir).join(&game_id);
    let thumbs_dir = dir.join("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let fname = filename.unwrap_or_else(|| {
        format!(
            "screenshot_{}.png",
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        )
    });
    let file_path = dir.join(&fname);
    let thumb_path = thumbs_dir.join(format!("thumb_{}", &fname));

    // Decode base64
    let data = base64_data
        .strip_prefix("data:image/png;base64,")
        .or_else(|| base64_data.strip_prefix("data:image/jpeg;base64,"))
        .unwrap_or(&base64_data);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;

    // Save full image
    fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    // Load and get dimensions
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let (width, height) = img.dimensions();

    // Generate thumbnail (320px wide)
    let thumb = image::imageops::resize(
        &img.to_rgba8(),
        320,
        (320.0 * height as f64 / width as f64) as u32,
        image::imageops::FilterType::Lanczos3,
    );
    thumb.save(&thumb_path).map_err(|e| e.to_string())?;

    let file_size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

    Ok(ScreenshotResult {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        thumbnail_path: thumb_path.to_string_lossy().to_string(),
        width,
        height,
        file_size,
    })
}

/// Generate a thumbnail for an existing screenshot
#[tauri::command]
pub async fn generate_thumbnail(
    image_path: String,
    output_dir: String,
    max_width: u32,
) -> Result<String, String> {
    let img = image::open(&image_path).map_err(|e| e.to_string())?;
    let (w, h) = img.dimensions();
    let new_height = (max_width as f64 * h as f64 / w as f64) as u32;

    let thumb = image::imageops::resize(
        &img.to_rgba8(),
        max_width,
        new_height,
        image::imageops::FilterType::Lanczos3,
    );

    let out_dir = PathBuf::from(&output_dir);
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let fname = PathBuf::from(&image_path)
        .file_name()
        .map(|n| format!("thumb_{}", n.to_string_lossy()))
        .unwrap_or_else(|| "thumb.png".to_string());

    let out_path = out_dir.join(&fname);
    thumb.save(&out_path).map_err(|e| e.to_string())?;

    Ok(out_path.to_string_lossy().to_string())
}

/// Open a screenshot file with the system viewer
#[tauri::command]
pub async fn open_screenshot(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}
