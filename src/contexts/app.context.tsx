import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Game, GameEntry, AppSettings, KeyMapping, Macro } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useKeyEngine } from "@/lib/useKeyEngine";

const normalizePath = (v: string | null | undefined) =>
  (v || "").replace(/\//g, "\\").toLowerCase().trim();

const toLocalDay = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const PLAYTIME_POLL_MS = 3000;
const PLAYTIME_END_GRACE_MS = 15000;
const PLAYTIME_FLUSH_MS = 30000; // Flush playtime to DB every 30s while game is running
const MIN_SESSION_SECONDS = 5;

export interface AutoBackupStatus {
  running: boolean;
  current: number;
  total: number;
  message: string;
  lastRunAt: string | null;
}

interface AppContextValue {
  // Games
  games: Game[];
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  selectedGame: Game | null;
  refreshGames: () => Promise<void>;

  // Settings
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  updateSetting: (key: string, value: string) => Promise<void>;

  // State
  isLoading: boolean;
  setupComplete: boolean;
  setSetupComplete: (v: boolean) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  // Version
  version: string;

  // Auto backup status
  autoBackupStatus: AutoBackupStatus;
}

const defaultSettings: AppSettings = {
  backup_directory: "",
  theme: "dark",
  auto_detect_games: true,
  notifications_enabled: true,
  screenshots_directory: "",
  ai_provider: "openrouter",
  ai_api_key: "",
  ai_openrouter_api_key: "",
  ai_openai_api_key: "",
  ai_model: "openai/gpt-5.2:online",
  overlay_shortcut: "Ctrl+Shift+G",
  screenshot_shortcut: "Ctrl+Shift+S",
  quick_backup_shortcut: "Ctrl+Shift+B",
  setup_complete: false,
  recordings_directory: "",
  recording_fps: 30,
  recording_resolution: "native",
  recording_quality: "medium",
  recording_shortcut: "F9",
  ffmpeg_path: "ffmpeg",
  auto_backup_enabled: true,
  auto_backup_interval_minutes: 1440,
  max_backups_per_game: 10,
  compress_backups: true,
  notify_backup_complete: true,
  launch_on_startup: true,
  minimize_to_tray: true,
  overlay_opacity: 92,
};

const BOOLEAN_KEYS: Set<string> = new Set([
  "auto_detect_games",
  "notifications_enabled",
  "setup_complete",
  "auto_backup_enabled",
  "compress_backups",
  "notify_backup_complete",
  "launch_on_startup",
  "minimize_to_tray",
]);

const NUMBER_KEYS: Set<string> = new Set([
  "auto_backup_interval_minutes",
  "max_backups_per_game",
  "overlay_opacity",
  "recording_fps",
]);

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [version, setVersion] = useState("2.0.0");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [autoBackupStatus, setAutoBackupStatus] = useState<AutoBackupStatus>({
    running: false,
    current: 0,
    total: 0,
    message: "Idle",
    lastRunAt: null,
  });
  const autoBackupLock = useRef(false);
  const lastAutoBackupRunAt = useRef<number>(0);

  // Key mappings & macros state for the key engine
  const [activeKeyMappings, setActiveKeyMappings] = useState<KeyMapping[]>([]);
  const [activeMacros, setActiveMacros] = useState<Macro[]>([]);

  // Reusable games loader
  const refreshGames = useCallback(async () => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select("SELECT * FROM games ORDER BY is_favorite DESC, name ASC")) as Record<string, unknown>[];
      const mapped: Game[] = rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        developer: (r.developer as string) || "",
        steam_appid: r.steam_appid as string | null,
        cover_url: r.cover_url as string | null,
        header_url: r.header_url as string | null,
        custom_cover_path: r.custom_cover_path as string | null,
        custom_header_path: r.custom_header_path as string | null,
        save_paths: JSON.parse((r.save_paths as string) || "[]"),
        extensions: JSON.parse((r.extensions as string) || "[]"),
        notes: (r.notes as string) || "",
        exe_path: r.exe_path as string | null,
        is_custom: Boolean(r.is_custom),
        is_detected: Boolean(r.is_detected),
        is_favorite: Boolean(r.is_favorite),
        auto_backup_disabled: Boolean(r.auto_backup_disabled),
        play_count: (r.play_count as number) || 0,
        total_playtime_seconds: (r.total_playtime_seconds as number) || 0,
        last_played_at: r.last_played_at as string | null,
        added_at: r.added_at as string,
        updated_at: r.updated_at as string,
      }));
      setGames(mapped);
    } catch (err) {
      console.error("Failed to load games:", err);
    }
  }, []);

  // Detect if this is the overlay window (don't run key engine in overlay)
  const isOverlay = typeof window !== "undefined" && (
    window.location.pathname === "/overlay" ||
    new URLSearchParams(window.location.search).get("window") === "overlay"
  );

  // Load active key mappings and macros from DB
  useEffect(() => {
    if (!settingsLoaded || isOverlay) return;
    const loadKeysAndMacros = async () => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");

        const keyRows = (await conn.select(
          "SELECT * FROM key_mappings WHERE is_active = 1"
        )) as KeyMapping[];
        setActiveKeyMappings(keyRows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })));

        const macroRows = (await conn.select(
          "SELECT * FROM macros WHERE is_active = 1"
        )) as Record<string, unknown>[];
        setActiveMacros(
          macroRows.map((r) => ({
            ...r,
            actions: JSON.parse((r.actions as string) || "[]"),
            is_active: Boolean(r.is_active),
          })) as Macro[]
        );
      } catch (err) {
        console.error("Failed to load key mappings/macros:", err);
      }
    };
    loadKeysAndMacros();

    // Re-load when any DB change might have happened (every 5s)
    const timer = window.setInterval(loadKeysAndMacros, 5000);
    return () => window.clearInterval(timer);
  }, [settingsLoaded, isOverlay]);

  // App-level shortcut combos reserved for Rust-side handling (overlay, screenshot, backup, recording)
  const reservedShortcuts = [
    settings.overlay_shortcut,
    settings.screenshot_shortcut,
    settings.quick_backup_shortcut,
    settings.recording_shortcut,
  ].filter(Boolean);

  // Register global shortcuts for active key mappings and macros (excludes reserved shortcuts)
  useKeyEngine(activeKeyMappings, activeMacros, settingsLoaded && !isOverlay, reservedShortcuts);

  // ── Register app-level global shortcuts via Rust ──
  // Sends shortcut config to Rust, which handles registration.
  // Rust fires events back when shortcuts are pressed.
  useEffect(() => {
    if (!settingsLoaded || isOverlay) return;

    let cancelled = false;

    const sendShortcutsToRust = async () => {
      try {
        const { comboToTauriShortcut } = await import("@/lib/keycode-map");
        const bindings = [
          { action: "toggle_overlay", key: comboToTauriShortcut(settings.overlay_shortcut || ""), enabled: !!settings.overlay_shortcut },
          { action: "take_screenshot", key: comboToTauriShortcut(settings.screenshot_shortcut || ""), enabled: !!settings.screenshot_shortcut },
          { action: "quick_backup", key: comboToTauriShortcut(settings.quick_backup_shortcut || ""), enabled: !!settings.quick_backup_shortcut },
          { action: "toggle_recording", key: comboToTauriShortcut(settings.recording_shortcut || ""), enabled: !!settings.recording_shortcut },
        ].filter((b) => b.key.trim().length > 0);

        if (!cancelled) {
          await invoke("update_shortcuts", { config: { bindings } });
        }
      } catch (err) {
        console.warn("[AppShortcuts] Failed to send shortcuts to Rust:", err);
      }
    };

    void sendShortcutsToRust();

    // Cleanup: unregister all app shortcuts when effect re-fires (React strict mode)
    return () => {
      cancelled = true;
      invoke("update_shortcuts", { config: { bindings: [] } }).catch(() => {});
    };
  }, [
    settingsLoaded,
    isOverlay,
    settings.overlay_shortcut,
    settings.screenshot_shortcut,
    settings.quick_backup_shortcut,
    settings.recording_shortcut,
  ]);

  // ── Listen for shortcut events from Rust ──
  // Rust fires "shortcut-triggered" with { action: string }
  // Refs ensure we always use the latest state values.
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const selectedGameIdRef = useRef(selectedGameId);
  selectedGameIdRef.current = selectedGameId;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (isOverlay) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    const setup = async () => {
      const unlistenAction = await listen<{ action: string }>("shortcut-triggered", async (event) => {
        if (cancelled) return;
        const { action } = event.payload;
        const s = settingsRef.current;
        const currentGameId = selectedGameIdRef.current;
        const currentGames = gamesRef.current;

        switch (action) {
          case "take_screenshot": {
            try {
              if (!s.screenshots_directory) { toast.error("Set screenshots directory in Settings first"); return; }
              const base64 = await invoke<string>("capture_screen");
              const result = await invoke<{
                id: string; file_path: string; thumbnail_path: string;
                width: number; height: number; file_size: number;
              }>("save_screenshot_file", {
                screenshotsDir: s.screenshots_directory,
                gameId: currentGameId || "_general",
                base64Data: base64,
                filename: null,
              });
              const db = await import("@tauri-apps/plugin-sql");
              const conn = await db.default.load("sqlite:gamevault.db");
              await conn.execute(
                `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
                [result.id, currentGameId || "_general", result.file_path, result.thumbnail_path, result.width, result.height, result.file_size]
              );
              toast.success("Screenshot captured!");
            } catch (e) { toast.error(`Screenshot failed: ${e}`); }
            break;
          }
          case "quick_backup": {
            const currentGame = currentGames.find((g) => g.id === currentGameId) || null;
            if (!currentGame) { toast.error("Select a game first for quick backup"); return; }
            if (!s.backup_directory) { toast.error("Set backup directory in Settings first"); return; }
            if (currentGame.save_paths.length === 0) { toast.error("No save paths configured for this game"); return; }
            try {
              const toastId = toast.loading("Quick backup...");
              await invoke("create_backup", {
                backupDir: s.backup_directory,
                gameId: currentGame.id,
                gameName: currentGame.name,
                savePath: currentGame.save_paths[0],
                displayName: "Quick backup",
                collectionId: null,
                checkDuplicates: true,
              });
              toast.success("Quick backup done!", { id: toastId });
            } catch (e) { toast.error(`Backup failed: ${e}`); }
            break;
          }
          case "toggle_recording": {
            try {
              const status = await invoke<{ is_recording: boolean }>("get_recording_status");
              if (status.is_recording) {
                const result = await invoke<{
                  id: string; file_path: string; thumbnail_path: string;
                  width: number; height: number; file_size: number;
                  duration_seconds: number;
                }>("stop_recording");
                const db = await import("@tauri-apps/plugin-sql");
                const conn = await db.default.load("sqlite:gamevault.db");
                await conn.execute(
                  `INSERT INTO recordings (id, game_id, file_path, thumbnail_path, width, height, file_size, duration_seconds, fps, recorded_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, datetime('now'))`,
                  [result.id, currentGameId || "_general", result.file_path, result.thumbnail_path,
                   result.width, result.height, result.file_size, result.duration_seconds, s.recording_fps || 30]
                );
                toast.success("Recording saved!");
              } else {
                const recDir = s.recordings_directory || s.screenshots_directory;
                if (!recDir) { toast.error("Set recordings directory in Settings"); return; }
                const ffmpegPath = await invoke<string>("resolve_ffmpeg", { userPath: s.ffmpeg_path || null });
                await invoke<string>("start_recording", {
                  recordingsDir: recDir,
                  gameId: currentGameId || "_general",
                  ffmpegPath,
                  fps: s.recording_fps || 30,
                  resolution: s.recording_resolution === "native" ? null : s.recording_resolution,
                  quality: s.recording_quality || "medium",
                });
                toast.success("Recording started!");
              }
            } catch (e: any) { toast.error(`Recording: ${e}`); }
            break;
          }
          default:
            console.log("[Shortcut] Unknown action:", action);
        }
      });
      cleanups.push(unlistenAction);

      // Listen for registration errors
      const unlistenErrors = await listen<string[]>("shortcut-registration-error", (event) => {
        if (cancelled) return;
        for (const err of event.payload) {
          console.warn("[Shortcut registration]", err);
        }
        if (event.payload.length > 0) {
          const preview = event.payload.slice(0, 2).join(" | ");
          toast.error(`Some shortcuts could not be registered: ${preview}`);
        }
      });
      cleanups.push(unlistenErrors);

      // If cancelled while we were setting up, immediately clean up
      if (cancelled) {
        unlistenAction();
        unlistenErrors();
      }
    };

    void setup();
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [isOverlay]);

  // ── Background game session detection (external launches) ─────────────────
  // Powers:
  // - Playtime tracking (per day + totals)
  // - Notes reminders ("next session" / recurring) when game is detected running
  const dbConnRef = useRef<any>(null);
  const sessionsRef = useRef<
    Map<
      string,
      {
        pid: number;
        exe_path: string;
        started_at_ms: number;
        last_seen_ms: number;
        last_flushed_ms: number;
        flushed_seconds: number; // total seconds already written to DB for this session
        reminder_checked: boolean;
      }
    >
  >(new Map());

  const ensureDbConn = useCallback(async () => {
    if (dbConnRef.current) return dbConnRef.current;
    const db = await import("@tauri-apps/plugin-sql");
    dbConnRef.current = await db.default.load("sqlite:gamevault.db");
    return dbConnRef.current;
  }, []);

  useEffect(() => {
    if (!settingsLoaded || isOverlay) return;
    if (!games.length) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const windows = await invoke<
          Array<{ pid: number; process_name: string; exe_path: string; title: string; is_foreground: boolean }>
        >("list_running_windows");
        const now = Date.now();

        // Build lookups of exe_path -> window and title/process_name -> window
        const exeToPid = new Map<string, { pid: number; exe_path: string; is_foreground: boolean }>();
        for (const w of windows) {
          const exe = normalizePath(w.exe_path);
          if (!exe) continue;
          const existing = exeToPid.get(exe);
          if (!existing || (!existing.is_foreground && w.is_foreground)) {
            exeToPid.set(exe, { pid: w.pid, exe_path: exe, is_foreground: w.is_foreground });
          }
        }

        // Match games to running windows
        // Priority 1: exact exe_path match
        // Priority 2: window title or process name contains the game name (fuzzy)
        const seenGameIds = new Set<string>();
        for (const game of games) {
          let matchedWindow: { pid: number; exe_path: string; is_foreground: boolean } | null = null;

          // Try exe_path match first (most accurate)
          const exe = normalizePath(game.exe_path);
          if (exe) {
            const m = exeToPid.get(exe);
            if (m) matchedWindow = m;
          }

          // Fallback: fuzzy match by game name in window title or process name
          if (!matchedWindow && game.name.length >= 3) {
            const gameLower = game.name.toLowerCase();
            for (const w of windows) {
              const titleLower = (w.title || "").toLowerCase();
              const processLower = (w.process_name || "").toLowerCase();
              if (titleLower.includes(gameLower) || processLower.includes(gameLower)) {
                matchedWindow = { pid: w.pid, exe_path: normalizePath(w.exe_path), is_foreground: w.is_foreground };
                break;
              }
            }
          }

          if (!matchedWindow) continue;
          seenGameIds.add(game.id);

          const existing = sessionsRef.current.get(game.id);
          if (!existing) {
            sessionsRef.current.set(game.id, {
              pid: matchedWindow.pid,
              exe_path: matchedWindow.exe_path,
              started_at_ms: now,
              last_seen_ms: now,
              last_flushed_ms: now,
              flushed_seconds: 0,
              reminder_checked: false,
            });

            // Update game metadata immediately (play_count + last_played_at)
            try {
              const conn = await ensureDbConn();
              await conn.execute(
                "UPDATE games SET play_count = play_count + 1, last_played_at = datetime('now'), updated_at = datetime('now') WHERE id = $1",
                [game.id]
              );
            } catch {
              // non-fatal
            }
          } else {
            sessionsRef.current.set(game.id, {
              ...existing,
              pid: matchedWindow.pid,
              last_seen_ms: now,
            });
          }
        }

        // Intermediate flush: write accumulated playtime every PLAYTIME_FLUSH_MS while game runs
        for (const [gameId, session] of sessionsRef.current.entries()) {
          if (!seenGameIds.has(gameId)) continue; // will be handled by session-end below
          if (now - session.last_flushed_ms < PLAYTIME_FLUSH_MS) continue;

          const totalElapsed = Math.round((now - session.started_at_ms) / 1000);
          const delta = totalElapsed - session.flushed_seconds;
          if (delta < 1) continue;

          try {
            const conn = await ensureDbConn();
            const day = toLocalDay(new Date(now));

            await conn.execute(
              "INSERT INTO playtime_daily (game_id, day, duration_seconds, updated_at) VALUES ($1,$2,$3, datetime('now')) ON CONFLICT(game_id, day) DO UPDATE SET duration_seconds = duration_seconds + excluded.duration_seconds, updated_at = datetime('now')",
              [gameId, day, delta]
            );
            await conn.execute(
              "UPDATE games SET total_playtime_seconds = total_playtime_seconds + $1, last_played_at = datetime('now'), updated_at = datetime('now') WHERE id = $2",
              [delta, gameId]
            );

            // Update React state
            setGames((prev) =>
              prev.map((g) =>
                g.id === gameId
                  ? { ...g, total_playtime_seconds: (g.total_playtime_seconds || 0) + delta, last_played_at: new Date(now).toISOString() }
                  : g
              )
            );

            sessionsRef.current.set(gameId, {
              ...session,
              last_flushed_ms: now,
              flushed_seconds: totalElapsed,
            });
          } catch {
            // non-fatal
          }
        }

        // End sessions that have not been seen recently
        for (const [gameId, session] of sessionsRef.current.entries()) {
          if (seenGameIds.has(gameId)) continue;
          if (now - session.last_seen_ms < PLAYTIME_END_GRACE_MS) continue;

          const durationSeconds = Math.round((now - session.started_at_ms) / 1000);
          const remainingSeconds = durationSeconds - session.flushed_seconds; // only write unflushed portion
          sessionsRef.current.delete(gameId);

          if (durationSeconds < MIN_SESSION_SECONDS) continue;

          try {
            const conn = await ensureDbConn();
            const sessionId = crypto.randomUUID();
            const startedAtIso = new Date(session.started_at_ms).toISOString();
            const endedAtIso = new Date(now).toISOString();
            const day = toLocalDay(new Date(now));

            // Write the full session record (for history)
            await conn.execute(
              "INSERT INTO play_sessions (id, game_id, pid, exe_path, started_at, ended_at, duration_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7)",
              [
                sessionId,
                gameId,
                session.pid,
                session.exe_path,
                startedAtIso,
                endedAtIso,
                durationSeconds,
              ]
            );

            // Only write the remaining unflushed time to daily + total
            if (remainingSeconds > 0) {
              await conn.execute(
                "INSERT INTO playtime_daily (game_id, day, duration_seconds, updated_at) VALUES ($1,$2,$3, datetime('now')) ON CONFLICT(game_id, day) DO UPDATE SET duration_seconds = duration_seconds + excluded.duration_seconds, updated_at = datetime('now')",
                [gameId, day, remainingSeconds]
              );

              await conn.execute(
                "UPDATE games SET total_playtime_seconds = total_playtime_seconds + $1, updated_at = datetime('now') WHERE id = $2",
                [remainingSeconds, gameId]
              );

              // Update React state with only the remaining delta
              setGames((prev) =>
                prev.map((g) =>
                  g.id === gameId
                    ? {
                        ...g,
                        total_playtime_seconds: (g.total_playtime_seconds || 0) + remainingSeconds,
                        last_played_at: endedAtIso,
                      }
                    : g
                )
              );
            }
          } catch (err) {
            console.error("Failed to persist play session:", err);
          }
        }

        // Reminder checks (run once per session start)
        for (const [gameId, session] of sessionsRef.current.entries()) {
          if (session.reminder_checked) continue;
          session.reminder_checked = true;
          sessionsRef.current.set(gameId, session);

          try {
            const conn = await ensureDbConn();
            const due = (await conn.select(
              `SELECT id, title FROM game_notes
               WHERE game_id = $1 AND reminder_enabled = 1 AND is_dismissed = 0
                 AND (
                   remind_next_session = 1
                   OR (
                     recurring_days IS NOT NULL
                     AND (last_reminded_at IS NULL OR (julianday('now') - julianday(last_reminded_at)) >= recurring_days)
                   )
                 )
               ORDER BY updated_at DESC
               LIMIT 5`,
              [gameId]
            )) as Array<{ id: string; title: string }>;

            if (due.length > 0 && settings.notifications_enabled) {
              const gameName = games.find((g) => g.id === gameId)?.name || "Game";
              try {
                sendNotification({
                  title: `Reminder · ${gameName}`,
                  body: due.map((n) => `• ${n.title}`).join("\n"),
                });
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // silent
      }
    };

    const timer = window.setInterval(poll, PLAYTIME_POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ensureDbConn, games, isOverlay, settings.notifications_enabled, settingsLoaded]);

  const selectedGame = games.find((g) => g.id === selectedGameId) || null;

  // Load version
  useEffect(() => {
    invoke<string>("get_version")
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Load settings from SQLite
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");

        const rows = (await conn.select("SELECT key, value FROM settings")) as {
          key: string;
          value: string;
        }[];

        const loaded = { ...defaultSettings };
        for (const row of rows) {
          const key = row.key as keyof AppSettings;
          if (key in loaded) {
            if (BOOLEAN_KEYS.has(key)) {
              (loaded as unknown as Record<string, unknown>)[key] = row.value === "true" || row.value === "1";
            } else if (NUMBER_KEYS.has(key)) {
              (loaded as unknown as Record<string, unknown>)[key] = parseInt(row.value) || (defaultSettings as unknown as Record<string, unknown>)[key];
            } else {
              (loaded as unknown as Record<string, unknown>)[key] = row.value;
            }
          }
        }

        // Compute ai_api_key from active provider's key
        if (loaded.ai_provider === "openai") {
          loaded.ai_api_key = loaded.ai_openai_api_key;
        } else {
          loaded.ai_api_key = loaded.ai_openrouter_api_key;
        }

        setSettings(loaded);
        setSetupComplete(loaded.setup_complete);
        setSettingsLoaded(true);
      } catch (err) {
        console.error("Failed to load settings:", err);
        setSettingsLoaded(true);
      }
    };
    loadSettings();
  }, []);

  // Load games from SQLite
  useEffect(() => {
    refreshGames().finally(() => setIsLoading(false));
  }, [refreshGames]);

  // ── Background sync: fetch game database from GitHub and merge new entries ──
  useEffect(() => {
    if (isLoading) return; // wait until local games are loaded first
    const REMOTE_URL =
      "https://raw.githubusercontent.com/Kawai-Senpai/GameVault/main/src/data/games.json";

    const syncGameDatabase = async () => {
      try {
        const resp = await tauriFetch(REMOTE_URL, {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!resp.ok) return; // silent fail - not critical

        const data = (await resp.json()) as { games?: GameEntry[] };
        if (!data?.games?.length) return;

        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");

        // Get all existing game IDs from DB
        const existing = (await conn.select("SELECT id FROM games")) as Array<{ id: string }>;
        const existingIds = new Set(existing.map((r) => r.id));

        let added = 0;
        for (const entry of data.games) {
          if (existingIds.has(entry.id)) {
            // Update cover_url, header_url, and save_paths for existing entries
            // (so new URLs and paths propagate without requiring an app update)
            await conn.execute(
              `UPDATE games SET
                cover_url = COALESCE(NULLIF($1, ''), cover_url),
                header_url = COALESCE(NULLIF($2, ''), header_url),
                save_paths = CASE WHEN save_paths = '[]' THEN $3 ELSE save_paths END,
                updated_at = datetime('now')
              WHERE id = $4 AND is_custom = 0`,
              [
                entry.cover_url || "",
                entry.header_url || "",
                JSON.stringify(entry.save_paths || []),
                entry.id,
              ]
            );
            continue;
          }

          // New game entry - insert it
          await conn.execute(
            `INSERT INTO games (id, name, developer, steam_appid, cover_url, header_url, save_paths, extensions, notes, is_custom, is_detected, added_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, datetime('now'), datetime('now'))`,
            [
              entry.id,
              entry.name,
              entry.developer || "",
              entry.steam_appid || null,
              entry.cover_url || null,
              entry.header_url || null,
              JSON.stringify(entry.save_paths || []),
              JSON.stringify(entry.extensions || []),
              entry.notes || "",
            ]
          );
          added += 1;
        }

        if (added > 0) {
          // Reload games from DB so UI reflects the new additions
          await refreshGames();
          console.log(`[GameVault] Synced ${added} new game(s) from remote database`);
        }
      } catch (err) {
        // Silent - this is a background enhancement, not critical
        console.debug("[GameVault] Remote game sync skipped:", err);
      }
    };

    syncGameDatabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke("set_launch_on_startup", { enabled: settings.launch_on_startup }).catch(() => {
      // Unsupported platform or unavailable permission.
    });
  }, [settings.launch_on_startup, settingsLoaded]);

  // Auto-scan backup directory on startup to reconcile on-disk backups with DB
  useEffect(() => {
    if (!settingsLoaded || !settings.backup_directory || games.length === 0) return;
    const reconcileBackups = async () => {
      try {
        interface ScannedBackup {
          id: string;
          game_id: string;
          game_name: string;
          display_name: string;
          collection_id: string | null;
          source_path: string;
          backup_time: string;
          content_hash: string;
          file_count: number;
          file_size: number;
          compressed_size: number;
          file_path: string;
        }
        const discovered = await invoke<ScannedBackup[]>("scan_backup_directory", {
          backupDir: settings.backup_directory,
        });
        if (discovered.length === 0) return;

        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        let imported = 0;

        for (const backup of discovered) {
          // Skip if already in DB
          const existing = (await conn.select(
            "SELECT id FROM backups WHERE id = $1 OR file_path = $2",
            [backup.id, backup.file_path]
          )) as Array<{ id: string }>;
          if (existing.length > 0) continue;

          // Skip if game not in DB
          const gameExists = (await conn.select(
            "SELECT id FROM games WHERE id = $1",
            [backup.game_id]
          )) as Array<{ id: string }>;
          if (gameExists.length === 0) continue;

          await conn.execute(
            `INSERT INTO backups (id, game_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              backup.id,
              backup.game_id,
              backup.display_name || `Recovered: ${backup.game_name}`,
              backup.file_path,
              backup.file_size,
              backup.compressed_size,
              backup.content_hash,
              backup.source_path,
              backup.backup_time,
            ]
          );
          imported += 1;
        }

        if (imported > 0) {
          console.log(`Auto-reconciled ${imported} backup(s) from disk`);
        }
      } catch (err) {
        console.error("Backup reconciliation failed:", err);
      }
    };
    reconcileBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, settings.backup_directory, games.length]);

  const runAutoBackup = useCallback(async () => {
    if (!settingsLoaded) return;
    if (!settings.auto_backup_enabled) return;
    if (!settings.backup_directory) return;
    if (autoBackupLock.current) return;

    const intervalMs = Math.max(5, settings.auto_backup_interval_minutes) * 60_000;
    if (Date.now() - lastAutoBackupRunAt.current < intervalMs) return;

    const candidates = games.filter((game) => game.save_paths.length > 0 && !game.auto_backup_disabled);
    if (!candidates.length) return;

    autoBackupLock.current = true;
    setAutoBackupStatus({
      running: true,
      current: 0,
      total: candidates.length,
      message: "Running auto-backup...",
      lastRunAt: autoBackupStatus.lastRunAt,
    });

    let created = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      for (let i = 0; i < candidates.length; i++) {
        const game = candidates[i];
        setAutoBackupStatus((prev) => ({
          ...prev,
          current: i + 1,
          message: `Backing up ${game.name}...`,
        }));

        try {
          const expanded = await invoke<string>("expand_env_path", {
            path: game.save_paths[0],
          });
          const exists = await invoke<boolean>("check_path_exists", {
            path: game.save_paths[0],
          });
          if (!exists) {
            skipped += 1;
            continue;
          }

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
            savePath: expanded,
            displayName: `Auto Backup ${new Date().toLocaleString()}`,
            collectionId: null,
            checkDuplicates: true,
          });

          if (result.skipped_duplicate) {
            skipped += 1;
            continue;
          }

          // Get or create an "Auto Backup" collection for this game
          let autoCollId: string | null = null;
          try {
            const collRows = (await conn.select(
              "SELECT id FROM backup_collections WHERE game_id = $1 AND name = 'Auto Backup'",
              [game.id]
            )) as Array<{ id: string }>;
            if (collRows.length > 0) {
              autoCollId = collRows[0].id;
            } else {
              autoCollId = crypto.randomUUID();
              await conn.execute(
                "INSERT INTO backup_collections (id, game_id, name, max_backups, color) VALUES ($1, $2, 'Auto Backup', $3, '#64748b')",
                [autoCollId, game.id, settings.max_backups_per_game]
              );
            }
          } catch {
            // If collection creation fails, store as uncategorized
          }

          await conn.execute(
            `INSERT INTO backups (id, game_id, collection_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, datetime('now'))`,
            [
              result.backup_id,
              game.id,
              autoCollId,
              `Auto Backup ${new Date().toLocaleString()}`,
              result.file_path,
              result.file_size,
              result.compressed_size,
              result.content_hash,
              expanded,
            ]
          );

          // Prune old auto-backups in this collection
          const pruneQuery = autoCollId
            ? "SELECT id, file_path FROM backups WHERE game_id = $1 AND collection_id = $2 ORDER BY created_at DESC"
            : "SELECT id, file_path FROM backups WHERE game_id = $1 AND display_name LIKE '%Auto%' ORDER BY created_at DESC";
          const pruneParams = autoCollId ? [game.id, autoCollId] : [game.id];
          const autoRows = (await conn.select(pruneQuery, pruneParams)) as Array<{ id: string; file_path: string }>;
          if (autoRows.length > settings.max_backups_per_game) {
            const overflow = autoRows.slice(settings.max_backups_per_game);
            for (const old of overflow) {
              try {
                await invoke("delete_backup", { zipPath: old.file_path });
              } catch {
                // Continue pruning metadata even if file is already missing.
              }
              await conn.execute("DELETE FROM backups WHERE id = $1", [old.id]);
            }
          }

          created += 1;
        } catch (err) {
          console.error(`Auto-backup failed for ${game.name}:`, err);
          failed += 1;
        }
      }

      lastAutoBackupRunAt.current = Date.now();
      const summary = `Auto-backup complete: ${created} new, ${skipped} unchanged, ${failed} failed`;
      setAutoBackupStatus({
        running: false,
        current: candidates.length,
        total: candidates.length,
        message: summary,
        lastRunAt: new Date().toISOString(),
      });
      if (settings.notify_backup_complete) {
        try {
          sendNotification({
            title: "Game Vault",
            body: summary,
          });
        } catch {
          // Notification may be blocked.
        }
      }
    } finally {
      autoBackupLock.current = false;
    }
  }, [
    autoBackupStatus.lastRunAt,
    games,
    settings.auto_backup_enabled,
    settings.auto_backup_interval_minutes,
    settings.backup_directory,
    settings.max_backups_per_game,
    settings.notify_backup_complete,
    settingsLoaded,
  ]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setInterval(() => {
      void runAutoBackup();
    }, 30_000);
    void runAutoBackup();
    return () => window.clearInterval(timer);
  }, [runAutoBackup, settingsLoaded]);

  // ── Auto-update check: on startup (10s delay) + every 24 hours ──
  useEffect(() => {
    if (!settingsLoaded || isOverlay) return;

    const checkForUpdate = async () => {
      try {
        const result = await invoke<{
          current_version: string;
          latest_version: string;
          update_available: boolean;
          release_url: string;
          download_url: string;
          download_size: number;
        }>("check_for_updates");

        if (result.update_available) {
          toast.info(
            `Update available: v${result.latest_version}`,
            {
              description: "A new version of GameVault is available. Go to Settings → check for updates to install it.",
              duration: 15000,
              action: {
                label: "Open Settings",
                onClick: () => {
                  // Navigate to settings if possible
                  window.location.hash = "#/settings";
                  window.dispatchEvent(new CustomEvent("navigate-to-settings"));
                },
              },
            }
          );
        }
      } catch {
        // Silent - don't bother the user if the update check fails
      }
    };

    // Check after 10 second delay (let the app fully load first)
    const startupTimer = window.setTimeout(checkForUpdate, 10_000);
    // Re-check every 24 hours while the app is running
    const recurringTimer = window.setInterval(checkForUpdate, 24 * 60 * 60 * 1000);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(recurringTimer);
    };
  }, [settingsLoaded, isOverlay]);

  // Tray menu actions are now handled via Rust shortcuts module
  // (tray.rs routes through shortcuts::handle_shortcut_action -> "shortcut-triggered" event)
  // The shortcut-triggered listener above handles all actions.

  const updateSetting = useCallback(
    async (key: string, value: string) => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))",
          [key, value]
        );

        if (key === "launch_on_startup") {
          try {
            await invoke("set_launch_on_startup", {
              enabled: value === "true" || value === "1",
            });
          } catch (err) {
            console.error("Failed to set startup behavior:", err);
          }
        }

        setSettings((prev) => {
          const updated = { ...prev };
          if (BOOLEAN_KEYS.has(key)) {
            (updated as unknown as Record<string, unknown>)[key] = value === "true" || value === "1";
          } else if (NUMBER_KEYS.has(key)) {
            (updated as unknown as Record<string, unknown>)[key] = parseInt(value) || (defaultSettings as unknown as Record<string, unknown>)[key];
          } else {
            (updated as unknown as Record<string, unknown>)[key] = value;
          }

          // Recompute ai_api_key when provider or provider keys change
          if (key === "ai_provider") {
            updated.ai_api_key = value === "openai" ? updated.ai_openai_api_key : updated.ai_openrouter_api_key;
            // Set sensible default model when switching providers
            if (value === "openai" && updated.ai_model.includes("/")) {
              updated.ai_model = "gpt-5.2";
            } else if (value === "openrouter" && !updated.ai_model.includes("/")) {
              updated.ai_model = "openai/gpt-5.2:online";
            }
          } else if (key === "ai_openrouter_api_key" && updated.ai_provider === "openrouter") {
            updated.ai_api_key = value;
          } else if (key === "ai_openai_api_key" && updated.ai_provider === "openai") {
            updated.ai_api_key = value;
          }

          return updated;
        });
      } catch (err) {
        console.error("Failed to update setting:", err);
      }
    },
    []
  );

  return (
    <AppContext.Provider
      value={{
        games,
        setGames,
        selectedGameId,
        setSelectedGameId,
        selectedGame,
        refreshGames,
        settings,
        setSettings,
        updateSetting,
        isLoading,
        setupComplete,
        setSetupComplete,
        sidebarCollapsed,
        setSidebarCollapsed,
        version,
        autoBackupStatus,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
