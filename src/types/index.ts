// ─── Game Types ──────────────────────────────────────────────

export interface GameEntry {
  id: string;
  name: string;
  developer: string;
  steam_appid: string | null;
  cover_url: string | null;
  header_url: string | null;
  save_paths: string[];
  extensions: string[];
  notes: string;
}

export interface GameDatabase {
  games: GameEntry[];
}

export interface Game {
  id: string;
  name: string;
  developer: string;
  steam_appid: string | null;
  cover_url: string | null;
  header_url: string | null;
  custom_cover_path: string | null;
  custom_header_path: string | null;
  save_paths: string[];
  extensions: string[];
  notes: string;
  exe_path: string | null;
  is_custom: boolean;
  is_detected: boolean;
  is_favorite: boolean;
  auto_backup_disabled: boolean;
  play_count: number;
  total_playtime_seconds: number;
  last_played_at: string | null;
  added_at: string;
  updated_at: string;
}

// ─── Backup Types ────────────────────────────────────────────

export interface BackupCollection {
  id: string;
  game_id: string;
  name: string;
  description: string;
  max_backups: number;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Backup {
  id: string;
  game_id: string;
  collection_id: string | null;
  display_name: string;
  file_path: string;
  file_size: number;
  compressed_size: number;
  content_hash: string;
  source_path: string;
  created_at: string;
  notes: string;
}

export interface BackupResult {
  success: boolean;
  backup_id: string;
  file_path: string;
  file_size: number;
  compressed_size: number;
  content_hash: string;
  skipped_duplicate: boolean;
  message: string;
}

export interface RestoreResult {
  success: boolean;
  files_restored: number;
  message: string;
}

// ─── Screenshot Types ────────────────────────────────────────

export interface Screenshot {
  id: string;
  game_id: string;
  file_path: string;
  thumbnail_path: string | null;
  title: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  file_size: number;
  captured_at: string;
}

// ─── Key Mapping Types ───────────────────────────────────────

export interface KeyMapping {
  id: string;
  game_id: string | null;
  name: string;
  description: string;
  source_key: string;
  target_key: string;
  is_active: boolean;
  created_at: string;
}

// ─── Macro Types ─────────────────────────────────────────────

export interface MacroAction {
  type: "key_press" | "key_release" | "key_tap" | "delay";
  key_code?: number;
  key_name?: string;
  delay_ms?: number;
}

export interface Macro {
  id: string;
  game_id: string | null;
  name: string;
  description: string;
  trigger_key: string;
  actions: MacroAction[];
  delay_ms: number;
  repeat_count: number;
  is_active: boolean;
  created_at: string;
}

// ─── Shortcut Types ──────────────────────────────────────────

export interface Shortcut {
  id: string;
  action_id: string;
  label: string;
  description: string;
  keys: string;
  is_global: boolean;
  is_active: boolean;
  category: string;
}

// ─── Settings Types ──────────────────────────────────────────

export interface AppSettings {
  backup_directory: string;
  theme: "light" | "dark" | "system";
  auto_detect_games: boolean;
  notifications_enabled: boolean;
  screenshots_directory: string;
  ai_provider: string;
  ai_api_key: string; // computed from active provider
  ai_openrouter_api_key: string;
  ai_openai_api_key: string;
  ai_model: string;
  overlay_shortcut: string;
  screenshot_shortcut: string;
  quick_backup_shortcut: string;
  setup_complete: boolean;

  // Backup settings
  auto_backup_enabled: boolean;
  auto_backup_interval_minutes: number;
  max_backups_per_game: number;
  compress_backups: boolean;

  // Notification settings
  notify_backup_complete: boolean;
  launch_on_startup: boolean;
  minimize_to_tray: boolean;

  // Overlay
  overlay_opacity: number; // 0-100 (percent)
}

// ─── AI Types ────────────────────────────────────────────────

export interface AiConversation {
  id: string;
  game_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  image_paths: string[];
  created_at: string;
}

// ─── Detected Game ───────────────────────────────────────────

export interface DetectedGame {
  id: string;
  name: string;
  developer: string;
  steam_appid: string | null;
  cover_url: string | null;
  header_url: string | null;
  save_paths: string[];
  resolved_save_path: string;
  extensions: string[];
  notes: string;
  save_size: number;
}

// ─── Game Note Types ─────────────────────────────────────────

export interface GameNote {
  id: string;
  game_id: string;
  title: string;
  content: string;
  color: string;
  is_pinned: boolean;
  // Tags
  tags: string[];
  is_archived: boolean;
  // Reminders
  reminder_enabled: boolean;
  remind_next_session: boolean;
  remind_at: string | null;
  recurring_days: number | null;
  last_reminded_at: string | null;
  last_shown_at: string | null;
  is_dismissed: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Playtime Types ─────────────────────────────────────────

export interface PlaySession {
  id: string;
  game_id: string;
  pid: number | null;
  exe_path: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  created_at: string;
}

export interface PlaytimeDailyPoint {
  game_id: string;
  day: string; // YYYY-MM-DD
  duration_seconds: number;
  updated_at: string;
}
