// GameVault Shortcuts Module
// Handles all global shortcut registration on the Rust side.
// The frontend sends its config, Rust registers/unregisters shortcuts,
// and dispatches events back to the frontend when shortcuts fire.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

// ─── State ──────────────────────────────────────────────────

#[derive(Default)]
pub struct RegisteredShortcuts {
    pub map: Mutex<HashMap<String, String>>, // shortcut_key -> action_id
}

// ─── Types ──────────────────────────────────────────────────

#[derive(serde::Deserialize, Debug, Clone)]
pub struct ShortcutBinding {
    pub action: String,
    pub key: String,
    pub enabled: bool,
}

#[derive(serde::Deserialize, Debug)]
pub struct ShortcutsConfig {
    pub bindings: Vec<ShortcutBinding>,
}

#[derive(serde::Serialize, Clone)]
pub struct ShortcutEvent {
    pub action: String,
}

// ─── Commands ───────────────────────────────────────────────

/// Check if any shortcuts are currently registered
#[tauri::command]
pub fn check_shortcuts_registered(state: tauri::State<RegisteredShortcuts>) -> bool {
    let map = state.map.lock().unwrap();
    !map.is_empty()
}

/// Get current registered shortcuts map
#[tauri::command]
pub fn get_registered_shortcuts(
    state: tauri::State<RegisteredShortcuts>,
) -> HashMap<String, String> {
    let map = state.map.lock().unwrap();
    map.clone()
}

/// Validate a shortcut key string by attempting to parse it
#[tauri::command]
pub fn validate_shortcut_key(key: String) -> Result<bool, String> {
    match key.parse::<Shortcut>() {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Invalid shortcut '{}': {}", key, e)),
    }
}

/// Core: unregister all existing shortcuts and register new ones from config.
/// Holds the map lock for the entire operation to prevent concurrent calls
/// (e.g. from React strict mode double-firing) from interleaving.
#[tauri::command]
pub fn update_shortcuts(
    app: tauri::AppHandle,
    config: ShortcutsConfig,
) -> Result<(), String> {
    let state = app.state::<RegisteredShortcuts>();
    let gsm = app.global_shortcut();

    // Hold the lock for the entire operation to prevent race conditions
    let mut map = state.map.lock().unwrap();

    // Unregister all existing shortcuts we previously registered
    for (key_str, _action) in map.drain() {
        if let Ok(shortcut) = key_str.parse::<Shortcut>() {
            let _ = gsm.unregister(shortcut);
        }
    }

    // Register new shortcuts
    let mut new_map = HashMap::new();
    let mut errors: Vec<String> = Vec::new();

    for binding in &config.bindings {
        if !binding.enabled || binding.key.trim().is_empty() {
            continue;
        }

        let key_str = binding.key.trim().to_string();
        let shortcut = match key_str.parse::<Shortcut>() {
            Ok(s) => s,
            Err(e) => {
                errors.push(format!("Failed to parse '{}': {}", key_str, e));
                continue;
            }
        };

        // Defensive cleanup: always unregister this key first to clear any stale
        // registrations from JS-side handlers or previous sessions.
        let _ = gsm.unregister(shortcut);

        // Check if already registered by us in this batch
        if new_map.contains_key(&key_str) {
            errors.push(format!("Duplicate shortcut '{}'", key_str));
            continue;
        }

        match gsm.register(shortcut) {
            Ok(_) => {
                new_map.insert(key_str, binding.action.clone());
            }
            Err(e) => {
                errors.push(format!(
                    "Failed to register '{}' for '{}': {}",
                    binding.key, binding.action, e
                ));
            }
        }
    }

    // Store the new map (lock is still held)
    *map = new_map;

    // Emit registration errors as event so frontend can show them
    if !errors.is_empty() {
        let _ = app.emit("shortcut-registration-error", errors);
    }

    Ok(())
}

// ─── Handler ────────────────────────────────────────────────

/// Called from the plugin handler in lib.rs when a shortcut fires
pub fn handle_shortcut_action(app: &tauri::AppHandle, action: &str) {
    match action {
        "toggle_overlay" => {
            // Directly toggle overlay visibility without stealing focus
            if let Some(overlay) = app.get_webview_window("overlay") {
                if overlay.is_visible().unwrap_or(false) {
                    let _ = overlay.hide();
                } else {
                    // Cache foreground before showing overlay
                    crate::games::cache_foreground_window_snapshot();
                    crate::position_overlay_strip(&overlay);
                    // Show without stealing focus (won't minimize the game)
                    crate::show_overlay_no_activate(&overlay);
                }
            }
        }
        // All other actions emit events to the frontend
        _ => {
            let _ = app.emit(
                "shortcut-triggered",
                ShortcutEvent {
                    action: action.to_string(),
                },
            );
        }
    }
}
