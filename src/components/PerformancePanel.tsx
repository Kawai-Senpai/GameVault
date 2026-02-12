import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn, formatBytes } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Cpu, HardDrive, Monitor } from "lucide-react";

type PerfProcess = {
  pid: number;
  name: string;
  exe_path: string;
  cpu_percent: number;
  memory_bytes: number;
};

type PerfSystem = {
  cpu_percent: number;
  memory_total_bytes: number;
  memory_used_bytes: number;
  memory_percent: number;
};

type PerfGpu = {
  usage_percent: number;
};

type PerformanceSnapshot = {
  system: PerfSystem;
  gpu: PerfGpu | null;
  target: PerfProcess | null;
  top: PerfProcess[];
};

const HISTORY_POINTS = 60;

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sparkPath(values: number[], width: number, height: number) {
  if (values.length === 0) return "";
  const max = Math.max(1e-9, ...values);
  const min = Math.min(0, ...values);
  const range = Math.max(1e-9, max - min);

  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((v, i) => {
      const x = i * step;
      const yNorm = (v - min) / range;
      const y = height - yNorm * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 120;
  const h = 28;
  const d = useMemo(() => sparkPath(values, w, h), [values]);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.9} />
    </svg>
  );
}

export default function PerformancePanel({
  pid,
  title = "Performance",
  compact = false,
}: {
  pid?: number | null;
  title?: string;
  compact?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [gpuHistory, setGpuHistory] = useState<number[]>([]);

  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await invoke<PerformanceSnapshot>("get_performance_snapshot", {
          pid: pid ?? null,
          topN: compact ? 6 : 10,
        });
        if (cancelled) return;

        setSnapshot(result);
        setLoading(false);

        setCpuHistory((prev) => {
          const next = [...prev, result.system.cpu_percent];
          return next.slice(-HISTORY_POINTS);
        });
        setMemHistory((prev) => {
          const next = [...prev, result.system.memory_percent];
          return next.slice(-HISTORY_POINTS);
        });
        setGpuHistory((prev) => {
          const v = result.gpu?.usage_percent ?? 0;
          const next = [...prev, v];
          return next.slice(-HISTORY_POINTS);
        });
      } catch {
        // keep last good snapshot
      }
    };

    void tick();
    pollRef.current = window.setInterval(tick, 1000);

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [pid, compact]);

  const systemCpu = snapshot?.system.cpu_percent ?? 0;
  const systemMemPercent = snapshot?.system.memory_percent ?? 0;
  const systemMemUsed = snapshot?.system.memory_used_bytes ?? 0;
  const systemMemTotal = snapshot?.system.memory_total_bytes ?? 0;
  const gpuPercent = snapshot?.gpu?.usage_percent ?? 0;

  const target = snapshot?.target;

  return (
    <Card className={cn(compact && "border-white/[0.10] bg-white/[0.03]")}> 
      <CardHeader className={cn(compact ? "py-2 px-3" : "")}> 
        <CardTitle className={cn("flex items-center gap-2", compact ? "text-[11px]" : "")}> 
          <Activity className={cn("size-4", compact && "size-3.5")} /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("space-y-3", compact ? "px-3 pb-3" : "")}> 
        {loading || !snapshot ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border/40 p-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-20 mt-2" />
                </div>
              ))}
            </div>
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <div className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-3")}> 
              <div className={cn("rounded-xl border border-border/40 p-2", compact && "border-white/10 bg-white/5")}> 
                <div className="flex items-center justify-between">
                  <span className={cn("text-[10px] text-muted-foreground flex items-center gap-1", compact && "text-white/50")}> 
                    <Cpu className="size-3" /> CPU
                  </span>
                  <Sparkline values={cpuHistory} className={cn("text-primary", compact && "text-white/60")} />
                </div>
                <div className={cn("mt-1 text-xs font-semibold tabular-nums", compact && "text-white")}> 
                  {systemCpu.toFixed(0)}%
                </div>
              </div>

              <div className={cn("rounded-xl border border-border/40 p-2", compact && "border-white/10 bg-white/5")}> 
                <div className="flex items-center justify-between">
                  <span className={cn("text-[10px] text-muted-foreground flex items-center gap-1", compact && "text-white/50")}> 
                    <HardDrive className="size-3" /> RAM
                  </span>
                  <Sparkline values={memHistory} className={cn("text-emerald-500", compact && "text-white/60")} />
                </div>
                <div className={cn("mt-1 text-xs font-semibold tabular-nums", compact && "text-white")}> 
                  {systemMemPercent.toFixed(0)}%
                </div>
                <div className={cn("text-[9px] text-muted-foreground", compact && "text-white/35")}> 
                  {formatBytes(systemMemUsed)} / {formatBytes(systemMemTotal)}
                </div>
              </div>

              <div className={cn("rounded-xl border border-border/40 p-2", compact && "border-white/10 bg-white/5")}> 
                <div className="flex items-center justify-between">
                  <span className={cn("text-[10px] text-muted-foreground flex items-center gap-1", compact && "text-white/50")}> 
                    <Monitor className="size-3" /> GPU
                  </span>
                  <Sparkline values={gpuHistory} className={cn("text-sky-500", compact && "text-white/60")} />
                </div>
                <div className={cn("mt-1 text-xs font-semibold tabular-nums", compact && "text-white")}> 
                  {gpuPercent.toFixed(0)}%
                </div>
                <div className={cn("text-[9px] text-muted-foreground", compact && "text-white/35")}> 
                  Windows GPU Engine (3D)
                </div>
              </div>
            </div>

            {target && (
              <div className={cn("rounded-xl border border-border/40 p-2", compact && "border-white/10 bg-white/5")}> 
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn("text-[10px] text-muted-foreground", compact && "text-white/45")}>Current App</p>
                    <p className={cn("text-xs font-semibold truncate", compact && "text-white")}>{target.name}</p>
                    <p className={cn("text-[9px] text-muted-foreground truncate", compact && "text-white/30")}>PID {target.pid}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={compact ? "secondary" : "outline"} className={cn("text-[9px]", compact && "bg-white/10 text-white")}>CPU {target.cpu_percent.toFixed(0)}%</Badge>
                    <Badge variant={compact ? "secondary" : "outline"} className={cn("text-[9px]", compact && "bg-white/10 text-white")}>RAM {formatBytes(target.memory_bytes)}</Badge>
                  </div>
                </div>
              </div>
            )}

            <div className={cn("rounded-xl border border-border/40 overflow-hidden", compact && "border-white/10")}> 
              <div className={cn("px-3 py-2 border-b border-border/40", compact && "border-white/10")}> 
                <p className={cn("text-[10px] font-medium", compact && "text-white/80")}>Top Processes</p>
              </div>
              <div className={cn("divide-y divide-border/40", compact && "divide-white/10")}> 
                {snapshot.top.slice(0, compact ? 6 : 10).map((p) => {
                  const cpuW = `${Math.round(clamp01(p.cpu_percent / 100) * 100)}%`;
                  return (
                    <div key={p.pid} className={cn("px-3 py-2", compact && "text-white")}> 
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn("text-[10px] font-medium truncate", compact && "text-white/80")}>{p.name}</p>
                          <p className={cn("text-[8px] text-muted-foreground truncate", compact && "text-white/30")}>PID {p.pid}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn("text-[9px] font-mono tabular-nums", compact && "text-white/70")}>{p.cpu_percent.toFixed(0)}%</span>
                          <span className={cn("text-[9px] text-muted-foreground", compact && "text-white/40")}>{formatBytes(p.memory_bytes)}</span>
                        </div>
                      </div>
                      <div className={cn("mt-1 h-1.5 rounded bg-muted overflow-hidden", compact && "bg-white/5")}> 
                        <div className={cn("h-full bg-primary/60", compact && "bg-white/40")} style={{ width: cpuW }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
