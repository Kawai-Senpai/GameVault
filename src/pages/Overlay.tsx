import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts/app.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  Camera,
  ChevronDown,
  FolderOpen,
  Gamepad2,
  Globe,
  Keyboard,
  MessageSquareText,
  RotateCcw,
  Search,
  Send,
  StickyNote,
  Swords,
  X,
} from "lucide-react";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import type { Backup, Game } from "@/types";

import OverlayChat from "@/components/overlay/OverlayChat";
import OverlayNotes from "@/components/overlay/OverlayNotes";
import OverlayMacros from "@/components/overlay/OverlayMacros";
import OverlayArcade from "@/components/overlay/OverlayArcade";
import OverlaySearch from "@/components/overlay/OverlaySearch";

/* ─── Helpers ──────────────────────────────────────────────── */

interface RunningWindowInfo {
  pid: number;
  title: string;
  process_name: string;
  exe_path: string;
  is_foreground: boolean;
}

const windowKey = (win: RunningWindowInfo) => `${win.pid}:${win.title}`;
const normalizePath = (v: string | null | undefined) =>
  (v || "").replace(/\//g, "\\").toLowerCase().trim();
const slugify = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const STRIP_HEIGHT = 54;
const EXPANDED_HEIGHT = 480;

type OverlayTab = "ops" | "notes" | "macros" | "ai" | "search" | "arcade";

/* ─── Component ────────────────────────────────────────────── */

export default function Overlay() {
  const { games, settings, setGames } = useApp();

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<OverlayTab>("ops");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [runningWindows, setRunningWindows] = useState<RunningWindowInfo[]>([]);
  const [selectedWindowKey, setSelectedWindowKey] = useState("");
  const [lastBackup, setLastBackup] = useState<Backup | null>(null);
  const [quickInput, setQuickInput] = useState("");
  const [statusText, setStatusText] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState(false);

  const selectedGame = games.find((g) => g.id === selectedGameId) || null;
  const selectedWindow = runningWindows.find((w) => windowKey(w) === selectedWindowKey) || null;

  const findGameByExe = useCallback(
    (exe: string | null | undefined) => {
      const norm = normalizePath(exe);
      if (!norm) return null;
      return games.find((g) => normalizePath(g.exe_path) === norm) || null;
    },
    [games]
  );

  const matchedGame = useMemo(
    () => findGameByExe(selectedWindow?.exe_path),
    [findGameByExe, selectedWindow?.exe_path]
  );

  /* ─── Bootstrap ──────────────────────────────────────── */

  const refreshWindows = useCallback(async () => {
    try {
      const rows = await invoke<RunningWindowInfo[]>("list_running_windows");
      setRunningWindows(rows);
      setSelectedWindowKey((prev) => {
        if (prev && rows.some((r) => windowKey(r) === prev)) return prev;
        const fg = rows.find((r) => r.is_foreground);
        return fg ? windowKey(fg) : rows[0] ? windowKey(rows[0]) : "";
      });
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void refreshWindows();
    (async () => {
      try {
        const snap = await invoke<RunningWindowInfo | null>("get_last_foreground_window");
        if (snap) setSelectedWindowKey(windowKey(snap));
      } catch {
        /* silent */
      }
    })();
  }, [refreshWindows]);

  useEffect(() => {
    if (!selectedGameId && matchedGame) setSelectedGameId(matchedGame.id);
  }, [matchedGame, selectedGameId]);

  useEffect(() => {
    if (!selectedGameId) return setLastBackup(null);
    (async () => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        const rows = (await conn.select(
          "SELECT * FROM backups WHERE game_id = $1 ORDER BY created_at DESC LIMIT 1",
          [selectedGameId]
        )) as Backup[];
        setLastBackup(rows[0] || null);
      } catch {
        setLastBackup(null);
      }
    })();
  }, [selectedGameId]);

  /* ─── Expand / Collapse / Tab toggle ───────────────── */

  const handleTabClick = useCallback(
    (tab: OverlayTab) => {
      if (expanded && activeTab === tab) {
        // Clicking same tab again → collapse
        setExpanded(false);
        invoke("set_overlay_height", { height: STRIP_HEIGHT }).catch(() => {});
      } else {
        setActiveTab(tab);
        if (!expanded) {
          setExpanded(true);
          invoke("set_overlay_height", { height: EXPANDED_HEIGHT }).catch(() => {});
        }
      }
    },
    [expanded, activeTab]
  );

  const handleClose = () => {
    setExpanded(false);
    invoke("set_overlay_height", { height: STRIP_HEIGHT }).catch(() => {});
    invoke("hide_overlay");
  };

  const openMainApp = () => {
    invoke("show_overlay").catch(() => {}); // This is actually show main — let me use the right command
    // We need to show the main window from overlay
    (async () => {
      try {
        // Use Tauri window API to show main
        const { Window } = await import("@tauri-apps/api/window");
        const mainWin = new Window("main");
        await mainWin.unminimize();
        await mainWin.show();
        await mainWin.setFocus();
      } catch {
        toast.error("Could not open main window");
      }
    })();
  };

  /* ─── Actions ────────────────────────────────────────── */

  const ensureGame = useCallback(async (): Promise<Game | null> => {
    if (selectedGame) return selectedGame;
    if (selectedWindow?.exe_path) {
      const m = findGameByExe(selectedWindow.exe_path);
      if (m) {
        setSelectedGameId(m.id);
        return m;
      }
    }
    if (selectedWindow) {
      const name = selectedWindow.title.split("-")[0].trim() || selectedWindow.process_name;
      const base = slugify(name) || `game_${Date.now()}`;
      let id = base;
      let n = 2;
      while (games.some((g) => g.id === id)) {
        id = `${base}_${n}`;
        n += 1;
      }
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          `INSERT INTO games (id, name, developer, save_paths, extensions, notes, exe_path, is_custom, is_detected, added_at, updated_at)
           VALUES ($1, $2, '', '[]', '[]', 'Added from overlay', $3, 1, 1, datetime('now'), datetime('now'))`,
          [id, name, selectedWindow.exe_path]
        );
        const now = new Date().toISOString();
        const newGame: Game = {
          id,
          name,
          developer: "",
          steam_appid: null,
          cover_url: null,
          header_url: null,
          custom_cover_path: null,
          custom_header_path: null,
          save_paths: [],
          extensions: [],
          notes: "Added from overlay",
          exe_path: selectedWindow.exe_path,
          is_custom: true,
          is_detected: true,
          is_favorite: false,
          auto_backup_disabled: false,
          play_count: 0,
          total_playtime_seconds: 0,
          last_played_at: null,
          added_at: now,
          updated_at: now,
        };
        setGames((prev) => [...prev, newGame]);
        setSelectedGameId(id);
        toast.success(`Auto-linked "${name}"`);
        return newGame;
      } catch (err) {
        toast.error(`${err}`);
        return null;
      }
    }
    return null;
  }, [findGameByExe, games, selectedGame, selectedWindow, setGames]);

  const showStatus = (msg: string) => {
    setStatusText(msg);
    setTimeout(() => setStatusText(""), 3000);
  };

  const handleScreenshot = async () => {
    const game = await ensureGame();
    if (!game) return;
    if (!settings.screenshots_directory) return toast.error("Set screenshots directory in Settings first");
    showStatus("Capturing...");
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
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at) VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
        [result.id, game.id, result.file_path, result.thumbnail_path, result.width, result.height, result.file_size]
      );
      showStatus(`Screenshot saved (${formatBytes(result.file_size)})`);
      toast.success("Screenshot captured and saved");
    } catch (err) {
      showStatus("Failed");
      toast.error(`${err}`);
    }
  };

  const handleQuickBackup = async () => {
    const game = await ensureGame();
    if (!game) return;
    if (!settings.backup_directory) return toast.error("Set backup directory in Settings first");
    if (!game.save_paths.length) return toast.error("No save path configured for this game");
    showStatus("Backing up...");
    try {
      const savePath = await invoke<string>("expand_env_path", { path: game.save_paths[0] });
      const result = await invoke<{
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
        displayName: `Overlay Backup ${new Date().toLocaleTimeString()}`,
        collectionId: null,
        checkDuplicates: true,
      });
      if (!result.skipped_duplicate) {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          `INSERT INTO backups (id, game_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
          [result.backup_id, game.id, "Overlay Backup", result.file_path, result.file_size, result.compressed_size, result.content_hash, savePath]
        );
      }
      showStatus(result.skipped_duplicate ? "No changes" : "Backup done");
      toast.success(result.message);
      setLastBackup({
        id: result.backup_id,
        game_id: game.id,
        collection_id: null,
        display_name: "Overlay Backup",
        file_path: result.file_path,
        file_size: result.file_size,
        compressed_size: result.compressed_size,
        content_hash: result.content_hash,
        source_path: savePath,
        created_at: new Date().toISOString(),
        notes: "",
      });
    } catch (err) {
      showStatus("Failed");
      toast.error(`${err}`);
    }
  };

  const handleRestore = async () => {
    const game = await ensureGame();
    if (!game || !lastBackup) return;
    if (!game.save_paths.length) return toast.error("No save path configured");
    showStatus("Restoring...");
    try {
      const savePath = await invoke<string>("expand_env_path", { path: game.save_paths[0] });
      const result = await invoke<{ message: string }>("restore_backup", {
        zipPath: lastBackup.file_path,
        restorePath: savePath,
        createSafetyBackup: true,
        backupDir: settings.backup_directory,
        gameId: game.id,
        gameName: game.name,
      });
      showStatus("Restored");
      setRestoreConfirm(false);
      toast.success(result.message);
    } catch (err) {
      showStatus("Failed");
      toast.error(`${err}`);
    }
  };

  const handleOpenSaves = async () => {
    const game = await ensureGame();
    if (!game || !game.save_paths.length) return;
    try {
      await invoke("open_save_directory", { path: game.save_paths[0] });
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  /* ─── Computed ───────────────────────────────────────── */

  const gameLabel = selectedGame?.name || matchedGame?.name || "Game Vault";
  const hasGame = !!selectedGame || !!matchedGame;

  const tabs: { key: OverlayTab; icon: React.ReactNode; label: string }[] = [
    { key: "ops", icon: <Gamepad2 className="size-3" />, label: "Ops" },
    { key: "notes", icon: <StickyNote className="size-3" />, label: "Notes" },
    { key: "macros", icon: <Keyboard className="size-3" />, label: "Macros" },
    { key: "ai", icon: <MessageSquareText className="size-3" />, label: "AI" },
    { key: "search", icon: <Globe className="size-3" />, label: "Search" },
    { key: "arcade", icon: <Swords className="size-3" />, label: "Arcade" },
  ];

  /* ─── Render ─────────────────────────────────────────── */

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-transparent select-none"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* ── Restore Confirmation Dialog ───────────────────── */}
      {restoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRestoreConfirm(false)} />
          <div className="relative rounded-xl border border-amber-500/30 bg-black/90 backdrop-blur-xl p-4 w-80 text-center">
            <AlertTriangle className="mx-auto mb-2 size-8 text-amber-400" />
            <p className="text-xs font-semibold text-white mb-1">Restore Backup?</p>
            <p className="text-[9px] text-white/50 mb-3 leading-relaxed">
              This will overwrite your current save files with the last backup.
              A safety backup of current files will be created automatically.
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                size="sm"
                variant="ghost"
                className="text-[10px] text-white/60 hover:text-white"
                onClick={() => setRestoreConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-[10px] bg-amber-600 hover:bg-amber-500 text-white"
                onClick={() => void handleRestore()}
              >
                Yes, Restore
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Strip Bar ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-1.5 h-[54px] px-3 rounded-b-2xl border border-white/[0.12] border-t-0 bg-black/75 backdrop-blur-2xl text-white mx-auto"
        style={{ maxWidth: 700, WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Logo + Game — click opens main app */}
        <img
          src="/icon-192.png"
          alt=""
          className="size-6 rounded-md shrink-0 cursor-pointer hover:ring-1 hover:ring-white/20 transition-all"
          draggable={false}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={openMainApp}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />

        <div
          className="min-w-0 w-24 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={openMainApp}
          title="Open Game Vault"
        >
          <p className="text-[9px] font-semibold truncate leading-none">{gameLabel}</p>
          {statusText ? (
            <p className="text-[7px] text-emerald-400 truncate">{statusText}</p>
          ) : selectedGame && lastBackup ? (
            <p className="text-[7px] text-white/45 truncate">
              {formatRelativeTime(lastBackup.created_at)}
            </p>
          ) : selectedGame ? (
            <p className="text-[7px] text-white/30 truncate">No backup yet</p>
          ) : (
            <p className="text-[7px] text-white/30 truncate">Command Deck</p>
          )}
        </div>

        <div className="h-6 w-px bg-white/10 shrink-0" />

        {/* Quick actions */}
        <div
          className="flex items-center gap-0.5 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <StripBtn icon={<Camera className="size-3" />} title="Screenshot" onClick={handleScreenshot} />
          <StripBtn icon={<Archive className="size-3" />} title="Backup" onClick={handleQuickBackup} />
          <StripBtn
            icon={<RotateCcw className="size-3" />}
            title="Restore"
            onClick={() => setRestoreConfirm(true)}
            disabled={!lastBackup}
          />
        </div>

        <div className="h-6 w-px bg-white/10 shrink-0" />

        {/* Tab buttons — click toggles panel */}
        <div
          className="flex items-center gap-0.5 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              className={cn(
                "size-7 flex items-center justify-center rounded-md transition-all",
                activeTab === t.key && expanded
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              )}
              onClick={() => handleTabClick(t.key)}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-white/10 shrink-0" />

        {/* Quick AI input */}
        <div
          className="flex-1 min-w-0 flex items-center gap-0.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && quickInput.trim()) {
                e.preventDefault();
                handleTabClick("ai");
                setQuickInput("");
              }
            }}
            placeholder="Ask AI..."
            className="h-6 text-[9px] bg-white/5 border-white/10 text-white placeholder:text-white/25 flex-1 min-w-0 px-1.5 select-text"
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-6 shrink-0 text-white/40 hover:text-white"
            onClick={() => {
              if (quickInput.trim()) {
                handleTabClick("ai");
                setQuickInput("");
              }
            }}
            disabled={!quickInput.trim()}
          >
            <Send className="size-3" />
          </Button>
        </div>

        {/* Close */}
        <div
          className="flex items-center shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-white/40 hover:text-red-400"
            onClick={handleClose}
            title="Close"
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>

      {/* ── Expanded Panel ────────────────────────────────── */}
      {expanded && (
        <div
          className="mx-auto rounded-b-2xl border border-white/[0.12] border-t-0 bg-black/75 backdrop-blur-2xl text-white overflow-hidden"
          style={{ maxWidth: 700, height: EXPANDED_HEIGHT - STRIP_HEIGHT }}
        >
          {activeTab === "ops" && (
            <OpsPanel
              games={games}
              selectedGameId={selectedGameId}
              setSelectedGameId={setSelectedGameId}
              selectedGame={selectedGame}
              runningWindows={runningWindows}
              selectedWindowKey={selectedWindowKey}
              setSelectedWindowKey={setSelectedWindowKey}
              lastBackup={lastBackup}
              matchedGame={matchedGame}
              hasGame={hasGame}
              handleScreenshot={handleScreenshot}
              handleQuickBackup={handleQuickBackup}
              handleRestore={() => setRestoreConfirm(true)}
              handleOpenSaves={handleOpenSaves}
              settings={settings}
            />
          )}
          {activeTab === "notes" && (
            <div className="h-full select-text">
              <OverlayNotes gameId={selectedGameId} gameName={selectedGame?.name || ""} />
            </div>
          )}
          {activeTab === "macros" && <OverlayMacros gameId={selectedGameId} />}
          {activeTab === "ai" && (
            <div className="h-full select-text">
              <OverlayChat settings={settings} />
            </div>
          )}
          {activeTab === "search" && (
            <div className="h-full select-text">
              <OverlaySearch defaultSearchEngine="google" />
            </div>
          )}
          {activeTab === "arcade" && <OverlayArcade />}
        </div>
      )}
    </div>
  );
}

/* ─── Ops Panel ────────────────────────────────────────────── */

function OpsPanel({
  games,
  selectedGameId,
  setSelectedGameId,
  selectedGame,
  runningWindows,
  selectedWindowKey,
  setSelectedWindowKey,
  lastBackup,
  matchedGame,
  hasGame,
  handleScreenshot,
  handleQuickBackup,
  handleRestore,
  handleOpenSaves,
  settings,
}: {
  games: Game[];
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  selectedGame: Game | null;
  runningWindows: RunningWindowInfo[];
  selectedWindowKey: string;
  setSelectedWindowKey: (k: string) => void;
  lastBackup: Backup | null;
  matchedGame: Game | null;
  hasGame: boolean;
  handleScreenshot: () => void;
  handleQuickBackup: () => void;
  handleRestore: () => void;
  handleOpenSaves: () => void;
  settings: { overlay_shortcut: string; screenshot_shortcut: string; quick_backup_shortcut: string };
}) {
  const [gameSearch, setGameSearch] = useState("");
  const [windowSearch, setWindowSearch] = useState("");
  const [gameDropOpen, setGameDropOpen] = useState(false);
  const [windowDropOpen, setWindowDropOpen] = useState(false);
  const gameRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  const filteredGames = games.filter((g) =>
    g.name.toLowerCase().includes(gameSearch.toLowerCase())
  );
  const filteredWindows = runningWindows.filter(
    (w) =>
      w.process_name.toLowerCase().includes(windowSearch.toLowerCase()) ||
      w.title.toLowerCase().includes(windowSearch.toLowerCase())
  );

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gameRef.current && !gameRef.current.contains(e.target as Node)) setGameDropOpen(false);
      if (windowRef.current && !windowRef.current.contains(e.target as Node)) setWindowDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex h-full">
      {/* Left: Game + Window selector */}
      <div className="w-56 border-r border-white/[0.08] p-2.5 flex flex-col gap-2 shrink-0">
        <p className="text-[10px] font-medium text-white/70">Game & Window</p>

        {/* Custom Game Dropdown */}
        <div ref={gameRef} className="relative">
          <button
            className="w-full h-7 flex items-center gap-1 px-2 text-[9px] bg-white/5 border border-white/10 rounded-md text-white hover:border-white/20 transition-colors"
            onClick={() => {
              setGameDropOpen((p) => !p);
              setWindowDropOpen(false);
            }}
          >
            <Gamepad2 className="size-3 text-white/40 shrink-0" />
            <span className="flex-1 text-left truncate">
              {selectedGame?.name || "Select game..."}
            </span>
            <ChevronDown className="size-3 text-white/30 shrink-0" />
          </button>
          {gameDropOpen && (
            <div className="absolute top-8 left-0 right-0 z-50 rounded-lg border border-white/15 bg-black/95 shadow-xl overflow-hidden">
              <div className="p-1.5 border-b border-white/[0.08]">
                <div className="flex items-center gap-1 px-1.5 h-6 bg-white/5 rounded border border-white/10">
                  <Search className="size-2.5 text-white/30" />
                  <input
                    value={gameSearch}
                    onChange={(e) => setGameSearch(e.target.value)}
                    placeholder="Search games..."
                    className="flex-1 bg-transparent text-[9px] text-white outline-none placeholder:text-white/25 select-text"
                    autoFocus
                  />
                </div>
              </div>
              <ScrollArea className="max-h-40">
                {filteredGames.length === 0 && (
                  <p className="text-[8px] text-white/30 text-center py-3">No games found</p>
                )}
                {filteredGames.map((g) => (
                  <button
                    key={g.id}
                    className={cn(
                      "w-full flex items-center gap-1.5 px-2 py-1.5 text-[9px] transition-colors",
                      g.id === selectedGameId
                        ? "bg-white/10 text-white"
                        : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                    )}
                    onClick={() => {
                      setSelectedGameId(g.id);
                      setGameDropOpen(false);
                      setGameSearch("");
                    }}
                  >
                    <Gamepad2 className="size-2.5 shrink-0 text-white/30" />
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Custom Window Dropdown */}
        {runningWindows.length > 0 && (
          <div ref={windowRef} className="relative">
            <button
              className="w-full h-7 flex items-center gap-1 px-2 text-[9px] bg-white/5 border border-white/10 rounded-md text-white hover:border-white/20 transition-colors"
              onClick={() => {
                setWindowDropOpen((p) => !p);
                setGameDropOpen(false);
              }}
            >
              <span className="size-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
              <span className="flex-1 text-left truncate">
                {runningWindows.find((w) => windowKey(w) === selectedWindowKey)?.process_name ||
                  "Running windows..."}
              </span>
              <ChevronDown className="size-3 text-white/30 shrink-0" />
            </button>
            {windowDropOpen && (
              <div className="absolute top-8 left-0 right-0 z-50 rounded-lg border border-white/15 bg-black/95 shadow-xl overflow-hidden">
                <div className="p-1.5 border-b border-white/[0.08]">
                  <div className="flex items-center gap-1 px-1.5 h-6 bg-white/5 rounded border border-white/10">
                    <Search className="size-2.5 text-white/30" />
                    <input
                      value={windowSearch}
                      onChange={(e) => setWindowSearch(e.target.value)}
                      placeholder="Search windows..."
                      className="flex-1 bg-transparent text-[9px] text-white outline-none placeholder:text-white/25 select-text"
                      autoFocus
                    />
                  </div>
                </div>
                <ScrollArea className="max-h-40">
                  {filteredWindows.length === 0 && (
                    <p className="text-[8px] text-white/30 text-center py-3">No matches</p>
                  )}
                  {filteredWindows.map((w) => (
                    <button
                      key={windowKey(w)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1.5 text-[9px] transition-colors",
                        windowKey(w) === selectedWindowKey
                          ? "bg-white/10 text-white"
                          : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                      )}
                      onClick={() => {
                        setSelectedWindowKey(windowKey(w));
                        setWindowDropOpen(false);
                        setWindowSearch("");
                      }}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full shrink-0",
                          w.is_foreground ? "bg-emerald-400" : "bg-white/20"
                        )}
                      />
                      <div className="min-w-0 text-left">
                        <p className="truncate font-medium">{w.process_name}</p>
                        <p className="truncate text-[7px] text-white/35">{w.title.slice(0, 40)}</p>
                      </div>
                    </button>
                  ))}
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        {matchedGame && (
          <p className="text-[8px] text-emerald-400/80">Auto-linked to {matchedGame.name}</p>
        )}

        {selectedGame && (
          <div className="text-[8px] text-white/50 space-y-0.5 mt-1">
            <p className="font-medium text-white/70">{selectedGame.name}</p>
            <p className="truncate">Developer: {selectedGame.developer || "—"}</p>
            <p className="truncate">Save: {selectedGame.save_paths[0] || "Not configured"}</p>
            <p>EXE: {selectedGame.exe_path ? "Set" : "Not set"}</p>
            {lastBackup && (
              <p className="text-emerald-400/60">
                Last backup {formatRelativeTime(lastBackup.created_at)}
              </p>
            )}
          </div>
        )}

        {/* Shortcuts reference */}
        <div className="mt-auto text-[7px] text-white/25 space-y-0.5 pt-2 border-t border-white/[0.06]">
          <p>Overlay: {settings.overlay_shortcut}</p>
          <p>Screenshot: {settings.screenshot_shortcut}</p>
          <p>Backup: {settings.quick_backup_shortcut}</p>
        </div>
      </div>

      {/* Right: Actions or guidance */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {!hasGame ? (
            /* No game guidance */
            <NoGameGuide />
          ) : (
            <>
              <p className="text-[10px] font-medium mb-2">Quick Actions</p>
              <div className="grid grid-cols-2 gap-2">
                <ActionTile
                  icon={<Camera className="size-5 text-sky-400" />}
                  label="Take Screenshot"
                  desc="Capture current screen"
                  onClick={handleScreenshot}
                />
                <ActionTile
                  icon={<Archive className="size-5 text-emerald-400" />}
                  label="Quick Backup"
                  desc="Backup current game saves"
                  onClick={handleQuickBackup}
                />
                <ActionTile
                  icon={<RotateCcw className="size-5 text-amber-400" />}
                  label="Restore Last"
                  desc="Restore most recent backup"
                  onClick={handleRestore}
                  disabled={!lastBackup}
                />
                <ActionTile
                  icon={<FolderOpen className="size-5 text-violet-400" />}
                  label="Open Saves"
                  desc="Open save directory in Explorer"
                  onClick={handleOpenSaves}
                />
              </div>

              {lastBackup && (
                <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
                  <p className="text-[9px] font-medium">Last Backup</p>
                  <p className="text-[8px] text-white/50">{lastBackup.display_name}</p>
                  <p className="text-[7px] text-white/35 mt-0.5">
                    {formatBytes(lastBackup.compressed_size)} ·{" "}
                    {formatRelativeTime(lastBackup.created_at)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ─── No Game Guidance Component ───────────────────────────── */

function NoGameGuide() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-8 text-center">
      <div className="size-12 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center mb-3">
        <Gamepad2 className="size-6 text-white/20" />
      </div>
      <p className="text-xs font-semibold text-white/80 mb-1">No Game Selected</p>
      <p className="text-[9px] text-white/40 max-w-52 leading-relaxed mb-4">
        Select a game from the dropdown on the left, or launch a game and the overlay will
        auto-detect it.
      </p>
      <div className="space-y-2 text-[8px] text-white/35 max-w-56">
        <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
          <span className="size-4 flex items-center justify-center rounded bg-sky-500/20 text-sky-400 text-[7px] font-bold shrink-0">
            1
          </span>
          <p>Select a game from the dropdown, or launch any game</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
          <span className="size-4 flex items-center justify-center rounded bg-emerald-500/20 text-emerald-400 text-[7px] font-bold shrink-0">
            2
          </span>
          <p>Configure save paths in the main app if not auto-detected</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
          <span className="size-4 flex items-center justify-center rounded bg-violet-500/20 text-violet-400 text-[7px] font-bold shrink-0">
            3
          </span>
          <p>Use the quick action buttons to screenshot, backup, or restore</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────── */

function StripBtn({
  icon,
  title,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "size-7 flex items-center justify-center rounded-md transition-all",
        disabled
          ? "opacity-25 cursor-not-allowed"
          : "text-white/50 hover:text-white hover:bg-white/10 active:scale-95"
      )}
      onClick={disabled ? undefined : () => void onClick()}
      title={title}
    >
      {icon}
    </button>
  );
}

function ActionTile({
  icon,
  label,
  desc,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 text-left transition-all",
        disabled
          ? "opacity-30 cursor-not-allowed"
          : "hover:bg-white/[0.08] active:scale-[0.98]"
      )}
      onClick={disabled ? undefined : () => void onClick()}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold">{label}</p>
        <p className="text-[7px] text-white/40">{desc}</p>
      </div>
    </button>
  );
}
