import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  History,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";

interface Props {
  defaultSearchEngine: string;
  /** callback to change search engine */
  onSearchEngineChange?: (engine: string) => void;
}

const ENGINES: Record<string, { name: string; url: (q: string) => string; icon: string }> = {
  google: {
    name: "Google",
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&igu=1`,
    icon: "G",
  },
  duckduckgo: {
    name: "DuckDuckGo",
    url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kae=d&k7=%23293038&kj=%23181a1f&k9=%2371d4a0&kx=%236c8cff&k8=%23e0e0e0&kaa=%239ecfff`,
    icon: "D",
  },
  bing: {
    name: "Bing",
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    icon: "B",
  },
  youtube: {
    name: "YouTube",
    url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    icon: "Y",
  },
};

export default function OverlaySearch({ defaultSearchEngine, onSearchEngineChange }: Props) {
  const [query, setQuery] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [engine, setEngine] = useState(defaultSearchEngine || "google");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gv_search_history") || "[]");
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const engineConfig = ENGINES[engine] || ENGINES.google;

  useEffect(() => {
    localStorage.setItem("gv_search_history", JSON.stringify(history.slice(0, 20)));
  }, [history]);

  const handleSearch = (q?: string) => {
    const searchQuery = (q || query).trim();
    if (!searchQuery) return;
    const url = engineConfig.url(searchQuery);
    setCurrentUrl(url);
    setShowHistory(false);
    setHistory((prev) => {
      const next = [searchQuery, ...prev.filter((h) => h.toLowerCase() !== searchQuery.toLowerCase())];
      return next.slice(0, 20);
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("gv_search_history");
  };

  const cycleEngine = () => {
    const keys = Object.keys(ENGINES);
    const idx = keys.indexOf(engine);
    const next = keys[(idx + 1) % keys.length];
    setEngine(next);
    onSearchEngineChange?.(next);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-2.5 py-1.5 border-b border-white/[0.06] flex items-center gap-1.5">
        <button
          className="size-5 flex items-center justify-center rounded bg-white/10 text-[8px] font-bold shrink-0 hover:bg-white/20 transition-colors"
          onClick={cycleEngine}
          title={`Switch engine (current: ${engineConfig.name})`}
        >
          {engineConfig.icon}
        </button>
        <div className="flex-1 relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            onFocus={() => history.length > 0 && setShowHistory(true)}
            onBlur={() => setTimeout(() => setShowHistory(false), 200)}
            placeholder={`Search ${engineConfig.name}...`}
            className="h-6 text-[9px] bg-white/5 border-white/10 text-white placeholder:text-white/30 pr-6"
          />
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-0 top-0 size-6 text-white/40 hover:text-white"
            onClick={() => handleSearch()}
            disabled={!query.trim()}
          >
            <Search className="size-3" />
          </Button>

          {/* Search history dropdown */}
          {showHistory && history.length > 0 && (
            <div className="absolute top-7 left-0 right-0 z-50 rounded-lg border border-white/10 bg-black/95 shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.06]">
                <span className="text-[8px] text-white/40">Recent</span>
                <button
                  className="text-[7px] text-white/30 hover:text-white/60"
                  onMouseDown={(e) => { e.preventDefault(); clearHistory(); }}
                >
                  Clear
                </button>
              </div>
              <ScrollArea className="max-h-32">
                {history.map((h, i) => (
                  <button
                    key={i}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-[8px] text-white/60 hover:bg-white/10 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); setQuery(h); handleSearch(h); }}
                  >
                    <History className="size-2.5 text-white/25 shrink-0" />
                    <span className="truncate">{h}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>
          )}
        </div>
        {currentUrl && (
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-white/40 hover:text-white"
              onClick={() => iframeRef.current?.contentWindow?.history.back()}
              title="Back"
            >
              <ArrowLeft className="size-2.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-white/40 hover:text-white"
              onClick={() => iframeRef.current?.contentWindow?.history.forward()}
              title="Forward"
            >
              <ArrowRight className="size-2.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-white/40 hover:text-white"
              onClick={() => iframeRef.current?.contentWindow?.location.reload()}
              title="Reload"
            >
              <RotateCcw className="size-2.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-white/40 hover:text-white"
              onClick={() => { if (currentUrl) window.open(currentUrl, "_blank"); }}
              title="Open in browser"
            >
              <ExternalLink className="size-2.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-white/40 hover:text-red-400"
              onClick={() => setCurrentUrl("")}
              title="Close browser"
            >
              <X className="size-2.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Content area */}
      {currentUrl ? (
        <div className="flex-1 relative">
          <iframe
            ref={iframeRef}
            src={currentUrl}
            className="w-full h-full border-0 rounded-b-lg"
            style={{
              transform: 'scale(0.92)',
              transformOrigin: 'top left',
              width: 'calc(100% / 0.92)',
              height: 'calc(100% / 0.92)',
              filter: 'brightness(0.82) contrast(1.08)',
            }}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            title="Web Search"
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <Globe className="size-8 text-white/10 mb-2" />
          <p className="text-[10px] text-white/40 mb-1">Quick Web Search</p>
          <p className="text-[8px] text-white/25 text-center max-w-56">
            Search for game guides, save locations, fixes & more. Click the engine icon to switch between Google, DuckDuckGo, Bing, or YouTube.
          </p>

          {/* Quick search suggestions */}
          <div className="flex flex-wrap gap-1 justify-center mt-3">
            {[
              "save file location",
              "game performance fix",
              "best settings guide",
              "controller not working fix",
            ].map((q) => (
              <button
                key={q}
                className="text-[7px] px-2 py-0.5 rounded-full border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors"
                onClick={() => { setQuery(q); handleSearch(q); }}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Recent searches */}
          {history.length > 0 && (
            <div className="mt-4 w-full max-w-64">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] text-white/30">Recent</p>
                <button className="text-[7px] text-white/20 hover:text-white/50" onClick={clearHistory}>
                  <Trash2 className="size-2.5 inline" /> Clear
                </button>
              </div>
              <div className="space-y-0.5">
                {history.slice(0, 5).map((h, i) => (
                  <button
                    key={i}
                    className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-[8px] text-white/50 hover:bg-white/[0.06] transition-colors"
                    onClick={() => { setQuery(h); handleSearch(h); }}
                  >
                    <History className="size-2 text-white/20 shrink-0" />
                    <span className="truncate">{h}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
