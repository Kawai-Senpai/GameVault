import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow();

/**
 * Custom themed title bar for GameVault.
 * Replaces the default Windows title bar with a minimal, red-accented design.
 * Supports drag-to-move, double-click maximize, and standard window controls.
 */
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for resize events to update maximize state
    const unlisten = appWindow.onResized(async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-8 bg-card/50 border-b border-border select-none shrink-0"
    >
      {/* Left: App branding */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 h-full"
      >
        {/* Logo icon */}
        <div className="size-4 rounded-sm overflow-hidden shrink-0">
          <img
            src="/icon-192.png"
            alt="GameVault"
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>
        <span
          data-tauri-drag-region
          className="text-[10px] font-semibold text-muted-foreground tracking-wide"
        >
          GameVault
        </span>
      </div>

      {/* Right: Window controls */}
      <div className="flex items-center h-full">
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          className={cn(
            "inline-flex items-center justify-center w-11 h-full",
            "hover:bg-muted transition-colors cursor-default"
          )}
          aria-label="Minimize"
        >
          <Minus className="size-3.5 text-muted-foreground" />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={handleMaximize}
          className={cn(
            "inline-flex items-center justify-center w-11 h-full",
            "hover:bg-muted transition-colors cursor-default"
          )}
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy className="size-3 text-muted-foreground rotate-180" />
          ) : (
            <Square className="size-3 text-muted-foreground" />
          )}
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          className={cn(
            "inline-flex items-center justify-center w-11 h-full",
            "hover:bg-destructive hover:text-white transition-colors cursor-default"
          )}
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
