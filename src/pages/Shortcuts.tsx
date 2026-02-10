import React from "react";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Camera,
  Archive,
  Keyboard,
  FolderOpen,
  Gamepad2,
  RotateCcw,
  Play,
  Star,
  Search,
  Settings,
  Plus,
} from "lucide-react";

const shortcuts = [
  {
    category: "Global",
    items: [
      { keys: ["Ctrl", "Shift", "B"], description: "Quick backup current game" },
      { keys: ["Ctrl", "Shift", "S"], description: "Take screenshot" },
      { keys: ["Ctrl", "Shift", "R"], description: "Quick restore last backup" },
      { keys: ["Ctrl", "/"], description: "Open search" },
      { keys: ["Ctrl", ","], description: "Open settings" },
      { keys: ["Ctrl", "N"], description: "Add new game" },
    ],
  },
  {
    category: "Library",
    items: [
      { keys: ["Ctrl", "F"], description: "Search games" },
      { keys: ["Ctrl", "1"], description: "Grid view" },
      { keys: ["Ctrl", "2"], description: "List view" },
      { keys: ["F5"], description: "Refresh / detect games" },
    ],
  },
  {
    category: "Game Detail",
    items: [
      { keys: ["Ctrl", "B"], description: "Create backup" },
      { keys: ["Ctrl", "P"], description: "Launch game" },
      { keys: ["Ctrl", "O"], description: "Open save directory" },
      { keys: ["Ctrl", "D"], description: "Toggle favorite" },
    ],
  },
  {
    category: "Navigation",
    items: [
      { keys: ["Ctrl", "Shift", "L"], description: "Go to Library" },
      { keys: ["Ctrl", "Shift", "K"], description: "Go to Key Mapper" },
      { keys: ["Ctrl", "Shift", "M"], description: "Go to Macros" },
      { keys: ["Ctrl", "Shift", "C"], description: "Go to AI Chat" },
      { keys: ["Escape"], description: "Go back / close dialog" },
    ],
  },
];

const iconMap: Record<string, React.ReactNode> = {
  "Quick backup current game": <Archive className="size-3" />,
  "Take screenshot": <Camera className="size-3" />,
  "Quick restore last backup": <RotateCcw className="size-3" />,
  "Open search": <Search className="size-3" />,
  "Open settings": <Settings className="size-3" />,
  "Add new game": <Plus className="size-3" />,
  "Launch game": <Play className="size-3" />,
  "Open save directory": <FolderOpen className="size-3" />,
  "Toggle favorite": <Star className="size-3" />,
  "Search games": <Search className="size-3" />,
};

export default function Shortcuts() {
  return (
    <div className="flex flex-col h-full">
      <Header
        title="Keyboard Shortcuts"
        description="Quick reference for all hotkeys"
      />

      <ScrollArea className="flex-1">
        <div className="p-5 max-w-2xl space-y-4">
          {shortcuts.map((section) => (
            <Card key={section.category}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {section.category === "Global" && <Gamepad2 className="size-3.5" />}
                  {section.category === "Library" && <FolderOpen className="size-3.5" />}
                  {section.category === "Game Detail" && <Archive className="size-3.5" />}
                  {section.category === "Navigation" && <Keyboard className="size-3.5" />}
                  {section.category}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {section.items.map((shortcut, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      {iconMap[shortcut.description] && (
                        <span className="text-muted-foreground">
                          {iconMap[shortcut.description]}
                        </span>
                      )}
                      <span>{shortcut.description}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, ki) => (
                        <React.Fragment key={ki}>
                          <kbd className="min-w-6 text-center px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono font-medium">
                            {key}
                          </kbd>
                          {ki < shortcut.keys.length - 1 && (
                            <span className="text-[8px] text-muted-foreground">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <p className="text-[9px] text-muted-foreground/60 text-center pb-4">
            Shortcuts work globally when GameVault is focused. Some shortcuts may be overridden by games when they're running.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
