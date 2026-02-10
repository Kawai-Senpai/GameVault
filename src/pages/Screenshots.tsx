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
import { invoke } from "@tauri-apps/api/core";
import {
  Camera,
  Search,
  Trash2,
  ExternalLink,
  ImageIcon,
  Filter,
  Grid3X3,
  List,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import type { Screenshot } from "@/types";

type ViewMode = "grid" | "list";

export default function Screenshots() {
  const { games, settings } = useApp();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterGameId, setFilterGameId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    loadScreenshots();
  }, []);

  const loadScreenshots = useCallback(async () => {
    setIsLoading(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM screenshots ORDER BY captured_at DESC"
      )) as Record<string, unknown>[];
      setScreenshots(
        rows.map((r) => ({
          ...r,
          tags: JSON.parse((r.tags as string) || "[]"),
        })) as Screenshot[]
      );
    } catch (err) {
      console.error("Failed to load screenshots:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCapture = async () => {
    if (!settings.screenshots_directory) {
      toast.error("Set a screenshots directory in Settings first");
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
        gameId: "_general",
        base64Data: base64,
      });

      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at)
         VALUES ($1, '_general', $2, $3, $4, $5, $6, datetime('now'))`,
        [result.id, result.file_path, result.thumbnail_path, result.width, result.height, result.file_size]
      );

      toast.success("Screenshot captured!");
      loadScreenshots();
    } catch (err) {
      toast.error(`Screenshot failed: ${err}`);
    }
  };

  const handleDelete = async (ss: Screenshot) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM screenshots WHERE id = $1", [ss.id]);
      setScreenshots((prev) => prev.filter((s) => s.id !== ss.id));
      toast.success("Screenshot deleted");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const filtered = screenshots.filter((ss) => {
    if (filterGameId !== "all" && ss.game_id !== filterGameId) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        ss.title.toLowerCase().includes(q) ||
        ss.description.toLowerCase().includes(q) ||
        ss.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const gamesWithScreenshots = [
    ...new Set(screenshots.map((s) => s.game_id)),
  ];

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Screenshots"
        description={`${screenshots.length} screenshots captured`}
        rightContent={
          <Button size="sm" onClick={handleCapture}>
            <Camera className="size-3" />
            Capture Now
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
            placeholder="Search screenshots..."
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
            {gamesWithScreenshots.map((gid) => {
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
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-2.5 w-3/4 rounded" />
                <Skeleton className="h-2 w-1/2 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <ImageIcon className="size-10 text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground">No screenshots found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1 mb-3">
              Press {settings.screenshot_shortcut} to capture while playing
            </p>
            <Button size="sm" onClick={handleCapture}>
              <Camera className="size-3" /> Capture Screen
            </Button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-5">
            {filtered.map((ss) => (
              <ScreenshotCard
                key={ss.id}
                screenshot={ss}
                gameName={games.find((g) => g.id === ss.game_id)?.name}
                onDelete={() => handleDelete(ss)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1 p-5">
            {filtered.map((ss) => (
              <ScreenshotListItem
                key={ss.id}
                screenshot={ss}
                gameName={games.find((g) => g.id === ss.game_id)?.name}
                onDelete={() => handleDelete(ss)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ScreenshotCard({
  screenshot,
  gameName,
  onDelete,
}: {
  screenshot: Screenshot;
  gameName?: string;
  onDelete: () => void;
}) {
  const handleOpen = async () => {
    try {
      await invoke("open_screenshot", { path: screenshot.file_path });
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  return (
    <div className="group rounded-xl overflow-hidden border border-border bg-card hover:border-primary/20 transition-all animate-fade-in">
      <button
        onClick={handleOpen}
        className="relative w-full aspect-video bg-muted overflow-hidden cursor-pointer"
      >
        <img
          src={`https://asset.localhost/${screenshot.thumbnail_path || screenshot.file_path}`}
          alt={screenshot.title || "Screenshot"}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <ExternalLink className="size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </button>
      <div className="p-2.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium truncate">
            {screenshot.title || formatDate(screenshot.captured_at)}
          </p>
          <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
            {gameName && <span>{gameName}</span>}
            <span>
              {screenshot.width}×{screenshot.height}
            </span>
            <span>{formatBytes(screenshot.file_size)}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function ScreenshotListItem({
  screenshot,
  gameName,
  onDelete,
}: {
  screenshot: Screenshot;
  gameName?: string;
  onDelete: () => void;
}) {
  const handleOpen = async () => {
    try {
      await invoke("open_screenshot", { path: screenshot.file_path });
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent transition-colors group">
      <button
        onClick={handleOpen}
        className="size-12 rounded-lg overflow-hidden bg-muted shrink-0 cursor-pointer"
      >
        <img
          src={`https://asset.localhost/${screenshot.thumbnail_path || screenshot.file_path}`}
          alt={screenshot.title || "Screenshot"}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">
          {screenshot.title || formatDate(screenshot.captured_at)}
        </div>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          {gameName && <span>{gameName}</span>}
          <span>{screenshot.width}×{screenshot.height}</span>
          <span>{formatBytes(screenshot.file_size)}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onDelete}
      >
        <Trash2 className="size-3 text-destructive" />
      </Button>
    </div>
  );
}
