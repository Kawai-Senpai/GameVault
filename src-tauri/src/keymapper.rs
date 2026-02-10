use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyEvent {
    pub key_code: u32,
    pub is_press: bool,
}

/// Simulate a key press event (key down)
#[tauri::command]
pub async fn simulate_key_press(key_code: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        simulate_key_event_win(key_code, true)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = key_code;
        return Err("Key simulation is currently only supported on Windows".to_string());
    }

    Ok(())
}

/// Simulate a key release event (key up)
#[tauri::command]
pub async fn simulate_key_release(key_code: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        simulate_key_event_win(key_code, false)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = key_code;
        return Err("Key simulation is currently only supported on Windows".to_string());
    }

    Ok(())
}

/// Simulate a full key tap (press + release)
#[tauri::command]
pub async fn simulate_key_tap(key_code: u32, delay_ms: u64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        simulate_key_event_win(key_code, true)?;
        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        simulate_key_event_win(key_code, false)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (key_code, delay_ms);
        return Err("Key simulation is currently only supported on Windows".to_string());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn simulate_key_event_win(key_code: u32, is_press: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };

    let mut flags = 0u32;
    if !is_press {
        flags |= KEYEVENTF_KEYUP;
    }

    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key_code as u16,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let result = unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };

    if result != 1 {
        return Err("Failed to send key input".to_string());
    }

    Ok(())
}
