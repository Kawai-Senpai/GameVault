import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  saveConversation as dbSaveConversation,
  getConversationById,
  type ChatConversation as DbChatConversation,
  type ChatMessage as DbChatMessage,
} from "@/lib/database/chat-history.actions";
import { toast } from "sonner";
import { Bot, Camera, Globe, ImageIcon, Loader2, Send, Sparkles, Trash2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/types";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  imageBase64?: string; // attached screenshot (data URI)
}

interface Props {
  settings: AppSettings;
  gameName?: string;
  exeName?: string;
  initialMessage?: string;
  onMessageConsumed?: () => void;
}

export default function OverlayChat({ settings, gameName, exeName, initialMessage, onMessageConsumed }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWaitingResponse, setIsWaitingResponse] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null); // base64 data URI
  const [isCapturing, setIsCapturing] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const isOpenRouter = settings.ai_provider === "openrouter";

  const resolveApiKey = (provider: string, values: Record<string, string>) => {
    const providerKey =
      provider === "openai"
        ? (values.ai_openai_api_key || "").trim()
        : (values.ai_openrouter_api_key || "").trim();
    const genericKey = (values.ai_api_key || "").trim();
    return providerKey || genericKey;
  };

  const streamAssistantText = async (fullText: string) => {
    const assistantId = crypto.randomUUID();
    const finalText = fullText || "No response.";
    const total = finalText.length;
    const step = total > 1000 ? 18 : total > 500 ? 10 : 6;

    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    for (let index = 0; index < total; index += step) {
      await new Promise((resolve) => window.setTimeout(resolve, 12));
      const next = finalText.slice(0, Math.min(total, index + step));
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: next,
                isStreaming: next.length < total,
              }
            : msg
        )
      );
    }

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId
          ? {
              ...msg,
              isStreaming: false,
            }
          : msg
      )
    );
  };

  // Periodically reload AI settings from DB (overlay is a separate window)
  const [liveApiKey, setLiveApiKey] = useState(
    resolveApiKey(settings.ai_provider || "openrouter", {
      ai_openrouter_api_key: settings.ai_openrouter_api_key || "",
      ai_openai_api_key: settings.ai_openai_api_key || "",
      ai_api_key: settings.ai_api_key || "",
    })
  );
  const [liveProvider, setLiveProvider] = useState(settings.ai_provider || "openrouter");
  const [liveModel, setLiveModel] = useState(settings.ai_model);

  const overlayConversationIdRef = useRef<string>("");
  const overlayConversationTitle = gameName ? `Overlay · ${gameName}` : "Overlay Chat";

  // Generate or restore a stable overlay conversation ID
  useEffect(() => {
    const stableKey = `overlay_${(gameName || exeName || "general").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    overlayConversationIdRef.current = stableKey;
  }, [gameName, exeName]);

  const toDbMessage = (message: ChatMsg): DbChatMessage => {
    const rawImage =
      message.imageBase64 && message.imageBase64.includes(",")
        ? message.imageBase64.split(",")[1]
        : message.imageBase64;

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      images: rawImage
        ? [
            {
              id: `${message.id}_image`,
              name: `overlay_${message.id}.png`,
              base64: rawImage,
              size: rawImage.length,
            },
          ]
        : undefined,
    };
  };

  const fromDbMessage = (message: DbChatMessage): ChatMsg | null => {
    if (message.role !== "user" && message.role !== "assistant") return null;
    const image = Array.isArray(message.images) && message.images.length > 0
      ? `data:image/png;base64,${message.images[0].base64}`
      : undefined;

    return {
      id: message.id,
      role: message.role as "user" | "assistant",
      content: message.content,
      timestamp: message.timestamp || Date.now(),
      imageBase64: image,
    };
  };

  const readLiveAiConfig = async () => {
    const db = await import("@tauri-apps/plugin-sql");
    const conn = await db.default.load("sqlite:gamevault.db");
    const rows = (await conn.select(
      "SELECT key, value FROM settings WHERE key IN ('ai_provider', 'ai_openrouter_api_key', 'ai_openai_api_key', 'ai_api_key', 'ai_model')"
    )) as { key: string; value: string }[];

    const map: Record<string, string> = {};
    rows.forEach((r) => {
      map[r.key] = r.value;
    });

    const provider = (map.ai_provider || settings.ai_provider || "openrouter").trim();
    const key = resolveApiKey(provider, map);
    const model = (map.ai_model || settings.ai_model || "").trim();

    return { provider, key, model };
  };

  // Restore overlay conversation from SQLite
  useEffect(() => {
    let cancelled = false;
    const overlayId = overlayConversationIdRef.current;
    if (!overlayId) return;

    const restoreOverlayConversation = async () => {
      try {
        const conversation = await getConversationById(overlayId);
        if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) return;

        const restored = conversation.messages
          .map(fromDbMessage)
          .filter((msg): msg is ChatMsg => Boolean(msg));

        if (!cancelled && restored.length > 0) {
          setMessages(restored);
        }
      } catch (err) {
        console.error("[OverlayChat] Failed to restore conversation:", err);
      }
    };

    void restoreOverlayConversation();
    return () => { cancelled = true; };
  }, [gameName, exeName]);

  // Persist overlay conversation to SQLite (same DB as main app)
  useEffect(() => {
    if (messages.length === 0 || messages.some((message) => message.isStreaming)) return;

    const overlayId = overlayConversationIdRef.current;
    if (!overlayId) return;

    const persistOverlayConversation = async () => {
      const now = Date.now();
      const dbConversation: DbChatConversation = {
        id: overlayId,
        title: overlayConversationTitle,
        createdAt: now, // will be ignored on update (only used for create)
        updatedAt: now,
        source: "overlay",
        messages: messages
          .filter((m) => !m.isStreaming)
          .map(toDbMessage),
      };

      await dbSaveConversation(dbConversation);
    };

    void persistOverlayConversation().catch((err) => {
      console.error("[OverlayChat] Failed to persist conversation:", err);
    });
  }, [messages, overlayConversationTitle]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const live = await readLiveAiConfig();
        if (cancelled) return;
        setLiveProvider(live.provider);
        setLiveApiKey(live.key);
        setLiveModel(live.model);
      } catch { /* silent */ }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // Auto-send initial message from strip input
  const initialMsgRef = useRef<string | null>(null);
  const pendingSendRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialMessage && initialMessage.trim() && initialMessage !== initialMsgRef.current) {
      initialMsgRef.current = initialMessage;
      pendingSendRef.current = initialMessage;
      setInputValue(initialMessage);
      onMessageConsumed?.();
    }
  }, [initialMessage, onMessageConsumed]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // Track whether we need to auto-send after mount
  const [autoSendPending, setAutoSendPending] = useState(false);
  useEffect(() => {
    if (pendingSendRef.current && inputValue === pendingSendRef.current) {
      pendingSendRef.current = null;
      setAutoSendPending(true);
    }
  }, [inputValue]);

  const captureScreenshot = async () => {
    setIsCapturing(true);
    try {
      // Hide overlay temporarily
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const overlayWin = getCurrentWindow();
      await overlayWin.hide();
      await new Promise((r) => setTimeout(r, 250));

      const raw = await invoke<string>("capture_screen");

      await overlayWin.show();

      // capture_screen returns full data URI, use as-is
      const dataUri = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
      setAttachedImage(dataUri);
      toast.success("Screenshot attached");
    } catch (err) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().show();
      } catch { /* ignore */ }
      toast.error(`Capture failed: ${err}`);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && !attachedImage) || isStreaming) return;

    // Build user message content enriched with game context
    let userText = inputValue.trim();
    if (gameName && !messages.length) {
      // Inject game context into the first message
      userText = `[Game: ${gameName}${exeName ? ` | Exe: ${exeName}` : ""}]\n${userText}`;
    }

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText || (attachedImage ? "(screenshot)" : ""),
      timestamp: Date.now(),
      imageBase64: attachedImage || undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    const capturedImage = attachedImage;
    setAttachedImage(null);

    let activeProvider = liveProvider;
    let activeApiKey = liveApiKey;
    let activeModel = liveModel;

    if (!activeApiKey || !activeProvider) {
      try {
        const live = await readLiveAiConfig();
        activeProvider = live.provider;
        activeApiKey = live.key;
        activeModel = live.model;
        setLiveProvider(live.provider);
        setLiveApiKey(live.key);
        setLiveModel(live.model);
      } catch {
      }
    }

    if (!activeApiKey || !activeProvider) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          timestamp: Date.now(),
          content:
            "AI is not configured yet. Open the main app and go to Settings → AI Configuration to add your provider API key, then try again.",
        },
      ]);
      toast.error("AI is not configured. Configure provider API key in Settings.");
      return;
    }

    setIsStreaming(true);
    setIsWaitingResponse(true);

    try {
      let response = "";
      let model = activeModel || "openai/gpt-5.2:online";
      const liveIsOpenRouter = activeProvider === "openrouter";
      if (webSearchEnabled && liveIsOpenRouter && !model.endsWith(":online")) model = `${model}:online`;
      const apiUrl =
        activeProvider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : activeProvider === "openai"
            ? "https://api.openai.com/v1/chat/completions"
            : `${activeProvider}/v1/chat/completions`;

      const systemPrompt = buildOverlaySystemPrompt(gameName, exeName);

      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => {
          if (m.imageBase64) {
            return {
              role: m.role,
              content: [
                ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
                { type: "image_url" as const, image_url: { url: m.imageBase64 } },
              ],
            };
          }
          return { role: m.role, content: m.content };
        }),
      ];

      if (capturedImage) {
        apiMessages.push({
          role: "user",
          content: [
            ...(userText ? [{ type: "text" as const, text: userText }] : []),
            { type: "image_url" as const, image_url: { url: capturedImage } },
          ],
        });
      } else {
        apiMessages.push({ role: "user", content: userText });
      }

      const res = await tauriFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          max_tokens: 700,
        }),
      });
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (data.error) throw new Error(data.error.message || "API error");
      response = data.choices?.[0]?.message?.content || "No response.";
      setIsWaitingResponse(false);
      await streamAssistantText(response);
    } catch (err) {
      toast.error(`AI: ${err}`);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          timestamp: Date.now(),
          content: "I couldn't complete that request. Check AI Configuration in Settings and try again.",
        },
      ]);
    } finally {
      setIsWaitingResponse(false);
      setIsStreaming(false);
    }
  };

  // Auto-send pending message from strip input
  useEffect(() => {
    if (autoSendPending) {
      setAutoSendPending(false);
      void handleSendMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendPending]);

  // Show setup guide if no API key
  const fallbackProvider = settings.ai_provider || "openrouter";
  const fallbackKey = resolveApiKey(fallbackProvider, {
    ai_openrouter_api_key: settings.ai_openrouter_api_key || "",
    ai_openai_api_key: settings.ai_openai_api_key || "",
    ai_api_key: settings.ai_api_key || "",
  });
  const hasApiKey = !!((liveApiKey || fallbackKey).trim() && (liveProvider || fallbackProvider).trim());

  return (
    <div className="flex flex-col h-full">
      <div className="px-2.5 py-1.5 border-b border-white/[0.06] flex items-center gap-1.5">
        <Sparkles className="size-3 text-primary shrink-0" />
        <p className="text-[10px] font-medium">AI Assistant</p>
        {gameName && (
          <span className="text-[7px] text-white/30 truncate max-w-[120px]" title={gameName}>
            · {gameName}
          </span>
        )}
        {isStreaming && (
          <span className="text-[8px] text-primary/70 animate-pulse ml-auto">thinking...</span>
        )}
        {messages.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="size-4 ml-auto text-white/30 hover:text-white/60"
            onClick={() => setMessages([])}
            title="Clear chat"
          >
            <Trash2 className="size-2.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 px-2.5">
        <div ref={chatRef} className="space-y-1.5 py-2">
          {!hasApiKey && messages.length === 0 && (
            <div className="text-center py-6">
              <Sparkles className="mx-auto mb-2 size-5 text-yellow-400/40" />
              <p className="text-[10px] text-yellow-400/70 font-medium mb-1">AI not configured</p>
              <p className="text-[8px] text-white/30 leading-relaxed max-w-[200px] mx-auto">
                Set up an API key in Settings &gt; AI Assistant to unlock smart chat.
                Supports OpenRouter and OpenAI.
              </p>
              <p className="text-[7px] text-white/20 mt-2">
                Without an API key, chat is disabled.
              </p>
            </div>
          )}
          {hasApiKey && messages.length === 0 && (
            <div className="text-center py-8">
              <Sparkles className="mx-auto mb-2 size-5 text-white/15" />
              <p className="text-[9px] text-white/30">
                Ask about save locations, backup strategies, game tips...
              </p>
              <p className="text-[8px] text-white/20 mt-0.5">
                Attach a screenshot with <Camera className="inline size-2.5 -mt-0.5" /> to ask about what&apos;s on screen
              </p>
              <div className="flex flex-wrap gap-1 justify-center mt-2">
                {["Where are my saves?", "Best backup strategy?", "How to fix corrupt saves?"].map((q) => (
                  <button
                    key={q}
                    className="text-[7px] px-2 py-0.5 rounded-full border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors"
                    onClick={() => setInputValue(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex gap-1.5", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              {msg.role === "assistant" && (
                <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <Bot className="size-2 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-2 py-1 text-[9px] leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/[0.06] border border-white/[0.08]"
                )}
              >
                {msg.imageBase64 && (
                  <div className="mb-1 rounded overflow-hidden border border-white/10 max-w-[140px]">
                    <img src={msg.imageBase64} alt="Screenshot" className="w-full h-auto" draggable={false} />
                  </div>
                )}
                {msg.content && msg.content !== "(screenshot)" && (
                  <p className="whitespace-pre-wrap break-words">
                    {msg.content}
                    {msg.isStreaming && (
                      <span className="inline-block size-1 rounded-full bg-current align-middle ml-1 animate-pulse" />
                    )}
                  </p>
                )}
              </div>
              {msg.role === "user" && (
                <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <User className="size-2" />
                </div>
              )}
            </div>
          ))}
          {isWaitingResponse && (
            <div className="flex gap-1.5 justify-start">
              <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20">
                <Bot className="size-2 text-primary" />
              </div>
              <div className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-2 py-1">
                <div className="flex items-center gap-1">
                  <div className="size-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="size-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "140ms" }} />
                  <div className="size-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "280ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Attached image preview */}
      {attachedImage && (
        <div className="px-2.5 py-1 border-t border-white/[0.06] flex items-center gap-1.5 bg-white/[0.03]">
          <div className="relative rounded overflow-hidden border border-white/15 w-10 h-7 shrink-0">
            <img src={attachedImage} alt="Attached" className="w-full h-full object-cover" draggable={false} />
            <button
              className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400"
              onClick={() => setAttachedImage(null)}
            >
              <X className="size-2 text-white" />
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-[8px] text-white/50 flex items-center gap-0.5">
              <ImageIcon className="size-2" /> Screenshot attached
            </p>
            <p className="text-[7px] text-white/30">Will be sent with your next message</p>
          </div>
        </div>
      )}

      <div className="px-2.5 py-1.5 border-t border-white/[0.06] flex items-center gap-1">
        {isOpenRouter && (
          <button
            className={cn(
              "size-5 flex items-center justify-center rounded shrink-0 transition-colors",
              webSearchEnabled ? "bg-primary/30 text-primary" : "text-white/40 hover:text-white/70"
            )}
            onClick={() => setWebSearchEnabled((p) => !p)}
            title="Web search"
          >
            <Globe className="size-2.5" />
          </button>
        )}
        <button
          className={cn(
            "size-5 flex items-center justify-center rounded shrink-0 transition-colors",
            attachedImage ? "bg-emerald-500/30 text-emerald-400" : "text-white/40 hover:text-white/70",
            isCapturing && "animate-pulse"
          )}
          onClick={() => void captureScreenshot()}
          disabled={isCapturing}
          title="Capture & attach screenshot"
        >
          {isCapturing ? <Loader2 className="size-2.5 animate-spin" /> : <Camera className="size-2.5" />}
        </button>
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSendMessage();
            }
          }}
          placeholder={attachedImage ? "Describe what you see..." : "Ask anything..."}
          className="h-6 text-[9px] bg-white/5 border-white/10 text-white placeholder:text-white/30 flex-1 min-w-0"
          disabled={isStreaming}
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0 text-white/60 hover:text-white"
          onClick={() => void handleSendMessage()}
          disabled={(!inputValue.trim() && !attachedImage) || isStreaming}
        >
          <Send className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function buildOverlaySystemPrompt(gameName?: string, exeName?: string): string {
  let prompt = "You are GameVault AI, the in-app assistant for GameVault. You are a practical gaming assistant focused on the user’s immediate request.\n\nProduct context:\n- GameVault is created by Ranit Bhowmick (ranitbhowmick.com)\n- Support email: mail@ranitbhowmick.com\n\nYour scope:\n- Help with game mechanics, quests, item descriptions, progression tips, builds, and troubleshooting\n- Help with save/backups/restores only when asked\n- Keep guidance concise and actionable for real players\n\nRules:\n- For greetings or short openers, respond naturally and ask what they need\n- Do not push backup/save guidance unless requested\n- Keep responses compact in overlay mode\n- If uncertain, say so and provide a safe next step\n- Do not invent game facts. Suggest to use the web icon in the overlay to perform actual web search if you dont know something.";

  if (gameName) {
    prompt += `\n\nCurrent game context: ${gameName}.`;
  }
  if (exeName) {
    prompt += ` Executable hint: ${exeName}.`;
  }

  return prompt;
}
