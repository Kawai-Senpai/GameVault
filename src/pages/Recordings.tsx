import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  Video,
  Search,
  Trash2,
  ExternalLink,
  Filter,
  Grid3X3,
  List,
  Play,
  Clock,
  Film,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import type { Recording, RecordingStatus } from "@/types";

type ViewMode = "grid" | "list";

export default function Recordings() {
  const { games, settings } = useApp();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterGameId, setFilterGameId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    loadRecordings();
    // Check if currently recording
    invoke<RecordingStatus>("get_recording_status").then((status) => {
      setIsRecording(status.is_recording);
    }).catch(() => {});

    // Listen for recording state changes from global shortcuts / overlay / tray
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ is_recording: boolean }>("recording-state-changed", (event) => {
          setIsRecording(event.payload.is_recording);
          if (!event.payload.is_recording) {
            // Recording just stopped - reload list after a short delay for file to be ready
            setTimeout(() => loadRecordings(), 500);
          }
        });
      } catch { /* ignore */ }
    })();

    return () => { unlisten?.(); };
  }, []);

  const loadRecordings = useCallback(async () => {
    setIsLoading(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM recordings ORDER BY recorded_at DESC"
      )) as Record<string, unknown>[];
      setRecordings(
        rows.map((r) => ({
          ...r,
          tags: JSON.parse((r.tags as string) || "[]"),
        })) as Recording[]
      );
    } catch (err) {
      console.error("Failed to load recordings:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleStartRecording = async () => {
    const recDir = settings.recordings_directory || settings.screenshots_directory;
    if (!recDir) {
      toast.error("Set a recordings or screenshots directory in Settings first");
      return;
    }

    try {
      // Resolve best ffmpeg path (user → bundled → system)
      const ffmpegPath = await invoke<string>("resolve_ffmpeg", { userPath: settings.ffmpeg_path || null });
      await invoke<string>("start_recording", {
        recordingsDir: recDir,
        gameId: "_general",
        ffmpegPath,
        fps: settings.recording_fps || 30,
        resolution: settings.recording_resolution === "native" ? null : settings.recording_resolution,
        quality: settings.recording_quality || "medium",
      });
      setIsRecording(true);
      toast.success("Recording started");
    } catch (err) {
      toast.error(`Start failed: ${err}`);
    }
  };

  const handleStopRecording = async () => {
    try {
      const result = await invoke<{
        id: string;
        file_path: string;
        thumbnail_path: string;
        width: number;
        height: number;
        file_size: number;
        duration_seconds: number;
      }>("stop_recording");

      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT INTO recordings (id, game_id, file_path, thumbnail_path, width, height, file_size, duration_seconds, fps, recorded_at)
         VALUES ($1, '_general', $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
        [
          result.id, result.file_path, result.thumbnail_path,
          result.width, result.height, result.file_size,
          result.duration_seconds, settings.recording_fps || 30,
        ]
      );

      setIsRecording(false);
      toast.success("Recording saved!");
      loadRecordings();
    } catch (err) {
      toast.error(`Stop failed: ${err}`);
      setIsRecording(false);
    }
  };

  const handleDelete = async (rec: Recording) => {
    try {
      await invoke("delete_recording_file", { path: rec.file_path });
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM recordings WHERE id = $1", [rec.id]);
      setRecordings((prev) => prev.filter((r) => r.id !== rec.id));
      toast.success("Recording deleted");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleOpen = async (path: string) => {
    try {
      await invoke("open_recording", { path });
    } catch (err) {
      toast.error(`Failed to open: ${err}`);
    }
  };

  const handleRename = async (id: string, title: string) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("UPDATE recordings SET title = $1 WHERE id = $2", [title, id]);
      setRecordings((prev) =>
        prev.map((r) => (r.id === id ? { ...r, title } : r))
      );
      toast.success("Recording renamed");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const filtered = recordings.filter((rec) => {
    if (filterGameId !== "all" && rec.game_id !== filterGameId) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        rec.title.toLowerCase().includes(q) ||
        rec.description.toLowerCase().includes(q) ||
        rec.tags.some((t: string) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const gamesWithRecordings = [...new Set(recordings.map((r) => r.game_id))];

  return (
    <div className="flex flex-col h-full min-h-0">
      <Header
        title="Recordings"
        description={`${recordings.length} recordings captured`}
        rightContent={
          <Button
            size="sm"
            variant={isRecording ? "destructive" : "default"}
            onClick={isRecording ? handleStopRecording : handleStartRecording}
          >
            {isRecording ? (
              <>
                <div className="size-2 rounded-full bg-white animate-pulse mr-1.5" />
                Stop Recording
              </>
            ) : (
              <>
                <Video className="size-3" />
                Record Screen
              </>
            )}
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search recordings..."
            className="h-7 pl-8 text-[11px]"
          />
        </div>

        <Select value={filterGameId} onValueChange={setFilterGameId}>
          <SelectTrigger className="h-7 w-40 text-[11px]">
            <Filter className="size-3 mr-1" />
            <SelectValue placeholder="All Games" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Games</SelectItem>
            {gamesWithRecordings.map((gid) => {
              const game = games.find((g) => g.id === gid);
              return (
                <SelectItem key={gid} value={gid}>
                  {game?.name || gid}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <div className="flex items-center border rounded-lg overflow-hidden">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon-sm"
            className="rounded-none size-7"
            onClick={() => setViewMode("grid")}
          >
            <Grid3X3 className="size-3" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon-sm"
            className="rounded-none size-7"
            onClick={() => setViewMode("list")}
          >
            <List className="size-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-video rounded-lg" />
                  <Skeleton className="h-3 w-3/4 rounded" />
                  <Skeleton className="h-2 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Film className="size-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground mb-1">No recordings yet</p>
              <p className="text-[10px] text-muted-foreground/60 max-w-xs mb-4">
                {recordings.length === 0
                  ? `Press ${settings.recording_shortcut || "F9"} or click "Record Screen" to start recording. Requires FFmpeg.`
                  : "No recordings match your search."}
              </p>
              {recordings.length === 0 && (
                <Button
                  size="sm"
                  variant={isRecording ? "destructive" : "default"}
                  onClick={isRecording ? handleStopRecording : handleStartRecording}
                >
                  <Video className="size-3" />
                  {isRecording ? "Stop Recording" : "Record Screen"}
                </Button>
              )}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map((rec) => {
                const game = games.find((g) => g.id === rec.game_id);
                return (
                  <div key={rec.id} className="group relative">
                    {/* Thumbnail */}
                    <div
                      className="relative aspect-video rounded-lg overflow-hidden bg-muted cursor-pointer border border-border hover:border-primary/50 transition-all"
                      onClick={() => handleOpen(rec.file_path)}
                    >
                      {rec.thumbnail_path ? (
                        <img
                          src={convertFileSrc(rec.thumbnail_path)}
                          alt={rec.title || "Recording"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video className="size-8 text-muted-foreground/30" />
                        </div>
                      )}
                      {/* Overlay play icon */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <Play className="size-8 text-white drop-shadow-lg" />
                      </div>
                      {/* Duration badge */}
                      <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[8px] px-1.5 py-0.5 rounded-sm font-mono">
                        {formatDuration(rec.duration_seconds)}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="mt-1.5 px-0.5">
                      <input
                        className="text-[10px] font-medium w-full bg-transparent border-none outline-none hover:text-primary truncate"
                        value={rec.title || ""}
                        placeholder="Untitled recording"
                        onBlur={(e) => {
                          if (e.target.value !== rec.title) handleRename(rec.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                        <span>{game?.name || rec.game_id}</span>
                        <span>·</span>
                        <span>{rec.width}×{rec.height}</span>
                        <span>·</span>
                        <span>{formatBytes(rec.file_size)}</span>
                      </div>
                      <div className="text-[8px] text-muted-foreground/60">
                        {formatDate(rec.recorded_at)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpen(rec.file_path)}
                        className="size-5 flex items-center justify-center rounded bg-black/60 text-white hover:bg-black/80 transition-colors"
                        title="Open"
                      >
                        <ExternalLink className="size-2.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(rec)}
                        className="size-5 flex items-center justify-center rounded bg-red-500/60 text-white hover:bg-red-500/80 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="size-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* List view */
            <div className="space-y-1">
              {filtered.map((rec) => {
                const game = games.find((g) => g.id === rec.game_id);
                return (
                  <div
                    key={rec.id}
                    className="group flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    {/* Mini thumbnail */}
                    <div
                      className="relative size-16 shrink-0 rounded-md overflow-hidden bg-muted cursor-pointer border border-border"
                      onClick={() => handleOpen(rec.file_path)}
                    >
                      {rec.thumbnail_path ? (
                        <img
                          src={convertFileSrc(rec.thumbnail_path)}
                          alt={rec.title || "Recording"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video className="size-5 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[7px] px-1 py-px rounded-sm font-mono">
                        {formatDuration(rec.duration_seconds)}
                      </div>
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <input
                        className="text-[11px] font-medium w-full bg-transparent border-none outline-none hover:text-primary truncate"
                        value={rec.title || ""}
                        placeholder="Untitled recording"
                        onBlur={(e) => {
                          if (e.target.value !== rec.title) handleRename(rec.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Clock className="size-2.5" /> {formatDuration(rec.duration_seconds)}
                        </span>
                        <span>{rec.width}×{rec.height}</span>
                        <span>{formatBytes(rec.file_size)}</span>
                        <span>{rec.fps}fps</span>
                        {game && <span>· {game.name}</span>}
                      </div>
                      <div className="text-[8px] text-muted-foreground/60 mt-0.5">
                        {formatDate(rec.recorded_at)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        onClick={() => handleOpen(rec.file_path)}
                      >
                        <ExternalLink className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(rec)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
