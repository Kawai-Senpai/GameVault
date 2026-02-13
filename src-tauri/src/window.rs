// GameVault Window Module
// Handles Windows-specific window management for the overlay.
// Mirrors GodVision's approach: show without focus steal, WS_EX_NOACTIVATE.

use tauri::{Manager, Runtime, WebviewWindow};

/// Show a window WITHOUT activating/focusing it (Windows only).
/// The foreground app (game) keeps focus – overlay just appears silently on top.
#[cfg(target_os = "windows")]
pub fn show_no_activate<R: Runtime>(window: &WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

    let hwnd = window.hwnd().unwrap().0 as *mut core::ffi::c_void;
    unsafe {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
}

/// Apply WS_EX_NOACTIVATE so clicks/drags on the overlay never steal focus.
/// This is critical for game overlays — without it, clicking the overlay
/// would activate the window and potentially minimize the game.
#[cfg(target_os = "windows")]
pub fn apply_no_activate<R: Runtime>(window: &WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let hwnd = window.hwnd().unwrap().0 as *mut core::ffi::c_void;
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE as isize);
    }
}

/// Remove WS_EX_NOACTIVATE so the window can receive keyboard focus temporarily.
/// Call this when the user needs to type in the overlay (e.g., AI chat input).
#[cfg(target_os = "windows")]
pub fn remove_no_activate<R: Runtime>(window: &WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let hwnd = window.hwnd().unwrap().0 as *mut core::ffi::c_void;
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_NOACTIVATE as isize));
    }
}

/// Tauri command: lock overlay (re-apply WS_EX_NOACTIVATE)
#[tauri::command]
pub fn lock_overlay(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("overlay") {
            apply_no_activate(&window);
        }
    }
    let _ = app;
    Ok(())
}

/// Tauri command: unlock overlay (remove WS_EX_NOACTIVATE for typing)
#[tauri::command]
pub fn unlock_overlay(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("overlay") {
            remove_no_activate(&window);
        }
    }
    let _ = app;
    Ok(())
}
