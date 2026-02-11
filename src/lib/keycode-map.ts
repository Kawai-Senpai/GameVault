/**
 * Mapping of key names (as captured by KeyboardEvent.key) to Windows Virtual Key Codes.
 * Used by the key mapping and macro systems to simulate key presses via Tauri commands.
 */

const KEY_NAME_TO_VK: Record<string, number> = {
  // Letters
  A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45,
  F: 0x46, G: 0x47, H: 0x48, I: 0x49, J: 0x4a,
  K: 0x4b, L: 0x4c, M: 0x4d, N: 0x4e, O: 0x4f,
  P: 0x50, Q: 0x51, R: 0x52, S: 0x53, T: 0x54,
  U: 0x55, V: 0x56, W: 0x57, X: 0x58, Y: 0x59,
  Z: 0x5a,

  // Numbers
  "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
  "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,

  // Function keys
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74,
  F6: 0x75, F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79,
  F11: 0x7a, F12: 0x7b, F13: 0x7c, F14: 0x7d, F15: 0x7e,
  F16: 0x7f, F17: 0x80, F18: 0x81, F19: 0x82, F20: 0x83,
  F21: 0x84, F22: 0x85, F23: 0x86, F24: 0x87,

  // Modifiers
  Ctrl: 0x11, Control: 0x11,
  Shift: 0x10,
  Alt: 0x12,
  Meta: 0x5b, Win: 0x5b,

  // Navigation
  ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
  Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27,
  Home: 0x24, End: 0x23,
  PageUp: 0x21, PageDown: 0x22,

  // Editing
  Backspace: 0x08, Delete: 0x2e, Insert: 0x2d,
  Enter: 0x0d, Return: 0x0d,
  Tab: 0x09,
  Space: 0x20, " ": 0x20,
  Escape: 0x1b, Esc: 0x1b,

  // Punctuation / symbols
  ";": 0xba, "=": 0xbb, ",": 0xbc, "-": 0xbd,
  ".": 0xbe, "/": 0xbf, "`": 0xc0,
  "[": 0xdb, "\\": 0xdc, "]": 0xdd, "'": 0xde,

  // Numpad
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63,
  Numpad4: 0x64, Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67,
  Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
  NumLock: 0x90,

  // Toggles
  CapsLock: 0x14, ScrollLock: 0x91,
  PrintScreen: 0x2c,
  Pause: 0x13,

  // Media
  VolumeMute: 0xad, VolumeDown: 0xae, VolumeUp: 0xaf,
  MediaTrackNext: 0xb0, MediaTrackPrevious: 0xb1,
  MediaStop: 0xb2, MediaPlayPause: 0xb3,
};

/**
 * Convert a key name (from KeyboardEvent.key or our combo format) to a Windows VK code.
 * Returns undefined if the key is not recognized.
 */
export function keyNameToVk(keyName: string): number | undefined {
  // Try exact match first
  if (KEY_NAME_TO_VK[keyName] !== undefined) return KEY_NAME_TO_VK[keyName];
  // Try uppercase
  const upper = keyName.toUpperCase();
  if (KEY_NAME_TO_VK[upper] !== undefined) return KEY_NAME_TO_VK[upper];
  // Try case-insensitive match
  const lower = keyName.toLowerCase();
  for (const [key, code] of Object.entries(KEY_NAME_TO_VK)) {
    if (key.toLowerCase() === lower) return code;
  }
  return undefined;
}

/**
 * Parse a key combo string like "Ctrl+Shift+A" into individual key parts.
 * Returns { modifiers: string[], key: string }
 */
export function parseKeyCombo(combo: string): { modifiers: string[]; key: string } {
  const parts = combo.split("+").map((p) => p.trim());
  const modifiers: string[] = [];
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      modifiers.push("Ctrl");
    } else if (lower === "shift") {
      modifiers.push("Shift");
    } else if (lower === "alt") {
      modifiers.push("Alt");
    } else if (lower === "meta" || lower === "win" || lower === "super" || lower === "command" || lower === "commandorcontrol") {
      modifiers.push("Meta");
    } else {
      key = part;
    }
  }

  return { modifiers, key };
}

/**
 * Convert our combo format to the tauri global-shortcut format.
 * e.g. "Ctrl+Shift+A" → "CommandOrControl+Shift+A"
 */
export function comboToTauriShortcut(combo: string): string {
  return combo
    .replace(/Ctrl/gi, "CommandOrControl")
    .replace(/Meta|Win|Super/gi, "Super");
}

/**
 * Get all VK codes for a combo string. Returns array of { vk, isModifier } in press order.
 * Press modifiers first, then the main key.
 */
export function comboToVkSequence(combo: string): { vk: number; isModifier: boolean }[] {
  const { modifiers, key } = parseKeyCombo(combo);
  const result: { vk: number; isModifier: boolean }[] = [];

  for (const mod of modifiers) {
    const vk = keyNameToVk(mod);
    if (vk !== undefined) result.push({ vk, isModifier: true });
  }

  if (key) {
    const vk = keyNameToVk(key);
    if (vk !== undefined) result.push({ vk, isModifier: false });
  }

  return result;
}
