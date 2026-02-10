use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

pub fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "Show Game Vault", true, None::<&str>)?;
    let backup_i = MenuItem::with_id(app, "quick_backup", "Quick Backup", true, None::<&str>)?;
    let screenshot_i = MenuItem::with_id(app, "screenshot", "Take Screenshot", true, None::<&str>)?;
    let separator_1 = MenuItem::with_id(app, "sep1", "───────────", false, None::<&str>)?;
    let overlay_i = MenuItem::with_id(app, "overlay", "Toggle Overlay", true, None::<&str>)?;
    let separator_2 = MenuItem::with_id(app, "sep2", "───────────", false, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Game Vault", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_i,
            &separator_1,
            &backup_i,
            &screenshot_i,
            &overlay_i,
            &separator_2,
            &quit_i,
        ],
    )?;

    // Load tray icon — try embedded icon first, then fall back to decoding PNG
    let tray_icon = app.default_window_icon().cloned().unwrap_or_else(|| {
        // Decode the embedded PNG at compile time using the `image` crate
        let png_bytes = include_bytes!("../icons/icon.png");
        let img = image::load_from_memory(png_bytes).expect("Failed to decode icon PNG");
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        Image::new_owned(rgba.into_raw(), w, h)
    });

    let _tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("Game Vault")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::DoubleClick { button, .. } if button == MouseButton::Left => {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            TrayIconEvent::Click {
                button,
                button_state,
                ..
            } if button == MouseButton::Left && button_state == MouseButtonState::Down => {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quick_backup" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-quick-backup", ());
                }
            }
            "screenshot" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-take-screenshot", ());
                }
            }
            "overlay" => {
                if let Some(overlay) = app.get_webview_window("overlay") {
                    if overlay.is_visible().unwrap_or(false) {
                        let _ = overlay.hide();
                    } else {
                        crate::games::cache_foreground_window_snapshot();
                        crate::position_overlay_strip(&overlay);
                        let _ = overlay.show();
                        let _ = overlay.set_focus();
                    }
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
