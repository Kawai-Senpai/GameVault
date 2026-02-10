import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Bot, Globe, Send, Sparkles, Trash2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/types";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Props {
  settings: AppSettings;
}

export default function OverlayChat({ settings }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const isOpenRouter = settings.ai_provider === "openrouter";

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: inputValue.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsStreaming(true);

    try {
      let response = "";
      if (settings.ai_api_key && settings.ai_provider) {
        let model = settings.ai_model || "openai/gpt-4o-mini";
        if (webSearchEnabled && isOpenRouter && !model.endsWith(":online")) model = `${model}:online`;
        const apiUrl =
          settings.ai_provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : settings.ai_provider === "openai"
              ? "https://api.openai.com/v1/chat/completions"
              : `${settings.ai_provider}/v1/chat/completions`;
        const res = await tauriFetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.ai_api_key}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: userMsg.content },
            ],
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
            { role: "user", content: userMsg.content },
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
              <div className="flex flex-wrap gap-1 justify-center mt-2">
                {["Where are my Elden Ring saves?", "Best backup strategy?", "How to fix corrupt saves?"].map((q) => (
                  <button
                    key={q}
                    className="text-[7px] px-2 py-0.5 rounded-full border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors"
                    onClick={() => {
                      setInputValue(q);
                    }}
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
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
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
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSendMessage();
            }
          }}
          placeholder="Ask anything..."
          className="h-6 text-[9px] bg-white/5 border-white/10 text-white placeholder:text-white/30 flex-1 min-w-0"
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0 text-white/60 hover:text-white"
          onClick={() => void handleSendMessage()}
          disabled={!inputValue.trim() || isStreaming}
        >
          <Send className="size-3" />
        </Button>
      </div>
    </div>
  );
}
