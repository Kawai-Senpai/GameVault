import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useApp } from "@/contexts/app.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Archive,
  Camera,
  CheckCircle2,
  ChevronDown,
  FolderInput,
  FolderOpen,
  Gamepad2,
  Globe,
  Info,
  Keyboard,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Search,
  Send,
  StickyNote,
  Swords,
  Video,
  X,
} from "lucide-react";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import type { Backup, Game, GameNote } from "@/types";

import OverlayChat from "@/components/overlay/OverlayChat";
import OverlayNotes from "@/components/overlay/OverlayNotes";
import OverlayMacros from "@/components/overlay/OverlayMacros";
import OverlayArcade from "@/components/overlay/OverlayArcade";
import OverlaySearch from "@/components/overlay/OverlaySearch";
import PerformancePanel from "@/components/PerformancePanel";

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

type OverlayTab = "ops" | "notes" | "macros" | "ai" | "search" | "arcade" | "perf";

/* ─── Component ────────────────────────────────────────────── */

export default function Overlay() {
  const { games, settings, setGames, updateSetting } = useApp();

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<OverlayTab>("ops");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [runningWindows, setRunningWindows] = useState<RunningWindowInfo[]>([]);
  const [selectedWindowKey, setSelectedWindowKey] = useState("");
  const [lastBackup, setLastBackup] = useState<Backup | null>(null);
  const [quickInput, setQuickInput] = useState("");
  const [pendingAiMessage, setPendingAiMessage] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [overlayWizard, setOverlayWizard] = useState<null | "game" | "screenshot-dir" | "backup-dir" | "save-paths">(null);
  const [successCard, setSuccessCard] = useState<{ action: string; info: string } | null>(null);

  // Reminder popup (notes alarms)
  const [dueReminders, setDueReminders] = useState<GameNote[]>([]);
  const [reminderHidden, setReminderHidden] = useState(false);

  // Live session timer - shows how long current game has been running
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const prevMatchedGameId = useRef<string | null>(null);

  const formatSessionTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  // Make body/html transparent for overlay window (rounded corners)
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
    };
  }, []);

  // Overlay opacity: now synced automatically via AppProvider's periodic settings poll.
  // No need for separate DB polling - settings.overlay_opacity stays fresh.
  const liveOpacity = settings.overlay_opacity;

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
    () => {
      // Priority 1: Match the foreground/selected window exe_path against known games.
      const fgMatch = findGameByExe(selectedWindow?.exe_path);
      if (fgMatch) return fgMatch;

      // Priority 2: Fuzzy match the foreground window title/process against game names.
      if (selectedWindow) {
        const titleLower = (selectedWindow.title || "").toLowerCase();
        const processLower = (selectedWindow.process_name || "").toLowerCase();
        const exeName = (selectedWindow.exe_path || "").split(/[/\\]/).pop()?.replace(/\.exe$/i, "").toLowerCase() || "";
        for (const g of games) {
          if (g.name.length < 2) continue;
          const gameLower = g.name.toLowerCase();
          if (
            titleLower.includes(gameLower) ||
            processLower.includes(gameLower) ||
            gameLower.includes(exeName) ||
            exeName.includes(gameLower)
          ) {
            return g;
          }
        }
      }

      // Priority 3: Check ALL running windows for exe_path match against games in library.
      // This catches fullscreen games where GetForegroundWindow might return a system process
      // instead of the game. ONLY matches by exact exe_path (set in game library).
      for (const w of runningWindows) {
        if (selectedWindow && windowKey(w) === selectedWindowKey) continue;
        const exeMatch = findGameByExe(w.exe_path);
        if (exeMatch) {
          // Found a known game running — auto-select it
          setSelectedWindowKey(windowKey(w));
          return exeMatch;
        }
      }

      // Priority 4: Fuzzy match ALL running window titles against game names in library.
      // Only matches if the game name is IN the window title (or vice versa).
      for (const w of runningWindows) {
        if (selectedWindow && windowKey(w) === selectedWindowKey) continue;
        const titleLower = (w.title || "").toLowerCase();
        const processLower = (w.process_name || "").toLowerCase();
        for (const g of games) {
          if (g.name.length < 3) continue;
          const gameLower = g.name.toLowerCase();
          if (titleLower.includes(gameLower) || processLower.includes(gameLower)) {
            setSelectedWindowKey(windowKey(w));
            return g;
          }
        }
      }

      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findGameByExe, selectedWindow, runningWindows, games, selectedWindowKey]
  );

  // Track current session start when a game is detected
  useEffect(() => {
    const currentId = selectedGame?.id || matchedGame?.id || null;
    if (currentId && currentId !== prevMatchedGameId.current) {
      setSessionStartMs(Date.now());
      setSessionElapsed(0);
    } else if (!currentId) {
      setSessionStartMs(null);
      setSessionElapsed(0);
    }
    prevMatchedGameId.current = currentId;
  }, [selectedGame?.id, matchedGame?.id]);

  // Tick session timer every second
  useEffect(() => {
    if (!sessionStartMs) return;
    const t = window.setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - sessionStartMs) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [sessionStartMs]);

  // Fetch due reminders when the matched game changes
  useEffect(() => {
    setReminderHidden(false);
    if (!matchedGame?.id) {
      setDueReminders([]);
      return;
    }

    (async () => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");

        const rows = (await conn.select(
          `SELECT * FROM game_notes
           WHERE game_id = $1 AND reminder_enabled = 1 AND is_dismissed = 0
             AND (
               remind_next_session = 1
               OR (
                 recurring_days IS NOT NULL
                 AND (last_reminded_at IS NULL OR (julianday('now') - julianday(last_reminded_at)) >= recurring_days)
               )
             )
           ORDER BY is_pinned DESC, updated_at DESC
           LIMIT 6`,
          [matchedGame.id]
        )) as Array<Record<string, unknown>>;

        const mapped: GameNote[] = rows.map((r) => ({
          id: r.id as string,
          game_id: r.game_id as string,
          title: (r.title as string) || "Untitled",
          content: (r.content as string) || "",
          color: (r.color as string) || "#6366f1",
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
        }));

        setDueReminders(mapped);

        // Mark "due" reminders as shown so they don't spam inside the same session
        if (mapped.length > 0) {
          const ids = mapped.map((n) => n.id);
          const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
          await conn.execute(
            `UPDATE game_notes
             SET
               last_shown_at = datetime('now'),
               -- one-shot next-session reminders clear themselves on show
               remind_next_session = CASE WHEN remind_next_session = 1 THEN 0 ELSE remind_next_session END,
               -- recurring reminders advance their last_reminded_at on show
               last_reminded_at = CASE
                 WHEN recurring_days IS NOT NULL AND (last_reminded_at IS NULL OR (julianday('now') - julianday(last_reminded_at)) >= recurring_days)
                   THEN datetime('now')
                 ELSE last_reminded_at
               END
             WHERE id IN (${placeholders})`,
            ids
          );
        }
      } catch {
        setDueReminders([]);
      }
    })();
  }, [matchedGame?.id]);

  const dismissReminderForever = useCallback(async (noteId: string) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE game_notes SET reminder_enabled = 0, remind_next_session = 0, recurring_days = NULL, is_dismissed = 1, updated_at = datetime('now') WHERE id = $1",
        [noteId]
      );
      setDueReminders((prev) => prev.filter((n) => n.id !== noteId));
      toast.success("Reminder dismissed");
    } catch (err) {
      toast.error(`${err}`);
    }
  }, []);

  const remindAgainNextSession = useCallback(async (noteId: string) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE game_notes SET reminder_enabled = 1, remind_next_session = 1, is_dismissed = 0, updated_at = datetime('now') WHERE id = $1",
        [noteId]
      );
      setDueReminders((prev) => prev.filter((n) => n.id !== noteId));
      toast.success("Will remind next session");
    } catch (err) {
      toast.error(`${err}`);
    }
  }, []);

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

  // Periodically refresh running windows for accurate game detection.
  // The overlay stays mounted even when hidden, so we poll every 5s.
  // Also refresh on visibility change (when overlay is shown via shortcut).
  useEffect(() => {
    const timer = window.setInterval(refreshWindows, 5000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshWindows();
        // Re-read the cached foreground window (captured right before overlay was shown)
        invoke<RunningWindowInfo | null>("get_last_foreground_window")
          .then((snap) => {
            if (snap) setSelectedWindowKey(windowKey(snap));
          })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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
    invoke("show_overlay").catch(() => {}); // This is actually show main - let me use the right command
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

  const showWizard = useCallback(
    (wiz: "game" | "screenshot-dir" | "backup-dir" | "save-paths") => {
      setOverlayWizard(wiz);
      setActiveTab("ops");
      if (!expanded) {
        setExpanded(true);
        invoke("set_overlay_height", { height: EXPANDED_HEIGHT }).catch(() => {});
      }
    },
    [expanded]
  );

  const showSuccess = (action: string, info: string) => {
    setSuccessCard({ action, info });
    setTimeout(() => setSuccessCard(null), 3500);
  };

  const handleScreenshot = async () => {
    setOverlayWizard(null);
    setSuccessCard(null);
    const game = await ensureGame();
    if (!game) {
      if (!selectedGame && !matchedGame && !selectedWindow) {
        showWizard("game");
      }
      return;
    }

    // Always read fresh screenshots_directory from DB (overlay has a separate React tree
    // and settings might be stale if user changed them in the main window)
    let screenshotDir = settings.screenshots_directory;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT value FROM settings WHERE key = 'screenshots_directory'"
      )) as { value: string }[];
      if (rows[0]?.value) screenshotDir = rows[0].value;
    } catch { /* use context value */ }

    if (!screenshotDir) {
      showWizard("screenshot-dir");
      return;
    }
    setScreenshotBusy(true);
    showStatus("Capturing...");
    try {
      // Hide overlay so it doesn't appear in the screenshot
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const overlayWin = getCurrentWindow();
      await overlayWin.hide();
      await new Promise((r) => setTimeout(r, 250)); // wait for window to fully hide

      const base64 = await invoke<string>("capture_screen");

      // Restore overlay immediately
      await overlayWin.show();

      const result = await invoke<{
        id: string;
        file_path: string;
        thumbnail_path: string;
        width: number;
        height: number;
        file_size: number;
      }>("save_screenshot_file", {
        screenshotsDir: screenshotDir,
        gameId: game.id,
        base64Data: base64,
      });
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at) VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
        [result.id, game.id, result.file_path, result.thumbnail_path, result.width, result.height, result.file_size]
      );
      showStatus(`Screenshot saved`);
      showSuccess("screenshot", `${result.width}×${result.height} · ${formatBytes(result.file_size)}`);
      toast.success("Screenshot captured and saved");
      try {
        sendNotification({
          title: "Screenshot Captured",
          body: `${game.name} · ${result.width}×${result.height}`,
        });
      } catch { /* notification may be blocked */ }
    } catch (err) {
      // Ensure overlay is visible again on error
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().show();
      } catch { /* ignore */ }
      showStatus("Failed");
      toast.error(`Screenshot failed: ${err}`);
    } finally {
      setScreenshotBusy(false);
    }
  };

  // ── Recording ─────────────────────────────────────────
  const recordingTimerRef = useRef<number | null>(null);

  // Sync recording state on mount + listen for events from global shortcut
  useEffect(() => {
    // Check if recording is already in progress (started via global shortcut)
    const syncState = async () => {
      try {
        const status = await invoke<{ is_recording: boolean; duration_seconds: number }>("get_recording_status");
        if (status.is_recording) {
          setIsRecording(true);
          setRecordingDuration(Math.floor(status.duration_seconds));
          // Start counting from current duration
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = window.setInterval(() => {
            setRecordingDuration((d) => d + 1);
          }, 1000);
        }
      } catch { /* ignore */ }
    };
    syncState();

    // Listen for recording state changes from other windows / global shortcut
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ is_recording: boolean }>("recording-state-changed", (event) => {
          if (event.payload.is_recording) {
            setIsRecording(true);
            setRecordingDuration(0);
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = window.setInterval(() => {
              setRecordingDuration((d) => d + 1);
            }, 1000);
          } else {
            setIsRecording(false);
            setRecordingDuration(0);
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
          }
        });
      } catch { /* ignore */ }
    })();

    return () => {
      if (unlisten) unlisten();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const handleToggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      showStatus("Stopping recording...");
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

        setIsRecording(false);
        setRecordingDuration(0);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        // Save to DB
        const game = await ensureGame();
        const gameId = game?.id || "_general";
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          `INSERT INTO recordings (id, game_id, file_path, thumbnail_path, width, height, file_size, duration_seconds, fps, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, datetime('now'))`,
          [
            result.id, gameId, result.file_path, result.thumbnail_path,
            result.width, result.height, result.file_size,
            result.duration_seconds, settings.recording_fps,
          ]
        );

        const durStr = result.duration_seconds >= 60
          ? `${Math.floor(result.duration_seconds / 60)}m ${Math.floor(result.duration_seconds % 60)}s`
          : `${Math.floor(result.duration_seconds)}s`;
        showSuccess("recording", `${durStr} · ${result.width}×${result.height} · ${formatBytes(result.file_size)}`);
        toast.success("Recording saved");
        try {
          sendNotification({
            title: "Recording Saved",
            body: `${durStr} · ${result.width}×${result.height}`,
          });
        } catch { /* notification may be blocked */ }
      } catch (err) {
        toast.error(`Stop recording failed: ${err}`);
        setIsRecording(false);
        setRecordingDuration(0);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
      }
    } else {
      // Start recording
      const recDir = settings.recordings_directory || settings.screenshots_directory;
      if (!recDir) {
        showWizard("screenshot-dir");
        toast.error("Set a screenshots or recordings directory first");
        return;
      }

      // Try to get game but don't block recording if no game selected
      let gameId = "_general";
      try {
        const game = await ensureGame();
        if (game) gameId = game.id;
      } catch { /* use _general */ }

      try {
        // Resolve best ffmpeg path (user → bundled → system)
        const ffmpegPath = await invoke<string>("resolve_ffmpeg", { userPath: settings.ffmpeg_path || null });
        await invoke<string>("start_recording", {
          recordingsDir: recDir,
          gameId,
          ffmpegPath,
          fps: settings.recording_fps || 30,
          resolution: settings.recording_resolution === "native" ? null : settings.recording_resolution,
          quality: settings.recording_quality || "medium",
        });

        setIsRecording(true);
        setRecordingDuration(0);
        showStatus("Recording started");
        toast.success("Recording started");
        try {
          sendNotification({
            title: "Recording Started",
            body: `Recording at ${settings.recording_fps || 30} FPS`,
          });
        } catch { /* notification may be blocked */ }

        // Start duration timer
        const startTime = Date.now();
        recordingTimerRef.current = window.setInterval(() => {
          setRecordingDuration(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
      } catch (err) {
        toast.error(`Start recording failed: ${err}`);
      }
    }
  };

  // Cleanup recording timer on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const handleQuickBackup = async () => {
    setOverlayWizard(null);
    setSuccessCard(null);
    const game = await ensureGame();
    if (!game) {
      if (!selectedGame && !matchedGame && !selectedWindow) {
        showWizard("game");
      }
      return;
    }

    // Always read fresh backup_directory from DB (overlay has a separate React tree)
    let backupDir = settings.backup_directory;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT value FROM settings WHERE key = 'backup_directory'"
      )) as { value: string }[];
      if (rows[0]?.value) backupDir = rows[0].value;
    } catch { /* use context value */ }

    if (!backupDir) {
      showWizard("backup-dir");
      return;
    }
    if (!game.save_paths.length) {
      showWizard("save-paths");
      return;
    }
    setBackupBusy(true);
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
        backupDir: backupDir,
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
      showSuccess(
        "backup",
        result.skipped_duplicate
          ? "No changes since last backup"
          : `${formatBytes(result.compressed_size)} saved`
      );
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
      toast.error(`Backup failed: ${err}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestore = async () => {
    const game = await ensureGame();
    if (!game || !lastBackup) return;
    if (!game.save_paths.length) {
      showWizard("save-paths");
      setRestoreConfirm(false);
      return;
    }

    // Read fresh backup_directory from DB
    let backupDirRestore = settings.backup_directory;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT value FROM settings WHERE key = 'backup_directory'"
      )) as { value: string }[];
      if (rows[0]?.value) backupDirRestore = rows[0].value;
    } catch { /* use context value */ }

    showStatus("Restoring...");
    try {
      const savePath = await invoke<string>("expand_env_path", { path: game.save_paths[0] });
      const result = await invoke<{ message: string }>("restore_backup", {
        zipPath: lastBackup.file_path,
        restorePath: savePath,
        createSafetyBackup: true,
        backupDir: backupDirRestore,
        gameId: game.id,
        gameName: game.name,
      });
      showStatus("Restored");
      setRestoreConfirm(false);
      showSuccess("restore", "Save files restored successfully");
      toast.success(result.message);
    } catch (err) {
      showStatus("Failed");
      toast.error(`Restore failed: ${err}`);
    }
  };

  const handleOpenSaves = async () => {
    const game = await ensureGame();
    if (!game) {
      if (!selectedGame && !matchedGame && !selectedWindow) showWizard("game");
      return;
    }
    if (!game.save_paths.length) {
      showWizard("save-paths");
      return;
    }
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
    { key: "perf", icon: <Activity className="size-3" />, label: "Perf" },
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
      {/* ── Reminder Popup (notes alarms) ─────────────────── */}
      {!reminderHidden && matchedGame && dueReminders.length > 0 && (
        <div className="fixed left-1/2 top-[62px] z-[60] w-[680px] max-w-[calc(100vw-16px)] -translate-x-1/2 px-2">
          <div className="rounded-2xl border border-white/[0.12] bg-black/85 backdrop-blur-2xl overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08]">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-white truncate">Reminders · {matchedGame.name}</p>
                <p className="text-[8px] text-white/40 truncate">Quick notes you asked to see in this session</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-white/40 hover:text-white"
                onClick={() => setReminderHidden(true)}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <X className="size-3" />
              </Button>
            </div>
            <div className="p-3 space-y-2">
              {dueReminders.slice(0, 4).map((n) => (
                <div key={n.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2">
                  <div className="flex items-start gap-2">
                    <div className="mt-1 size-2 rounded-full" style={{ backgroundColor: n.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-white truncate">{n.title}</p>
                      {n.content ? (
                        <p className="text-[8px] text-white/45 mt-0.5 line-clamp-2 leading-relaxed">{n.content}</p>
                      ) : (
                        <p className="text-[8px] text-white/30 mt-0.5">(No content)</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[9px] text-white/60 hover:text-white hover:bg-white/10"
                          onClick={() => void remindAgainNextSession(n.id)}
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          Remind next session again
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[9px] text-red-300/80 hover:text-red-200 hover:bg-red-500/10"
                          onClick={() => void dismissReminderForever(n.id)}
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          Stop forever
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {dueReminders.length > 4 && (
                <p className="text-[8px] text-white/30">+{dueReminders.length - 4} more... open Notes for full list</p>
              )}
            </div>
          </div>
        </div>
      )}

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
        className={cn(
          "flex items-center gap-1.5 h-[54px] px-3 rounded-t-2xl border border-white/[0.12] backdrop-blur-2xl text-white mx-auto",
          expanded ? "rounded-b-none border-b-0" : "rounded-b-2xl"
        )}
        style={{ maxWidth: 700, WebkitAppRegion: "drag", background: `rgba(0,0,0,${(liveOpacity || 92) / 100})` } as React.CSSProperties}
      >
        {/* Logo + Game - click opens main app */}
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
          {successCard ? (
            <p className="text-[7px] text-emerald-400 truncate flex items-center gap-0.5">
              <CheckCircle2 className="size-2 shrink-0" /> {successCard.info}
            </p>
          ) : statusText ? (
            <p className={cn("text-[7px] truncate", statusText.includes("...") ? "text-sky-400 animate-pulse" : "text-emerald-400")}>{statusText}</p>
          ) : sessionStartMs && sessionElapsed > 0 ? (
            <p className="text-[7px] text-sky-400 truncate tabular-nums">
              ⏱ {formatSessionTime(sessionElapsed)}
            </p>
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
          <StripBtn icon={<Camera className="size-3" />} title="Screenshot" onClick={handleScreenshot} loading={screenshotBusy} />
          <StripBtn
            icon={<Video className={cn("size-3", isRecording && "text-red-400")} />}
            title={isRecording ? `Recording ${Math.floor(recordingDuration / 60)}:${String(recordingDuration % 60).padStart(2, '0')}` : "Record"}
            onClick={handleToggleRecording}
            className={isRecording ? "!bg-red-500/30 animate-pulse" : ""}
          />
          <StripBtn icon={<Archive className="size-3" />} title="Backup" onClick={handleQuickBackup} loading={backupBusy} />
          <StripBtn
            icon={<RotateCcw className="size-3" />}
            title="Restore"
            onClick={() => setRestoreConfirm(true)}
            disabled={!lastBackup}
          />
        </div>

        <div className="h-6 w-px bg-white/10 shrink-0" />

        {/* Tab buttons - click toggles panel */}
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
            onFocus={() => invoke("unlock_overlay").catch(() => {})}
            onBlur={() => invoke("lock_overlay").catch(() => {})}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && quickInput.trim()) {
                e.preventDefault();
                setPendingAiMessage(quickInput.trim());
                setQuickInput("");
                handleTabClick("ai");
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
                setPendingAiMessage(quickInput.trim());
                setQuickInput("");
                handleTabClick("ai");
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
          className="mx-auto rounded-b-2xl border border-white/[0.12] border-t-0 backdrop-blur-2xl text-white overflow-hidden cursor-default"
          style={{ maxWidth: 700, height: EXPANDED_HEIGHT - STRIP_HEIGHT, background: `rgba(0,0,0,${(liveOpacity || 92) / 100})` }}
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
              updateSetting={updateSetting}
              screenshotBusy={screenshotBusy}
              backupBusy={backupBusy}
              overlayWizard={overlayWizard}
              setOverlayWizard={setOverlayWizard}
              successCard={successCard}
              setGames={setGames}
            />
          )}
          {activeTab === "notes" && (
            <div className="h-full select-text">
              <OverlayNotes gameId={selectedGameId} gameName={selectedGame?.name || ""} />
            </div>
          )}
          {activeTab === "macros" && <OverlayMacros gameId={selectedGameId} />}
          {activeTab === "perf" && (
            <ScrollArea className="h-full">
              <div className="p-3">
                <PerformancePanel
                  pid={selectedWindow?.pid ?? null}
                  title="Performance"
                  compact
                />
              </div>
            </ScrollArea>
          )}
          {activeTab === "ai" && (
            <div className="h-full select-text">
              <OverlayChat
                settings={settings}
                gameName={selectedGame?.name || matchedGame?.name}
                exeName={selectedWindow?.process_name}
                initialMessage={pendingAiMessage || undefined}
                onMessageConsumed={() => setPendingAiMessage(null)}
              />
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
  updateSetting,
  screenshotBusy,
  backupBusy,
  overlayWizard,
  setOverlayWizard,
  successCard,
  setGames,
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
  settings: { overlay_shortcut: string; screenshot_shortcut: string; quick_backup_shortcut: string; backup_directory: string; screenshots_directory: string };
  updateSetting: (key: string, value: string) => Promise<void>;
  screenshotBusy: boolean;
  backupBusy: boolean;
  overlayWizard: null | "game" | "screenshot-dir" | "backup-dir" | "save-paths";
  setOverlayWizard: (wiz: null | "game" | "screenshot-dir" | "backup-dir" | "save-paths") => void;
  successCard: { action: string; info: string } | null;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
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
            <p className="truncate">Developer: {selectedGame.developer || "-"}</p>
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
          {/* Success Card */}
          {successCard && (
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="size-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="size-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-emerald-300 capitalize">{successCard.action} Complete</p>
                <p className="text-[8px] text-emerald-400/70">{successCard.info}</p>
              </div>
            </div>
          )}

          {/* Inline Wizard */}
          {overlayWizard && (
            <InlineWizard
              wizard={overlayWizard}
              onClose={() => setOverlayWizard(null)}
              updateSetting={updateSetting}
              selectedGame={selectedGame}
              selectedGameId={selectedGameId}
              setGames={setGames}
            />
          )}

          {!overlayWizard && !hasGame ? (
            /* No game guidance */
            <NoGameGuide />
          ) : !overlayWizard ? (
            <>
              <p className="text-[10px] font-medium mb-2">Quick Actions</p>
              <div className="grid grid-cols-2 gap-2">
                <ActionTile
                  icon={<Camera className="size-5 text-sky-400" />}
                  label="Take Screenshot"
                  desc="Capture current screen"
                  onClick={handleScreenshot}
                  loading={screenshotBusy}
                />
                <ActionTile
                  icon={<Archive className="size-5 text-emerald-400" />}
                  label="Quick Backup"
                  desc="Backup current game saves"
                  onClick={handleQuickBackup}
                  loading={backupBusy}
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

              {/* Config status hints */}
              {selectedGame && (
                <div className="mt-3 space-y-0.5">
                  {!settings.screenshots_directory && (
                    <button
                      className="w-full flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-left hover:bg-amber-500/10 transition-colors cursor-pointer"
                      onClick={() => setOverlayWizard("screenshot-dir")}
                    >
                      <Info className="size-3 text-amber-400 shrink-0" />
                      <p className="text-[8px] text-amber-300/80">Set screenshots directory to enable captures</p>
                    </button>
                  )}
                  {!settings.backup_directory && (
                    <button
                      className="w-full flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-left hover:bg-amber-500/10 transition-colors cursor-pointer"
                      onClick={() => setOverlayWizard("backup-dir")}
                    >
                      <Info className="size-3 text-amber-400 shrink-0" />
                      <p className="text-[8px] text-amber-300/80">Set backup directory to enable quick backups</p>
                    </button>
                  )}
                  {selectedGame.save_paths.length === 0 && (
                    <button
                      className="w-full flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-left hover:bg-amber-500/10 transition-colors cursor-pointer"
                      onClick={() => setOverlayWizard("save-paths")}
                    >
                      <Info className="size-3 text-amber-400 shrink-0" />
                      <p className="text-[8px] text-amber-300/80">Configure save path for backups & restores</p>
                    </button>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ─── Inline Setup Wizard ──────────────────────────────────── */

function InlineWizard({
  wizard,
  onClose,
  updateSetting,
  selectedGame,
  selectedGameId,
  setGames,
}: {
  wizard: "game" | "screenshot-dir" | "backup-dir" | "save-paths";
  onClose: () => void;
  updateSetting: (key: string, value: string) => Promise<void>;
  selectedGame: Game | null;
  selectedGameId: string | null;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
}) {
  const [picking, setPicking] = useState(false);
  const [savePathInput, setSavePathInput] = useState("");

  const pickDirectory = async (settingKey: string) => {
    setPicking(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: wizard === "screenshot-dir" ? "Select Screenshots Folder" : "Select Backup Folder" });
      if (dir) {
        await updateSetting(settingKey, dir as string);
        toast.success("Directory configured!");
        onClose();
      }
    } catch (err) {
      toast.error(`Failed to pick directory: ${err}`);
    } finally {
      setPicking(false);
    }
  };

  const handleSavePath = async () => {
    if (!savePathInput.trim() || !selectedGameId) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const path = savePathInput.trim();
      // Get current save_paths, append the new one
      const current = selectedGame?.save_paths || [];
      const updated = [...current, path];
      await conn.execute("UPDATE games SET save_paths = $1, updated_at = datetime('now') WHERE id = $2", [
        JSON.stringify(updated),
        selectedGameId,
      ]);
      setGames((prev) =>
        prev.map((g) => (g.id === selectedGameId ? { ...g, save_paths: updated } : g))
      );
      toast.success("Save path configured!");
      onClose();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const pickSavePath = async () => {
    setPicking(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: "Select Save Files Location" });
      if (dir) setSavePathInput(dir as string);
    } catch (err) {
      toast.error(`${err}`);
    } finally {
      setPicking(false);
    }
  };

  if (wizard === "game") {
    return (
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-center animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="size-10 rounded-full bg-sky-500/15 flex items-center justify-center mx-auto mb-2.5">
          <Gamepad2 className="size-5 text-sky-400" />
        </div>
        <p className="text-[11px] font-semibold text-white mb-1">Select a Game First</p>
        <p className="text-[8px] text-white/50 leading-relaxed mb-3 max-w-52 mx-auto">
          Use the game dropdown on the left panel to pick a game, or launch a game and it will be auto-detected.
        </p>
        <div className="flex items-center gap-1.5 justify-center text-[7px] text-white/30">
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">← Select from dropdown</span>
          <span>or</span>
          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Launch a game</span>
        </div>
        <button
          className="mt-3 text-[8px] text-white/40 hover:text-white/60 transition-colors"
          onClick={onClose}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (wizard === "screenshot-dir") {
    return (
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="size-9 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0">
            <Camera className="size-4 text-sky-400" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-white">Configure Screenshots</p>
            <p className="text-[8px] text-white/40">Choose where to save screenshot captures</p>
          </div>
        </div>
        <button
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-2 text-[9px] font-medium text-sky-300 transition-colors disabled:opacity-50"
          onClick={() => pickDirectory("screenshots_directory")}
          disabled={picking}
        >
          {picking ? <Loader2 className="size-3 animate-spin" /> : <FolderInput className="size-3" />}
          {picking ? "Selecting..." : "Choose Folder"}
        </button>
        <button
          className="mt-2 w-full text-[8px] text-white/30 hover:text-white/50 transition-colors"
          onClick={onClose}
        >
          Skip for now
        </button>
      </div>
    );
  }

  if (wizard === "backup-dir") {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="size-9 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Archive className="size-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-white">Configure Backups</p>
            <p className="text-[8px] text-white/40">Choose where to store game save backups</p>
          </div>
        </div>
        <button
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 text-[9px] font-medium text-emerald-300 transition-colors disabled:opacity-50"
          onClick={() => pickDirectory("backup_directory")}
          disabled={picking}
        >
          {picking ? <Loader2 className="size-3 animate-spin" /> : <FolderInput className="size-3" />}
          {picking ? "Selecting..." : "Choose Folder"}
        </button>
        <button
          className="mt-2 w-full text-[8px] text-white/30 hover:text-white/50 transition-colors"
          onClick={onClose}
        >
          Skip for now
        </button>
      </div>
    );
  }

  if (wizard === "save-paths") {
    return (
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="size-9 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0">
            <FolderOpen className="size-4 text-violet-400" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-white">Configure Save Path</p>
            <p className="text-[8px] text-white/40">
              Set the save file location for {selectedGame?.name || "this game"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 mb-2">
          <input
            value={savePathInput}
            onChange={(e) => setSavePathInput(e.target.value)}
            placeholder="C:\Users\...\SaveGames"
            className="flex-1 h-7 px-2 text-[9px] bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/25 outline-none focus:border-violet-500/40 transition-colors select-text"
          />
          <button
            className="h-7 px-2 rounded-md border border-white/10 bg-white/5 text-[8px] text-white/50 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 shrink-0"
            onClick={pickSavePath}
            disabled={picking}
          >
            {picking ? <Loader2 className="size-3 animate-spin" /> : "Browse"}
          </button>
        </div>
        <button
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 px-3 py-1.5 text-[9px] font-medium text-violet-300 transition-colors disabled:opacity-50"
          onClick={handleSavePath}
          disabled={!savePathInput.trim()}
        >
          <CheckCircle2 className="size-3" /> Save Path
        </button>
        <button
          className="mt-2 w-full text-[8px] text-white/30 hover:text-white/50 transition-colors"
          onClick={onClose}
        >
          Skip for now
        </button>
      </div>
    );
  }

  return null;
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
  loading = false,
  className: extraClassName,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <button
      className={cn(
        "size-7 flex items-center justify-center rounded-md transition-all",
        disabled || loading
          ? "opacity-25 cursor-not-allowed"
          : "text-white/50 hover:text-white hover:bg-white/10 active:scale-95",
        extraClassName
      )}
      onClick={disabled || loading ? undefined : () => void onClick()}
      title={title}
    >
      {loading ? <Loader2 className="size-3 animate-spin" /> : icon}
    </button>
  );
}

function ActionTile({
  icon,
  label,
  desc,
  onClick,
  disabled = false,
  loading = false,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 text-left transition-all",
        disabled || loading
          ? "opacity-30 cursor-not-allowed"
          : "hover:bg-white/[0.08] active:scale-[0.98]"
      )}
      onClick={disabled || loading ? undefined : () => void onClick()}
    >
      <div className="shrink-0 mt-0.5">
        {loading ? <Loader2 className="size-5 text-white/50 animate-spin" /> : icon}
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold">{loading ? `${label}...` : label}</p>
        <p className="text-[7px] text-white/40">{loading ? "Please wait..." : desc}</p>
      </div>
    </button>
  );
}
