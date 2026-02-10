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
  Zap,
  Plus,
  Trash2,
  Edit3,
  Play,
  Repeat,
  Timer,
} from "lucide-react";
import { cn, generateId } from "@/lib/utils";
import type { Macro, MacroAction } from "@/types";

export default function Macros() {
  const { games } = useApp();
  const [macros, setMacros] = useState<Macro[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTriggerKey, setFormTriggerKey] = useState("");
  const [formGameId, setFormGameId] = useState<string>("global");
  const [formDelay, setFormDelay] = useState("50");
  const [formRepeat, setFormRepeat] = useState("1");
  const [formActions, setFormActions] = useState<MacroAction[]>([]);
  const [isRecordingTrigger, setIsRecordingTrigger] = useState(false);

  useEffect(() => {
    loadMacros();
  }, []);

  const loadMacros = useCallback(async () => {
    setIsLoading(true);
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      const rows = (await conn.select(
        "SELECT * FROM macros ORDER BY created_at DESC"
      )) as Record<string, unknown>[];
      setMacros(
        rows.map((r) => ({
          ...r,
          actions: JSON.parse((r.actions as string) || "[]"),
          is_active: Boolean(r.is_active),
        })) as Macro[]
      );
    } catch (err) {
      console.error("Failed to load macros:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleTriggerKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecordingTrigger) return;
      e.preventDefault();
      const key = e.key === " " ? "Space" : e.key;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        parts.push(key.length === 1 ? key.toUpperCase() : key);
      }
      setFormTriggerKey(parts.join("+"));
      setIsRecordingTrigger(false);
    },
    [isRecordingTrigger]
  );

  useEffect(() => {
    if (isRecordingTrigger) {
      window.addEventListener("keydown", handleTriggerKeyDown);
      return () => window.removeEventListener("keydown", handleTriggerKeyDown);
    }
  }, [isRecordingTrigger, handleTriggerKeyDown]);

  const openCreateDialog = () => {
    setEditingMacro(null);
    setFormName("");
    setFormDescription("");
    setFormTriggerKey("");
    setFormGameId("global");
    setFormDelay("50");
    setFormRepeat("1");
    setFormActions([]);
    setDialogOpen(true);
  };

  const openEditDialog = (macro: Macro) => {
    setEditingMacro(macro);
    setFormName(macro.name);
    setFormDescription(macro.description);
    setFormTriggerKey(macro.trigger_key);
    setFormGameId(macro.game_id || "global");
    setFormDelay(String(macro.delay_ms));
    setFormRepeat(String(macro.repeat_count));
    setFormActions([...macro.actions]);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formTriggerKey) {
      toast.error("Name and trigger key are required");
      return;
    }

    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      const actionsJson = JSON.stringify(formActions);

      if (editingMacro) {
        await conn.execute(
          `UPDATE macros SET name=$1, description=$2, trigger_key=$3, game_id=$4, actions=$5, delay_ms=$6, repeat_count=$7 WHERE id=$8`,
          [
            formName.trim(),
            formDescription.trim(),
            formTriggerKey,
            formGameId === "global" ? null : formGameId,
            actionsJson,
            parseInt(formDelay) || 50,
            parseInt(formRepeat) || 1,
            editingMacro.id,
          ]
        );
        toast.success("Macro updated");
      } else {
        const id = generateId();
        await conn.execute(
          `INSERT INTO macros (id, game_id, name, description, trigger_key, actions, delay_ms, repeat_count, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, datetime('now'))`,
          [
            id,
            formGameId === "global" ? null : formGameId,
            formName.trim(),
            formDescription.trim(),
            formTriggerKey,
            actionsJson,
            parseInt(formDelay) || 50,
            parseInt(formRepeat) || 1,
          ]
        );
        toast.success("Macro created");
      }

      setDialogOpen(false);
      loadMacros();
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const handleToggle = async (macro: Macro) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("UPDATE macros SET is_active=$1 WHERE id=$2", [
        macro.is_active ? 0 : 1,
        macro.id,
      ]);
      setMacros((prev) =>
        prev.map((m) =>
          m.id === macro.id ? { ...m, is_active: !m.is_active } : m
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
      await conn.execute("DELETE FROM macros WHERE id=$1", [id]);
      setMacros((prev) => prev.filter((m) => m.id !== id));
      toast.success("Macro deleted");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const addAction = (type: MacroAction["type"]) => {
    setFormActions((prev) => [
      ...prev,
      {
        type,
        key_code: type === "delay" ? undefined : 0,
        key_name: type === "delay" ? undefined : "",
        delay_ms: type === "delay" ? 100 : undefined,
      },
    ]);
  };

  const removeAction = (index: number) => {
    setFormActions((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Macros"
        description="Create automated key sequences"
        rightContent={
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-3" /> New Macro
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
                  <Skeleton className="h-2 w-24 rounded" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))
          ) : macros.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <Zap className="size-10 text-muted-foreground/30 mb-3" />
              <p className="text-xs text-muted-foreground">No macros created</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1 mb-3">
                Automate repetitive key sequences for any game
              </p>
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="size-3" /> Create Macro
              </Button>
            </div>
          ) : (
            macros.map((macro) => {
              const game = games.find((g) => g.id === macro.game_id);
              return (
                <div
                  key={macro.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-all animate-slide-up",
                    macro.is_active
                      ? "border-border bg-card"
                      : "border-border/50 bg-card/50 opacity-60"
                  )}
                >
                  <div className="size-9 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                    <Zap className="size-4 text-warning" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{macro.name}</span>
                      {game && (
                        <Badge variant="secondary" className="text-[8px]">{game.name}</Badge>
                      )}
                      {!macro.game_id && (
                        <Badge variant="outline" className="text-[8px]">Global</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[9px] text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[8px]">
                          {macro.trigger_key}
                        </kbd>
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Play className="size-2" /> {macro.actions.length} actions
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Timer className="size-2" /> {macro.delay_ms}ms
                      </span>
                      {macro.repeat_count > 1 && (
                        <span className="flex items-center gap-0.5">
                          <Repeat className="size-2" /> ×{macro.repeat_count}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={macro.is_active}
                      onCheckedChange={() => handleToggle(macro)}
                    />
                    <Button variant="ghost" size="icon-sm" onClick={() => openEditDialog(macro)}>
                      <Edit3 className="size-3" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(macro.id)}>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingMacro ? "Edit" : "New"} Macro</DialogTitle>
            <DialogDescription>Create an automated key sequence</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[10px]">Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Auto-Sprint"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px]">Trigger Key</Label>
              <Button
                variant="outline"
                className={cn(
                  "w-full mt-1 h-9 font-mono text-xs",
                  isRecordingTrigger && "border-primary ring-2 ring-primary/30"
                )}
                onClick={() => setIsRecordingTrigger(true)}
              >
                {isRecordingTrigger ? (
                  <span className="text-primary animate-pulse">Press a key...</span>
                ) : formTriggerKey ? (
                  <kbd>{formTriggerKey}</kbd>
                ) : (
                  <span className="text-muted-foreground">Click to record trigger</span>
                )}
              </Button>
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
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px]">Delay (ms)</Label>
                <Input
                  type="number"
                  value={formDelay}
                  onChange={(e) => setFormDelay(e.target.value)}
                  min="10"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px]">Repeat Count</Label>
                <Input
                  type="number"
                  value={formRepeat}
                  onChange={(e) => setFormRepeat(e.target.value)}
                  min="1"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Actions */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-[10px]">Actions</Label>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-[9px]" onClick={() => addAction("key_tap")}>
                    + Key Tap
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[9px]" onClick={() => addAction("delay")}>
                    + Delay
                  </Button>
                </div>
              </div>
              {formActions.length > 0 ? (
                <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                  {formActions.map((action, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2 py-1 rounded bg-muted text-[10px]"
                    >
                      <span className="text-muted-foreground w-4">{idx + 1}.</span>
                      <span className="flex-1">
                        {action.type === "delay"
                          ? `Wait ${action.delay_ms}ms`
                          : `${action.type}: ${action.key_name || "?"}`}
                      </span>
                      <button
                        onClick={() => removeAction(idx)}
                        className="text-destructive hover:text-destructive/80"
                      >
                        <Trash2 className="size-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[9px] text-muted-foreground mt-1">
                  No actions added yet
                </p>
              )}
            </div>

            <div>
              <Label className="text-[10px]">Description (optional)</Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What does this macro do?"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              {editingMacro ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
