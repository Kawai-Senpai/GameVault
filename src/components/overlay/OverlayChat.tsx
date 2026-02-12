import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Bot, Camera, Globe, ImageIcon, Loader2, Send, Sparkles, Trash2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/types";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageBase64?: string; // attached screenshot (data URI)
}

interface Props {
  settings: AppSettings;
  gameName?: string;
  exeName?: string;
}

export default function OverlayChat({ settings, gameName, exeName }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null); // base64 data URI
  const [isCapturing, setIsCapturing] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const isOpenRouter = settings.ai_provider === "openrouter";

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const captureScreenshot = async () => {
    setIsCapturing(true);
    try {
      // Hide overlay temporarily
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const overlayWin = getCurrentWindow();
      await overlayWin.hide();
      await new Promise((r) => setTimeout(r, 250));

      const base64 = await invoke<string>("capture_screen");

      await overlayWin.show();

      setAttachedImage(`data:image/png;base64,${base64}`);
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
      imageBase64: attachedImage || undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    const capturedImage = attachedImage;
    setAttachedImage(null);
    setIsStreaming(true);

    try {
      let response = "";
      if (settings.ai_api_key && settings.ai_provider) {
        let model = settings.ai_model || "openai/gpt-5.2:online";
        if (webSearchEnabled && isOpenRouter && !model.endsWith(":online")) model = `${model}:online`;
        const apiUrl =
          settings.ai_provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : settings.ai_provider === "openai"
              ? "https://api.openai.com/v1/chat/completions"
              : `${settings.ai_provider}/v1/chat/completions`;

        // Build message history — convert to vision format if images are present
        const apiMessages = messages.map((m) => {
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
        });

        // Add current message
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
            Authorization: `Bearer ${settings.ai_api_key}`,
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
      } else {
        response = await invoke<string>("ai_chat", {
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userText },
          ],
        });
      }
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: response }]);
    } catch (err) {
      toast.error(`AI: ${err}`);
    } finally {
      setIsStreaming(false);
    }
  };

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
          {messages.length === 0 && (
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
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                )}
              </div>
              {msg.role === "user" && (
                <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <User className="size-2" />
                </div>
              )}
            </div>
          ))}
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
