import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { ScrollArea } from "@/components/ui/scroll-area";
import PerformancePanel from "@/components/PerformancePanel";
import { invoke } from "@tauri-apps/api/core";

interface RunningWindowInfo {
  pid: number;
  title: string;
  process_name: string;
  exe_path: string;
  is_foreground: boolean;
}

export default function Performance() {
  const [foregroundPid, setForegroundPid] = useState<number | null>(null);
  const [foregroundName, setForegroundName] = useState<string>("Foreground App");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const rows = await invoke<RunningWindowInfo[]>("list_running_windows");
        if (cancelled) return;
        const fg = rows.find((r) => r.is_foreground);
        if (fg) {
          setForegroundPid(fg.pid);
          setForegroundName(fg.process_name || fg.title || "Foreground App");
        }
      } catch {
        // silent
      }
    };

    void poll();
    const t = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Performance"
        description="Live system + current app performance"
      />
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 space-y-3 max-w-3xl">
          <PerformancePanel pid={foregroundPid} title={`Now: ${foregroundName}`} />
        </div>
      </ScrollArea>
    </div>
  );
}
