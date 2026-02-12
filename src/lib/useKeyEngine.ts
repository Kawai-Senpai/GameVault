/**
 * Hook that registers/unregisters global shortcuts for active key mappings and macros.
 * Uses tauri-plugin-global-shortcut to intercept trigger keys and then simulates
 * target keys/macro actions via the Rust backend.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { comboToTauriShortcut, comboToVkSequence } from "@/lib/keycode-map";
import type { KeyMapping, Macro, MacroAction } from "@/types";

// Dynamically import global-shortcut to avoid errors when plugin isn't available
async function getShortcutPlugin() {
  try {
    return await import("@tauri-apps/plugin-global-shortcut");
  } catch {
    console.warn("[KeyEngine] global-shortcut plugin not available");
    return null;
  }
}

/**
 * Simulate pressing a key combo (press modifiers, tap key, release modifiers).
 */
async function simulateCombo(combo: string): Promise<void> {
  const sequence = comboToVkSequence(combo);
  if (sequence.length === 0) return;

  const modifiers = sequence.filter((s) => s.isModifier);
  const keys = sequence.filter((s) => !s.isModifier);

  // Press modifiers down
  for (const mod of modifiers) {
    await invoke("simulate_key_press", { keyCode: mod.vk });
  }

  // Tap each non-modifier key
  for (const key of keys) {
    await invoke("simulate_key_tap", { keyCode: key.vk, delayMs: 30 });
  }

  // Release modifiers in reverse order
  for (let i = modifiers.length - 1; i >= 0; i--) {
    await invoke("simulate_key_release", { keyCode: modifiers[i].vk });
  }
}

/**
 * Execute a single macro action.
 */
async function executeMacroAction(action: MacroAction): Promise<void> {
  switch (action.type) {
    case "key_tap": {
      if (action.key_name) {
        await simulateCombo(action.key_name);
      } else if (action.key_code) {
        await invoke("simulate_key_tap", { keyCode: action.key_code, delayMs: 30 });
      }
      break;
    }
    case "key_press": {
      if (action.key_code) {
        await invoke("simulate_key_press", { keyCode: action.key_code });
      }
      break;
    }
    case "key_release": {
      if (action.key_code) {
        await invoke("simulate_key_release", { keyCode: action.key_code });
      }
      break;
    }
    case "delay": {
      const ms = action.delay_ms || 100;
      await new Promise((resolve) => setTimeout(resolve, ms));
      break;
    }
  }
}

/**
 * Execute a full macro: run actions for repeat_count iterations with delay_ms between each action.
 */
async function executeMacro(macro: Macro): Promise<void> {
  for (let rep = 0; rep < macro.repeat_count; rep++) {
    for (const action of macro.actions) {
      await executeMacroAction(action);
      if (action.type !== "delay") {
        await new Promise((r) => setTimeout(r, macro.delay_ms));
      }
    }
  }
}

/**
 * Check if a combo string is a valid registerable global shortcut.
 * Most platforms require at least one modifier for global shortcuts,
 * except for function keys (F1-F24) which can stand alone.
 */
function isRegisterable(combo: string): boolean {
  if (!combo || combo.trim().length === 0) return false;
  const parts = combo.split("+").map((p) => p.trim().toLowerCase());
  // Function keys can be registered alone
  if (parts.length === 1 && /^f\d{1,2}$/i.test(parts[0])) return true;
  // Otherwise need at least one modifier
  const hasModifier = parts.some((p) =>
    ["ctrl", "control", "shift", "alt", "meta", "win", "super", "command", "commandorcontrol"].includes(p)
  );
  return hasModifier;
}

export function useKeyEngine(
  mappings: KeyMapping[],
  macros: Macro[],
  enabled: boolean = true,
  reservedShortcuts: string[] = []
) {
  const registeredRef = useRef<Set<string>>(new Set());
  const reservedSignature = reservedShortcuts.join("||");
  const reservedSet = useMemo(
    () => new Set(reservedShortcuts.map((s) => comboToTauriShortcut(s).toLowerCase())),
    [reservedSignature]
  );

  const registerAll = useCallback(async () => {
    const plugin = await getShortcutPlugin();
    if (!plugin) return;

    // Unregister previous shortcuts we registered
    for (const shortcut of registeredRef.current) {
      try {
        await plugin.unregister(shortcut);
      } catch { /* ignore */ }
    }
    registeredRef.current.clear();

    if (!enabled) return;

    // Register key mappings
    for (const mapping of mappings) {
      if (!mapping.is_active || !mapping.source_key || !mapping.target_key) continue;
      if (!isRegisterable(mapping.source_key)) continue;

      const tauriShortcut = comboToTauriShortcut(mapping.source_key);
      try {
        // Skip if this shortcut is reserved for app-level actions (handled by Rust)
        if (reservedSet.has(tauriShortcut.toLowerCase())) continue;
        // Defensive: unregister first in case of stale registration
        try { await plugin.unregister(tauriShortcut); } catch { /* noop */ }
        await plugin.register(tauriShortcut, async (event) => {
          if (event.state === "Pressed") {
            try {
              await simulateCombo(mapping.target_key);
            } catch (err) {
              console.error(`[KeyEngine] Failed to simulate ${mapping.target_key}:`, err);
            }
          }
        });
        registeredRef.current.add(tauriShortcut);
      } catch (err) {
        console.warn(`[KeyEngine] Could not register mapping "${mapping.name}" (${tauriShortcut}):`, err);
      }
    }

    // Register macros
    for (const macro of macros) {
      if (!macro.is_active || !macro.trigger_key || macro.actions.length === 0) continue;
      if (!isRegisterable(macro.trigger_key)) continue;

      const tauriShortcut = comboToTauriShortcut(macro.trigger_key);
      try {
        // Skip if already registered (e.g. by a key mapping) or reserved for app-level actions
        if (registeredRef.current.has(tauriShortcut)) continue;
        if (reservedSet.has(tauriShortcut.toLowerCase())) continue;
        // Defensive: unregister first in case of stale registration
        try { await plugin.unregister(tauriShortcut); } catch { /* noop */ }
        await plugin.register(tauriShortcut, async (event) => {
          if (event.state === "Pressed") {
            try {
              await executeMacro(macro);
            } catch (err) {
              console.error(`[KeyEngine] Failed to execute macro "${macro.name}":`, err);
            }
          }
        });
        registeredRef.current.add(tauriShortcut);
      } catch (err) {
        console.warn(`[KeyEngine] Could not register macro "${macro.name}" (${tauriShortcut}):`, err);
      }
    }
  }, [mappings, macros, enabled, reservedSet]);

  // Register on mount / when data changes.
  // Small delay lets Rust-side app shortcuts register first to avoid conflicts.
  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (!cancelled) void registerAll();
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Cleanup on unmount / re-fire
      (async () => {
        const plugin = await getShortcutPlugin();
        if (!plugin) return;
        for (const shortcut of registeredRef.current) {
          try {
            await plugin.unregister(shortcut);
          } catch { /* ignore */ }
        }
        registeredRef.current.clear();
      })();
    };
  }, [registerAll]);

  return { registerAll };
}
