import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Game, AppSettings } from "@/types";
import { invoke } from "@tauri-apps/api/core";

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
  ai_model: "openai/gpt-4o-mini",
  overlay_shortcut: "Ctrl+Shift+G",
  screenshot_shortcut: "F12",
  quick_backup_shortcut: "Ctrl+Shift+B",
  setup_complete: false,
  auto_backup_enabled: false,
  auto_backup_interval_minutes: 30,
  max_backups_per_game: 10,
  compress_backups: true,
  notify_backup_complete: true,
  launch_on_startup: false,
  minimize_to_tray: true,
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
      } catch (err) {
        console.error("Failed to load settings:", err);
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

  const updateSetting = useCallback(
    async (key: string, value: string) => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        await conn.execute(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))",
          [key, value]
        );
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
