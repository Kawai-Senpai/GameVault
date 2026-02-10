import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Keyboard,
  Plus,
  Trash2,
  ArrowRight,
  ArrowRightLeft,
  Edit3,
} from "lucide-react";
import { cn, generateId } from "@/lib/utils";
import type { KeyMapping } from "@/types";

export default function KeyMapper() {
  const { games } = useApp();
  const [mappings, setMappings] = useState<KeyMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<KeyMapping | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSourceKey, setFormSourceKey] = useState("");
  const [formTargetKey, setFormTargetKey] = useState("");
  const [formGameId, setFormGameId] = useState<string>("global");
  const [isRecordingSource, setIsRecordingSource] = useState(false);
  const [isRecordingTarget, setIsRecordingTarget] = useState(false);

  useEffect(() => {
    loadMappings();
  }, []);

  const loadMappings = useCallback(async () => {
    setIsLoading(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM key_mappings ORDER BY created_at DESC"
      )) as KeyMapping[];
      setMappings(rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })));
    } catch (err) {
      console.error("Failed to load key mappings:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      const key = e.key === " " ? "Space" : e.key;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        parts.push(key.length === 1 ? key.toUpperCase() : key);
      }
      const combo = parts.join("+");

      if (isRecordingSource) {
        setFormSourceKey(combo);
        setIsRecordingSource(false);
      } else if (isRecordingTarget) {
        setFormTargetKey(combo);
        setIsRecordingTarget(false);
      }
    },
    [isRecordingSource, isRecordingTarget]
  );

  useEffect(() => {
    if (isRecordingSource || isRecordingTarget) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isRecordingSource, isRecordingTarget, handleKeyDown]);

  const openCreateDialog = () => {
    setEditingMapping(null);
    setFormName("");
    setFormDescription("");
    setFormSourceKey("");
    setFormTargetKey("");
    setFormGameId("global");
    setDialogOpen(true);
  };

  const openEditDialog = (mapping: KeyMapping) => {
    setEditingMapping(mapping);
    setFormName(mapping.name);
    setFormDescription(mapping.description);
    setFormSourceKey(mapping.source_key);
    setFormTargetKey(mapping.target_key);
    setFormGameId(mapping.game_id || "global");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formSourceKey || !formTargetKey) {
      toast.error("Name, source key, and target key are required");
      return;
    }

    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      if (editingMapping) {
        await conn.execute(
          `UPDATE key_mappings SET name=$1, description=$2, source_key=$3, target_key=$4, game_id=$5 WHERE id=$6`,
          [
            formName.trim(),
            formDescription.trim(),
            formSourceKey,
            formTargetKey,
            formGameId === "global" ? null : formGameId,
            editingMapping.id,
          ]
        );
        toast.success("Key mapping updated");
      } else {
        const id = generateId();
        await conn.execute(
          `INSERT INTO key_mappings (id, game_id, name, description, source_key, target_key, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, datetime('now'))`,
          [
            id,
            formGameId === "global" ? null : formGameId,
            formName.trim(),
            formDescription.trim(),
            formSourceKey,
            formTargetKey,
          ]
        );
        toast.success("Key mapping created");
      }

      setDialogOpen(false);
      loadMappings();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleToggle = async (mapping: KeyMapping) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        "UPDATE key_mappings SET is_active=$1 WHERE id=$2",
        [mapping.is_active ? 0 : 1, mapping.id]
      );
      setMappings((prev) =>
        prev.map((m) =>
          m.id === mapping.id ? { ...m, is_active: !m.is_active } : m
        )
      );
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("DELETE FROM key_mappings WHERE id=$1", [id]);
      setMappings((prev) => prev.filter((m) => m.id !== id));
      toast.success("Key mapping deleted");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Key Mapper"
        description="Remap keys for different games"
        rightContent={
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-3" /> New Mapping
          </Button>
        }
      />

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-36 rounded" />
                  <Skeleton className="h-2 w-20 rounded" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))
          ) : mappings.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <Keyboard className="size-10 text-muted-foreground/30 mb-3" />
              <p className="text-xs text-muted-foreground">No key mappings</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1 mb-3">
                Create mappings to remap keys while playing
              </p>
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="size-3" /> Create Mapping
              </Button>
            </div>
          ) : (
            mappings.map((mapping) => {
              const game = games.find((g) => g.id === mapping.game_id);
              return (
                <div
                  key={mapping.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-all animate-slide-up",
                    mapping.is_active
                      ? "border-border bg-card"
                      : "border-border/50 bg-card/50 opacity-60"
                  )}
                >
                  <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ArrowRightLeft className="size-4 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{mapping.name}</span>
                      {game && (
                        <Badge variant="secondary" className="text-[8px]">
                          {game.name}
                        </Badge>
                      )}
                      {!mapping.game_id && (
                        <Badge variant="outline" className="text-[8px]">Global</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <kbd className="px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono">
                        {mapping.source_key}
                      </kbd>
                      <ArrowRight className="size-2.5 text-muted-foreground" />
                      <kbd className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-mono">
                        {mapping.target_key}
                      </kbd>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={mapping.is_active}
                      onCheckedChange={() => handleToggle(mapping)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditDialog(mapping)}
                    >
                      <Edit3 className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(mapping.id)}
                    >
                      <Trash2 className="size-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMapping ? "Edit" : "New"} Key Mapping
            </DialogTitle>
            <DialogDescription>
              Map one key or combo to another
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[10px]">Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Dodge Roll Remap"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px]">Game (optional)</Label>
              <Select value={formGameId} onValueChange={setFormGameId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Global" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (all games)</SelectItem>
                  {games.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px]">Source Key</Label>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full mt-1 h-10 font-mono text-xs",
                    isRecordingSource && "border-primary ring-2 ring-primary/30"
                  )}
                  onClick={() => {
                    setIsRecordingSource(true);
                    setIsRecordingTarget(false);
                  }}
                >
                  {isRecordingSource ? (
                    <span className="text-primary animate-pulse">Press a key...</span>
                  ) : formSourceKey ? (
                    <kbd>{formSourceKey}</kbd>
                  ) : (
                    <span className="text-muted-foreground">Click to record</span>
                  )}
                </Button>
              </div>
              <div>
                <Label className="text-[10px]">Target Key</Label>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full mt-1 h-10 font-mono text-xs",
                    isRecordingTarget && "border-primary ring-2 ring-primary/30"
                  )}
                  onClick={() => {
                    setIsRecordingTarget(true);
                    setIsRecordingSource(false);
                  }}
                >
                  {isRecordingTarget ? (
                    <span className="text-primary animate-pulse">Press a key...</span>
                  ) : formTargetKey ? (
                    <kbd>{formTargetKey}</kbd>
                  ) : (
                    <span className="text-muted-foreground">Click to record</span>
                  )}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-[10px]">Description (optional)</Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Brief description"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              {editingMapping ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
