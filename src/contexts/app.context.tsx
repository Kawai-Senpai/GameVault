import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Game, GameEntry, AppSettings } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

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
  ai_model: "openai/gpt-4o:online",
  overlay_shortcut: "Ctrl+Shift+G",
  screenshot_shortcut: "F12",
  quick_backup_shortcut: "Ctrl+Shift+B",
  setup_complete: false,
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
    const loadGames = async () => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");

        const rows = (await conn.select("SELECT * FROM games ORDER BY is_favorite DESC, name ASC")) as Record<
          string,
          unknown
        >[];

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
      } finally {
        setIsLoading(false);
      }
    };
    loadGames();
  }, []);

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
        if (!resp.ok) return; // silent fail — not critical

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

          // New game entry — insert it
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
          console.log(`[GameVault] Synced ${added} new game(s) from remote database`);
        }
      } catch (err) {
        // Silent — this is a background enhancement, not critical
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

          await conn.execute(
            `INSERT INTO backups (id, game_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
            [
              result.backup_id,
              game.id,
              `Auto Backup ${new Date().toLocaleString()}`,
              result.file_path,
              result.file_size,
              result.compressed_size,
              result.content_hash,
              expanded,
            ]
          );

          // Only prune auto-created backups — manual/overlay backups are never auto-deleted
          const autoRows = (await conn.select(
            "SELECT id, file_path FROM backups WHERE game_id = $1 AND display_name LIKE '%Auto%' ORDER BY created_at DESC",
            [game.id]
          )) as Array<{ id: string; file_path: string }>;
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

  useEffect(() => {
    const resolveGame = () => {
      if (selectedGameId) {
        const selected = games.find((g) => g.id === selectedGameId);
        if (selected) return selected;
      }
      return games.find((g) => g.save_paths.length > 0) || games[0] || null;
    };

    const onQuickBackup = async () => {
      const game = resolveGame();
      if (!game) return toast.error("No game available for quick backup");
      if (!settings.backup_directory) return toast.error("Set backup directory in Settings");
      if (!game.save_paths.length) return toast.error(`No save path configured for ${game.name}`);

      const toastId = toast.loading(`Quick backup: ${game.name}`);
      try {
        const expanded = await invoke<string>("expand_env_path", { path: game.save_paths[0] });
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
          displayName: `Tray Backup ${new Date().toLocaleTimeString()}`,
          collectionId: null,
          checkDuplicates: true,
        });

        if (!result.skipped_duplicate) {
          const db = await import("@tauri-apps/plugin-sql");
          const conn = await db.default.load("sqlite:gamevault.db");
          await conn.execute(
            `INSERT INTO backups (id, game_id, display_name, file_path, file_size, compressed_size, content_hash, source_path, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'))`,
            [
              result.backup_id,
              game.id,
              `Tray Backup ${new Date().toLocaleTimeString()}`,
              result.file_path,
              result.file_size,
              result.compressed_size,
              result.content_hash,
              expanded,
            ]
          );
        }
        toast.success(result.message, { id: toastId });
      } catch (err) {
        toast.error(`Quick backup failed: ${err}`, { id: toastId });
      }
    };

    const onTakeScreenshot = async () => {
      const game = resolveGame();
      if (!game) return toast.error("No game available for screenshot");
      if (!settings.screenshots_directory) return toast.error("Set screenshots directory in Settings");

      const toastId = toast.loading(`Capturing screenshot: ${game.name}`);
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
          `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
          [
            result.id,
            game.id,
            result.file_path,
            result.thumbnail_path,
            result.width,
            result.height,
            result.file_size,
          ]
        );
        toast.success("Screenshot captured", { id: toastId });
      } catch (err) {
        toast.error(`Screenshot failed: ${err}`, { id: toastId });
      }
    };

    let unlistenBackup: (() => void) | null = null;
    let unlistenScreenshot: (() => void) | null = null;
    listen("tray-quick-backup", onQuickBackup).then((fn) => {
      unlistenBackup = fn;
    });
    listen("tray-take-screenshot", onTakeScreenshot).then((fn) => {
      unlistenScreenshot = fn;
    });

    return () => {
      unlistenBackup?.();
      unlistenScreenshot?.();
    };
  }, [
    games,
    selectedGameId,
    settings.backup_directory,
    settings.screenshots_directory,
  ]);

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
              updated.ai_model = "openai/gpt-4o:online";
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
