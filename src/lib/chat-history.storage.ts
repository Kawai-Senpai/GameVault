const CHAT_HISTORY_DB_KEY = "ai_chat_history_json";
const CHAT_ACTIVE_DB_KEY = "ai_chat_active_conversation_id";

export interface SharedChatHistoryState {
  historyJson: string | null;
  activeConversationId: string | null;
}

export async function loadSharedChatHistory(): Promise<SharedChatHistoryState> {
  try {
    const db = await import("@tauri-apps/plugin-sql");
    const conn = await db.default.load("sqlite:gamevault.db");
    const rows = (await conn.select(
      "SELECT key, value FROM settings WHERE key IN ($1, $2)",
      [CHAT_HISTORY_DB_KEY, CHAT_ACTIVE_DB_KEY]
    )) as Array<{ key: string; value: string }>;

    const map = new Map<string, string>();
    rows.forEach((row) => map.set(row.key, row.value));

    return {
      historyJson: map.get(CHAT_HISTORY_DB_KEY) || null,
      activeConversationId: map.get(CHAT_ACTIVE_DB_KEY) || null,
    };
  } catch {
    return {
      historyJson: null,
      activeConversationId: null,
    };
  }
}

export async function saveSharedChatHistory(
  historyJson: string,
  activeConversationId: string
): Promise<void> {
  try {
    const db = await import("@tauri-apps/plugin-sql");
    const conn = await db.default.load("sqlite:gamevault.db");

    await conn.execute(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))",
      [CHAT_HISTORY_DB_KEY, historyJson]
    );
    await conn.execute(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))",
      [CHAT_ACTIVE_DB_KEY, activeConversationId]
    );
  } catch {
  }
}
