import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApp } from "@/contexts/app.context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
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
} from "lucide-react";
import { cn, formatBytes, formatDate, formatRelativeTime, getGameInitials, getCardColor } from "@/lib/utils";
import type { Backup, BackupCollection, Screenshot, GameNote } from "@/types";

export default function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { games, settings, setGames } = useApp();
  const [activeTab, setActiveTab] = useState("backups");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [_collections, setCollections] = useState<BackupCollection[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [backupName, setBackupName] = useState("");
  const [coverChangeOpen, setCoverChangeOpen] = useState(false);
  const [gameNotes, setGameNotes] = useState<GameNote[]>([]);

  const game = games.find((g) => g.id === gameId);

  // Load backups, screenshots, and notes
  useEffect(() => {
    if (!gameId) return;
    loadBackups();
    loadScreenshots();
    loadGameNotes();
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
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        }))
      );
    } catch (err) {
      console.error("Failed to load game notes:", err);
    }
  }, [gameId]);

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
        collectionId: null,
        checkDuplicates: true,
      });

      if (result.skipped_duplicate) {
        toast.info(result.message, { id: toastId });
      } else {
        // Save to database
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          `INSERT INTO backups (id, game_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
          [
            result.backup_id,
            game.id,
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

  const coverSrc = game.custom_cover_path || game.cover_url;
  const headerSrc = game.custom_header_path || game.header_url;

  return (
    <div className="flex flex-col h-full">
      {/* Hero Header */}
      <div className="relative h-36 shrink-0 overflow-hidden">
        {headerSrc ? (
          <img
            src={headerSrc}
            alt={game.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className={cn(
              "w-full h-full bg-linear-to-br",
              getCardColor(game.id)
            )}
          />
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-linear-to-t from-background via-background/60 to-transparent" />

        {/* Game info overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-3 flex items-end gap-3">
          {/* Cover thumbnail */}
          <div className="size-16 rounded-xl overflow-hidden border-2 border-background shadow-lg shrink-0 -mb-1">
            {coverSrc ? (
              <img src={coverSrc} alt={game.name} className="w-full h-full object-cover" />
            ) : (
              <div className={cn("w-full h-full flex items-center justify-center bg-linear-to-br text-lg font-bold", getCardColor(game.id))}>
                {getGameInitials(game.name)}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 pb-0.5">
            <h1 className="text-base font-bold truncate drop-shadow-md">
              {game.name}
            </h1>
            <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
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
          <TabsList className="bg-transparent h-9 p-0 gap-4">
            <TabsTrigger value="backups" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <Archive className="size-3 mr-1" /> Backups
              <Badge variant="secondary" className="ml-1.5 text-[8px] px-1 py-0">{backups.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="screenshots" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2">
              <Image className="size-3 mr-1" /> Screenshots
              <Badge variant="secondary" className="ml-1.5 text-[8px] px-1 py-0">{screenshots.length}</Badge>
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
        <TabsContent value="backups" className="flex-1 m-0">
          <ScrollArea className="h-full">
            <div className="p-5 space-y-2">
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
              ) : backups.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <Archive className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No backups yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mb-3">
                    Create your first backup to protect your saves
                  </p>
                  <Button size="sm" onClick={() => setBackupDialogOpen(true)}>
                    <Save className="size-3" /> Create Backup
                  </Button>
                </div>
              ) : (
                backups.map((backup) => (
                  <BackupRow
                    key={backup.id}
                    backup={backup}
                    onRestore={() => handleRestore(backup)}
                    onDelete={() => handleDeleteBackup(backup)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Screenshots Tab */}
        <TabsContent value="screenshots" className="flex-1 m-0">
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

        {/* Info Tab */}
        <TabsContent value="info" className="flex-1 m-0">
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
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 m-0">
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

// ─── Backup Row ──────────────────────────────────────────────
function BackupRow({
  backup,
  onRestore,
  onDelete,
}: {
  backup: Backup;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/20 transition-colors animate-slide-up">
      <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Archive className="size-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">
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
        <Button variant="outline" size="sm" onClick={onRestore}>
          <RotateCcw className="size-3" /> Restore
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete}>
          <Trash2 className="size-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

// ─── Screenshot Card ─────────────────────────────────────────
function ScreenshotCard({ screenshot }: { screenshot: Screenshot }) {
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
        <img
          src={`https://asset.localhost/${screenshot.thumbnail_path || screenshot.file_path}`}
          alt={screenshot.title || "Screenshot"}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
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
