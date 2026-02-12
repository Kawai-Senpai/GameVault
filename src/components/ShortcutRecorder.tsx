import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShortcutRecorderProps {
  value: string;
  onChange: (newKey: string) => void;
  className?: string;
  disabled?: boolean;
}

// Map browser key names to Tauri accelerator format
const KEY_MAP: Record<string, string> = {
  Control: "CommandOrControl",
  Meta: "Super",
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  "+": "Plus",
  "\\": "Backslash",
  "/": "Slash",
  ".": "Period",
  ",": "Comma",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function browserKeyToTauri(key: string): string {
  if (KEY_MAP[key]) return KEY_MAP[key];
  // F1-F24
  if (/^F\d+$/.test(key)) return key;
  // Single letter keys
  if (key.length === 1 && /^[a-zA-Z0-9]$/.test(key)) return key.toUpperCase();
  return key;
}

// Convert Tauri format back to display format
function tauriToDisplay(key: string): string {
  return key
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/Super/g, "Win");
}

export function ShortcutRecorder({
  value,
  onChange,
  className,
  disabled = false,
}: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [capturedCombo, setCapturedCombo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startRecording = useCallback(() => {
    if (disabled) return;
    setIsRecording(true);
    setPressedKeys(new Set());
    setCapturedCombo(null);
    setError(null);
  }, [disabled]);

  const cancelRecording = useCallback(() => {
    setIsRecording(false);
    setPressedKeys(new Set());
    setCapturedCombo(null);
    setError(null);
  }, []);

  const saveCombo = useCallback(async (combo: string) => {
    try {
      await invoke<boolean>("validate_shortcut_key", { key: combo });
      // Store in user-friendly format (Ctrl instead of CommandOrControl)
      const userFormat = tauriToDisplay(combo);
      onChange(userFormat);
      setIsRecording(false);
      setPressedKeys(new Set());
      setCapturedCombo(null);
      setError(null);
    } catch (e: any) {
      setError(String(e).replace("Invalid shortcut", "Invalid"));
    }
  }, [onChange]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;
      if (key === "Escape") {
        cancelRecording();
        return;
      }

      setPressedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;

      setPressedKeys((prev) => {
        const allKeys = new Set(prev);

        // Build the combo from all keys pressed so far
        const modifiers: string[] = [];
        const regularKeys: string[] = [];

        for (const k of allKeys) {
          if (MODIFIER_KEYS.has(k)) {
            modifiers.push(browserKeyToTauri(k));
          } else {
            regularKeys.push(browserKeyToTauri(k));
          }
        }

        // Only capture if we have at least one non-modifier key, or it's a standalone function key
        if (regularKeys.length > 0) {
          const parts = [...modifiers, ...regularKeys];
          const combo = parts.join("+");
          setCapturedCombo(combo);
          // Auto-save
          void saveCombo(combo);
        }

        // Remove the released key
        const next = new Set(allKeys);
        next.delete(key);
        return next;
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [isRecording, cancelRecording, saveCombo]);

  // Click outside to cancel
  useEffect(() => {
    if (!isRecording) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        cancelRecording();
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [isRecording, cancelRecording]);

  const displayValue = value ? tauriToDisplay(value) : "Not set";

  return (
    <div ref={containerRef} className={cn("inline-flex items-center gap-1.5", className)}>
      {isRecording ? (
        <div className="flex items-center gap-1.5">
          <div className="px-2 py-1 rounded border border-gaming/50 bg-gaming/10 text-[10px] font-mono text-gaming animate-pulse min-w-[80px] text-center">
            {pressedKeys.size > 0
              ? Array.from(pressedKeys).map((k) => browserKeyToTauri(k)).join(" + ")
              : "Press keys..."}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[9px] text-muted-foreground"
            onClick={cancelRecording}
          >
            Esc
          </Button>
        </div>
      ) : (
        <button
          onClick={startRecording}
          disabled={disabled}
          className={cn(
            "px-2 py-1 rounded border text-[10px] font-mono transition-colors min-w-[80px] text-center cursor-pointer",
            value
              ? "border-border bg-muted/50 text-foreground hover:border-gaming/50 hover:bg-gaming/5"
              : "border-dashed border-muted-foreground/30 text-muted-foreground hover:border-gaming/50",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          title="Click to change shortcut"
        >
          {displayValue}
        </button>
      )}
      {error && (
        <span className="text-[9px] text-destructive">{error}</span>
      )}
      {capturedCombo && !error && (
        <span className="text-[9px] text-success">Saved</span>
      )}
    </div>
  );
}

export default ShortcutRecorder;
