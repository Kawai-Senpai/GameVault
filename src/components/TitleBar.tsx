import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Layers, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts/app.context";
import { Progress } from "@/components/ui/progress";

const appWindow = getCurrentWindow();

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const { autoBackupStatus } = useApp();

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
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

  const handleToggleOverlay = async () => {
    if (overlayBusy) return;
    try {
      setOverlayBusy(true);
      await invoke("toggle_overlay");
    } catch {
      // Silent by design: title-bar interactions should not spam errors.
    } finally {
      setOverlayBusy(false);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "relative flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-1 select-none",
        "bg-[radial-gradient(120%_160%_at_0%_0%,rgb(255_65_65_/_0.18)_0%,transparent_60%),linear-gradient(180deg,rgb(255_255_255_/_0.03),transparent)]"
      )}
    >
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 items-center gap-2.5 rounded-md px-2"
      >
        <div className="size-5 overflow-hidden rounded-md ring-1 ring-border/60">
          <img
            src="/icon-192.png"
            alt="GameVault"
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        <div data-tauri-drag-region className="min-w-0">
          <p className="truncate text-[11px] font-semibold leading-none tracking-wide">
            Game Vault
          </p>
          <p className="truncate text-[9px] text-muted-foreground/85">
            Command Deck
          </p>
        </div>
      </div>

      <div className="flex h-full items-center">
        <button
          onClick={handleToggleOverlay}
          disabled={overlayBusy}
          className={cn(
            "inline-flex h-full w-11 items-center justify-center transition-colors",
            "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
            "disabled:opacity-50"
          )}
          aria-label="Toggle Overlay"
          title="Toggle overlay"
        >
          <Layers className="size-3.5" />
        </button>

        <button
          onClick={handleMinimize}
          className={cn(
            "inline-flex h-full w-11 items-center justify-center transition-colors",
            "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
          )}
          aria-label="Minimize"
        >
          <Minus className="size-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className={cn(
            "inline-flex h-full w-11 items-center justify-center transition-colors",
            "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
          )}
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy className="size-3 rotate-180" />
          ) : (
            <Square className="size-3" />
          )}
        </button>

        <button
          onClick={handleClose}
          className={cn(
            "inline-flex h-full w-11 items-center justify-center transition-colors",
            "hover:bg-destructive hover:text-white"
          )}
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {autoBackupStatus.running && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2 pb-0.5">
          <Progress
            value={
              autoBackupStatus.total
                ? Math.round((autoBackupStatus.current / autoBackupStatus.total) * 100)
                : 0
            }
            className="h-0.5 bg-primary/15"
          />
        </div>
      )}
    </div>
  );
}
