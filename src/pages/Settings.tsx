import { useCallback, useState } from "react";
import { useApp } from "@/contexts/app.context";
import { useTheme } from "@/contexts/theme.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderOpen,
  Archive,
  Camera,
  Moon,
  Sun,
  Monitor,
  Shield,
  Bell,
  Palette,
  Trash2,
  Info,
  Sparkles,
  Globe,
  Eye,
  EyeOff,
} from "lucide-react";
import type { AppSettings } from "@/types";

export default function Settings() {
  const { settings, updateSetting, games } = useApp();
  const { theme, setTheme } = useTheme();
  const [showApiKey, setShowApiKey] = useState(false);

  const handleUpdate = useCallback(
    async (key: keyof AppSettings, value: unknown) => {
      try {
        const strValue =
          typeof value === "boolean"
            ? value ? "true" : "false"
            : String(value);
        await updateSetting(key, strValue);
      } catch (err) {
        toast.error(`Failed to save setting: ${err}`);
      }
    },
    [updateSetting]
  );

  const handlePickDir = async (field: "backup_directory" | "screenshots_directory") => {
    try {
      const folder = await invoke<string | null>("pick_folder_path", {
        title: `Select ${field === "backup_directory" ? "Backup" : "Screenshots"} Directory`,
      });
      if (folder) {
        await handleUpdate(field, folder);
        toast.success(`${field === "backup_directory" ? "Backup" : "Screenshots"} directory updated`);
      }
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleClearAllData = async () => {
    if (!confirm("This will permanently delete ALL data including backups, screenshots, and settings. Continue?")) return;
    if (!confirm("Are you absolutely sure? This cannot be undone.")) return;

    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM backups");
      await conn.execute("DELETE FROM screenshots");
      await conn.execute("DELETE FROM key_mappings");
      await conn.execute("DELETE FROM macros");
      await conn.execute("DELETE FROM games");
      toast.success("All data cleared");
      window.location.reload();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" description="Configure GameVault to your liking" />

      <ScrollArea className="flex-1">
        <div className="p-5 max-w-xl space-y-4 pb-16">
          {/* ── Appearance ────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="size-3.5" /> Appearance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[11px]">Theme</Label>
                  <p className="text-[9px] text-muted-foreground">Choose your preferred color scheme</p>
                </div>
                <div className="flex gap-1 rounded-lg border p-0.5">
                  {(["light", "dark", "system"] as const).map((t) => (
                    <Button
                      key={t}
                      variant={theme === t ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setTheme(t)}
                    >
                      {t === "light" && <Sun className="size-3 mr-1" />}
                      {t === "dark" && <Moon className="size-3 mr-1" />}
                      {t === "system" && <Monitor className="size-3 mr-1" />}
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── AI Configuration ──────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-3.5" /> AI Configuration
              </CardTitle>
              <CardDescription>Configure AI provider and API keys for the AI Chat feature</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Provider selector */}
              <div>
                <Label className="text-[10px]">AI Provider</Label>
                <p className="text-[9px] text-muted-foreground mb-1">Choose which AI service to use</p>
                <Select
                  value={settings.ai_provider}
                  onValueChange={(v) => {
                    handleUpdate("ai_provider", v);
                    // Auto-set default model when switching
                    if (v === "openai" && settings.ai_model.includes("/")) {
                      handleUpdate("ai_model", "gpt-4o-mini");
                    } else if (v === "openrouter" && !settings.ai_model.includes("/")) {
                      handleUpdate("ai_model", "openai/gpt-4o-mini");
                    }
                  }}
                >
                  <SelectTrigger className="w-full h-8 text-[10px]">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openrouter">
                      <div className="flex items-center gap-2">
                        <Globe className="size-3" />
                        <span>OpenRouter</span>
                        <Badge variant="outline" className="text-[7px] px-1 py-0 ml-1">recommended</Badge>
                      </div>
                    </SelectItem>
                    <SelectItem value="openai">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-3" />
                        <span>OpenAI (Direct)</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* OpenRouter API Key */}
              <div>
                <Label className="text-[10px]">OpenRouter API Key</Label>
                <p className="text-[9px] text-muted-foreground mb-1">
                  Get your key at{" "}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-gaming hover:underline">openrouter.ai/keys</a>
                </p>
                <div className="flex gap-1.5">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={settings.ai_openrouter_api_key}
                    onChange={(e) => handleUpdate("ai_openrouter_api_key", e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="flex-1 text-[10px] font-mono"
                  />
                  <Button variant="outline" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </Button>
                </div>
                {settings.ai_provider === "openrouter" && settings.ai_openrouter_api_key && (
                  <p className="text-[8px] text-success mt-0.5 flex items-center gap-1">● Active — using this key</p>
                )}
              </div>

              {/* OpenAI API Key */}
              <div>
                <Label className="text-[10px]">OpenAI API Key</Label>
                <p className="text-[9px] text-muted-foreground mb-1">
                  Get your key at{" "}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-gaming hover:underline">platform.openai.com</a>
                </p>
                <div className="flex gap-1.5">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={settings.ai_openai_api_key}
                    onChange={(e) => handleUpdate("ai_openai_api_key", e.target.value)}
                    placeholder="sk-..."
                    className="flex-1 text-[10px] font-mono"
                  />
                  <Button variant="outline" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </Button>
                </div>
                {settings.ai_provider === "openai" && settings.ai_openai_api_key && (
                  <p className="text-[8px] text-success mt-0.5 flex items-center gap-1">● Active — using this key</p>
                )}
              </div>

              {/* Model */}
              <div>
                <Label className="text-[10px]">Model</Label>
                <p className="text-[9px] text-muted-foreground mb-1">
                  {settings.ai_provider === "openrouter"
                    ? "Use OpenRouter format: provider/model (e.g. openai/gpt-4o-mini)"
                    : "Use OpenAI model name (e.g. gpt-4o-mini)"}
                </p>
                <Input
                  value={settings.ai_model}
                  onChange={(e) => handleUpdate("ai_model", e.target.value)}
                  placeholder={settings.ai_provider === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini"}
                  className="w-full text-[10px] font-mono"
                />
              </div>

              {/* Web search info */}
              {settings.ai_provider === "openrouter" && (
                <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Globe className="size-3 text-blue-400" />
                    <span className="text-[10px] font-medium text-blue-400">Web Search Available</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground">
                    OpenRouter supports live web search via the <code className="text-[8px] bg-muted px-1 rounded">:online</code> model suffix. Toggle it in the AI Chat page.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Backups ───────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Archive className="size-3.5" /> Backups
              </CardTitle>
              <CardDescription>Configure backup behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-[10px]">Backup Directory</Label>
                <div className="flex gap-1.5 mt-1">
                  <Input
                    value={settings.backup_directory}
                    readOnly
                    className="flex-1 text-[10px]"
                    placeholder="Not set"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => handlePickDir("backup_directory")}
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[10px]">Auto-Backup</Label>
                  <p className="text-[9px] text-muted-foreground">
                    Automatically back up game saves
                  </p>
                </div>
                <Switch
                  checked={settings.auto_backup_enabled}
                  onCheckedChange={(v) => handleUpdate("auto_backup_enabled", v)}
                />
              </div>

              {settings.auto_backup_enabled && (
                <div>
                  <Label className="text-[10px]">Backup Interval (minutes)</Label>
                  <Input
                    type="number"
                    value={settings.auto_backup_interval_minutes}
                    onChange={(e) =>
                      handleUpdate(
                        "auto_backup_interval_minutes",
                        Math.max(5, parseInt(e.target.value) || 30)
                      )
                    }
                    min={5}
                    className="mt-1 w-32"
                  />
                </div>
              )}

              <div>
                <Label className="text-[10px]">Max Backups Per Game</Label>
                <Input
                  type="number"
                  value={settings.max_backups_per_game}
                  onChange={(e) =>
                    handleUpdate(
                      "max_backups_per_game",
                      Math.max(1, parseInt(e.target.value) || 10)
                    )
                  }
                  min={1}
                  className="mt-1 w-32"
                />
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  Oldest backups are auto-deleted when exceeded
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[10px]">Compress Backups</Label>
                  <p className="text-[9px] text-muted-foreground">
                    Use ZIP compression (saves disk space)
                  </p>
                </div>
                <Switch
                  checked={settings.compress_backups}
                  onCheckedChange={(v) => handleUpdate("compress_backups", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Screenshots ───────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="size-3.5" /> Screenshots
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-[10px]">Screenshots Directory</Label>
                <div className="flex gap-1.5 mt-1">
                  <Input
                    value={settings.screenshots_directory}
                    readOnly
                    className="flex-1 text-[10px]"
                    placeholder="Not set"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => handlePickDir("screenshots_directory")}
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-[10px]">Screenshot Shortcut</Label>
                <Input
                  value={settings.screenshot_shortcut}
                  onChange={(e) => handleUpdate("screenshot_shortcut", e.target.value)}
                  placeholder="Ctrl+Shift+S"
                  className="mt-1 w-48 font-mono text-[10px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Notifications ─────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="size-3.5" /> Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[10px]">Backup Notifications</Label>
                  <p className="text-[9px] text-muted-foreground">
                    Show a notification when a backup completes
                  </p>
                </div>
                <Switch
                  checked={settings.notify_backup_complete}
                  onCheckedChange={(v) => handleUpdate("notify_backup_complete", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[10px]">Launch on Startup</Label>
                  <p className="text-[9px] text-muted-foreground">
                    Start GameVault when your PC boots
                  </p>
                </div>
                <Switch
                  checked={settings.launch_on_startup}
                  onCheckedChange={(v) => handleUpdate("launch_on_startup", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[10px]">Minimize to Tray</Label>
                  <p className="text-[9px] text-muted-foreground">
                    Keep running in the system tray when closed
                  </p>
                </div>
                <Switch
                  checked={settings.minimize_to_tray}
                  onCheckedChange={(v) => handleUpdate("minimize_to_tray", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Danger Zone ───────────────────────────────────── */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Shield className="size-3.5" /> Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[10px]">Clear All Data</Label>
                  <p className="text-[9px] text-muted-foreground">
                    Remove all games, backups, screenshots, and settings
                  </p>
                </div>
                <Button variant="destructive" size="sm" onClick={handleClearAllData}>
                  <Trash2 className="size-3" /> Reset Everything
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── About ────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="size-3.5" /> About
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-[10px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Version</span>
                  <Badge variant="secondary" className="text-[8px]">2.0.0-alpha</Badge>
                </div>
                <div className="flex justify-between">
                  <span>Engine</span>
                  <span>Tauri v2 + React</span>
                </div>
                <div className="flex justify-between">
                  <span>Games in library</span>
                  <span>{games.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
