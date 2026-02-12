import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Zap, Keyboard, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Macro, KeyMapping } from "@/types";

interface Props {
  gameId: string | null;
}

export default function OverlayMacros({ gameId }: Props) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [keyMappings, setKeyMappings] = useState<KeyMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"macros" | "keys">("macros");

  const loadData = useCallback(async () => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");

      // Load macros
      const macroRows = (await conn.select(
        "SELECT * FROM macros ORDER BY created_at DESC"
      )) as Record<string, unknown>[];
      setMacros(
        macroRows.map((r) => ({
          id: r.id as string,
          game_id: (r.game_id as string) || null,
          name: (r.name as string) || "Unnamed",
          description: (r.description as string) || "",
          trigger_key: (r.trigger_key as string) || "",
          actions: JSON.parse((r.actions as string) || "[]"),
          delay_ms: (r.delay_ms as number) || 50,
          repeat_count: (r.repeat_count as number) || 1,
          is_active: Boolean(r.is_active),
          created_at: r.created_at as string,
        }))
      );

      // Load key mappings
      const keyRows = (await conn.select(
        "SELECT * FROM key_mappings ORDER BY created_at DESC"
      )) as Record<string, unknown>[];
      setKeyMappings(
        keyRows.map((r) => ({
          id: r.id as string,
          game_id: (r.game_id as string) || null,
          name: (r.name as string) || "Unnamed",
          description: (r.description as string) || "",
          source_key: (r.source_key as string) || "",
          target_key: (r.target_key as string) || "",
          is_active: Boolean(r.is_active),
          created_at: r.created_at as string,
        }))
      );
    } catch (err) {
      console.error("Load macros/keys:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleMacro = async (macro: Macro) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("UPDATE macros SET is_active = $1 WHERE id = $2", [
        macro.is_active ? 0 : 1,
        macro.id,
      ]);
      setMacros((prev) =>
        prev.map((m) => (m.id === macro.id ? { ...m, is_active: !m.is_active } : m))
      );
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  const toggleKeyMapping = async (km: KeyMapping) => {
    try {
      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute("UPDATE key_mappings SET is_active = $1 WHERE id = $2", [
        km.is_active ? 0 : 1,
        km.id,
      ]);
      setKeyMappings((prev) =>
        prev.map((k) => (k.id === km.id ? { ...k, is_active: !k.is_active } : k))
      );
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  // Filter by game (show global + game-specific)
  const filteredMacros = macros.filter((m) => !m.game_id || m.game_id === gameId);
  const filteredKeys = keyMappings.filter((k) => !k.game_id || k.game_id === gameId);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-white/[0.06]">
        <button
          className={cn(
            "px-2 py-0.5 rounded text-[9px] transition-colors",
            tab === "macros" ? "bg-white/10 text-white font-medium" : "text-white/50 hover:text-white/70"
          )}
          onClick={() => setTab("macros")}
        >
          <Zap className="size-2.5 inline mr-0.5" />
          Macros ({filteredMacros.length})
        </button>
        <button
          className={cn(
            "px-2 py-0.5 rounded text-[9px] transition-colors",
            tab === "keys" ? "bg-white/10 text-white font-medium" : "text-white/50 hover:text-white/70"
          )}
          onClick={() => setTab("keys")}
        >
          <Keyboard className="size-2.5 inline mr-0.5" />
          Keys ({filteredKeys.length})
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-white/[0.04] animate-pulse" />
            ))
          ) : tab === "macros" ? (
            filteredMacros.length === 0 ? (
              <div className="text-center py-6">
                <Zap className="mx-auto mb-1 size-5 text-white/15" />
                <p className="text-[9px] text-white/30">No macros configured</p>
                <p className="text-[7px] text-white/20 mt-0.5">Create macros in the main app</p>
              </div>
            ) : (
              filteredMacros.map((macro) => (
                <div
                  key={macro.id}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 hover:bg-white/[0.06] transition-colors"
                >
                  <Zap className={cn("size-3 shrink-0", macro.is_active ? "text-amber-400" : "text-white/20")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-medium truncate">{macro.name}</p>
                    <div className="flex items-center gap-1 text-[7px] text-white/40">
                      <kbd className="px-1 py-0.5 rounded bg-white/10 text-[7px]">{macro.trigger_key || "-"}</kbd>
                      <ChevronRight className="size-2" />
                      <span>{macro.actions.length} action{macro.actions.length !== 1 ? "s" : ""}</span>
                      {macro.repeat_count > 1 && <span>×{macro.repeat_count}</span>}
                      {!macro.game_id && (
                        <span className="px-1 py-0.5 rounded bg-white/5 text-white/30">Global</span>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={macro.is_active}
                    onCheckedChange={() => toggleMacro(macro)}
                    className="scale-75"
                  />
                </div>
              ))
            )
          ) : filteredKeys.length === 0 ? (
            <div className="text-center py-6">
              <Keyboard className="mx-auto mb-1 size-5 text-white/15" />
              <p className="text-[9px] text-white/30">No key mappings configured</p>
              <p className="text-[7px] text-white/20 mt-0.5">Create mappings in the main app</p>
            </div>
          ) : (
            filteredKeys.map((km) => (
              <div
                key={km.id}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 hover:bg-white/[0.06] transition-colors"
              >
                <Keyboard className={cn("size-3 shrink-0", km.is_active ? "text-blue-400" : "text-white/20")} />
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-medium truncate">{km.name}</p>
                  <div className="flex items-center gap-1 text-[7px] text-white/40">
                    <kbd className="px-1 py-0.5 rounded bg-white/10 text-[7px]">{km.source_key}</kbd>
                    <ChevronRight className="size-2" />
                    <kbd className="px-1 py-0.5 rounded bg-white/10 text-[7px]">{km.target_key}</kbd>
                    {!km.game_id && (
                      <span className="px-1 py-0.5 rounded bg-white/5 text-white/30">Global</span>
                    )}
                  </div>
                </div>
                <Switch
                  checked={km.is_active}
                  onCheckedChange={() => toggleKeyMapping(km)}
                  className="scale-75"
                />
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
