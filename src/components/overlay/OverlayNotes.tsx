import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Pin, PinOff, Plus, Trash2, X, Check } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GameNote } from "@/types";

const NOTE_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#64748b",
];

interface Props {
  gameId: string | null;
  gameName: string;
}

export default function OverlayNotes({ gameId, gameName }: Props) {
  const [notes, setNotes] = useState<GameNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editColor, setEditColor] = useState(NOTE_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);

  const loadNotes = useCallback(async () => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const query = gameId
        ? "SELECT * FROM game_notes WHERE game_id = $1 ORDER BY is_pinned DESC, updated_at DESC"
        : "SELECT * FROM game_notes ORDER BY is_pinned DESC, updated_at DESC LIMIT 20";
      const params = gameId ? [gameId] : [];
      const rows = (await conn.select(query, params)) as Record<string, unknown>[];
      setNotes(
        rows.map((r) => ({
          id: r.id as string,
          game_id: r.game_id as string,
          title: (r.title as string) || "Untitled",
          content: (r.content as string) || "",
          color: (r.color as string) || "#6366f1",
          is_pinned: Boolean(r.is_pinned),
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        }))
      );
    } catch (err) {
      console.error("Load notes:", err);
    } finally {
      setIsLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const handleCreate = async () => {
    if (!gameId) return toast.error("Select a game first");
    if (!editTitle.trim()) return toast.error("Title is required");
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const id = crypto.randomUUID();
      await conn.execute(
        "INSERT INTO game_notes (id, game_id, title, content, color) VALUES ($1, $2, $3, $4, $5)",
        [id, gameId, editTitle.trim(), editContent.trim(), editColor]
      );
      setIsCreating(false);
      setEditTitle("");
      setEditContent("");
      setEditColor(NOTE_COLORS[0]);
      void loadNotes();
      toast.success("Note created");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE game_notes SET title = $1, content = $2, color = $3, updated_at = datetime('now') WHERE id = $4",
        [editTitle.trim(), editContent.trim(), editColor, editingId]
      );
      setEditingId(null);
      setEditTitle("");
      setEditContent("");
      void loadNotes();
      toast.success("Note updated");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleTogglePin = async (note: GameNote) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE game_notes SET is_pinned = $1, updated_at = datetime('now') WHERE id = $2",
        [note.is_pinned ? 0 : 1, note.id]
      );
      void loadNotes();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM game_notes WHERE id = $1", [id]);
      void loadNotes();
      toast.success("Note deleted");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const startEdit = (note: GameNote) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditColor(note.color);
    setIsCreating(false);
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
    setEditColor(NOTE_COLORS[0]);
  };

  const cancelEdit = () => {
    setIsCreating(false);
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  };

  // Editing/Creating form
  if (isCreating || editingId) {
    return (
      <div className="flex flex-col h-full p-2.5 gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium">{editingId ? "Edit Note" : "New Note"}</p>
          <Button
            size="icon"
            variant="ghost"
            className="size-5 text-white/50 hover:text-white"
            onClick={cancelEdit}
          >
            <X className="size-3" />
          </Button>
        </div>
        <Input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Note title"
          className="h-6 text-[9px] bg-white/5 border-white/10 text-white placeholder:text-white/30"
          autoFocus
        />
        <Textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder="Write your note..."
          className="flex-1 text-[9px] bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none min-h-0"
        />
        <div className="flex items-center gap-1">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              className={cn(
                "size-4 rounded-full border transition-transform",
                editColor === c ? "border-white scale-125" : "border-transparent"
              )}
              style={{ backgroundColor: c }}
              onClick={() => setEditColor(c)}
            />
          ))}
        </div>
        <Button
          size="sm"
          className="h-6 text-[9px] w-full"
          onClick={editingId ? handleUpdate : handleCreate}
          disabled={!editTitle.trim()}
        >
          <Check className="size-3" />
          {editingId ? "Save Changes" : "Create Note"}
        </Button>
      </div>
    );
  }

  // No game selected state
  if (!gameId) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-6 px-4">
        <div className="size-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-3">
          <Pin className="size-4 text-amber-400" />
        </div>
        <p className="text-[10px] font-semibold text-white/80 mb-1">No Game Selected</p>
        <p className="text-[8px] text-white/40 text-center max-w-48 leading-relaxed mb-3">
          Select a game from the <span className="text-white/60 font-medium">Ops</span> tab first to view and create notes for it.
        </p>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5 max-w-48 text-center">
          <p className="text-[8px] text-white/50 leading-relaxed">
            Switch to the <span className="font-medium text-white/70">Ops</span> tab → select a game from the dropdown → come back here to manage notes.
          </p>
        </div>
      </div>
    );
  }

  // Notes list
  return (
    <div className="flex flex-col h-full">
      <div className="px-2.5 py-1.5 border-b border-white/[0.06] flex items-center justify-between">
        <p className="text-[10px] font-medium">
          Notes{gameId ? ` · ${gameName}` : ""}
          {notes.length > 0 && <span className="text-white/40 ml-1">({notes.length})</span>}
        </p>
        <Button
          size="icon"
          variant="ghost"
          className="size-5 text-white/50 hover:text-white"
          onClick={startCreate}
        >
          <Plus className="size-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 rounded-lg bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-6">
              <div className="size-8 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-2">
                <Plus className="size-3.5 text-white/20" />
              </div>
              <p className="text-[9px] text-white/40 mb-1">No notes for {gameName || "this game"}</p>
              <p className="text-[7px] text-white/25 mb-2 max-w-40 mx-auto">Keep track of strategies, passwords, save locations, or anything you want to remember</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[8px] text-white/60 hover:text-white border border-white/10 hover:border-white/20"
                onClick={startCreate}
              >
                <Plus className="size-2.5 mr-1" /> Create your first note
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="group rounded-lg border border-white/[0.06] overflow-hidden hover:border-white/15 transition-all cursor-pointer"
                  style={{ backgroundColor: `${note.color}08` }}
                  onClick={() => startEdit(note)}
                >
                  <div className="h-0.5" style={{ backgroundColor: note.color }} />
                  <div className="px-2 py-1.5">
                    <div className="flex items-start justify-between gap-0.5">
                      <p className="text-[9px] font-medium truncate flex-1">{note.title}</p>
                      {note.is_pinned && <Pin className="size-2 text-white/30 shrink-0 mt-0.5" />}
                    </div>
                    <p className="text-[7px] text-white/35 line-clamp-2 mt-0.5 leading-relaxed">{note.content || "Empty"}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[6px] text-white/20">{formatRelativeTime(note.updated_at)}</p>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="size-3.5 flex items-center justify-center rounded text-white/30 hover:text-white"
                          onClick={(e) => { e.stopPropagation(); handleTogglePin(note); }}
                        >
                          {note.is_pinned ? <PinOff className="size-2" /> : <Pin className="size-2" />}
                        </button>
                        <button
                          className="size-3.5 flex items-center justify-center rounded text-white/30 hover:text-red-400"
                          onClick={(e) => { e.stopPropagation(); handleDelete(note.id); }}
                        >
                          <Trash2 className="size-2" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
