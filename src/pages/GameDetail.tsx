import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApp } from "@/contexts/app.context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  Play,
  Save,
  FolderOpen,
  Star,
  Camera,
  MoreVertical,
  Trash2,
  RotateCcw,
  Clock,
  HardDrive,
  Archive,
  Image,
  Sparkles,
  Gamepad2,
  Palette,
  StickyNote,
  Plus,
  Pin,
  PinOff,
  Pencil,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Upload,
  Share2,
  Video,
  ExternalLink,
} from "lucide-react";
import { cn, formatBytes, formatDate, formatRelativeTime } from "@/lib/utils";
import GameCover from "@/components/GameCover";
import type { Backup, BackupCollection, Screenshot, GameNote, Recording } from "@/types";

export default function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { games, settings, setGames } = useApp();
  const [activeTab, setActiveTab] = useState("backups");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [collections, setCollections] = useState<BackupCollection[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [backupName, setBackupName] = useState("");
  const [backupCollectionId, setBackupCollectionId] = useState<string | null>(null);
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionColor, setNewCollectionColor] = useState("#6366f1");
  const [newCollectionMaxBackups, setNewCollectionMaxBackups] = useState(10);
  const [coverChangeOpen, setCoverChangeOpen] = useState(false);
  const [gameNotes, setGameNotes] = useState<GameNote[]>([]);
  const [playtimeDaily, setPlaytimeDaily] = useState<Array<{ day: string; duration_seconds: number }>>([]);
  const [isLoadingPlaytime, setIsLoadingPlaytime] = useState(true);
  const [editableExePath, setEditableExePath] = useState("");
  const [editableSavePaths, setEditableSavePaths] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");

  const game = games.find((g) => g.id === gameId);

  useEffect(() => {
    if (!game) return;
    setEditableExePath(game.exe_path || "");
    setEditableSavePaths(game.save_paths.join("\n"));
  }, [game?.id]);

  // Load backups, screenshots, and notes
  useEffect(() => {
    if (!gameId) return;
    loadBackups();
    loadScreenshots();
    loadRecordings();
    loadGameNotes();
    loadPlaytimeDaily();
  }, [gameId]);

  // Reload playtime graph when total_playtime_seconds changes (e.g. session ends)
  useEffect(() => {
    if (!gameId || !game) return;
    loadPlaytimeDaily();
  }, [game?.total_playtime_seconds]);

  const loadPlaytimeDaily = useCallback(async () => {
    if (!gameId) return;
    setIsLoadingPlaytime(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT day, duration_seconds FROM playtime_daily WHERE game_id = $1 ORDER BY day DESC LIMIT 32",
        [gameId]
      )) as Array<{ day: string; duration_seconds: number }>;
      setPlaytimeDaily(rows);
    } catch {
      setPlaytimeDaily([]);
    } finally {
      setIsLoadingPlaytime(false);
    }
  }, [gameId]);

  const loadBackups = useCallback(async () => {
    if (!gameId) return;
    setIsLoadingBackups(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      const backupRows = (await conn.select(
        "SELECT * FROM backups WHERE game_id = $1 ORDER BY created_at DESC",
        [gameId]
      )) as Backup[];
      setBackups(backupRows);

      const collRows = (await conn.select(
        "SELECT * FROM backup_collections WHERE game_id = $1 ORDER BY name ASC",
        [gameId]
      )) as BackupCollection[];
      setCollections(collRows);
    } catch (err) {
      console.error("Failed to load backups:", err);
    } finally {
      setIsLoadingBackups(false);
    }
  }, [gameId]);

  const loadScreenshots = useCallback(async () => {
    if (!gameId) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM screenshots WHERE game_id = $1 ORDER BY captured_at DESC",
        [gameId]
      )) as Record<string, unknown>[];
      setScreenshots(
        rows.map((r) => ({
          ...r,
          tags: JSON.parse((r.tags as string) || "[]"),
        })) as Screenshot[]
      );
    } catch (err) {
      console.error("Failed to load screenshots:", err);
    }
  }, [gameId]);

  const loadRecordings = useCallback(async () => {
    if (!gameId) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM recordings WHERE game_id = $1 ORDER BY recorded_at DESC",
        [gameId]
      )) as Record<string, unknown>[];
      setRecordings(
        rows.map((r) => ({
          id: r.id as string,
          game_id: r.game_id as string,
          file_path: r.file_path as string,
          thumbnail_path: (r.thumbnail_path as string) || "",
          title: (r.title as string) || "",
          description: (r.description as string) || "",
          tags: JSON.parse((r.tags as string) || "[]"),
          width: (r.width as number) || 0,
          height: (r.height as number) || 0,
          file_size: (r.file_size as number) || 0,
          duration_seconds: (r.duration_seconds as number) || 0,
          fps: (r.fps as number) || 30,
          recorded_at: r.recorded_at as string,
        }))
      );
    } catch (err) {
      console.error("Failed to load recordings:", err);
    }
  }, [gameId]);

  const loadGameNotes = useCallback(async () => {
    if (!gameId) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM game_notes WHERE game_id = $1 ORDER BY is_pinned DESC, updated_at DESC",
        [gameId]
      )) as Record<string, unknown>[];
      setGameNotes(
        rows.map((r) => ({
          id: r.id as string,
          game_id: r.game_id as string,
          title: r.title as string,
          content: r.content as string,
          color: r.color as string,
          is_pinned: Boolean(r.is_pinned),
          reminder_enabled: Boolean((r as any).reminder_enabled),
          remind_next_session: Boolean((r as any).remind_next_session),
          remind_at: ((r as any).remind_at as string) || null,
          recurring_days:
            typeof (r as any).recurring_days === "number"
              ? ((r as any).recurring_days as number)
              : (r as any).recurring_days
                ? parseInt(String((r as any).recurring_days))
                : null,
          last_reminded_at: ((r as any).last_reminded_at as string) || null,
          last_shown_at: ((r as any).last_shown_at as string) || null,
          is_dismissed: Boolean((r as any).is_dismissed),
          tags: (() => {
            try {
              const raw = (r as any).tags;
              if (Array.isArray(raw)) return raw;
              if (typeof raw === "string") return JSON.parse(raw);
              return [];
            } catch { return []; }
          })(),
          is_archived: Boolean((r as any).is_archived),
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        }))
      );
    } catch (err) {
      console.error("Failed to load game notes:", err);
    }
  }, [gameId]);

  const handleCreateCollection = async () => {
    if (!gameId || !newCollectionName.trim()) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const id = crypto.randomUUID();
      await conn.execute(
        "INSERT INTO backup_collections (id, game_id, name, max_backups, color) VALUES ($1, $2, $3, $4, $5)",
        [id, gameId, newCollectionName.trim(), newCollectionMaxBackups, newCollectionColor]
      );
      setCollectionDialogOpen(false);
      setNewCollectionName("");
      setNewCollectionMaxBackups(10);
      toast.success("Collection created");
      loadBackups();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleDeleteCollection = async (collId: string) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      // Move backups in this collection to uncategorized
      await conn.execute("UPDATE backups SET collection_id = NULL WHERE collection_id = $1", [collId]);
      await conn.execute("DELETE FROM backup_collections WHERE id = $1", [collId]);
      toast.success("Collection deleted, backups moved to Uncategorized");
      loadBackups();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleMoveBackup = async (backupId: string, collId: string | null) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("UPDATE backups SET collection_id = $1 WHERE id = $2", [collId, backupId]);
      loadBackups();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleBackup = async () => {
    if (!game || !settings.backup_directory) {
      toast.error("Please set a backup directory in Settings first");
      return;
    }

    setIsBackingUp(true);
    const toastId = toast.loading("Creating backup...");

    try {
      const savePath = await invoke<string>("expand_env_path", {
        path: game.save_paths[0],
      });

      const result = await invoke<{
        success: boolean;
        backup_id: string;
        file_path: string;
        file_size: number;
        compressed_size: number;
        content_hash: string;
        skipped_duplicate: boolean;
        message: string;
      }>("create_backup", {
        backupDir: settings.backup_directory,
        gameId: game.id,
        gameName: game.name,
        savePath,
        displayName: backupName || `Backup ${new Date().toLocaleDateString()}`,
        collectionId: backupCollectionId,
        checkDuplicates: true,
      });

      if (result.skipped_duplicate) {
        toast.info(result.message, { id: toastId });
      } else {
        // Save to database
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          `INSERT INTO backups (id, game_id, collection_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, datetime('now'))`,
          [
            result.backup_id,
            game.id,
            backupCollectionId,
            backupName || `Backup ${new Date().toLocaleDateString()}`,
            result.file_path,
            result.file_size,
            result.compressed_size,
            result.content_hash,
            savePath,
          ]
        );

        toast.success(result.message, { id: toastId });
        loadBackups();
      }
    } catch (err) {
      toast.error(`Backup failed: ${err}`, { id: toastId });
    } finally {
      setIsBackingUp(false);
      setBackupDialogOpen(false);
      setBackupName("");
    }
  };

  const handleRestore = async (backup: Backup) => {
    if (!game) return;
    const toastId = toast.loading("Restoring backup...");

    try {
      const savePath = await invoke<string>("expand_env_path", {
        path: game.save_paths[0],
      });

      const result = await invoke<{ success: boolean; files_restored: number; message: string }>(
        "restore_backup",
        {
          zipPath: backup.file_path,
          restorePath: savePath,
          createSafetyBackup: true,
          backupDir: settings.backup_directory,
          gameId: game.id,
          gameName: game.name,
        }
      );

      toast.success(result.message, { id: toastId });
    } catch (err) {
      toast.error(`Restore failed: ${err}`, { id: toastId });
    }
  };

  const handleDeleteBackup = async (backup: Backup) => {
    try {
      await invoke("delete_backup", { zipPath: backup.file_path });
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM backups WHERE id = $1", [backup.id]);
      toast.success("Backup deleted");
      loadBackups();
    } catch (err) {
      toast.error(`Failed to delete: ${err}`);
    }
  };

  const handleExportBackup = async (backup: Backup) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const destFolder = await open({ directory: true, title: "Export Backup To..." });
      if (!destFolder) return;
      const toastId = toast.loading("Exporting backup...");
      const destPath = await invoke<string>("export_backup", {
        zipPath: backup.file_path,
        destFolder: destFolder as string,
      });
      toast.success(`Backup exported to ${destPath}`, { id: toastId });
    } catch (err) {
      toast.error(`Export failed: ${err}`);
    }
  };

  const handleImportBackup = async () => {
    if (!game) return;
    if (!settings.backup_directory) {
      toast.error("Set a backup directory in Settings first");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({
        title: "Import Backup (.zip)",
        filters: [{ name: "Backup Archive", extensions: ["zip"] }],
        multiple: false,
      });
      if (!file) return;
      const toastId = toast.loading("Importing backup...");
      const result = await invoke<{
        backup_id: string;
        file_path: string;
        display_name: string;
        file_size: number;
        compressed_size: number;
        content_hash: string;
        source_path: string;
      }>("import_external_backup", {
        sourceZip: file as string,
        backupDir: settings.backup_directory,
        gameId: game.id,
        gameName: game.name,
      });
      // Insert into DB
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT OR IGNORE INTO backups (id, game_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
        [
          result.backup_id,
          game.id,
          result.display_name,
          result.file_path,
          result.file_size,
          result.compressed_size,
          result.content_hash,
          result.source_path,
        ]
      );
      toast.success("Backup imported successfully!", { id: toastId });
      loadBackups();
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    }
  };

  const handleLaunchGame = async () => {
    if (!game?.exe_path) {
      toast.error("Set a game executable path first");
      return;
    }
    setIsLaunching(true);
    try {
      await invoke("launch_game", { exePath: game.exe_path });
      toast.success("Game launched");
    } catch (err) {
      toast.error(`Failed to launch: ${err}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!game) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE games SET is_favorite = $1, updated_at = datetime('now') WHERE id = $2",
        [game.is_favorite ? 0 : 1, game.id]
      );
      setGames((prev) =>
        prev.map((g) =>
          g.id === game.id ? { ...g, is_favorite: !g.is_favorite } : g
        )
      );
    } catch (err) {
      toast.error(`Failed to update: ${err}`);
    }
  };

  const handleOpenSaveDir = async () => {
    if (!game) return;
    try {
      await invoke("open_save_directory", { path: game.save_paths[0] });
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleSetCover = async () => {
    try {
      const path = await invoke<string | null>("pick_image_file");
      if (path && game) {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          "UPDATE games SET custom_cover_path = $1, updated_at = datetime('now') WHERE id = $2",
          [path, game.id]
        );
        setGames((prev) =>
          prev.map((g) =>
            g.id === game.id ? { ...g, custom_cover_path: path } : g
          )
        );
        toast.success("Cover image updated");
        setCoverChangeOpen(false);
      }
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleSetHeader = async () => {
    try {
      const path = await invoke<string | null>("pick_image_file");
      if (path && game) {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          "UPDATE games SET custom_header_path = $1, updated_at = datetime('now') WHERE id = $2",
          [path, game.id]
        );
        setGames((prev) =>
          prev.map((g) =>
            g.id === game.id ? { ...g, custom_header_path: path } : g
          )
        );
        toast.success("Header image updated");
        setCoverChangeOpen(false);
      }
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleSavePathConfig = async () => {
    if (!game) return;
    const savePaths = editableSavePaths
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE games SET save_paths = $1, exe_path = $2, updated_at = datetime('now') WHERE id = $3",
        [JSON.stringify(savePaths), editableExePath.trim() || null, game.id]
      );

      setGames((prev) =>
        prev.map((g) =>
          g.id === game.id
            ? {
                ...g,
                save_paths: savePaths,
                exe_path: editableExePath.trim() || null,
                updated_at: new Date().toISOString(),
              }
            : g
        )
      );
      toast.success("Game paths updated");
    } catch (err) {
      toast.error(`Failed to update paths: ${err}`);
    }
  };

  const handlePickConfigSavePath = async () => {
    try {
      const folder = await invoke<string | null>("pick_folder_path", {
        title: "Select Save Directory",
      });
      if (!folder) return;
      setEditableSavePaths((prev) => (prev ? `${prev}\n${folder}` : folder));
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handlePickConfigExePath = async () => {
    try {
      const path = await invoke<string | null>("pick_exe_path");
      if (path) setEditableExePath(path);
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleTakeScreenshot = async () => {
    if (!game || !settings.screenshots_directory) {
      toast.error("Please set a screenshots directory in Settings first");
      return;
    }

    try {
      const base64 = await invoke<string>("capture_screen");
      const result = await invoke<{
        id: string;
        file_path: string;
        thumbnail_path: string;
        width: number;
        height: number;
        file_size: number;
      }>("save_screenshot_file", {
        screenshotsDir: settings.screenshots_directory,
        gameId: game.id,
        base64Data: base64,
      });

      // Save to database
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
        [result.id, game.id, result.file_path, result.thumbnail_path, result.width, result.height, result.file_size]
      );

      toast.success("Screenshot captured!");
      loadScreenshots();
    } catch (err) {
      toast.error(`Screenshot failed: ${err}`);
    }
  };

  if (!game) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Gamepad2 className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">Game not found</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate("/")}>
          Back to Library
        </Button>
      </div>
    );
  }

  const formatLocalDay = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h <= 0) return `${m}m`;
    if (m <= 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const playtimeMap = useMemo(() => {
    return new Map(playtimeDaily.map((p) => [p.day, p.duration_seconds] as const));
  }, [playtimeDaily]);

  const playtimeSeries = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 14 }).map((_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (13 - i));
      const day = formatLocalDay(d);
      return { day, seconds: playtimeMap.get(day) || 0 };
    });
    return days;
  }, [playtimeMap]);

  const maxDaySeconds = Math.max(1, ...playtimeSeries.map((d: { day: string; seconds: number }) => d.seconds));

  const headerSrc = game.custom_header_path || game.header_url;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Hero Header */}
      <div className="relative h-32 shrink-0 overflow-hidden sm:h-36">
        <GameCover
          gameId={game.id}
          gameName={game.name}
          coverUrl={headerSrc}
          className="w-full h-full"
          initialsClassName="text-3xl"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-linear-to-t from-background via-background/60 to-transparent" />

        {/* Game info overlay */}
        <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-end gap-3 px-4 pb-3 sm:px-5">
          {/* Cover thumbnail */}
          <div className="-mb-1 size-14 shrink-0 overflow-hidden rounded-xl border-2 border-background shadow-lg sm:size-16">
            <GameCover
              gameId={game.id}
              gameName={game.name}
              coverUrl={game.cover_url}
              customCoverPath={game.custom_cover_path}
              className="w-full h-full"
              initialsClassName="text-sm"
            />
          </div>

          <div className="min-w-0 flex-1 pb-0.5">
            <h1 className="truncate text-sm font-bold drop-shadow-md sm:text-base">
              {game.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {game.developer}
              </span>
              {game.is_detected && (
                <Badge variant="success" className="text-[8px]">Installed</Badge>
              )}
              {game.is_custom && (
                <Badge variant="outline" className="text-[8px]">Custom</Badge>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5 pb-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleToggleFavorite}
              className="size-7"
            >
              <Star
                className={cn(
                  "size-3.5",
                  game.is_favorite && "fill-warning text-warning"
                )}
              />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenSaveDir}
            >
              <FolderOpen className="size-3" />
              Saves
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTakeScreenshot}
            >
              <Camera className="size-3" />
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setBackupDialogOpen(true)}
              disabled={isBackingUp}
            >
              <Archive className="size-3" />
              Backup
            </Button>
            {game.exe_path && (
              <Button
                variant="gaming"
                size="sm"
                onClick={handleLaunchGame}
                disabled={isLaunching}
              >
                <Play className="size-3" />
                Play
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7">
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => {
                  setRenameName(game.name);
                  setRenameDialogOpen(true);
                }}>
                  <Pencil className="size-3" /> Rename Game
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCoverChangeOpen(true)}>
                  <Palette className="size-3" /> Change Cover/Header
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  const path = await invoke<string | null>("pick_exe_path");
                  if (path && game) {
                    const db = await import("@tauri-apps/plugin-sql");
                    const conn = await db.default.load("sqlite:gamevault.db");
                    await conn.execute(
                      "UPDATE games SET exe_path = $1, updated_at = datetime('now') WHERE id = $2",
                      [path, game.id]
                    );
                    setGames((prev) =>
                      prev.map((g) => (g.id === game.id ? { ...g, exe_path: path } : g))
                    );
                    toast.success("Executable path set");
                  }
                }}>
                  <Gamepad2 className="size-3" /> Set Executable
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={async () => {
                    try {
                      const db = await import("@tauri-apps/plugin-sql");
                      const conn = await db.default.load("sqlite:gamevault.db");
                      await conn.execute("DELETE FROM games WHERE id = $1", [game.id]);
                      setGames((prev) => prev.filter((g) => g.id !== game.id));
                      toast.success("Game removed from library");
                      navigate("/");
                    } catch (err) {
                      toast.error(`${err}`);
                    }
                  }}
                >
                  <Trash2 className="size-3" /> Remove Game
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-5 border-b border-border">
          <TabsList className="h-auto flex-wrap gap-4 bg-transparent p-0 py-1.5">
            <TabsTrigger value="backups" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <Archive className="size-3 mr-1" /> Backups
              <Badge variant="secondary" className="ml-1.5 text-[8px] px-1 py-0">{backups.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="screenshots" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <Image className="size-3 mr-1" /> Screenshots
              <Badge variant="secondary" className="ml-1.5 text-[8px] px-1 py-0">{screenshots.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="recordings" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <Video className="size-3 mr-1" /> Recordings
              <Badge variant="secondary" className="ml-1.5 text-[8px] px-1 py-0">{recordings.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="info" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <Sparkles className="size-3 mr-1" /> Info
            </TabsTrigger>
            <TabsTrigger value="notes" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <StickyNote className="size-3 mr-1" /> Notes
              {gameNotes.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[8px] px-1 py-0">{gameNotes.length}</Badge>}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Backups Tab */}
        <TabsContent value="backups" className="flex-1 min-h-0 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-5 space-y-3">
              {isLoadingBackups ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                    <Skeleton className="size-8 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-40 rounded" />
                      <Skeleton className="h-2 w-24 rounded" />
                    </div>
                    <Skeleton className="h-7 w-16 rounded" />
                  </div>
                ))
              ) : backups.length === 0 && collections.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <Archive className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No backups yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mb-3">
                    Create your first backup to protect your saves
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setBackupDialogOpen(true)}>
                      <Save className="size-3" /> Create Backup
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleImportBackup}>
                      <Upload className="size-3" /> Import Backup
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Actions bar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={() => setCollectionDialogOpen(true)}>
                      <FolderPlus className="size-2.5" /> New Collection
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={handleImportBackup}>
                      <Upload className="size-2.5" /> Import Backup
                    </Button>
                  </div>

                  {/* Collections */}
                  {collections.map((coll) => {
                    const collBackups = backups.filter((b) => b.collection_id === coll.id);
                    return (
                      <CollectionSection
                        key={coll.id}
                        collection={coll}
                        backups={collBackups}
                        allCollections={collections}
                        onRestore={handleRestore}
                        onDelete={handleDeleteBackup}
                        onExport={handleExportBackup}
                        onDeleteCollection={() => handleDeleteCollection(coll.id)}
                        onMoveBackup={handleMoveBackup}
                      />
                    );
                  })}

                  {/* Uncategorized backups */}
                  {(() => {
                    const uncategorized = backups.filter((b) => !b.collection_id);
                    if (uncategorized.length === 0) return null;
                    return (
                      <CollectionSection
                        key="uncategorized"
                        collection={null}
                        backups={uncategorized}
                        allCollections={collections}
                        onRestore={handleRestore}
                        onDelete={handleDeleteBackup}
                        onExport={handleExportBackup}
                        onDeleteCollection={() => {}}
                        onMoveBackup={handleMoveBackup}
                      />
                    );
                  })()}
                </>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Screenshots Tab */}
        <TabsContent value="screenshots" className="flex-1 min-h-0 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-5">
              {screenshots.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <Camera className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No screenshots yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mb-3">
                    Press {settings.screenshot_shortcut} to capture while playing
                  </p>
                  <Button size="sm" onClick={handleTakeScreenshot}>
                    <Camera className="size-3" /> Take Screenshot
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                  {screenshots.map((ss) => (
                    <ScreenshotCard key={ss.id} screenshot={ss} />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Recordings Tab */}
        <TabsContent value="recordings" className="flex-1 min-h-0 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-5">
              {recordings.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <Video className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No recordings yet</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    Press {settings.recording_shortcut || "F9"} to start recording while playing
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {recordings.map((rec) => {
                    const thumbSrc = rec.thumbnail_path ? convertFileSrc(rec.thumbnail_path) : null;
                    const durStr = rec.duration_seconds >= 60
                      ? `${Math.floor(rec.duration_seconds / 60)}m ${Math.floor(rec.duration_seconds % 60)}s`
                      : `${Math.floor(rec.duration_seconds)}s`;

                    return (
                      <div
                        key={rec.id}
                        className="group relative rounded-lg border border-border overflow-hidden hover:border-foreground/20 transition-all"
                      >
                        {/* Thumbnail */}
                        <div className="relative aspect-video bg-muted">
                          {thumbSrc ? (
                            <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Video className="size-6 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded">
                            {durStr}
                          </div>
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="text-[10px] h-6"
                              onClick={async () => {
                                try { await invoke("open_recording", { path: rec.file_path }); } catch (e: any) { toast.error(`${e}`); }
                              }}
                            >
                              <ExternalLink className="size-3" /> Play
                            </Button>
                          </div>
                        </div>
                        {/* Info */}
                        <div className="p-2">
                          <p className="text-[10px] text-muted-foreground truncate">
                            {rec.title || formatDate(rec.recorded_at)}
                          </p>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground/60">
                            <span>{rec.width}×{rec.height}</span>
                            <span>{formatBytes(rec.file_size)}</span>
                            <span>{rec.fps}fps</span>
                          </div>
                        </div>
                        {/* Delete button */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-red-500/80 text-white"
                          onClick={async () => {
                            try {
                              await invoke("delete_recording_file", { path: rec.file_path });
                              const db = await import("@tauri-apps/plugin-sql");
                              const conn = await db.default.load("sqlite:gamevault.db");
                              await conn.execute("DELETE FROM recordings WHERE id = $1", [rec.id]);
                              setRecordings((prev) => prev.filter((r) => r.id !== rec.id));
                              toast.success("Recording deleted");
                            } catch (e: any) { toast.error(`${e}`); }
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Info Tab */}
        <TabsContent value="info" className="flex-1 min-h-0 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-5 space-y-4 max-w-lg">
              <Card>
                <CardHeader>
                  <CardTitle>Game Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow label="Developer" value={game.developer} />
                  {game.steam_appid && (
                    <InfoRow label="Steam App ID" value={game.steam_appid} />
                  )}
                  <InfoRow label="Save Paths" value={game.save_paths.join(", ")} />
                  {game.exe_path && <InfoRow label="Executable" value={game.exe_path} />}
                  {game.notes && <InfoRow label="Notes" value={game.notes} />}
                  <InfoRow label="Added" value={formatDate(game.added_at)} />
                  <InfoRow label="Play Count" value={String(game.play_count)} />
                  <InfoRow label="Total Playtime" value={formatDuration(game.total_playtime_seconds || 0)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Playtime (Last 14 Days)</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoadingPlaytime ? (
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-32" />
                      <div className="flex items-end gap-1 h-16">
                        {Array.from({ length: 14 }).map((_, i) => (
                          <Skeleton key={i} className="w-3 rounded" style={{ height: `${20 + (i % 5) * 8}px` }} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[9px] text-muted-foreground">
                        Tracks playtime automatically when the game is detected running (even if launched outside GameVault).
                      </p>
                      <div className="flex items-end gap-1 h-16">
                        {playtimeSeries.map((d: { day: string; seconds: number }) => {
                          const h = Math.max(2, Math.round((d.seconds / maxDaySeconds) * 64));
                          return (
                            <div key={d.day} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                              <div
                                className={cn(
                                  "w-full rounded-md",
                                  d.seconds > 0 ? "bg-primary/40" : "bg-muted"
                                )}
                                style={{ height: `${h}px` }}
                                title={`${d.day}: ${formatDuration(d.seconds)}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[8px] text-muted-foreground">
                        <span>{playtimeSeries[0]?.day}</span>
                        <span>{playtimeSeries[playtimeSeries.length - 1]?.day}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Per-Game Auto-Backup Toggle */}
              <Card>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-medium">Auto-Backup</p>
                      <p className="text-[9px] text-muted-foreground">
                        {!settings.auto_backup_enabled
                          ? "Global auto-backup is OFF - enable it in Settings to use per-game backups"
                          : game.auto_backup_disabled
                            ? "Disabled - this game is excluded from automatic backups"
                            : "Enabled - saves are backed up automatically"}
                      </p>
                    </div>
                    <Switch
                      checked={!game.auto_backup_disabled}
                      disabled={!settings.auto_backup_enabled}
                      onCheckedChange={async (checked) => {
                        try {
                          const db = await import("@tauri-apps/plugin-sql");
                          const conn = await db.default.load("sqlite:gamevault.db");
                          await conn.execute(
                            "UPDATE games SET auto_backup_disabled = $1 WHERE id = $2",
                            [checked ? 0 : 1, game.id]
                          );
                          // Update local state
                          setGames((prev) =>
                            prev.map((g) =>
                              g.id === game.id
                                ? { ...g, auto_backup_disabled: !checked }
                                : g
                            )
                          );
                          toast.success(
                            checked
                              ? "Auto-backup enabled for this game"
                              : "Auto-backup disabled for this game"
                          );
                        } catch (err) {
                          toast.error(`${err}`);
                        }
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Launch and Save Paths</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">
                      Executable Path
                    </label>
                    <div className="flex gap-1.5">
                      <Input
                        value={editableExePath}
                        onChange={(e) => setEditableExePath(e.target.value)}
                        placeholder="Path to game executable"
                        className="flex-1 text-[10px]"
                      />
                      <Button variant="outline" size="icon-sm" onClick={handlePickConfigExePath}>
                        <Gamepad2 className="size-3" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">
                      Save Paths (one per line)
                    </label>
                    <div className="flex gap-1.5">
                      <Textarea
                        value={editableSavePaths}
                        onChange={(e) => setEditableSavePaths(e.target.value)}
                        placeholder="%APPDATA%\\Game\\Saved"
                        className="min-h-20 text-[10px]"
                      />
                      <Button variant="outline" size="icon-sm" onClick={handlePickConfigSavePath}>
                        <FolderOpen className="size-3" />
                      </Button>
                    </div>
                  </div>

                  <Button size="sm" onClick={handleSavePathConfig}>
                    <Save className="size-3" />
                    Save Path Configuration
                  </Button>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 min-h-0 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <div className="p-5 space-y-3 max-w-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-muted-foreground">
                  Game-specific notes, tips, and strategies
                </p>
                <Button
                  size="sm"
                  className="h-6 text-[9px] gap-1"
                  onClick={() => window.location.href = "/notes"}
                >
                  <Plus className="size-2.5" /> New Note
                </Button>
              </div>

              {gameNotes.length === 0 ? (
                <div className="text-center py-10 border border-dashed rounded-xl">
                  <StickyNote className="size-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-[10px] text-muted-foreground">No notes for this game yet</p>
                  <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                    Create notes from the Notes page to track tips, strategies, etc.
                  </p>
                </div>
              ) : (
                gameNotes.map((note) => (
                  <Card key={note.id} className="overflow-hidden hover:border-foreground/20 transition-all">
                    <div className="h-0.5" style={{ backgroundColor: note.color }} />
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {note.is_pinned && <Pin className="size-2.5 text-gaming shrink-0" />}
                            <h4 className="text-[11px] font-semibold truncate">{note.title}</h4>
                          </div>
                          {note.content && (
                            <p className="text-[9px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                              {note.content}
                            </p>
                          )}
                          <p className="text-[8px] text-muted-foreground/50 mt-1.5">
                            {formatRelativeTime(note.updated_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-5"
                            title={note.is_pinned ? "Unpin" : "Pin"}
                            onClick={async () => {
                              try {
                                const db = await import("@tauri-apps/plugin-sql");
                                const conn = await db.default.load("sqlite:gamevault.db");
                                await conn.execute(
                                  "UPDATE game_notes SET is_pinned = $1 WHERE id = $2",
                                  [note.is_pinned ? 0 : 1, note.id]
                                );
                                loadGameNotes();
                              } catch (err) {
                                toast.error(`${err}`);
                              }
                            }}
                          >
                            {note.is_pinned ? <PinOff className="size-2.5" /> : <Pin className="size-2.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-5"
                            title="Edit"
                            onClick={() => window.location.href = "/notes"}
                          >
                            <Pencil className="size-2.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-5 text-destructive"
                            title="Delete"
                            onClick={async () => {
                              try {
                                const db = await import("@tauri-apps/plugin-sql");
                                const conn = await db.default.load("sqlite:gamevault.db");
                                await conn.execute("DELETE FROM game_notes WHERE id = $1", [note.id]);
                                loadGameNotes();
                                toast.success("Note deleted");
                              } catch (err) {
                                toast.error(`${err}`);
                              }
                            }}
                          >
                            <Trash2 className="size-2.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Backup Dialog */}
      <Dialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>
              Back up your {game.name} saves to a compressed archive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                Backup Name (optional)
              </label>
              <Input
                value={backupName}
                onChange={(e) => setBackupName(e.target.value)}
                placeholder={`Backup ${new Date().toLocaleDateString()}`}
                className="h-8"
              />
            </div>
            {collections.length > 0 && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">
                  Collection
                </label>
                <select
                  value={backupCollectionId || ""}
                  onChange={(e) => setBackupCollectionId(e.target.value || null)}
                  className="w-full h-8 rounded-md border border-input bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Uncategorized</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBackupDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleBackup} disabled={isBackingUp}>
              {isBackingUp ? (
                <>
                  <div className="size-3 border-2 border-t-transparent border-current rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="size-3" /> Create Backup
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collection Creation Dialog */}
      <Dialog open={collectionDialogOpen} onOpenChange={setCollectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Backup Collection</DialogTitle>
            <DialogDescription>
              Organize your backups into collections (e.g., "Auto Backups", "Before Boss Fight", etc.)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                Collection Name
              </label>
              <Input
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="e.g. Auto Backups"
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newCollectionName.trim()) handleCreateCollection();
                }}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                Max Backups (oldest auto-removed)
              </label>
              <Input
                type="number"
                value={newCollectionMaxBackups}
                onChange={(e) => setNewCollectionMaxBackups(parseInt(e.target.value) || 10)}
                min={1}
                max={100}
                className="h-8 w-24"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                Color
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      "size-6 rounded-full border-2 transition-all",
                      newCollectionColor === c ? "border-foreground scale-110" : "border-transparent opacity-70 hover:opacity-100"
                    )}
                    style={{ background: c }}
                    onClick={() => setNewCollectionColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCollectionDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!newCollectionName.trim()} onClick={handleCreateCollection}>
              <FolderPlus className="size-3" /> Create Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Game Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Game</DialogTitle>
            <DialogDescription>
              Set a custom name for this game. This only changes how it appears in GameVault.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Game name"
            className="mt-1"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameName.trim()) {
                (async () => {
                  try {
                    const db = await import("@tauri-apps/plugin-sql");
                    const conn = await db.default.load("sqlite:gamevault.db");
                    await conn.execute(
                      "UPDATE games SET name = $1, updated_at = datetime('now') WHERE id = $2",
                      [renameName.trim(), game.id]
                    );
                    setGames((prev) =>
                      prev.map((g) => (g.id === game.id ? { ...g, name: renameName.trim() } : g))
                    );
                    toast.success("Game renamed");
                    setRenameDialogOpen(false);
                  } catch (err) {
                    toast.error(`${err}`);
                  }
                })();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!renameName.trim() || renameName.trim() === game.name}
              onClick={async () => {
                try {
                  const db = await import("@tauri-apps/plugin-sql");
                  const conn = await db.default.load("sqlite:gamevault.db");
                  await conn.execute(
                    "UPDATE games SET name = $1, updated_at = datetime('now') WHERE id = $2",
                    [renameName.trim(), game.id]
                  );
                  setGames((prev) =>
                    prev.map((g) => (g.id === game.id ? { ...g, name: renameName.trim() } : g))
                  );
                  toast.success("Game renamed");
                  setRenameDialogOpen(false);
                } catch (err) {
                  toast.error(`${err}`);
                }
              }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cover Change Dialog */}
      <Dialog open={coverChangeOpen} onOpenChange={setCoverChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Images</DialogTitle>
            <DialogDescription>
              Set custom cover art and header images for {game.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" size="sm" className="w-full" onClick={handleSetCover}>
              <Image className="size-3" /> Set Cover Image (Portrait)
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={handleSetHeader}>
              <Image className="size-3" /> Set Header Image (Landscape)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Collection Section ──────────────────────────────────────
function CollectionSection({
  collection,
  backups,
  allCollections,
  onRestore,
  onDelete,
  onExport,
  onDeleteCollection,
  onMoveBackup,
}: {
  collection: BackupCollection | null;
  backups: Backup[];
  allCollections: BackupCollection[];
  onRestore: (b: Backup) => void;
  onDelete: (b: Backup) => void;
  onExport: (b: Backup) => void;
  onDeleteCollection: () => void;
  onMoveBackup: (backupId: string, collId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const name = collection?.name || "Uncategorized";
  const color = collection?.color || "#64748b";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="size-3 rounded-full shrink-0" style={{ background: color }} />
        {expanded ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
        <span className="text-[11px] font-semibold flex-1">{name}</span>
        <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{backups.length}</Badge>
        {collection && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-sm" className="size-5">
                <MoreVertical className="size-2.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-[10px]">
                Max: {collection.max_backups} backups
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive text-[10px]" onClick={onDeleteCollection}>
                <Trash2 className="size-2.5" /> Delete Collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </button>

      {/* Backup list */}
      {expanded && (
        <div className="border-t border-border">
          {backups.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[10px] text-muted-foreground/50">No backups in this collection</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {backups.map((backup) => (
                <BackupRowInCollection
                  key={backup.id}
                  backup={backup}
                  allCollections={allCollections}
                  onRestore={() => onRestore(backup)}
                  onDelete={() => onDelete(backup)}
                  onExport={() => onExport(backup)}
                  onMoveBackup={onMoveBackup}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Backup Row (inside collection) ─────────────────────────
function BackupRowInCollection({
  backup,
  allCollections,
  onRestore,
  onDelete,
  onExport,
  onMoveBackup,
}: {
  backup: Backup;
  allCollections: BackupCollection[];
  onRestore: () => void;
  onDelete: () => void;
  onExport: () => void;
  onMoveBackup: (backupId: string, collId: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 transition-colors">
      <div className="size-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Archive className="size-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">
          {backup.display_name || "Unnamed Backup"}
        </div>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Clock className="size-2.5" />
            {formatRelativeTime(backup.created_at)}
          </span>
          <span className="flex items-center gap-0.5">
            <HardDrive className="size-2.5" />
            {formatBytes(backup.compressed_size || backup.file_size)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="outline" size="sm" className="h-6 text-[9px]" onClick={onRestore}>
          <RotateCcw className="size-2.5" /> Restore
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-6">
              <MoreVertical className="size-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-[10px]" onClick={onExport}>
              <Share2 className="size-2.5" /> Export / Share
            </DropdownMenuItem>
            {allCollections.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[9px]">Move to...</DropdownMenuLabel>
                {backup.collection_id && (
                  <DropdownMenuItem className="text-[10px]" onClick={() => onMoveBackup(backup.id, null)}>
                    Uncategorized
                  </DropdownMenuItem>
                )}
                {allCollections
                  .filter((c) => c.id !== backup.collection_id)
                  .map((c) => (
                    <DropdownMenuItem key={c.id} className="text-[10px]" onClick={() => onMoveBackup(backup.id, c.id)}>
                      <div className="size-2 rounded-full shrink-0" style={{ background: c.color }} />
                      {c.name}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive text-[10px]" onClick={onDelete}>
              <Trash2 className="size-2.5" /> Delete Backup
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Screenshot Card ─────────────────────────────────────────
function ScreenshotCard({ screenshot }: { screenshot: Screenshot }) {
  const [imgError, setImgError] = useState(false);

  const handleOpen = async () => {
    try {
      await invoke("open_screenshot", { path: screenshot.file_path });
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  return (
    <button
      onClick={handleOpen}
      className="group rounded-xl overflow-hidden border border-border bg-card hover:border-primary/20 transition-all cursor-pointer text-left"
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        {imgError ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-muted">
            <Image className="size-5 text-muted-foreground/30" />
            <span className="text-[8px] text-muted-foreground/40">Unable to load</span>
          </div>
        ) : (
          <img
            src={convertFileSrc(screenshot.thumbnail_path || screenshot.file_path)}
            alt={screenshot.title || "Screenshot"}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}
      </div>
      <div className="p-2">
        <p className="text-[10px] font-medium truncate">
          {screenshot.title || formatDate(screenshot.captured_at)}
        </p>
        <p className="text-[8px] text-muted-foreground">
          {screenshot.width}x{screenshot.height} · {formatBytes(screenshot.file_size)}
        </p>
        {screenshot.tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {screenshot.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[7px] px-1 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Info Row ────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-muted-foreground shrink-0 w-24">{label}</span>
      <span className="text-[11px] break-all">{value}</span>
    </div>
  );
}
