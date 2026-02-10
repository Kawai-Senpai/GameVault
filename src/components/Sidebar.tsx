import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "@/contexts/app.context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Library,
  Settings,
  Keyboard,
  Camera,
  Gamepad2,
  Zap,
  ChevronLeft,
  ChevronRight,
  Search,
  Star,
  Plus,
  Sparkles,
  FolderOpen,
  StickyNote,
} from "lucide-react";
import { cn, truncateText } from "@/lib/utils";
import GameCover from "@/components/GameCover";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { games, selectedGameId, setSelectedGameId, sidebarCollapsed, setSidebarCollapsed, version } = useApp();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const applyAutoCollapse = () => {
      if (window.innerWidth < 980 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
    };
    applyAutoCollapse();
    window.addEventListener("resize", applyAutoCollapse);
    return () => window.removeEventListener("resize", applyAutoCollapse);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  const navItems: NavItem[] = [
    { path: "/", label: "Library", icon: <Library className="size-3.5" /> },
    { path: "/screenshots", label: "Screenshots", icon: <Camera className="size-3.5" /> },
    { path: "/key-mapper", label: "Key Mapper", icon: <Keyboard className="size-3.5" /> },
    { path: "/macros", label: "Macros", icon: <Zap className="size-3.5" /> },
    { path: "/ai-chat", label: "AI Chat", icon: <Sparkles className="size-3.5" />, badge: "new" },
    { path: "/notes", label: "Notes", icon: <StickyNote className="size-3.5" /> },
    { path: "/shortcuts", label: "Shortcuts", icon: <Gamepad2 className="size-3.5" /> },
    { path: "/settings", label: "Settings", icon: <Settings className="size-3.5" /> },
  ];

  const filteredGames = useMemo(() => {
    if (!searchQuery.trim()) return games;
    const q = searchQuery.toLowerCase();
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.developer.toLowerCase().includes(q)
    );
  }, [games, searchQuery]);

  const favoriteGames = filteredGames.filter((g) => g.is_favorite);
  const otherGames = filteredGames.filter((g) => !g.is_favorite);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
          sidebarCollapsed ? "w-14" : "w-[clamp(13.25rem,18vw,16.5rem)]"
        )}
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
          {!sidebarCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold tracking-tight text-sidebar-foreground">
                Vault Navigation
              </span>
              <span className="text-[9px] text-muted-foreground">v{version}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto size-6"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronLeft className="size-3" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <div className="px-2 py-2 space-y-0.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return sidebarCollapsed ? (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={cn(
                      "w-full",
                      isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    onClick={() => navigate(item.path)}
                  >
                    {item.icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                key={item.path}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "w-full justify-start gap-2",
                  isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
                onClick={() => navigate(item.path)}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <Badge variant="gaming" className="ml-auto text-[8px] px-1 py-0">
                    {item.badge}
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="px-3 py-1">
          <div className="h-px bg-sidebar-border" />
        </div>

        {/* Games section */}
        {!sidebarCollapsed && (
          <>
            <div className="px-3 pb-1.5 pt-0.5 flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                My Games
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5"
                onClick={() => navigate("/add-game")}
              >
                <Plus className="size-3" />
              </Button>
            </div>

            {/* Search */}
            <div className="px-2 pb-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search games..."
                  className="h-7 pl-7 text-[11px]"
                />
              </div>
            </div>
          </>
        )}

        {/* Games list */}
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-0.5 pb-2">
            {/* Favorites */}
            {favoriteGames.length > 0 && !sidebarCollapsed && (
              <>
                <div className="px-1 py-1">
                  <span className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
                    <Star className="size-2.5 fill-warning text-warning" />
                    Favorites
                  </span>
                </div>
                {favoriteGames.map((game) => (
                  <GameItem
                    key={game.id}
                    game={game}
                    isSelected={selectedGameId === game.id}
                    collapsed={sidebarCollapsed}
                    onClick={() => {
                      setSelectedGameId(game.id);
                      navigate(`/game/${game.id}`);
                    }}
                  />
                ))}
              </>
            )}

            {/* Other games */}
            {otherGames.map((game) => (
              <GameItem
                key={game.id}
                game={game}
                isSelected={selectedGameId === game.id}
                collapsed={sidebarCollapsed}
                onClick={() => {
                  setSelectedGameId(game.id);
                  navigate(`/game/${game.id}`);
                }}
              />
            ))}

            {filteredGames.length === 0 && !sidebarCollapsed && (
              <div className="px-2 py-4 text-center">
                <FolderOpen className="size-5 mx-auto text-muted-foreground/40 mb-1" />
                <p className="text-[10px] text-muted-foreground/60">
                  {searchQuery ? "No games found" : "No games added yet"}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        {!sidebarCollapsed && (
          <div className="px-3 py-2 border-t border-sidebar-border">
            <a
              href="https://ranitbhowmick.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              by Ranit Bhowmick
            </a>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ─── Game Item Component ─────────────────────────────────────
interface GameItemProps {
  game: {
    id: string;
    name: string;
    developer: string;
    cover_url: string | null;
    custom_cover_path: string | null;
    is_detected: boolean;
    is_favorite: boolean;
  };
  isSelected: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function GameItem({ game, isSelected, collapsed, onClick }: GameItemProps) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              "w-full flex items-center justify-center rounded-lg h-8 transition-all cursor-pointer",
              isSelected
                ? "bg-sidebar-accent"
                : "hover:bg-sidebar-accent/50"
            )}
          >
            <GameCover
              gameId={game.id}
              gameName={game.name}
              coverUrl={game.cover_url}
              customCoverPath={game.custom_cover_path}
              className="size-5 rounded"
              singleChar
              initialsClassName="text-[8px]"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{game.name}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all text-left cursor-pointer group",
        isSelected
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
      )}
    >
      <GameCover
        gameId={game.id}
        gameName={game.name}
        coverUrl={game.cover_url}
        customCoverPath={game.custom_cover_path}
        className="size-6 rounded shrink-0"
        singleChar
        initialsClassName="text-[9px]"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium truncate leading-tight">
          {truncateText(game.name, 22)}
        </div>
        <div className="text-[9px] text-muted-foreground truncate leading-tight">
          {game.developer}
        </div>
      </div>
      {game.is_detected && (
        <div className="size-1.5 rounded-full bg-success shrink-0" />
      )}
    </button>
  );
}
