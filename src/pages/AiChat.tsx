import React, { useCallback, useRef, useState } from "react";
import { useApp } from "@/contexts/app.context";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  Sparkles,
  Send,
  Bot,
  User,
  Copy,
  Trash2,
  Globe,
  Settings,
  Gamepad2,
  Info,
  Camera,
  Paperclip,
  X,
  ImageIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AttachedImage {
  id: string;
  name: string;
  base64: string; // raw base64 (no data: prefix)
  size: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  webSearchUsed?: boolean;
  gameContext?: string;
  images?: AttachedImage[]; // attached images
}

export default function AiChat() {
  const { games, settings } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "Hey! I'm your GameVault AI assistant. Ask me about game save locations, backup strategies, troubleshooting, or anything gaming-related. \n\nTip: Select a game for context-aware responses, or enable web search for live data.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string>("none");
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 5;

  const isOpenRouter = settings.ai_provider === "openrouter";
  const hasApiKey = !!settings.ai_api_key;
  const selectedGame = selectedGameId !== "none" ? games.find((g) => g.id === selectedGameId) : null;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const viewport = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }, 50);
  }, []);

  // ── Image helpers ──
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
    });

  const addImageFile = async (file: File) => {
    if (attachedImages.length >= MAX_IMAGES) {
      toast.error(`Max ${MAX_IMAGES} images per message`);
      return;
    }
    const base64 = await fileToBase64(file);
    setAttachedImages((prev) => [
      ...prev,
      { id: Date.now().toString(), name: file.name, base64, size: file.size },
    ]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => {
      if (f.type.startsWith("image/")) void addImageFile(f);
    });
    e.target.value = "";
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter((i) => i.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) await addImageFile(file);
    }
  };

  const captureScreenshot = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      const raw = await invoke<string>("capture_screen");
      // capture_screen returns full data URI, strip prefix if present
      const base64 = raw.startsWith("data:") ? raw.split(",")[1] || raw : raw;
      if (attachedImages.length >= MAX_IMAGES) {
        toast.error(`Max ${MAX_IMAGES} images per message`);
        return;
      }
      setAttachedImages((prev) => [
        ...prev,
        { id: Date.now().toString(), name: `screenshot_${Date.now()}.png`, base64, size: base64.length },
      ]);
      toast.success("Screenshot attached");
    } catch (err) {
      toast.error(`Capture failed: ${err}`);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && attachedImages.length === 0) || isLoading) return;

    const capturedImages = [...attachedImages];

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text || (capturedImages.length > 0 ? "(image)" : ""),
      timestamp: new Date(),
      webSearchUsed: webSearchEnabled && isOpenRouter,
      gameContext: selectedGame?.name,
      images: capturedImages.length > 0 ? capturedImages : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachedImages([]);
    setIsLoading(true);
    scrollToBottom();

    try {
      let response: string;

      if (hasApiKey && settings.ai_provider) {
        // Real AI call via OpenRouter / OpenAI
        let model = settings.ai_model || "openai/gpt-5.2:online";

        // Append :online for web search (OpenRouter only)
        if (webSearchEnabled && isOpenRouter && !model.endsWith(":online")) {
          model = `${model}:online`;
        }

        const apiUrl =
          settings.ai_provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : settings.ai_provider === "openai"
            ? "https://api.openai.com/v1/chat/completions"
            : `${settings.ai_provider}/v1/chat/completions`;

        const systemPrompt = buildSystemPrompt(selectedGame || null);

        const apiMessages = [
          { role: "system", content: systemPrompt },
          ...messages
            .filter((m) => m.role !== "system" && m.id !== "intro")
            .map((m) => {
              if (m.images && m.images.length > 0) {
                return {
                  role: m.role,
                  content: [
                    ...(m.content && m.content !== "(image)" ? [{ type: "text" as const, text: m.content }] : []),
                    ...m.images.map((img) => ({
                      type: "image_url" as const,
                      image_url: { url: `data:image/png;base64,${img.base64}` },
                    })),
                  ],
                };
              }
              return { role: m.role, content: m.content };
            }),
        ];

        // Current message
        if (capturedImages.length > 0) {
          apiMessages.push({
            role: "user",
            content: [
              ...(text ? [{ type: "text" as const, text }] : []),
              ...capturedImages.map((img) => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${img.base64}` },
              })),
            ],
          });
        } else {
          apiMessages.push({ role: "user", content: text });
        }

        const res = await tauriFetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.ai_api_key}`,
          },
          body: JSON.stringify({
            model,
            messages: apiMessages,
            max_tokens: 1200,
            temperature: 0.7,
          }),
        });

        const data = await res.json() as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        };

        if (data.error) throw new Error(data.error.message || "API error");
        response = data.choices?.[0]?.message?.content || "No response received.";
      } else {
        // Local fallback (Rust backend)
        try {
          response = await invoke<string>("ai_chat", {
            messages: [...messages.filter((m) => m.id !== "intro"), userMsg].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          });
        } catch {
          response = getLocalResponse(text);
        }
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      toast.error(`AI error: ${err}`);
      const fallback: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: getLocalResponse(text),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, fallback]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const handleClear = () => {
    setMessages([
      {
        id: "intro",
        role: "assistant",
        content: "Chat cleared! How can I help you?",
        timestamp: new Date(),
      },
    ]);
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="AI Chat"
        description={
          hasApiKey
            ? `Connected to ${settings.ai_provider || "AI"} · ${settings.ai_model || "default model"}`
            : "Using local responses · Set API key in Settings"
        }
        rightContent={
          <div className="flex items-center gap-1.5">
            {/* Game selector */}
            <Select value={selectedGameId} onValueChange={setSelectedGameId}>
              <SelectTrigger className="h-7 w-36 text-[10px]">
                <Gamepad2 className="size-3 mr-1 shrink-0" />
                <SelectValue placeholder="No game context" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No game context</SelectItem>
                {games.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Web search toggle */}
            <Button
              variant={webSearchEnabled && isOpenRouter ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 text-[10px] gap-1",
                !isOpenRouter && "opacity-50"
              )}
              disabled={!isOpenRouter}
              onClick={() => setWebSearchEnabled(!webSearchEnabled)}
              title={
                isOpenRouter
                  ? "Toggle web search (OpenRouter :online models)"
                  : "Web search requires OpenRouter as AI provider"
              }
            >
              <Globe className="size-3" />
              {webSearchEnabled && isOpenRouter ? "Search ON" : "Web Search"}
            </Button>

            <Badge variant="gaming" className="text-[8px] gap-1">
              <Sparkles className="size-2" /> AI
            </Badge>
            <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Clear chat">
              <Trash2 className="size-3" />
            </Button>
          </div>
        }
      />

      {/* Info bar */}
      {selectedGame && (
        <div className="px-5 py-1.5 border-b border-border/50 bg-gaming/5 flex items-center gap-2">
          <Gamepad2 className="size-3 text-gaming" />
          <span className="text-[9px] text-gaming">
            Context: <strong>{selectedGame.name}</strong> by {selectedGame.developer}
          </span>
          {selectedGame.save_paths.length > 0 && (
            <span className="text-[8px] text-muted-foreground ml-auto">
              Saves: {selectedGame.save_paths[0]}
            </span>
          )}
        </div>
      )}

      {webSearchEnabled && isOpenRouter && (
        <div className="px-5 py-1 border-b border-border/50 bg-blue-500/5 flex items-center gap-2">
          <Globe className="size-3 text-blue-400" />
          <span className="text-[9px] text-blue-400">
            Web search enabled · Responses include live web data via OpenRouter
          </span>
        </div>
      )}

      {!hasApiKey && (
        <div className="px-5 py-1.5 border-b border-border/50 bg-warning/5 flex items-center gap-2">
          <Info className="size-3 text-warning" />
          <span className="text-[9px] text-warning">
            No API key configured. Using local responses only.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-5 text-[8px] ml-auto"
            onClick={() => window.location.href = "/settings"}
          >
            <Settings className="size-2.5" /> Configure
          </Button>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="p-5 space-y-4 max-w-2xl mx-auto">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 animate-slide-up",
                msg.role === "user" && "flex-row-reverse"
              )}
            >
              {/* Avatar */}
              <div
                className={cn(
                  "size-7 rounded-lg flex items-center justify-center shrink-0",
                  msg.role === "assistant" ? "bg-gaming/15" : "bg-primary/15"
                )}
              >
                {msg.role === "assistant" ? (
                  <Bot className="size-3.5 text-gaming" />
                ) : (
                  <User className="size-3.5 text-primary" />
                )}
              </div>

              {/* Content */}
              <div
                className={cn(
                  "flex-1 max-w-[80%] group",
                  msg.role === "user" && "flex flex-col items-end"
                )}
              >
                {/* Metadata badges */}
                {msg.role === "user" && (msg.webSearchUsed || msg.gameContext) && (
                  <div className="flex items-center gap-1 mb-0.5">
                    {msg.webSearchUsed && (
                      <Badge variant="outline" className="text-[7px] px-1 py-0 gap-0.5">
                        <Globe className="size-2" /> Web
                      </Badge>
                    )}
                    {msg.gameContext && (
                      <Badge variant="outline" className="text-[7px] px-1 py-0 gap-0.5">
                        <Gamepad2 className="size-2" /> {msg.gameContext}
                      </Badge>
                    )}
                  </div>
                )}

                <div
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs leading-relaxed",
                    msg.role === "assistant"
                      ? "bg-card border border-border"
                      : "bg-primary text-primary-foreground"
                  )}
                >
                  {/* Attached images */}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {msg.images.map((img) => (
                        <div key={img.id} className="rounded-lg overflow-hidden border border-border/30 max-w-[180px]">
                          <img
                            src={`data:image/png;base64,${img.base64}`}
                            alt={img.name}
                            className="w-full h-auto max-h-[120px] object-cover"
                            draggable={false}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.content && msg.content !== "(image)" && (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCopy(msg.content)}
                    className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 cursor-pointer"
                  >
                    <Copy className="size-2.5" /> Copy
                  </button>
                  <span className="text-[8px] text-muted-foreground/50">
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3 animate-slide-up">
              <div className="size-7 rounded-lg bg-gaming/15 flex items-center justify-center shrink-0">
                <Bot className="size-3.5 text-gaming" />
              </div>
              <div className="bg-card border border-border rounded-xl px-3 py-2">
                <div className="flex gap-1">
                  <div className="size-1.5 rounded-full bg-gaming animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="size-1.5 rounded-full bg-gaming animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="size-1.5 rounded-full bg-gaming animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-5 py-3 border-t border-border">
        {/* Attached images preview */}
        {attachedImages.length > 0 && (
          <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2 flex-wrap">
            {attachedImages.map((img) => (
              <div key={img.id} className="relative group/thumb">
                <div className="w-14 h-10 rounded-lg overflow-hidden border border-border bg-muted">
                  <img
                    src={`data:image/png;base64,${img.base64}`}
                    alt={img.name}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </div>
                <button
                  className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  onClick={() => setAttachedImages((p) => p.filter((i) => i.id !== img.id))}
                >
                  <X className="size-2.5 text-white" />
                </button>
              </div>
            ))}
            <span className="text-[8px] text-muted-foreground">
              {attachedImages.length}/{MAX_IMAGES} images
            </span>
          </div>
        )}

        <div className="max-w-2xl mx-auto flex gap-2 items-center">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          {/* Attach file */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-9 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
          >
            <Paperclip className="size-3.5" />
          </Button>
          {/* Capture screenshot */}
          <Button
            variant={attachedImages.length > 0 ? "secondary" : "ghost"}
            size="icon-sm"
            className="size-9 shrink-0"
            onClick={() => void captureScreenshot()}
            disabled={isCapturing}
            title="Capture screenshot"
          >
            {isCapturing ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          </Button>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              attachedImages.length > 0
                ? "Describe what you see or ask a question..."
                : selectedGame
                  ? `Ask about ${selectedGame.name}...`
                  : "Ask about save locations, backup tips, troubleshooting..."
            }
            className="flex-1 h-9"
            disabled={isLoading}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={(!input.trim() && attachedImages.length === 0) || isLoading}
            className="h-9 px-3"
          >
            <Send className="size-3" />
          </Button>
        </div>
        <p className="text-[8px] text-muted-foreground/50 text-center mt-1.5 max-w-2xl mx-auto">
          {hasApiKey
            ? `${settings.ai_provider} · ${settings.ai_model}${webSearchEnabled && isOpenRouter ? " :online" : ""}`
            : "Local responses only"
          }
          {" · "}Attach images with <ImageIcon className="inline size-2.5 -mt-0.5" /> or paste from clipboard
        </p>
      </div>
    </div>
  );
}

// ─── System Prompt Builder ───────────────────────────────────
function buildSystemPrompt(game: { name: string; developer: string; save_paths: string[]; notes: string } | null): string {
  let prompt = "You are GameVault AI, a knowledgeable gaming assistant specialized in:\n- Game save file management and backup strategies\n- Save file locations across platforms\n- Troubleshooting corrupted saves\n- Gaming tips and strategies\n\nBe concise, accurate, and helpful. Use markdown formatting for readability.";

  if (game) {
    prompt += `\n\nThe user is currently working with the game: "${game.name}" by ${game.developer}.`;
    if (game.save_paths.length > 0) {
      prompt += `\nKnown save paths: ${game.save_paths.join(", ")}`;
    }
    if (game.notes) {
      prompt += `\nUser notes: ${game.notes}`;
    }
    prompt += "\nIncorporate this game context in your responses when relevant.";
  }

  return prompt;
}

// ─── Local Response Fallback ─────────────────────────────────
function getLocalResponse(input: string): string {
  const lower = input.toLowerCase();

  if (lower.includes("save") && (lower.includes("where") || lower.includes("location") || lower.includes("find"))) {
    return "Most PC games store saves in one of these locations:\n\n• **%APPDATA%** (C:\\Users\\<you>\\AppData\\Roaming)\n• **%LOCALAPPDATA%** (C:\\Users\\<you>\\AppData\\Local)\n• **Documents\\My Games\\**\n• The game's install directory\n• Steam: steamapps\\common\\<game>\\saves\n\nUse GameVault's auto-detect to find them, or check PCGamingWiki.";
  }

  if (lower.includes("backup") && (lower.includes("how") || lower.includes("tip") || lower.includes("strateg"))) {
    return "**Backup best practices:**\n\n1. Back up before major updates or patches\n2. Use meaningful names - \"Before final boss\" > \"Backup 3\"\n3. Enable auto-backup in GameVault Settings\n4. Test restores occasionally\n5. Keep both cloud and local copies for redundancy";
  }

  if (lower.includes("corrupt") || lower.includes("broken") || lower.includes("fix")) {
    return "**Fixing corrupted saves:**\n\n1. Check GameVault for a recent backup first\n2. Look for .bak or numbered save files in the same directory\n3. Check cloud saves (Steam Cloud, GOG Galaxy)\n4. Check auto-save slots - usually separate from manual saves\n5. Community tools exist for many games to repair or edit saves";
  }

  if (lower.includes("steam") || lower.includes("epic") || lower.includes("gog")) {
    return "**Platform save locations:**\n\n• **Steam:** C:\\Program Files\\Steam\\userdata\\<id>\\<appid>\n• **Epic Games:** Usually %LOCALAPPDATA%\\<game> or Documents\n• **GOG:** Varies per game, check GOG Galaxy settings\n• **Xbox/Game Pass:** Usually in %LOCALAPPDATA%\\Packages\n\nGameVault's auto-detect scans all common locations.";
  }

  return "I can help with:\n\n• **Save file locations** - \"Where are Elden Ring saves?\"\n• **Backup strategies** - protecting your progress\n• **Troubleshooting** - fixing corrupted or missing saves\n• **Game management** - organizing your library\n• **Platform specifics** - Steam, Epic, GOG save paths\n\nWhat would you like to know?";
}
