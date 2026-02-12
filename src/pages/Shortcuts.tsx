import React, { useCallback } from "react";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShortcutRecorder } from "@/components/ShortcutRecorder";
import { toast } from "sonner";
import {
  Camera,
  Archive,
  Keyboard,
  Layers,
  Video,
} from "lucide-react";
import type { AppSettings } from "@/types";

const SHORTCUT_DEFS: {
  key: keyof AppSettings;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  { key: "overlay_shortcut", label: "Toggle Overlay", description: "Show/hide the in-game overlay strip", icon: <Layers className="size-3.5" /> },
  { key: "screenshot_shortcut", label: "Take Screenshot", description: "Capture the screen instantly", icon: <Camera className="size-3.5" /> },
  { key: "quick_backup_shortcut", label: "Quick Backup", description: "Backup selected game's saves", icon: <Archive className="size-3.5" /> },
  { key: "recording_shortcut", label: "Toggle Recording", description: "Start or stop screen recording", icon: <Video className="size-3.5" /> },
];

export default function Shortcuts() {
  const { settings, updateSetting } = useApp();

  const handleChange = useCallback(
    async (key: keyof AppSettings, value: string) => {
      try {
        await updateSetting(key, value);
        toast.success("Shortcut updated");
      } catch (err) {
        toast.error(`Failed to save shortcut: ${err}`);
      }
    },
    [updateSetting]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <Header
        title="Keyboard Shortcuts"
        description="View and customise global hotkeys"
      />

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 max-w-2xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Keyboard className="size-3.5" /> Global Shortcuts
              </CardTitle>
              <CardDescription className="text-[9px]">
                Click any shortcut badge to re-record it. Press the new key combination, or Esc to cancel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {SHORTCUT_DEFS.map((def) => (
                <div
                  key={def.key}
                  className="flex items-center justify-between gap-3 py-2 px-2.5 rounded-lg hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-muted-foreground shrink-0">{def.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium leading-tight">{def.label}</p>
                      <p className="text-[8px] text-muted-foreground leading-tight">{def.description}</p>
                    </div>
                  </div>
                  <ShortcutRecorder
                    value={settings[def.key] as string}
                    onChange={(key) => handleChange(def.key, key)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-[9px] text-muted-foreground/60 text-center pb-4">
            Shortcuts are registered globally and work even when GameVault is in the background.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
