/**
 * GameVault AI Chat History - SQLite-backed CRUD layer.
 * Mirrors the GodVision pattern: proper relational storage with
 * conversations + messages tables, shared between main app & overlay.
 */
import { getDatabase } from "./config";

// ─── Types ────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  images?: AttachedImage[];
  metadata?: MessageMetadata;
}

export interface AttachedImage {
  id: string;
  name: string;
  base64: string;
  size: number;
}

export interface MessageMetadata {
  reasoning?: string;
  reasoningDetails?: unknown[];
  toolCalls?: unknown[];
  usage?: unknown;
  finishReason?: string;
  providerMessageId?: string;
  webSearchEnabled?: boolean;
  webSearchUsed?: boolean;
  gameContext?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: "main" | "overlay";
  gameId?: string | null;
  messages: ChatMessage[];
}

// ─── DB Row Types ─────────────────────────────────────────────

interface DbConversation {
  id: string;
  title: string;
  game_id: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

interface DbMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  image_paths: string | null; // JSON string of AttachedImage[]
  metadata: string | null; // JSON string of MessageMetadata
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function dbTimestampToMs(ts: string | null): number {
  if (!ts) return Date.now();
  const parsed = new Date(ts + "Z").getTime(); // SQLite datetime is UTC
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function mapDbConversation(conv: DbConversation, msgs: DbMessage[]): ChatConversation {
  return {
    id: conv.id,
    title: conv.title || "New Chat",
    createdAt: dbTimestampToMs(conv.created_at),
    updatedAt: dbTimestampToMs(conv.updated_at),
    source: (conv.source as "main" | "overlay") || "main",
    gameId: conv.game_id,
    messages: msgs.map(mapDbMessage),
  };
}

function mapDbMessage(msg: DbMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: dbTimestampToMs(msg.created_at),
    images: safeJsonParse<AttachedImage[] | undefined>(msg.image_paths, undefined),
    metadata: safeJsonParse<MessageMetadata | undefined>(msg.metadata, undefined),
  };
}

// ─── CRUD Operations ──────────────────────────────────────────

/**
 * Get all conversations (with messages), ordered by updated_at DESC.
 */
export async function getAllConversations(): Promise<ChatConversation[]> {
  const db = await getDatabase();
  try {
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM ai_conversations ORDER BY updated_at DESC"
    );
    if (conversations.length === 0) return [];

    const ids = conversations.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(",");
    const allMessages = await db.select<DbMessage[]>(
      `SELECT * FROM ai_messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, created_at ASC`,
      ids
    );

    const messagesByConv = new Map<string, DbMessage[]>();
    for (const msg of allMessages) {
      if (!messagesByConv.has(msg.conversation_id)) {
        messagesByConv.set(msg.conversation_id, []);
      }
      messagesByConv.get(msg.conversation_id)!.push(msg);
    }

    return conversations.map((conv) =>
      mapDbConversation(conv, messagesByConv.get(conv.id) || [])
    );
  } catch (error) {
    console.error("[chat-history] Failed to get all conversations:", error);
    return [];
  }
}

/**
 * Get a single conversation by ID.
 */
export async function getConversationById(id: string): Promise<ChatConversation | null> {
  if (!id) return null;
  const db = await getDatabase();
  try {
    const rows = await db.select<DbConversation[]>(
      "SELECT * FROM ai_conversations WHERE id = ?",
      [id]
    );
    if (rows.length === 0) return null;

    const messages = await db.select<DbMessage[]>(
      "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC",
      [id]
    );

    return mapDbConversation(rows[0], messages);
  } catch (error) {
    console.error(`[chat-history] Failed to get conversation ${id}:`, error);
    return null;
  }
}

/**
 * Create a new conversation (INSERT).
 */
export async function createConversation(conversation: ChatConversation): Promise<ChatConversation> {
  const db = await getDatabase();
  try {
    await db.execute(
      "INSERT INTO ai_conversations (id, title, game_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, datetime(? / 1000, 'unixepoch'), datetime(? / 1000, 'unixepoch'))",
      [
        conversation.id,
        conversation.title,
        conversation.gameId || null,
        conversation.source || "main",
        conversation.createdAt,
        conversation.updatedAt,
      ]
    );

    for (const msg of conversation.messages) {
      await insertMessage(db, conversation.id, msg);
    }

    return conversation;
  } catch (error) {
    console.error("[chat-history] Failed to create conversation:", error);
    // Rollback
    await db.execute("DELETE FROM ai_conversations WHERE id = ?", [conversation.id]).catch(() => {});
    throw error;
  }
}

/**
 * Update an existing conversation (UPDATE title/timestamp, replace messages).
 */
export async function updateConversation(conversation: ChatConversation): Promise<ChatConversation> {
  const db = await getDatabase();
  try {
    await db.execute(
      "UPDATE ai_conversations SET title = ?, game_id = ?, source = ?, updated_at = datetime(? / 1000, 'unixepoch') WHERE id = ?",
      [
        conversation.title,
        conversation.gameId || null,
        conversation.source || "main",
        conversation.updatedAt,
        conversation.id,
      ]
    );

    // Replace messages: delete old, insert new
    await db.execute("DELETE FROM ai_messages WHERE conversation_id = ?", [conversation.id]);
    for (const msg of conversation.messages) {
      await insertMessage(db, conversation.id, msg);
    }

    return conversation;
  } catch (error) {
    console.error("[chat-history] Failed to update conversation:", error);
    throw error;
  }
}

/**
 * Upsert: save or update a conversation.
 */
export async function saveConversation(conversation: ChatConversation): Promise<ChatConversation> {
  try {
    const existing = await getConversationById(conversation.id);
    if (existing) {
      return await updateConversation(conversation);
    } else {
      return await createConversation(conversation);
    }
  } catch (error) {
    console.error("[chat-history] Failed to save conversation:", error);
    throw error;
  }
}

/**
 * Delete a conversation and all its messages (CASCADE).
 */
export async function deleteConversation(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDatabase();
  try {
    // Delete messages first (in case CASCADE isn't working), then conversation
    await db.execute("DELETE FROM ai_messages WHERE conversation_id = ?", [id]);
    const result = await db.execute("DELETE FROM ai_conversations WHERE id = ?", [id]);
    return result.rowsAffected > 0;
  } catch (error) {
    console.error(`[chat-history] Failed to delete conversation ${id}:`, error);
    return false;
  }
}

/**
 * Delete all conversations.
 */
export async function deleteAllConversations(): Promise<void> {
  const db = await getDatabase();
  try {
    await db.execute("DELETE FROM ai_messages");
    await db.execute("DELETE FROM ai_conversations");
  } catch (error) {
    console.error("[chat-history] Failed to delete all conversations:", error);
  }
}

/**
 * Generate conversation title from first user message.
 */
export function generateConversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(
    (m) => m.role === "user" && m.content.trim() && m.content !== "(image)" && m.content !== "(screenshot)"
  );
  if (!firstUser) return "New Chat";
  return firstUser.content.trim().slice(0, 72);
}

/**
 * Generate a unique conversation ID.
 */
export function generateConversationId(source: "main" | "overlay" = "main"): string {
  const prefix = source === "overlay" ? "overlay" : "conv";
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(role: string): string {
  return `msg_${Date.now()}_${role}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Internal Helpers ─────────────────────────────────────────

async function insertMessage(db: Awaited<ReturnType<typeof getDatabase>>, conversationId: string, msg: ChatMessage) {
  const imagesJson = msg.images && msg.images.length > 0 ? JSON.stringify(msg.images) : null;
  const metadataJson = msg.metadata ? JSON.stringify(msg.metadata) : null;

  await db.execute(
    "INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, image_paths, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(? / 1000, 'unixepoch'))",
    [
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      imagesJson,
      metadataJson,
      msg.timestamp,
    ]
  );
}

// ─── One-Time Migration ───────────────────────────────────────

const MIGRATION_FLAG = "gamevault_chat_migrated_to_sqlite_tables";
const OLD_JSON_KEY = "ai_chat_history_json";
const OLD_LOCALSTORAGE_KEY = "gamevault_ai_chat_history_v1";

interface OldStoredMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  webSearchUsed?: boolean;
  gameContext?: string;
  images?: AttachedImage[];
  metadataEncrypted?: string;
}

interface OldStoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: OldStoredMessage[];
}

/**
 * Migrate old JSON-blob chat history (from settings table + localStorage) to proper SQLite tables.
 * Runs once; subsequent calls are no-ops.
 */
export async function migrateOldJsonToSqlite(): Promise<void> {
  if (typeof localStorage !== "undefined" && localStorage.getItem(MIGRATION_FLAG) === "true") return;

  try {
    const db = await getDatabase();

    // Check if we already have data in the new tables
    const existing = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM ai_conversations");
    if (existing[0]?.cnt > 0) {
      // Already have data in new tables, mark as migrated
      if (typeof localStorage !== "undefined") localStorage.setItem(MIGRATION_FLAG, "true");
      return;
    }

    // Try to load from old settings-based JSON blob
    let jsonRaw: string | null = null;

    try {
      const rows = await db.select<{ key: string; value: string }[]>(
        "SELECT key, value FROM settings WHERE key = ?",
        [OLD_JSON_KEY]
      );
      if (rows.length > 0 && rows[0].value) {
        jsonRaw = rows[0].value;
      }
    } catch { /* table might not exist */ }

    // Fallback to localStorage
    if (!jsonRaw && typeof localStorage !== "undefined") {
      jsonRaw = localStorage.getItem(OLD_LOCALSTORAGE_KEY);
    }

    if (!jsonRaw) {
      if (typeof localStorage !== "undefined") localStorage.setItem(MIGRATION_FLAG, "true");
      return;
    }

    let oldConversations: OldStoredConversation[] = [];
    try {
      const parsed = JSON.parse(jsonRaw);
      if (Array.isArray(parsed)) oldConversations = parsed;
    } catch {
      if (typeof localStorage !== "undefined") localStorage.setItem(MIGRATION_FLAG, "true");
      return;
    }

    console.log(`[chat-history] Migrating ${oldConversations.length} conversations from JSON to SQLite tables...`);

    for (const oldConv of oldConversations) {
      if (!oldConv?.id || !Array.isArray(oldConv.messages)) continue;

      try {
        const messages: ChatMessage[] = oldConv.messages.map((m) => {
          let metadata: MessageMetadata | undefined;
          if (m.metadataEncrypted) {
            try {
              metadata = JSON.parse(decodeURIComponent(escape(atob(m.metadataEncrypted))));
            } catch { /* ignore */ }
          }
          if (m.webSearchUsed || m.gameContext) {
            metadata = { ...metadata, webSearchUsed: m.webSearchUsed, gameContext: m.gameContext };
          }

          return {
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || Date.now(),
            images: m.images,
            metadata,
          };
        });

        const source = oldConv.id.startsWith("overlay_") ? "overlay" : "main";

        const conversation: ChatConversation = {
          id: oldConv.id,
          title: oldConv.title || "New Chat",
          createdAt: oldConv.createdAt || Date.now(),
          updatedAt: oldConv.updatedAt || Date.now(),
          source: source as "main" | "overlay",
          messages,
        };

        await saveConversation(conversation);
      } catch (err) {
        console.warn(`[chat-history] Failed to migrate conversation ${oldConv.id}:`, err);
      }
    }

    console.log("[chat-history] Migration complete");
    if (typeof localStorage !== "undefined") localStorage.setItem(MIGRATION_FLAG, "true");
  } catch (err) {
    console.error("[chat-history] Migration failed:", err);
  }
}
