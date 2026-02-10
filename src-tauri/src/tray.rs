use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};

pub fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "Show GameVault", true, None::<&str>)?;
    let backup_i = MenuItem::with_id(app, "quick_backup", "Quick Backup", true, None::<&str>)?;
    let screenshot_i = MenuItem::with_id(app, "screenshot", "Take Screenshot", true, None::<&str>)?;
    let separator_1 = MenuItem::with_id(app, "sep1", "───────────", false, None::<&str>)?;
    let overlay_i = MenuItem::with_id(app, "overlay", "Toggle Overlay", true, None::<&str>)?;
    let separator_2 = MenuItem::with_id(app, "sep2", "───────────", false, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit GameVault", true, None::<&str>)?;

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

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("No default icon configured"))
        .menu(&menu)
        .tooltip("GameVault")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
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
