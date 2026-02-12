import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  StickyNote,
  Plus,
  Search,
  Gamepad2,
  Pin,
  PinOff,
  Trash2,
  Pencil,
  Clock,
  Palette,
  FolderOpen,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GameNote } from "@/types";

const MAX_ACTIVE_REMINDERS_TOTAL = 200;

const NOTE_COLORS = [
  { value: "#6366f1", label: "Indigo", class: "bg-indigo-500" },
  { value: "#8b5cf6", label: "Violet", class: "bg-violet-500" },
  { value: "#ec4899", label: "Pink", class: "bg-pink-500" },
  { value: "#f43f5e", label: "Rose", class: "bg-rose-500" },
  { value: "#f97316", label: "Orange", class: "bg-orange-500" },
  { value: "#eab308", label: "Yellow", class: "bg-yellow-500" },
  { value: "#22c55e", label: "Green", class: "bg-green-500" },
  { value: "#06b6d4", label: "Cyan", class: "bg-cyan-500" },
  { value: "#3b82f6", label: "Blue", class: "bg-blue-500" },
  { value: "#64748b", label: "Slate", class: "bg-slate-500" },
];

export default function Notes() {
  const { games } = useApp();
  const [notes, setNotes] = useState<GameNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGameId, setSelectedGameId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingNote, setEditingNote] = useState<GameNote | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // New / edit note form state
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteColor, setNoteColor] = useState("#6366f1");
  const [noteGameId, setNoteGameId] = useState<string>("");
  const [remindNextSession, setRemindNextSession] = useState(false);
  const [recurringDays, setRecurringDays] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load notes
  const loadNotes = useCallback(async () => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM game_notes ORDER BY is_pinned DESC, updated_at DESC"
      )) as Array<Record<string, unknown>>;

      setNotes(
        rows.map((r) => ({
          id: r.id as string,
          game_id: r.game_id as string,
          title: r.title as string,
          content: r.content as string,
          color: r.color as string,
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
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        }))
      );
    } catch (err) {
      toast.error(`Failed to load notes: ${err}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Filtered notes
  const filteredNotes = useMemo(() => {
    let result = notes;
    if (selectedGameId !== "all") {
      result = result.filter((n) => n.game_id === selectedGameId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      );
    }
    return result;
  }, [notes, selectedGameId, searchQuery]);

  // Open create dialog
  const openCreateDialog = () => {
    setEditingNote(null);
    setNoteTitle("");
    setNoteContent("");
    setNoteColor("#6366f1");
    setNoteGameId(selectedGameId !== "all" ? selectedGameId : (games[0]?.id || ""));
    setRemindNextSession(false);
    setRecurringDays(null);
    setIsDialogOpen(true);
  };

  // Open edit dialog
  const openEditDialog = (note: GameNote) => {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNoteColor(note.color);
    setNoteGameId(note.game_id);
    setRemindNextSession(Boolean(note.remind_next_session));
    setRecurringDays(note.recurring_days ?? null);
    setIsDialogOpen(true);
  };

  const activeReminderCount = useMemo(() => {
    return notes.filter((n) => n.reminder_enabled && !n.is_dismissed).length;
  }, [notes]);

  // Save note
  const handleSave = async () => {
    if (!noteTitle.trim()) {
      toast.error("Note title is required");
      return;
    }
    if (!noteGameId) {
      toast.error("Please select a game");
      return;
    }

    // Enforce a hard cap on active reminders (prevents 1000+ alarm spam)
    const willEnableReminder = remindNextSession || recurringDays !== null;
    const isCurrentlyActiveReminder = editingNote ? (editingNote.reminder_enabled && !editingNote.is_dismissed) : false;
    const wouldIncreaseCount = willEnableReminder && !isCurrentlyActiveReminder;
    if (wouldIncreaseCount && activeReminderCount >= MAX_ACTIVE_REMINDERS_TOTAL) {
      toast.error(`Reminder limit reached (${MAX_ACTIVE_REMINDERS_TOTAL}). Dismiss some reminders first.`);
      return;
    }

    setIsSaving(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      const reminderEnabled = willEnableReminder ? 1 : 0;
      const nextSession = remindNextSession ? 1 : 0;
      const recurring = recurringDays !== null ? recurringDays : null;

      if (editingNote) {
        // Update
        await conn.execute(
          `UPDATE game_notes SET
            title = $1,
            content = $2,
            color = $3,
            game_id = $4,
            reminder_enabled = $5,
            remind_next_session = $6,
            recurring_days = $7,
            is_dismissed = CASE WHEN $5 = 0 THEN 0 ELSE is_dismissed END,
            updated_at = datetime('now')
           WHERE id = $8`,
          [
            noteTitle.trim(),
            noteContent,
            noteColor,
            noteGameId,
            reminderEnabled,
            nextSession,
            recurring,
            editingNote.id,
          ]
        );
        toast.success("Note updated");
      } else {
        // Create
        const id = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO game_notes (id, game_id, title, content, color, reminder_enabled, remind_next_session, recurring_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, noteGameId, noteTitle.trim(), noteContent, noteColor, reminderEnabled, nextSession, recurring]
        );
        toast.success("Note created");
      }

      await loadNotes();
      setIsDialogOpen(false);
    } catch (err) {
      toast.error(`Failed to save note: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle pin
  const handleTogglePin = async (note: GameNote) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE game_notes SET is_pinned = $1, updated_at = datetime('now') WHERE id = $2",
        [note.is_pinned ? 0 : 1, note.id]
      );
      await loadNotes();
      toast.success(note.is_pinned ? "Unpinned" : "Pinned");
    } catch (err) {
      toast.error(`Failed to update: ${err}`);
    }
  };

  // Delete note
  const handleDelete = async (note: GameNote) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM game_notes WHERE id = $1", [note.id]);
      await loadNotes();
      toast.success("Note deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${err}`);
    }
  };

  const getGameName = (gameId: string) =>
    games.find((g) => g.id === gameId)?.name || "Unknown Game";

  // Count per game
  const gamesWithNotes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notes) {
      counts[n.game_id] = (counts[n.game_id] || 0) + 1;
    }
    return counts;
  }, [notes]);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Notes"
        description={`${notes.length} note${notes.length !== 1 ? "s" : ""} across ${Object.keys(gamesWithNotes).length} game${Object.keys(gamesWithNotes).length !== 1 ? "s" : ""}`}
        rightContent={
          <Button size="sm" className="h-7 text-[10px] gap-1" onClick={openCreateDialog}>
            <Plus className="size-3" /> New Note
          </Button>
        }
      />

      {/* Filters bar */}
      <div className="px-5 py-2 border-b border-border/50 flex items-center gap-2 shrink-0">
        <Select value={selectedGameId} onValueChange={setSelectedGameId}>
          <SelectTrigger className="h-7 w-44 text-[10px]">
            <Gamepad2 className="size-3 mr-1 shrink-0" />
            <SelectValue placeholder="All games" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Games</SelectItem>
            {games.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
                {gamesWithNotes[g.id] && (
                  <Badge variant="secondary" className="ml-1 text-[7px] px-1 py-0">
                    {gamesWithNotes[g.id]}
                  </Badge>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
            className="h-7 pl-7 text-[10px]"
          />
        </div>

        <Badge variant="secondary" className="text-[8px] shrink-0">
          {filteredNotes.length} note{filteredNotes.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Notes grid */}
      <ScrollArea className="flex-1">
        <div className="p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <div className="h-1" />
                  <CardContent className="p-3 space-y-2">
                    <Skeleton className="h-4 w-3/4 rounded" />
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-2/3 rounded" />
                    <div className="flex items-center gap-2 pt-1">
                      <Skeleton className="h-2.5 w-16 rounded" />
                      <Skeleton className="h-2.5 w-20 rounded" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center py-16">
              <StickyNote className="size-10 mx-auto text-muted-foreground/30 mb-3" />
              <h3 className="text-sm font-medium mb-1">
                {searchQuery ? "No notes found" : "No notes yet"}
              </h3>
              <p className="text-[10px] text-muted-foreground mb-4 max-w-xs mx-auto">
                {searchQuery
                  ? "Try a different search term or game filter"
                  : "Create notes to track game-specific tips, strategies, save file info, and more"}
              </p>
              {!searchQuery && (
                <Button size="sm" className="h-7 text-[10px] gap-1" onClick={openCreateDialog}>
                  <Plus className="size-3" /> Create your first note
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  gameName={getGameName(note.game_id)}
                  onEdit={() => openEditDialog(note)}
                  onTogglePin={() => handleTogglePin(note)}
                  onDelete={() => handleDelete(note)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <StickyNote className="size-4" />
              {editingNote ? "Edit Note" : "New Note"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Game selector */}
            <div>
              <Label className="text-[10px]">Game</Label>
              <Select value={noteGameId} onValueChange={setNoteGameId}>
                <SelectTrigger className="h-8 text-[10px] mt-1">
                  <SelectValue placeholder="Select a game" />
                </SelectTrigger>
                <SelectContent>
                  {games.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <Label className="text-[10px]">Title</Label>
              <Input
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="e.g. Boss strategy, Save file locations..."
                className="mt-1 text-[11px]"
                autoFocus
              />
            </div>

            {/* Content */}
            <div>
              <Label className="text-[10px]">Content</Label>
              <textarea
                ref={textareaRef}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write your note here... Supports plain text with line breaks."
                className="mt-1 w-full h-40 rounded-lg border border-input bg-background px-3 py-2 text-[11px] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              />
            </div>

            {/* Color picker */}
            <div>
              <Label className="text-[10px] flex items-center gap-1">
                <Palette className="size-3" /> Color Tag
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNoteColor(c.value)}
                    className={cn(
                      "size-6 rounded-full transition-all cursor-pointer",
                      c.class,
                      noteColor === c.value
                        ? "ring-2 ring-offset-2 ring-offset-background ring-foreground scale-110"
                        : "opacity-60 hover:opacity-100"
                    )}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Reminders */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-[10px] flex items-center gap-1">
                    <Clock className="size-3" /> Remind Next Session
                  </Label>
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    Shows an overlay reminder the next time this game is detected running
                  </p>
                </div>
                <Switch
                  checked={remindNextSession}
                  onCheckedChange={(v) => setRemindNextSession(v)}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-[10px]">Recurring Reminder</Label>
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    Repeat on a cadence (still only triggers when the game is running)
                  </p>
                </div>
                <Select
                  value={recurringDays === null ? "none" : String(recurringDays)}
                  onValueChange={(v) => {
                    if (v === "none") return setRecurringDays(null);
                    if (v === "custom") return setRecurringDays(3);
                    const parsed = parseInt(v);
                    setRecurringDays(Number.isFinite(parsed) ? parsed : null);
                  }}
                >
                  <SelectTrigger className="h-7 w-40 text-[10px]">
                    <SelectValue placeholder="Off" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Off</SelectItem>
                    <SelectItem value="1">Daily</SelectItem>
                    <SelectItem value="7">Weekly</SelectItem>
                    <SelectItem value="30">Monthly</SelectItem>
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {recurringDays !== null && ![1, 7, 30].includes(recurringDays) && (
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-[10px] text-muted-foreground">Every (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={recurringDays}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 1;
                      setRecurringDays(Math.max(1, Math.min(365, v)));
                    }}
                    className="h-7 w-24 text-[10px]"
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-[8px] text-muted-foreground">
                <span>Active reminders</span>
                <span className="font-mono tabular-nums">
                  {activeReminderCount}/{MAX_ACTIVE_REMINDERS_TOTAL}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : editingNote ? "Update Note" : "Create Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Note Card Component ─────────────────────────────────────

interface NoteCardProps {
  note: GameNote;
  gameName: string;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function NoteCard({ note, gameName, onEdit, onTogglePin, onDelete }: NoteCardProps) {
  return (
    <Card
      className="group overflow-hidden hover:border-foreground/20 transition-all cursor-pointer"
      onClick={onEdit}
    >
      {/* Color strip */}
      <div className="h-1" style={{ backgroundColor: note.color }} />

      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2 mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {note.is_pinned && <Pin className="size-2.5 text-gaming shrink-0" />}
              <h3 className="text-[11px] font-semibold truncate">{note.title}</h3>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant="outline" className="text-[7px] px-1 py-0 gap-0.5">
                <Gamepad2 className="size-2" /> {gameName}
              </Badge>
              {note.reminder_enabled && !note.is_dismissed && (
                <Badge variant="secondary" className="text-[7px] px-1 py-0 gap-0.5">
                  <Clock className="size-2" />
                  {note.remind_next_session
                    ? "Next session"
                    : note.recurring_days
                      ? `Every ${note.recurring_days}d`
                      : "Reminder"}
                </Badge>
              )}
            </div>
          </div>

          {/* Actions (visible on hover) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="size-5" onClick={onTogglePin} title={note.is_pinned ? "Unpin" : "Pin"}>
              {note.is_pinned ? <PinOff className="size-2.5" /> : <Pin className="size-2.5" />}
            </Button>
            <Button variant="ghost" size="icon-sm" className="size-5" onClick={onEdit} title="Edit">
              <Pencil className="size-2.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" className="size-5 text-destructive" onClick={onDelete} title="Delete">
              <Trash2 className="size-2.5" />
            </Button>
          </div>
        </div>

        {/* Content preview */}
        {note.content && (
          <p className="text-[9px] text-muted-foreground line-clamp-3 leading-relaxed mt-1">
            {note.content}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-border/30">
          <Clock className="size-2.5 text-muted-foreground/60" />
          <span className="text-[8px] text-muted-foreground/60">
            {formatRelativeTime(note.updated_at)}
          </span>
          {!note.content && (
            <span className="text-[8px] text-muted-foreground/40 ml-auto flex items-center gap-0.5">
              <FolderOpen className="size-2" /> Empty note
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
