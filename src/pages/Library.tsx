import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  Grid3X3,
  List,
  SortAsc,
  Star,
  Gamepad2,
  Clock,
  HardDrive,
  RefreshCw,
  Filter,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import GameCover from "@/components/GameCover";
import type { Game, DetectedGame } from "@/types";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import gamesDatabase from "@/data/games.json";

type ViewMode = "grid" | "list";
type SortMode = "name" | "recent" | "developer" | "favorite";

export default function Library() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, isLoading, refreshGames } = useApp();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [isDetecting, setIsDetecting] = useState(false);

  const sortedGames = useMemo(() => {
    let filtered = games;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = games.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.developer.toLowerCase().includes(q)
      );
    }

    return [...filtered].sort((a, b) => {
      // Favorites always first
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;

      switch (sortMode) {
        case "recent":
          return (
            new Date(b.last_played_at || b.added_at).getTime() -
            new Date(a.last_played_at || a.added_at).getTime()
          );
        case "developer":
          return a.developer.localeCompare(b.developer);
        case "favorite":
          return a.is_favorite === b.is_favorite
            ? a.name.localeCompare(b.name)
            : a.is_favorite
            ? -1
            : 1;
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [games, searchQuery, sortMode]);

  const handleGameClick = (game: Game) => {
    setSelectedGameId(game.id);
    navigate(`/game/${game.id}`);
  };

  const handleDetectGames = async () => {
    setIsDetecting(true);
    try {
      const detected = await invoke<DetectedGame[]>("detect_installed_games", {
        gamesJson: JSON.stringify(gamesDatabase),
      });
      if (!detected || detected.length === 0) {
        toast.info("No games found on your system");
        setIsDetecting(false);
        return;
      }
      // Filter out already-added games
      const existingIds = new Set(games.map((g) => g.id));
      const newGames = detected.filter((g) => !existingIds.has(g.id));
      if (newGames.length === 0) {
        toast.info("All detected games are already in your library");
        setIsDetecting(false);
        return;
      }
      // Import all detected games into DB
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      let added = 0;
      for (const g of newGames) {
        try {
          await conn.execute(
            `INSERT OR IGNORE INTO games (id, name, developer, steam_appid, cover_url, header_url, save_paths, extensions, notes, is_custom, is_detected, added_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 1, datetime('now'), datetime('now'))`,
            [
              g.id, g.name, g.developer || "", g.steam_appid || null,
              g.cover_url || null, g.header_url || null,
              JSON.stringify(g.save_paths || []),
              JSON.stringify(g.extensions || []),
              g.notes || "",
            ]
          );
          added++;
        } catch { /* skip duplicates */ }
      }
      await refreshGames();
      toast.success(`Detected ${added} new game${added !== 1 ? "s" : ""}!`);
    } catch (err) {
      toast.error(`Detection failed: ${err}`);
    } finally {
      setIsDetecting(false);
    }
  };

  if (isLoading) {
    return <LibrarySkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        title="Game Library"
        description={`${games.length} games in your vault`}
        rightContent={
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDetectGames}
              disabled={isDetecting}
            >
              <RefreshCw
                className={cn("size-3", isDetecting && "animate-spin")}
              />
              Detect
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => navigate("/add-game")}
            >
              <Plus className="size-3" />
              Add Game
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="relative min-w-44 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your library..."
            className="h-7 pl-8 text-[11px]"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 max-sm:flex-1 max-sm:justify-between">
              <SortAsc className="size-3" />
              {sortMode === "name" && "Name"}
              {sortMode === "recent" && "Recent"}
              {sortMode === "developer" && "Developer"}
              {sortMode === "favorite" && "Favorites"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSortMode("name")}>
              <SortAsc className="size-3" /> Name
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode("recent")}>
              <Clock className="size-3" /> Recently Played
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode("developer")}>
              <Filter className="size-3" /> Developer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode("favorite")}>
              <Star className="size-3" /> Favorites First
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center overflow-hidden rounded-lg border">
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

      {/* Game Grid/List */}
      <ScrollArea className="flex-1">
        {sortedGames.length === 0 ? (
          <EmptyLibrary
            hasSearch={!!searchQuery.trim()}
            onAddGame={() => navigate("/add-game")}
          />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-3 p-4 sm:p-5">
            {sortedGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onClick={() => handleGameClick(game)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1 p-4 sm:p-5">
            {sortedGames.map((game) => (
              <GameListItem
                key={game.id}
                game={game}
                onClick={() => handleGameClick(game)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Game Card (Grid View) ───────────────────────────────────
function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group game-card flex flex-col rounded-xl overflow-hidden border border-border bg-card transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 cursor-pointer text-left animate-fade-in relative"
    >
      {/* Cover */}
      <div className="relative aspect-3/4 w-full overflow-hidden">
        <GameCover
          gameId={game.id}
          gameName={game.name}
          coverUrl={game.cover_url}
          customCoverPath={game.custom_cover_path}
          className="w-full h-full game-card-cover"
          initialsClassName="text-2xl"
        />

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Favorite star */}
        {game.is_favorite && (
          <div className="absolute top-1.5 right-1.5">
            <Star className="size-3.5 fill-warning text-warning drop-shadow-md" />
          </div>
        )}

        {/* Detected indicator */}
        {game.is_detected && (
          <div className="absolute top-1.5 left-1.5">
            <div className="size-2 rounded-full bg-success shadow-sm" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-0.5">
        <h3 className="text-[11px] font-semibold leading-tight truncate">
          {game.name}
        </h3>
        <p className="text-[9px] text-muted-foreground truncate">
          {game.developer}
        </p>
        <div className="flex items-center gap-1.5">
          {game.total_playtime_seconds > 0 && (
            <span className="text-[8px] text-muted-foreground/70 tabular-nums">
              {game.total_playtime_seconds >= 3600
                ? `${Math.floor(game.total_playtime_seconds / 3600)}h ${Math.floor((game.total_playtime_seconds % 3600) / 60)}m`
                : `${Math.floor(game.total_playtime_seconds / 60)}m`}
            </span>
          )}
          {game.last_played_at && (
            <span className="text-[8px] text-muted-foreground/50">
              {formatRelativeTime(game.last_played_at)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Game List Item ──────────────────────────────────────────
function GameListItem({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-left transition-all hover:bg-accent"
    >
      {/* Thumbnail */}
      <GameCover
        gameId={game.id}
        gameName={game.name}
        coverUrl={game.cover_url}
        customCoverPath={game.custom_cover_path}
        className="size-10 rounded-lg shrink-0"
        singleChar
        initialsClassName="text-xs"
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-medium truncate">{game.name}</h3>
          {game.is_favorite && (
            <Star className="size-2.5 fill-warning text-warning shrink-0" />
          )}
          {game.is_detected && (
            <div className="size-1.5 rounded-full bg-success shrink-0" />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">
          {game.developer}
        </p>
      </div>

      {/* Meta */}
      <div className="ml-auto flex items-center gap-2 max-sm:w-full max-sm:justify-between">
        {game.total_playtime_seconds > 0 && (
          <span className="text-[9px] text-muted-foreground tabular-nums">
            {game.total_playtime_seconds >= 3600
              ? `${Math.floor(game.total_playtime_seconds / 3600)}h ${Math.floor((game.total_playtime_seconds % 3600) / 60)}m`
              : `${Math.floor(game.total_playtime_seconds / 60)}m`}
          </span>
        )}
        {game.last_played_at && (
          <span className="text-[9px] text-muted-foreground">
            {formatRelativeTime(game.last_played_at)}
          </span>
        )}
        <Badge variant="secondary" className="text-[8px]">
          <HardDrive className="size-2 mr-0.5" />
          {game.save_paths.length} path{game.save_paths.length !== 1 ? "s" : ""}
        </Badge>
      </div>
    </button>
  );
}

// ─── Empty State ─────────────────────────────────────────────
function EmptyLibrary({
  hasSearch,
  onAddGame,
}: {
  hasSearch: boolean;
  onAddGame: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 px-4">
      <div className="size-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Gamepad2 className="size-7 text-muted-foreground/40" />
      </div>
      {hasSearch ? (
        <>
          <h3 className="text-sm font-medium mb-1">No games found</h3>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            Try a different search term or add a new game to your vault.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-sm font-medium mb-1">Your vault is empty</h3>
          <p className="text-xs text-muted-foreground text-center max-w-xs mb-4">
            Add games to start backing up your saves, taking screenshots, and
            more.
          </p>
          <Button size="sm" onClick={onAddGame}>
            <Plus className="size-3" />
            Add Your First Game
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────
function LibrarySkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 h-12 border-b border-border">
        <div className="skeleton h-3.5 w-24 rounded" />
      </div>
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border">
        <div className="skeleton h-7 w-48 rounded-lg" />
        <div className="skeleton h-7 w-20 rounded-lg ml-auto" />
        <div className="skeleton h-7 w-14 rounded-lg" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2 animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
            <Skeleton className="aspect-3/4 w-full rounded-xl" />
            <Skeleton className="h-3 w-3/4 rounded" />
            <Skeleton className="h-2 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
