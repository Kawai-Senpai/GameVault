import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  Plus,
  Check,
  HardDrive,
  FolderSearch,
  RefreshCw,
  X,
} from "lucide-react";
import { cn, formatBytes, getGameInitials, getCardColor } from "@/lib/utils";
import type { DetectedGame } from "@/types";
import gamesDatabase from "@/data/games.json";

export default function AddGame() {
  const navigate = useNavigate();
  const { games, setGames } = useApp();
  const [activeTab, setActiveTab] = useState("detect");
  const [detectedGames, setDetectedGames] = useState<DetectedGame[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [selectedDetected, setSelectedDetected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Custom game form
  const [customName, setCustomName] = useState("");
  const [customDeveloper, setCustomDeveloper] = useState("");
  const [customSavePath, setCustomSavePath] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [customExePath, setCustomExePath] = useState("");

  const existingGameIds = new Set(games.map((g) => g.id));

  // Auto-detect on mount
  useEffect(() => {
    handleDetect();
  }, []);

  const handleDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const result = await invoke<DetectedGame[]>("detect_installed_games", {
        gamesJson: JSON.stringify(gamesDatabase),
      });
      // Filter out already-added games
      const newGames = result.filter((g) => !existingGameIds.has(g.id));
      setDetectedGames(newGames);
    } catch (err) {
      console.error("Detection failed:", err);
      toast.error(`Detection failed: ${err}`);
    } finally {
      setIsDetecting(false);
    }
  }, [existingGameIds]);

  const toggleDetected = (id: string) => {
    setSelectedDetected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedDetected.size === filteredDetected.length) {
      setSelectedDetected(new Set());
    } else {
      setSelectedDetected(new Set(filteredDetected.map((g) => g.id)));
    }
  };

  const handleAddDetected = async () => {
    if (selectedDetected.size === 0) return;
    setIsAdding(true);

    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      const toAdd = detectedGames.filter((g) => selectedDetected.has(g.id));
      const newGames: import("@/types").Game[] = [];

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
          play_count: 0,
          total_playtime_seconds: 0,
          last_played_at: null,
          added_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      setGames((prev) => [...prev, ...newGames]);
      toast.success(`Added ${newGames.length} game${newGames.length > 1 ? "s" : ""} to your library`);
      navigate("/");
    } catch (err) {
      toast.error(`Failed to add games: ${err}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddCustom = async () => {
    if (!customName.trim()) {
      toast.error("Game name is required");
      return;
    }

    setIsAdding(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      const id = customName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      if (existingGameIds.has(id)) {
        toast.error("A game with this name already exists");
        setIsAdding(false);
        return;
      }

      const savePaths = customSavePath.trim()
        ? customSavePath.split("\n").map((p) => p.trim()).filter(Boolean)
        : [];

      await conn.execute(
        `INSERT INTO games (id, name, developer, save_paths, extensions, notes, exe_path, is_custom, added_at, updated_at)
         VALUES ($1, $2, $3, $4, '[]', $5, $6, 1, datetime('now'), datetime('now'))`,
        [id, customName.trim(), customDeveloper.trim(), JSON.stringify(savePaths), customNotes.trim(), customExePath || null]
      );

      const newGame = {
        id,
        name: customName.trim(),
        developer: customDeveloper.trim(),
        steam_appid: null,
        cover_url: null,
        header_url: null,
        custom_cover_path: null,
        custom_header_path: null,
        save_paths: savePaths,
        extensions: [],
        notes: customNotes.trim(),
        exe_path: customExePath || null,
        is_custom: true,
        is_detected: false,
        is_favorite: false,
        play_count: 0,
        total_playtime_seconds: 0,
        last_played_at: null,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setGames((prev) => [...prev, newGame]);
      toast.success(`${customName.trim()} added to your library`);
      navigate(`/game/${id}`);
    } catch (err) {
      toast.error(`Failed to add game: ${err}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handlePickSavePath = async () => {
    try {
      const folder = await invoke<string | null>("pick_folder_path", {
        title: "Select Save Directory",
      });
      if (folder) {
        setCustomSavePath((prev) => (prev ? `${prev}\n${folder}` : folder));
      }
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handlePickExePath = async () => {
    try {
      const path = await invoke<string | null>("pick_exe_path");
      if (path) setCustomExePath(path);
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const filteredDetected = searchQuery.trim()
    ? detectedGames.filter(
        (g) =>
          g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          g.developer.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : detectedGames;

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Add Games"
        description="Detect installed games or add custom entries"
        showBack
        backPath="/"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-5 border-b border-border">
          <TabsList className="bg-transparent h-9 p-0 gap-4">
            <TabsTrigger
              value="detect"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2"
            >
              <FolderSearch className="size-3 mr-1" /> Auto-Detect
              {detectedGames.length > 0 && (
                <Badge variant="gaming" className="ml-1.5 text-[8px] px-1 py-0">
                  {detectedGames.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="custom"
              className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2"
            >
              <Plus className="size-3 mr-1" /> Custom Game
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Auto-Detect Tab */}
        <TabsContent value="detect" className="flex-1 m-0 flex flex-col min-h-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border shrink-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter detected games..."
                className="h-7 pl-8 text-[11px]"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleDetect} disabled={isDetecting}>
              <RefreshCw className={cn("size-3", isDetecting && "animate-spin")} />
              Re-scan
            </Button>
            {filteredDetected.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {selectedDetected.size === filteredDetected.length ? (
                    <>
                      <X className="size-3" /> Deselect All
                    </>
                  ) : (
                    <>
                      <Check className="size-3" /> Select All
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddDetected}
                  disabled={selectedDetected.size === 0 || isAdding}
                >
                  {isAdding ? (
                    <div className="size-3 border-2 border-t-transparent border-current rounded-full animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  Add {selectedDetected.size > 0 ? selectedDetected.size : ""} Game
                  {selectedDetected.size !== 1 ? "s" : ""}
                </Button>
              </>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-5 space-y-2">
              {isDetecting ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border" style={{ animationDelay: `${i * 80}ms` }}>
                    <Skeleton className="size-10 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-40 rounded" />
                      <Skeleton className="h-2 w-24 rounded" />
                    </div>
                    <Skeleton className="size-5 rounded" />
                  </div>
                ))
              ) : filteredDetected.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <FolderSearch className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {detectedGames.length === 0
                      ? "No new games detected on this system"
                      : "No games match your search"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Try adding a custom game instead
                  </p>
                </div>
              ) : (
                filteredDetected.map((game) => (
                  <DetectedGameRow
                    key={game.id}
                    game={game}
                    isSelected={selectedDetected.has(game.id)}
                    onToggle={() => toggleDetected(game.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Custom Game Tab */}
        <TabsContent value="custom" className="flex-1 m-0">
          <ScrollArea className="h-full">
            <div className="p-5 max-w-lg space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Add Custom Game</CardTitle>
                  <CardDescription>
                    Manually add a game that wasn't auto-detected
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-[10px]">
                      Game Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="e.g. My Cool Game"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-[10px]">Developer</Label>
                    <Input
                      value={customDeveloper}
                      onChange={(e) => setCustomDeveloper(e.target.value)}
                      placeholder="e.g. Studio Name"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-[10px]">Save Paths</Label>
                    <div className="flex gap-1.5 mt-1">
                      <Textarea
                        value={customSavePath}
                        onChange={(e) => setCustomSavePath(e.target.value)}
                        placeholder="One path per line, e.g.&#10;%APPDATA%\MyGame\Saves&#10;C:\Games\MyGame\data"
                        className="min-h-20 flex-1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 self-start"
                        onClick={handlePickSavePath}
                      >
                        <FolderSearch className="size-3.5" />
                      </Button>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">
                      Supports %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, etc.
                    </p>
                  </div>

                  <div>
                    <Label className="text-[10px]">Game Executable (optional)</Label>
                    <div className="flex gap-1.5 mt-1">
                      <Input
                        value={customExePath}
                        onChange={(e) => setCustomExePath(e.target.value)}
                        placeholder="Path to .exe"
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={handlePickExePath}
                      >
                        <FolderSearch className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px]">Notes</Label>
                    <Textarea
                      value={customNotes}
                      onChange={(e) => setCustomNotes(e.target.value)}
                      placeholder="Any notes about save files, backup instructions, etc."
                      className="mt-1 min-h-15"
                    />
                  </div>

                  <Separator />

                  <Button
                    className="w-full"
                    onClick={handleAddCustom}
                    disabled={!customName.trim() || isAdding}
                  >
                    {isAdding ? (
                      <div className="size-3 border-2 border-t-transparent border-current rounded-full animate-spin" />
                    ) : (
                      <Plus className="size-3" />
                    )}
                    Add to Library
                  </Button>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Detected Game Row ───────────────────────────────────────
function DetectedGameRow({
  game,
  isSelected,
  onToggle,
}: {
  game: DetectedGame;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer text-left animate-slide-up",
        isSelected
          ? "border-primary/40 bg-primary/5"
          : "border-border hover:border-primary/20 bg-card"
      )}
    >
      {/* Cover */}
      <div className="size-10 rounded-lg overflow-hidden shrink-0 bg-muted">
        {game.cover_url && !imgError ? (
          <img
            src={game.cover_url}
            alt={game.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div
            className={cn(
              "w-full h-full flex items-center justify-center bg-linear-to-br text-[10px] font-bold",
              getCardColor(game.id)
            )}
          >
            {getGameInitials(game.name)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{game.name}</div>
        <div className="text-[10px] text-muted-foreground truncate">{game.developer}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant="secondary" className="text-[8px]">
            <HardDrive className="size-2 mr-0.5" />
            {formatBytes(game.save_size)}
          </Badge>
          {game.steam_appid && (
            <Badge variant="outline" className="text-[8px]">Steam</Badge>
          )}
        </div>
      </div>

      {/* Checkbox */}
      <div
        className={cn(
          "size-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
          isSelected
            ? "bg-primary border-primary"
            : "border-muted-foreground/30"
        )}
      >
        {isSelected && <Check className="size-3 text-primary-foreground" />}
      </div>
    </button>
  );
}
