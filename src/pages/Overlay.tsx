import { useEffect, useRef, useState } from "react";
import { useApp } from "@/contexts/app.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  Camera,
  Archive,
  X,
  Send,
  Sparkles,
  Gamepad2,
  RotateCcw,
  Globe,
  Bot,
  User,
  GripHorizontal,
  Maximize2,
} from "lucide-react";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import type { Backup } from "@/types";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/**
 * Overlay window — a compact floating panel with:
 * - Quick actions (screenshot, backup, open save dir)
 * - Mini AI chat with web search
 * - Current game info
 * Visible to screen capture (no stealth mode).
 */
export default function Overlay() {
  const { games, settings } = useApp();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [lastBackup, setLastBackup] = useState<Backup | null>(null);
  const [activeTab, setActiveTab] = useState<"actions" | "chat">("actions");
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedGame = games.find((g) => g.id === selectedGameId) || null;
  const isOpenRouter = settings.ai_provider === "openrouter";

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load last backup for selected game
  useEffect(() => {
    if (!selectedGameId) return;
    (async () => {
      try {
        const db = await import("@tauri-apps/plugin-sql");
        const conn = await db.default.load("sqlite:gamevault.db");
        const rows = (await conn.select(
          "SELECT * FROM backups WHERE game_id = $1 ORDER BY created_at DESC LIMIT 1",
          [selectedGameId]
        )) as Backup[];
        setLastBackup(rows[0] || null);
      } catch {
        // Ignore
      }
    })();
  }, [selectedGameId]);

  const handleScreenshot = async () => {
    if (!selectedGame) {
      toast.error("Select a game first");
      return;
    }
    if (!settings.screenshots_directory) {
      toast.error("Set screenshots directory in Settings");
      return;
    }
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
        gameId: selectedGame.id,
        base64Data: base64,
      });

      const db = await import("@tauri-apps/plugin-sql");
      const conn = await db.default.load("sqlite:gamevault.db");
      await conn.execute(
        `INSERT INTO screenshots (id, game_id, file_path, thumbnail_path, width, height, file_size, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
        [result.id, selectedGame.id, result.file_path, result.thumbnail_path, result.width, result.height, result.file_size]
      );

      toast.success(`Screenshot saved (${formatBytes(result.file_size)})`);
    } catch (err) {
      toast.error(`Screenshot failed: ${err}`);
    }
  };

  const handleQuickBackup = async () => {
    if (!selectedGame) {
      toast.error("Select a game first");
      return;
    }
    if (!settings.backup_directory) {
      toast.error("Set backup directory in Settings");
      return;
    }
    const toastId = toast.loading("Creating backup...");
    try {
      const savePath = await invoke<string>("expand_env_path", {
        path: selectedGame.save_paths[0],
      });
      const result = await invoke<{
        success: boolean;
        backup_id: string;
        file_path: string;
        file_size: number;
        compressed_size: number;
        content_hash: string;
        skipped_duplicate: boolean;
        message: string;
      }>("create_backup", {
        backupDir: settings.backup_directory,
        gameId: selectedGame.id,
        gameName: selectedGame.name,
        savePath,
        displayName: `Quick Backup ${new Date().toLocaleTimeString()}`,
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
            selectedGame.id,
            `Quick Backup ${new Date().toLocaleTimeString()}`,
            result.file_path,
            result.file_size,
            result.compressed_size,
            result.content_hash,
            savePath,
          ]
        );
      }
      toast.success(result.message, { id: toastId });
    } catch (err) {
      toast.error(`Backup failed: ${err}`, { id: toastId });
    }
  };

  const handleRestoreLastBackup = async () => {
    if (!selectedGame || !lastBackup) return;
    const toastId = toast.loading("Restoring...");
    try {
      const savePath = await invoke<string>("expand_env_path", {
        path: selectedGame.save_paths[0],
      });
      const result = await invoke<{ success: boolean; files_restored: number; message: string }>(
        "restore_backup",
        {
          zipPath: lastBackup.file_path,
          restorePath: savePath,
          createSafetyBackup: true,
          backupDir: settings.backup_directory,
          gameId: selectedGame.id,
          gameName: selectedGame.name,
        }
      );
      toast.success(result.message, { id: toastId });
    } catch (err) {
      toast.error(`Restore failed: ${err}`, { id: toastId });
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsStreaming(true);

    try {
      let response: string;

      if (settings.ai_api_key && settings.ai_provider) {
        // Real AI call
        let model = settings.ai_model || "openai/gpt-4o-mini";
        if (webSearchEnabled && isOpenRouter && !model.endsWith(":online")) {
          model = `${model}:online`;
        }

        const apiUrl =
          settings.ai_provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : settings.ai_provider === "openai"
            ? "https://api.openai.com/v1/chat/completions"
            : `${settings.ai_provider}/v1/chat/completions`;

        const systemPrompt = selectedGame
          ? `You are a helpful gaming assistant for GameVault, currently helping with "${selectedGame.name}" by ${selectedGame.developer}. Be concise and helpful. If asked about save files, the save paths are: ${selectedGame.save_paths.join(", ")}`
          : "You are a helpful gaming assistant for GameVault. Help with game save management, backup strategies, tips, and general gaming questions. Be concise.";

        const apiMessages = [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userMsg.content },
        ];

        const res = await tauriFetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.ai_api_key}`,
          },
          body: JSON.stringify({
            model,
            messages: apiMessages,
            max_tokens: 800,
            temperature: 0.7,
          }),
        });

        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (data.error) throw new Error(data.error.message || "API error");
        response = data.choices?.[0]?.message?.content || "No response received.";
      } else {
        // Local fallback
        response = await invoke<string>("ai_chat", {
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userMsg.content },
          ],
        });
      }

      const assistantMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      toast.error(`AI error: ${err}`);
      const errorMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${err}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClose = () => invoke("hide_overlay");

  return (
    <div className="h-screen w-screen flex flex-col overlay-glass rounded-2xl overflow-hidden border border-border/50 shadow-2xl select-none">
      {/* ── Title Bar ──────────────────────────────────── */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 h-9 border-b border-border/40 shrink-0 cursor-grab"
      >
        <GripHorizontal className="size-3 text-muted-foreground/40" />
        <Gamepad2 className="size-3 text-gaming" />
        <span className="text-[10px] font-semibold flex-1">GameVault</span>

        {/* Game selector */}
        <select
          value={selectedGameId || ""}
          onChange={(e) => setSelectedGameId(e.target.value || null)}
          className="h-5 text-[9px] bg-transparent border border-border/50 rounded px-1 max-w-30 truncate"
        >
          <option value="">Select game...</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        <Button variant="ghost" size="icon-sm" className="size-5" onClick={handleClose}>
          <X className="size-3" />
        </Button>
      </div>

      {/* ── Tab Switcher ──────────────────────────────── */}
      <div className="flex border-b border-border/30 px-2 py-1 gap-1 shrink-0">
        {(["actions", "chat"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-1 rounded-md text-[9px] font-medium transition-all",
              activeTab === tab
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            {tab === "actions" ? "Quick Actions" : "AI Chat"}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "actions" ? (
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {/* Game info card */}
              {selectedGame ? (
                <div className="rounded-xl bg-card/50 border border-border/30 p-2.5">
                  <div className="flex items-center gap-2">
                    {(selectedGame.custom_cover_path || selectedGame.cover_url) ? (
                      <img
                        src={selectedGame.custom_cover_path || selectedGame.cover_url!}
                        alt={selectedGame.name}
                        className="size-10 rounded-lg object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).parentElement?.classList.add('bg-gaming/15', 'flex', 'items-center', 'justify-center');
                        }}
                      />
                    ) : (
                      <div className="size-10 rounded-lg bg-gaming/15 flex items-center justify-center">
                        <Gamepad2 className="size-5 text-gaming" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold truncate">{selectedGame.name}</p>
                      <p className="text-[8px] text-muted-foreground">{selectedGame.developer}</p>
                      {lastBackup && (
                        <p className="text-[7px] text-muted-foreground/60">
                          Last backup: {formatRelativeTime(lastBackup.created_at)} ({formatBytes(lastBackup.compressed_size || lastBackup.file_size)})
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-card/30 border border-dashed border-border/30 p-4 text-center">
                  <Gamepad2 className="size-5 mx-auto text-muted-foreground/30 mb-1" />
                  <p className="text-[9px] text-muted-foreground/60">Select a game above to see quick actions</p>
                </div>
              )}

              {/* ── Quick Action Buttons ───────────────── */}
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-14 flex-col gap-1 text-[9px]"
                  onClick={handleScreenshot}
                  disabled={!selectedGame}
                >
                  <Camera className="size-4 text-blue-400" />
                  Screenshot
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-14 flex-col gap-1 text-[9px]"
                  onClick={handleQuickBackup}
                  disabled={!selectedGame}
                >
                  <Archive className="size-4 text-emerald-400" />
                  Quick Backup
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-14 flex-col gap-1 text-[9px]"
                  onClick={handleRestoreLastBackup}
                  disabled={!selectedGame || !lastBackup}
                >
                  <RotateCcw className="size-4 text-amber-400" />
                  Quick Restore
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-14 flex-col gap-1 text-[9px]"
                  onClick={() => {
                    if (selectedGame) {
                      invoke("open_save_directory", { path: selectedGame.save_paths[0] });
                    }
                  }}
                  disabled={!selectedGame}
                >
                  <Maximize2 className="size-4 text-purple-400" />
                  Open Saves
                </Button>
              </div>

              {/* ── Info strip ─────────────────────────── */}
              {selectedGame && (
                <div className="rounded-lg bg-muted/30 p-2 space-y-1">
                  <p className="text-[8px] text-muted-foreground font-medium uppercase tracking-wider">Save Paths</p>
                  {selectedGame.save_paths.map((sp, i) => (
                    <p key={i} className="text-[8px] text-foreground/70 font-mono truncate">{sp}</p>
                  ))}
                  {selectedGame.notes && (
                    <>
                      <p className="text-[8px] text-muted-foreground font-medium uppercase tracking-wider mt-1.5">Notes</p>
                      <p className="text-[8px] text-foreground/70">{selectedGame.notes}</p>
                    </>
                  )}
                </div>
              )}

              {/* ── Shortcut hints ─────────────────────── */}
              <div className="rounded-lg border border-border/20 p-2 space-y-1">
                <p className="text-[8px] text-muted-foreground font-medium uppercase tracking-wider">Shortcuts</p>
                <div className="flex justify-between text-[8px]">
                  <span className="text-muted-foreground">Quick Backup</span>
                  <kbd className="px-1 py-0.5 rounded bg-muted text-[7px] font-mono">{settings.quick_backup_shortcut}</kbd>
                </div>
                <div className="flex justify-between text-[8px]">
                  <span className="text-muted-foreground">Screenshot</span>
                  <kbd className="px-1 py-0.5 rounded bg-muted text-[7px] font-mono">{settings.screenshot_shortcut}</kbd>
                </div>
                <div className="flex justify-between text-[8px]">
                  <span className="text-muted-foreground">Toggle Overlay</span>
                  <kbd className="px-1 py-0.5 rounded bg-muted text-[7px] font-mono">{settings.overlay_shortcut}</kbd>
                </div>
              </div>
            </div>
          </ScrollArea>
        ) : (
          /* ── AI Chat Tab ──────────────────────────── */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages */}
            <ScrollArea className="flex-1">
              <div ref={scrollRef} className="p-3 space-y-2">
                {messages.length === 0 && (
                  <div className="text-center py-8">
                    <Sparkles className="size-6 mx-auto text-gaming/40 mb-2" />
                    <p className="text-[10px] text-muted-foreground">
                      Ask me anything about your games
                    </p>
                    <p className="text-[8px] text-muted-foreground/50 mt-0.5">
                      Save locations, backup tips, strategies...
                    </p>
                    {!settings.ai_api_key && (
                      <Badge variant="outline" className="text-[7px] mt-2">
                        Using local responses · Set API key in Settings for AI
                      </Badge>
                    )}
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex gap-1.5",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="size-5 rounded-full bg-gaming/15 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="size-2.5 text-gaming" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-xl px-2.5 py-1.5 text-[10px] leading-relaxed",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border border-border/50"
                      )}
                    >
                      <p className="whitespace-pre-wrap wrap-break-word">{msg.content}</p>
                    </div>
                    {msg.role === "user" && (
                      <div className="size-5 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="size-2.5" />
                      </div>
                    )}
                  </div>
                ))}

                {isStreaming && (
                  <div className="flex items-center gap-1.5">
                    <div className="size-5 rounded-full bg-gaming/15 flex items-center justify-center shrink-0">
                      <Bot className="size-2.5 text-gaming" />
                    </div>
                    <div className="bg-card border border-border/50 rounded-xl px-3 py-2">
                      <div className="flex items-center gap-1">
                        <div className="size-1.5 rounded-full bg-gaming animate-bounce" />
                        <div className="size-1.5 rounded-full bg-gaming animate-bounce [animation-delay:0.15s]" />
                        <div className="size-1.5 rounded-full bg-gaming animate-bounce [animation-delay:0.3s]" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-2 border-t border-border/30 shrink-0">
              <div className="flex items-center gap-1">
                {/* Web search toggle */}
                <Button
                  variant={webSearchEnabled ? "default" : "ghost"}
                  size="icon-sm"
                  className={cn(
                    "size-6 shrink-0",
                    !isOpenRouter && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={!isOpenRouter}
                  onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  title={
                    isOpenRouter
                      ? webSearchEnabled
                        ? "Web search ON"
                        : "Web search OFF"
                      : "Web search requires OpenRouter"
                  }
                >
                  <Globe className={cn("size-3", webSearchEnabled && "text-primary-foreground")} />
                </Button>

                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={
                    selectedGame ? `Ask about ${selectedGame.name}...` : "Ask anything..."
                  }
                  className="h-6 text-[10px] flex-1"
                  disabled={isStreaming}
                />
                <Button
                  variant="default"
                  size="icon-sm"
                  className="size-6 shrink-0"
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isStreaming}
                >
                  <Send className="size-3" />
                </Button>
              </div>
              {webSearchEnabled && (
                <p className="text-[7px] text-gaming/80 mt-0.5 pl-7">
                  Web search enabled · Responses include live web data
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
