import React, { useCallback, useEffect, useRef, useState } from "react";
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
import {
  getAllConversations,
  saveConversation as dbSaveConversation,
  deleteConversation as dbDeleteConversation,
  generateConversationId,
  generateConversationTitle,
  migrateOldJsonToSqlite,
  type ChatConversation as DbChatConversation,
  type ChatMessage as DbChatMessage,
  type AttachedImage,
  type MessageMetadata,
} from "@/lib/database/chat-history.actions";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useNavigate } from "react-router-dom";
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
  Plus,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// View-layer message type (extends DB type with transient UI fields)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  webSearchUsed?: boolean;
  gameContext?: string;
  images?: AttachedImage[];
  metadata?: MessageMetadata;
}

// View-layer conversation type
interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: "main" | "overlay";
  messages: ChatMessage[];
}

const ACTIVE_CHAT_STORAGE_KEY = "gamevault_ai_chat_active_v1";

const INTRO_MESSAGE =
  "Hey! I'm your GameVault AI assistant. Ask me about game mechanics, quests, progression, troubleshooting, save issues, or anything gaming-related.\n\nTip: Select a game for context-aware responses, or enable web search for live data.";

function createIntroMessage(content = INTRO_MESSAGE): ChatMessage {
  return {
    id: `intro_${Date.now()}`,
    role: "assistant",
    content,
    timestamp: new Date(),
  };
}

function buildNewConversation(title = "New Chat"): ChatConversation {
  const now = Date.now();
  return {
    id: generateConversationId("main"),
    title,
    createdAt: now,
    updatedAt: now,
    source: "main",
    messages: [createIntroMessage()],
  };
}

// Convert view ChatMessage → DB ChatMessage
function toDbMessage(msg: ChatMessage): DbChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp instanceof Date ? msg.timestamp.getTime() : Date.now(),
    images: msg.images,
    metadata: msg.metadata
      ? {
          ...msg.metadata,
          webSearchUsed: msg.webSearchUsed,
          gameContext: msg.gameContext,
        }
      : msg.webSearchUsed || msg.gameContext
        ? { webSearchUsed: msg.webSearchUsed, gameContext: msg.gameContext }
        : undefined,
  };
}

// Convert DB ChatMessage → view ChatMessage
function fromDbMessage(msg: DbChatMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp || Date.now()),
    images: msg.images,
    metadata: msg.metadata,
    webSearchUsed: msg.metadata?.webSearchUsed,
    gameContext: msg.metadata?.gameContext,
  };
}

// Convert DB conversation → view conversation
function fromDbConversation(conv: DbChatConversation): ChatConversation {
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    source: conv.source,
    messages: conv.messages.length > 0 ? conv.messages.map(fromDbMessage) : [createIntroMessage()],
  };
}

// Convert view conversation → DB conversation for saving
function toDbConversation(conv: ChatConversation): DbChatConversation {
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    source: conv.source,
    messages: conv.messages
      .filter((m) => !m.isStreaming) // never persist streaming state
      .map(toDbMessage),
  };
}

export default function AiChat() {
  const { games, settings } = useApp();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [historyReady, setHistoryReady] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreamingText, setIsStreamingText] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string>("none");
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [expandedImageIds, setExpandedImageIds] = useState<Set<string>>(new Set());
  const [isCapturing, setIsCapturing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const conversationDirtyRef = useRef(false); // true when user actually sends/receives a message
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 5;

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        // One-time migration from old JSON-blob storage to SQLite tables
        await migrateOldJsonToSqlite();

        const dbConversations = await getAllConversations();
        const loaded = dbConversations.map(fromDbConversation);

        const activeRaw = localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) || "";
        const fallbackConversation = buildNewConversation();
        const nextConversations = loaded.length > 0 ? loaded : [fallbackConversation];
        const activeExists = nextConversations.some((c) => c.id === activeRaw);
        const nextActiveId = activeExists ? activeRaw : nextConversations[0].id;
        const activeConversation =
          nextConversations.find((c) => c.id === nextActiveId) || nextConversations[0];

        if (cancelled) return;
        setConversations(nextConversations);
        setActiveConversationId(nextActiveId);
        conversationDirtyRef.current = false;
        setMessages(activeConversation.messages);
        setHistoryReady(true);
      } catch (err) {
        console.error("[AiChat] Failed to load history:", err);
        const fallback = buildNewConversation();
        if (!cancelled) {
          setConversations([fallback]);
          setActiveConversationId(fallback.id);
          setMessages(fallback.messages);
          setHistoryReady(true);
        }
      }
    };

    void loadHistory();
    return () => { cancelled = true; };
  }, []);

  // Persist active conversation to SQLite on message changes
  useEffect(() => {
    if (!historyReady || !activeConversationId) return;
    const hasStreamingMessage = messages.some((msg) => msg.isStreaming);
    if (hasStreamingMessage) return;

    const isDirty = conversationDirtyRef.current;
    if (!isDirty) return; // Don't save if we just loaded (prevents needless writes + reorder)

    const newTitle = generateConversationTitle(messages.map(toDbMessage));
    const newUpdatedAt = Date.now();

    // Update local state and persist
    setConversations((prev) => {
      const activeConv = prev.find((c) => c.id === activeConversationId);
      if (activeConv) {
        const toSave: DbChatConversation = toDbConversation({
          ...activeConv,
          title: newTitle,
          updatedAt: newUpdatedAt,
          messages,
        });

        dbSaveConversation(toSave).then(() => {
          localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeConversationId);
        }).catch((err) => {
          console.error("[AiChat] Failed to save conversation:", err);
        });
      }

      return prev.map((conv) =>
        conv.id === activeConversationId
          ? { ...conv, title: newTitle, updatedAt: newUpdatedAt, messages }
          : conv
      );
    });
  }, [messages, activeConversationId, historyReady]);

  // Sync all conversations from SQLite (picks up overlay conversations automatically)
  useEffect(() => {
    if (!historyReady) return;

    const syncFromDb = async () => {
      try {
        const dbConversations = await getAllConversations();
        const loaded = dbConversations.map(fromDbConversation);
        if (loaded.length === 0) return;

        setConversations((prev) => {
          const localIds = new Set(prev.map((c) => c.id));
          const newOnes = loaded.filter((c) => !localIds.has(c.id));

          // Update existing conversations that were modified externally (e.g., overlay)
          let updated = false;
          const merged = prev.map((local) => {
            const dbVersion = loaded.find((d) => d.id === local.id);
            if (dbVersion && dbVersion.id !== activeConversationId && dbVersion.updatedAt > local.updatedAt) {
              updated = true;
              return dbVersion;
            }
            return local;
          });

          if (newOnes.length === 0 && !updated) return prev;
          return newOnes.length > 0 ? [...merged, ...newOnes] : merged;
        });
      } catch { /* silent */ }
    };

    void syncFromDb();
    const pollTimer = window.setInterval(syncFromDb, 4000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncFromDb();
    };
    const onFocus = () => void syncFromDb();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [historyReady, activeConversationId]);

  const isOpenRouter = settings.ai_provider === "openrouter";
  const hasApiKey = !!settings.ai_api_key?.trim();
  const isChatReady = historyReady && !!activeConversationId;
  const selectedGame = selectedGameId !== "none" ? games.find((g) => g.id === selectedGameId) : null;

  const openAiSetupWizard = useCallback(() => {
    navigate("/settings#ai-configuration");
  }, [navigate]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const viewport = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }, 50);
  }, []);

  const streamAssistantText = useCallback(
    async (fullText: string, metadata?: MessageMetadata) => {
      const assistantId = (Date.now() + 1).toString();
      const finalText = fullText || "No response received.";
      const total = finalText.length;
      const step = total > 1200 ? 20 : total > 600 ? 12 : 7;

      setIsStreamingText(true);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
          metadata,
        },
      ]);
      scrollToBottom();

      try {
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
          scrollToBottom();
        }
      } finally {
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
        setIsStreamingText(false);
      }
    },
    [scrollToBottom]
  );

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

  const toggleImageSize = (imageId: string) => {
    setExpandedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const downloadImage = (image: AttachedImage) => {
    try {
      const link = document.createElement("a");
      link.href = `data:image/png;base64,${image.base64}`;
      link.download = image.name || `image_${Date.now()}.png`;
      link.click();
      toast.success("Image downloaded");
    } catch (err) {
      toast.error(`Image download failed: ${err}`);
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
    if (!isChatReady || ((!text && attachedImages.length === 0) || isLoading || isStreamingText)) return;

    const capturedImages = [...attachedImages];

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text || (capturedImages.length > 0 ? "(image)" : ""),
      timestamp: new Date(),
      webSearchUsed: webSearchEnabled && isOpenRouter,
      gameContext: selectedGame?.name,
      images: capturedImages.length > 0 ? capturedImages : undefined,
      metadata: {
        webSearchEnabled: webSearchEnabled && isOpenRouter,
      },
    };

    conversationDirtyRef.current = true; // user sent a message
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachedImages([]);
    scrollToBottom();

    if (!hasApiKey || !settings.ai_provider) {
      const setupMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: getAiSetupWizardMessage(settings.ai_provider),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, setupMsg]);
      toast.error("AI is not configured yet. Opening AI setup.");
      openAiSetupWizard();
      scrollToBottom();
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);

    try {
      let response: string;

      let model = settings.ai_model || "openai/gpt-5.2:online";

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
            const metadataPayload =
              m.role === "assistant"
                ? {
                    ...(m.metadata?.reasoning ? { reasoning: m.metadata.reasoning } : {}),
                    ...(m.metadata?.reasoningDetails && m.metadata.reasoningDetails.length > 0
                      ? { reasoning_details: m.metadata.reasoningDetails }
                      : {}),
                    ...(m.metadata?.toolCalls && m.metadata.toolCalls.length > 0
                      ? { tool_calls: m.metadata.toolCalls }
                      : {}),
                  }
                : {};

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
                ...metadataPayload,
              };
            }
            return { role: m.role, content: m.content, ...metadataPayload };
          }),
      ];

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
        id?: string;
        usage?: unknown;
        choices?: Array<{
          finish_reason?: string;
          message?: {
            id?: string;
            content?: string;
            reasoning?: string;
            reasoning_details?: unknown[];
            tool_calls?: unknown[];
          };
          reasoning?: string;
          reasoning_details?: unknown[];
          tool_calls?: unknown[];
        }>;
        reasoning?: string;
        reasoning_details?: unknown[];
        tool_calls?: unknown[];
        error?: { message?: string };
      };

      if (data.error) throw new Error(data.error.message || "API error");
      const choice = data.choices?.[0];
      response = choice?.message?.content || "No response received.";

      const assistantMetadata: MessageMetadata | undefined =
        choice || data.reasoning || data.reasoning_details || data.tool_calls
          ? {
              reasoning:
                choice?.message?.reasoning ||
                choice?.reasoning ||
                data.reasoning,
              reasoningDetails:
                choice?.message?.reasoning_details ||
                choice?.reasoning_details ||
                data.reasoning_details ||
                [],
              toolCalls:
                choice?.message?.tool_calls ||
                choice?.tool_calls ||
                data.tool_calls ||
                [],
              usage: data.usage,
              finishReason: choice?.finish_reason,
              providerMessageId: choice?.message?.id || data.id,
            }
          : undefined;

      await streamAssistantText(response, assistantMetadata);
    } catch (err) {
      toast.error(`AI error: ${err}`);
      const setupOrError: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: getAiProviderErrorMessage(err, settings.ai_provider),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, setupOrError]);
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

  const handleConversationChange = (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    conversationDirtyRef.current = false; // loading existing, not modifying
    setActiveConversationId(conversationId);
    setMessages(conversation.messages);
    setInput("");
    setAttachedImages([]);
    scrollToBottom();
  };

  const handleNewConversation = () => {
    if (isLoading || isStreamingText) return;
    const conversation = buildNewConversation();
    setConversations((prev) => [conversation, ...prev]);
    conversationDirtyRef.current = true;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setInput("");
    setAttachedImages([]);
    scrollToBottom();

    // Persist immediately to SQLite
    dbSaveConversation(toDbConversation(conversation)).catch((err) => {
      console.error("[AiChat] Failed to save new conversation:", err);
    });
  };

  const handleClear = () => {
    conversationDirtyRef.current = true;
    setMessages([createIntroMessage("Chat cleared! What do you want help with next?")]);
  };

  const handleDeleteConversation = (conversationId: string) => {
    if (isLoading || isStreamingText) return;

    // Delete from SQLite
    dbDeleteConversation(conversationId).catch((err) => {
      console.error("[AiChat] Failed to delete conversation:", err);
    });

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== conversationId);
      if (filtered.length === 0) {
        const freshChat = buildNewConversation();
        dbSaveConversation(toDbConversation(freshChat)).catch(() => {});
        setActiveConversationId(freshChat.id);
        setMessages(freshChat.messages);
        return [freshChat];
      }
      if (conversationId === activeConversationId) {
        const next = filtered[0];
        setActiveConversationId(next.id);
        setMessages(next.messages);
      }
      return filtered;
    });
    setDeleteConfirmId(null);
    toast.success("Chat deleted");
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
  };

  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="AI Chat"
        description={
          hasApiKey
            ? `Connected to ${settings.ai_provider || "AI"} · ${settings.ai_model || "default model"}`
            : "AI not configured · Open setup wizard to connect a provider"
        }
        rightContent={
          <div className="flex items-center gap-1.5">
            {/* Sidebar toggle */}
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => setSidebarOpen((p) => !p)}
              title={sidebarOpen ? "Hide chat list" : "Show chat list"}
            >
              {sidebarOpen ? <PanelLeftClose className="size-3" /> : <PanelLeft className="size-3" />}
            </Button>

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

      {/* Main layout: sidebar + chat */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Sidebar Panel ── */}
        <div
          className={cn(
            "flex flex-col border-r border-border/50 bg-muted/10 shrink-0 transition-all duration-200 overflow-hidden",
            sidebarOpen ? "w-56 min-w-[14rem]" : "w-0 min-w-0 border-r-0"
          )}
        >
          {sidebarOpen && (
            <>
              {/* New chat button */}
              <div className="p-2 border-b border-border/30">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-[10px] gap-1.5 justify-start"
                  onClick={handleNewConversation}
                  disabled={!isChatReady || isLoading || isStreamingText}
                >
                  <Plus className="size-3" /> New Chat
                </Button>
              </div>

              {/* Conversation list */}
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {sortedConversations.length === 0 && (
                    <div className="px-3 py-8 text-center">
                      <MessageSquare className="size-5 mx-auto mb-2 text-muted-foreground/30" />
                      <p className="text-[9px] text-muted-foreground/50">No chats yet</p>
                    </div>
                  )}
                  {sortedConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    const isOverlay = conversation.source === "overlay" || conversation.id.startsWith("overlay_");
                    const msgCount = conversation.messages.filter((m) => m.role === "user").length;

                    return (
                      <div
                        key={conversation.id}
                        className={cn(
                          "group relative flex items-start gap-2 px-2.5 py-1.5 cursor-pointer transition-colors",
                          isActive
                            ? "bg-primary/10 border-l-2 border-primary"
                            : "hover:bg-muted/40 border-l-2 border-transparent"
                        )}
                        onClick={() => handleConversationChange(conversation.id)}
                      >
                        <div className="flex-1 min-w-0 py-0.5">
                          <div className="flex items-center gap-1">
                            {isOverlay && (
                              <span className="text-[7px] px-1 py-px rounded bg-gaming/15 text-gaming shrink-0">OVL</span>
                            )}
                            <p className={cn(
                              "text-[10px] truncate leading-tight",
                              isActive ? "text-foreground font-medium" : "text-muted-foreground"
                            )}>
                              {conversation.title || "New Chat"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[8px] text-muted-foreground/50 flex items-center gap-0.5">
                              <Clock className="size-2" />
                              {formatTimeAgo(conversation.updatedAt)}
                            </span>
                            {msgCount > 0 && (
                              <span className="text-[8px] text-muted-foreground/40">
                                {msgCount} msg{msgCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Delete button */}
                        {deleteConfirmId === conversation.id ? (
                          <div className="flex items-center gap-0.5 shrink-0 py-0.5">
                            <button
                              className="text-[8px] px-1.5 py-0.5 rounded bg-destructive/90 text-white hover:bg-destructive transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteConversation(conversation.id);
                              }}
                            >
                              Delete
                            </button>
                            <button
                              className="text-[8px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive mt-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(conversation.id);
                            }}
                            title="Delete chat"
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              {/* Sidebar footer */}
              <div className="px-2.5 py-1.5 border-t border-border/30 bg-muted/20">
                <p className="text-[8px] text-muted-foreground/40 text-center">
                  {conversations.length} chat{conversations.length !== 1 ? "s" : ""}
                  {conversations.some((c) => c.source === "overlay" || c.id.startsWith("overlay_")) && " · overlay synced"}
                </p>
              </div>
            </>
          )}
        </div>

        {/* ── Chat Area ── */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Info bars */}
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
                AI is not configured. Open the setup wizard to connect OpenRouter or OpenAI.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[8px] ml-auto"
                onClick={openAiSetupWizard}
              >
                <Settings className="size-2.5" /> Open Wizard
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
                  {msg.role === "assistant" && msg.metadata?.reasoning && (
                    <div className="mb-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                      <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Thinking Summary</p>
                      <p className="text-[10px] whitespace-pre-wrap text-muted-foreground">
                        {msg.metadata.reasoning}
                      </p>
                    </div>
                  )}

                  {/* Attached images */}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {msg.images.map((img) => (
                        <div
                          key={img.id}
                          className={cn(
                            "rounded-lg overflow-hidden border border-border/30",
                            expandedImageIds.has(img.id) ? "max-w-[320px]" : "max-w-[180px]"
                          )}
                        >
                          <img
                            src={`data:image/png;base64,${img.base64}`}
                            alt={img.name}
                            className={cn(
                              "w-full h-auto object-cover",
                              expandedImageIds.has(img.id) ? "max-h-[260px]" : "max-h-[120px]"
                            )}
                            draggable={false}
                          />
                          <div className="flex items-center justify-end gap-1 px-1.5 py-1 bg-background/70 border-t border-border/30">
                            <button
                              onClick={() => toggleImageSize(img.id)}
                              className="text-[8px] text-muted-foreground hover:text-foreground"
                            >
                              {expandedImageIds.has(img.id) ? "Small" : "Large"}
                            </button>
                            <button
                              onClick={() => downloadImage(img)}
                              className="text-[8px] text-muted-foreground hover:text-foreground"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.content && msg.content !== "(image)" && (
                    <p className="whitespace-pre-wrap">
                      {msg.content}
                      {msg.isStreaming && (
                        <span className="inline-block size-1.5 rounded-full bg-current align-middle ml-1 animate-pulse" />
                      )}
                    </p>
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
                  : "Ask about mechanics, quests, items, builds, or troubleshooting..."
            }
            className="flex-1 h-9"
            disabled={!isChatReady || isLoading || isStreamingText}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!isChatReady || ((!input.trim() && attachedImages.length === 0) || isLoading || isStreamingText)}
            className="h-9 px-3"
          >
            <Send className="size-3" />
          </Button>
        </div>
        <p className="text-[8px] text-muted-foreground/50 text-center mt-1.5 max-w-2xl mx-auto">
          {hasApiKey
            ? `${settings.ai_provider} · ${settings.ai_model}${webSearchEnabled && isOpenRouter ? " :online" : ""}`
            : "AI disabled until provider setup is complete"
          }
          {" · "}Attach images with <ImageIcon className="inline size-2.5 -mt-0.5" /> or paste from clipboard
        </p>
      </div>
        </div>{/* end Chat Area */}
      </div>{/* end main flex */}
    </div>
  );
}

// ─── System Prompt Builder ───────────────────────────────────
function buildSystemPrompt(game: { name: string; developer: string; save_paths: string[]; notes: string } | null): string {
  let prompt = "You are GameVault AI, the built-in assistant inside GameVault. You are a practical gaming assistant focused on what the user asks right now.\n\nProduct context:\n- GameVault is created by Ranit Bhowmick (ranitbhowmick.com)\n- Support email: mail@ranitbhowmick.com\n\nPrimary role:\n- Help with game mechanics, quests, item descriptions, progression tips, builds, and troubleshooting\n- Help with save-related topics only when the user asks about saves/backups/restores\n- Provide clear, actionable, game-focused guidance\n\nBehavior rules:\n- If the user greets or sends a short opener, reply naturally and ask what they need\n- Do not jump into backup/save instructions unless directly requested\n- Be concise, accurate, and practical\n- Use markdown when it improves readability\n- If uncertain, say so clearly and give a safe next step\n- Do not fabricate game facts";

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

function getAiSetupWizardMessage(provider: string | undefined): string {
  const activeProvider = provider === "openai" ? "OpenAI" : "OpenRouter";
  return `AI is not configured yet, so I can't generate a real response.\n\nOpen AI setup wizard:\n1. Go to Settings → AI Configuration\n2. Choose provider (${activeProvider})\n3. Paste your API key\n4. Save and send your message again`;
}

function getAiProviderErrorMessage(error: unknown, provider: string | undefined): string {
  const details = String(error || "Unknown error").toLowerCase();
  const providerLabel = provider === "openai" ? "OpenAI" : "OpenRouter";

  if (details.includes("401") || details.includes("unauthorized") || details.includes("invalid") || details.includes("api key")) {
    return `Your ${providerLabel} credentials were rejected.\n\nPlease open Settings → AI Configuration, verify the API key, and try again.`;
  }

  if (details.includes("429") || details.includes("rate limit")) {
    return `Your ${providerLabel} request was rate-limited.\n\nWait a moment or switch to another model/provider in Settings → AI Configuration.`;
  }

  return `I couldn't reach ${providerLabel} right now.\n\nOpen Settings → AI Configuration to verify provider, model, and API key, then retry.`;
}
