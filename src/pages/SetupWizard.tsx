import { useState } from "react";
import { useApp } from "@/contexts/app.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import {
  Gamepad2,
  FolderOpen,
  Archive,
  ArrowRight,
  Check,
  ChevronLeft,
  Sparkles,
  Shield,
  Rocket,
  FolderSearch,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DetectedGame } from "@/types";
import gamesDatabase from "@/data/games.json";

type Step = "welcome" | "backup" | "detect" | "done";

export default function SetupWizard() {
  const { settings, updateSetting, setGames, setSetupComplete } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [backupDir, setBackupDir] = useState(settings.backup_directory || "");
  const [autoBackup, setAutoBackup] = useState(true);
  const [detectedGames, setDetectedGames] = useState<DetectedGame[]>([]);
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [isDetecting, setIsDetecting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  const steps: Step[] = ["welcome", "backup", "detect", "done"];
  const currentIndex = steps.indexOf(step);

  const handlePickBackupDir = async () => {
    try {
      const folder = await invoke<string | null>("pick_folder_path", {
        title: "Select Backup Directory",
      });
      if (folder) setBackupDir(folder);
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleDetect = async () => {
    setIsDetecting(true);
    try {
      const result = await invoke<DetectedGame[]>("detect_installed_games", {
        gamesJson: JSON.stringify(gamesDatabase),
      });
      setDetectedGames(result);
      // Select all by default
      setSelectedGames(new Set(result.map((g) => g.id)));
    } catch (err) {
      toast.error(`Detection failed: ${err}`);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      // Save settings via key-value store
      await updateSetting("backup_directory", backupDir);
      await updateSetting("auto_backup_enabled", autoBackup ? "true" : "false");
      await updateSetting("setup_complete", "true");

      // Add selected games
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const toAdd = detectedGames.filter((g) => selectedGames.has(g.id));
      const newGames = [];

      for (const game of toAdd) {
        await conn.execute(
          `INSERT OR IGNORE INTO games (id, name, developer, steam_appid, cover_url, header_url, save_paths, extensions, notes, is_detected, added_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, datetime('now'), datetime('now'))`,
          [
            game.id,
            game.name,
            game.developer,
            game.steam_appid,
            game.cover_url,
            game.header_url,
            JSON.stringify(game.save_paths),
            JSON.stringify(game.extensions),
            game.notes,
          ]
        );

        newGames.push({
          id: game.id,
          name: game.name,
          developer: game.developer,
          steam_appid: game.steam_appid,
          cover_url: game.cover_url,
          header_url: game.header_url,
          custom_cover_path: null,
          custom_header_path: null,
          save_paths: game.save_paths,
          extensions: game.extensions,
          notes: game.notes,
          exe_path: null,
          is_custom: false,
          is_detected: true,
          is_favorite: false,
          auto_backup_disabled: false,
          play_count: 0,
          total_playtime_seconds: 0,
          last_played_at: null,
          added_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      if (newGames.length > 0) {
        setGames(newGames);
      }

      toast.success("Setup complete! Welcome to GameVault.");
      setSetupComplete(true);
    } catch (err) {
      toast.error(`Setup failed: ${err}`);
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-background p-4 overflow-hidden">
      {/* Progress dots */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              "size-2 rounded-full transition-all",
              i < currentIndex
                ? "bg-primary"
                : i === currentIndex
                ? "bg-primary w-6"
                : "bg-muted"
            )}
          />
        ))}
      </div>

      {/* Content */}
      <div className="w-full max-w-md animate-slide-up">
        {/* ── Welcome ────────────────────────────────────── */}
        {step === "welcome" && (
          <div className="text-center space-y-4">
            <div className="size-16 rounded-2xl bg-gaming/15 flex items-center justify-center mx-auto">
              <Gamepad2 className="size-8 text-gaming" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Welcome to GameVault</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Your personal game save manager. Let's get you set up in under a minute.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-6">
              {[
                { icon: Shield, label: "Safe Backups", desc: "Never lose progress" },
                { icon: Sparkles, label: "AI Powered", desc: "Smart save detection" },
                { icon: Rocket, label: "Lightning Fast", desc: "Native Rust engine" },
              ].map((feat) => (
                <div key={feat.label} className="p-3 rounded-xl bg-card border border-border text-center">
                  <feat.icon className="size-5 mx-auto text-primary mb-1" />
                  <p className="text-[10px] font-medium">{feat.label}</p>
                  <p className="text-[8px] text-muted-foreground">{feat.desc}</p>
                </div>
              ))}
            </div>

            <Button className="w-full mt-4" onClick={() => setStep("backup")}>
              Get Started <ArrowRight className="size-3 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Backup Setup ────────────────────────────────── */}
        {step === "backup" && (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <div className="size-12 rounded-xl bg-primary/15 flex items-center justify-center mx-auto mb-2">
                <Archive className="size-6 text-primary" />
              </div>
              <h2 className="text-lg font-bold">Set Up Backups</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Choose where to store your game save backups
              </p>
            </div>

            <div>
              <Label className="text-[10px]">Backup Directory</Label>
              <div className="flex gap-1.5 mt-1">
                <Input
                  value={backupDir}
                  readOnly
                  className="flex-1 text-[10px]"
                  placeholder="Click to select..."
                />
                <Button variant="outline" size="icon" onClick={handlePickBackupDir}>
                  <FolderOpen className="size-3.5" />
                </Button>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">
                Can be a local folder, external drive, or network share
              </p>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <Label className="text-[10px]">Enable Auto-Backup</Label>
                <p className="text-[8px] text-muted-foreground">
                  Periodically back up saves automatically
                </p>
              </div>
              <Switch checked={autoBackup} onCheckedChange={setAutoBackup} />
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep("welcome")}>
                <ChevronLeft className="size-3" /> Back
              </Button>
              <Button className="flex-1" onClick={() => { setStep("detect"); handleDetect(); }}>
                Continue <ArrowRight className="size-3 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Game Detection ──────────────────────────────── */}
        {step === "detect" && (
          <div className="space-y-3">
            <div className="text-center mb-2">
              <div className="size-12 rounded-xl bg-gaming/15 flex items-center justify-center mx-auto mb-2">
                <FolderSearch className="size-6 text-gaming" />
              </div>
              <h2 className="text-lg font-bold">Detect Your Games</h2>
              <p className="text-xs text-muted-foreground mt-1">
                We'll scan your system for installed games
              </p>
            </div>

            <div className="rounded-xl border max-h-48 overflow-y-auto">
              {isDetecting ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="size-6 rounded" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-2.5 w-28 rounded" />
                        <Skeleton className="h-2 w-16 rounded" />
                      </div>
                    </div>
                  ))}
                  <p className="text-[9px] text-muted-foreground text-center pt-1">
                    Scanning your system...
                  </p>
                </div>
              ) : detectedGames.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-muted-foreground">No games found</p>
                  <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                    You can add games manually later
                  </p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={handleDetect}>
                    <RefreshCw className="size-3" /> Re-scan
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {detectedGames.map((game) => (
                    <button
                      key={game.id}
                      onClick={() => {
                        setSelectedGames((prev) => {
                          const next = new Set(prev);
                          if (next.has(game.id)) next.delete(game.id);
                          else next.add(game.id);
                          return next;
                        });
                      }}
                      className="w-full flex items-center gap-2 p-2 hover:bg-accent transition-colors text-left"
                    >
                      <div
                        className={cn(
                          "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          selectedGames.has(game.id)
                            ? "bg-primary border-primary"
                            : "border-muted-foreground/30"
                        )}
                      >
                        {selectedGames.has(game.id) && (
                          <Check className="size-2.5 text-primary-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium truncate">{game.name}</p>
                        <p className="text-[8px] text-muted-foreground truncate">{game.developer}</p>
                      </div>
                      {game.steam_appid && (
                        <Badge variant="outline" className="text-[7px] shrink-0">Steam</Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {detectedGames.length > 0 && (
              <p className="text-[9px] text-muted-foreground text-center">
                {selectedGames.size} of {detectedGames.length} games selected
              </p>
            )}

            <div className="flex gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("backup")}>
                <ChevronLeft className="size-3" /> Back
              </Button>
              <Button className="flex-1" onClick={() => setStep("done")}>
                Continue <ArrowRight className="size-3 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Done ────────────────────────────────────────── */}
        {step === "done" && (
          <div className="text-center space-y-4">
            <div className="size-16 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto">
              <Check className="size-8 text-green-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold">You're All Set!</h2>
              <p className="text-xs text-muted-foreground mt-1">
                GameVault is ready to protect your game saves.
              </p>
            </div>

            <div className="rounded-xl border p-3 text-left space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Backup location</span>
                <span className="font-medium truncate max-w-50">{backupDir || "Not set"}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Auto-backup</span>
                <span className="font-medium">{autoBackup ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Games to add</span>
                <span className="font-medium">{selectedGames.size}</span>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep("detect")}>
                <ChevronLeft className="size-3" /> Back
              </Button>
              <Button className="flex-1" onClick={handleFinish} disabled={isFinishing}>
                {isFinishing ? (
                  <div className="size-3 border-2 border-t-transparent border-current rounded-full animate-spin" />
                ) : (
                  <Rocket className="size-3" />
                )}
                Launch GameVault
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
