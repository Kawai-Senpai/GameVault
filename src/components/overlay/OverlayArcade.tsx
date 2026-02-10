import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ════════════════════════════════════════════════════════════
   Arcade overlay — two mini-games: Tic Tac Toe + Snake
   ════════════════════════════════════════════════════════════ */

type ArcadeGame = "ttt" | "snake";

export default function OverlayArcade() {
  const [game, setGame] = useState<ArcadeGame>("ttt");

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/[0.06]">
        <button
          className={cn(
            "px-3 py-1 rounded-md text-[9px] font-medium transition-all",
            game === "ttt" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
          )}
          onClick={() => setGame("ttt")}
        >
          Tic Tac Toe
        </button>
        <button
          className={cn(
            "px-3 py-1 rounded-md text-[9px] font-medium transition-all",
            game === "snake" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
          )}
          onClick={() => setGame("snake")}
        >
          Snake
        </button>
      </div>

      {/* Game area */}
      <div className="flex-1 overflow-hidden">
        {game === "ttt" ? <TicTacToeGame /> : <SnakeGame />}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Tic Tac Toe
   ════════════════════════════════════════════════════════════ */

type Cell = "X" | "O" | null;

function checkWinner(board: Cell[]): Cell {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function TicTacToeGame() {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [isX, setIsX] = useState(true);
  const [score, setScore] = useState({ x: 0, o: 0, d: 0 });
  const winner = checkWinner(board);
  const isDraw = !winner && board.every((c) => c !== null);

  const handleClick = (i: number) => {
    if (board[i] || winner || isDraw) return;
    const next = [...board];
    next[i] = isX ? "X" : "O";
    setBoard(next);
    setIsX(!isX);

    const w = checkWinner(next);
    if (w === "X") setScore((s) => ({ ...s, x: s.x + 1 }));
    else if (w === "O") setScore((s) => ({ ...s, o: s.o + 1 }));
    else if (next.every((c) => c !== null)) setScore((s) => ({ ...s, d: s.d + 1 }));
  };

  const reset = () => {
    setBoard(Array(9).fill(null));
    setIsX(true);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full py-4 gap-3">
      {/* Status */}
      <div className="text-center">
        {winner ? (
          <p className="text-sm font-bold text-emerald-400">{winner} wins!</p>
        ) : isDraw ? (
          <p className="text-sm font-bold text-amber-400">Draw!</p>
        ) : (
          <p className="text-[10px] text-white/60">
            <span className={cn("font-bold", isX ? "text-sky-400" : "text-pink-400")}>
              {isX ? "X" : "O"}
            </span>{" "}
            to play
          </p>
        )}
      </div>

      {/* Board */}
      <div className="grid grid-cols-3 gap-1.5">
        {board.map((cell, i) => (
          <button
            key={i}
            className={cn(
              "size-16 rounded-lg border text-2xl font-bold transition-all",
              cell === "X"
                ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                : cell === "O"
                ? "border-pink-500/40 bg-pink-500/10 text-pink-400"
                : "border-white/10 bg-white/[0.03] text-transparent hover:bg-white/[0.08] hover:border-white/20",
              (winner || isDraw) && !cell && "opacity-30 cursor-default"
            )}
            onClick={() => handleClick(i)}
          >
            {cell || "·"}
          </button>
        ))}
      </div>

      {/* Score + Reset */}
      <div className="flex items-center gap-4 mt-1">
        <div className="text-center">
          <p className="text-[8px] text-white/30">X</p>
          <p className="text-sm font-bold text-sky-400">{score.x}</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-white/30">Draw</p>
          <p className="text-sm font-bold text-white/40">{score.d}</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-white/30">O</p>
          <p className="text-sm font-bold text-pink-400">{score.o}</p>
        </div>
      </div>

      {(winner || isDraw) && (
        <Button size="sm" variant="ghost" className="text-[9px] text-white/60 mt-1" onClick={reset}>
          Play Again
        </Button>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Snake Game — Canvas-based for smooth rendering
   ════════════════════════════════════════════════════════════ */

type Dir = "UP" | "DOWN" | "LEFT" | "RIGHT";
type Pos = { x: number; y: number };

const GRID = 20; // cells
const CELL_PX = 16; // pixels per cell
const BOARD_PX = GRID * CELL_PX;
const TICK_MS = 120;

function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    snake: Pos[];
    food: Pos;
    dir: Dir;
    nextDir: Dir;
    alive: boolean;
    score: number;
    best: number;
    started: boolean;
  }>({
    snake: [{ x: 10, y: 10 }],
    food: { x: 15, y: 10 },
    dir: "RIGHT",
    nextDir: "RIGHT",
    alive: true,
    score: 0,
    best: parseInt(localStorage.getItem("gv_snake_best") || "0", 10),
    started: false,
  });
  const [, forceUpdate] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const spawnFood = useCallback((snake: Pos[]): Pos => {
    const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
    let pos: Pos;
    do {
      pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    } while (occupied.has(`${pos.x},${pos.y}`));
    return pos;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;

    // Background
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

    // Grid dots
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        ctx.fillRect(x * CELL_PX + CELL_PX / 2 - 0.5, y * CELL_PX + CELL_PX / 2 - 0.5, 1, 1);
      }
    }

    // Food
    ctx.fillStyle = "#f87171";
    ctx.shadowColor = "#f87171";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(
      s.food.x * CELL_PX + CELL_PX / 2,
      s.food.y * CELL_PX + CELL_PX / 2,
      CELL_PX / 2 - 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.shadowBlur = 0;

    // Snake
    s.snake.forEach((p, i) => {
      const isHead = i === 0;
      const alpha = 1 - i * (0.5 / s.snake.length);
      ctx.fillStyle = isHead
        ? s.alive
          ? "#34d399"
          : "#f87171"
        : `rgba(52,211,153,${alpha})`;
      ctx.shadowColor = isHead ? (s.alive ? "#34d399" : "#f87171") : "transparent";
      ctx.shadowBlur = isHead ? 6 : 0;
      const r = isHead ? 5 : 3;
      roundRect(ctx, p.x * CELL_PX + 1, p.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2, r);
      ctx.shadowBlur = 0;
    });
  }, []);

  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s.alive || !s.started) return;

    s.dir = s.nextDir;
    const head = { ...s.snake[0] };
    if (s.dir === "UP") head.y -= 1;
    else if (s.dir === "DOWN") head.y += 1;
    else if (s.dir === "LEFT") head.x -= 1;
    else head.x += 1;

    // Wall collision
    if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
      s.alive = false;
      if (s.score > s.best) {
        s.best = s.score;
        localStorage.setItem("gv_snake_best", String(s.score));
      }
      draw();
      forceUpdate((n) => n + 1);
      return;
    }

    // Self collision
    if (s.snake.some((p) => p.x === head.x && p.y === head.y)) {
      s.alive = false;
      if (s.score > s.best) {
        s.best = s.score;
        localStorage.setItem("gv_snake_best", String(s.score));
      }
      draw();
      forceUpdate((n) => n + 1);
      return;
    }

    s.snake.unshift(head);

    // Eat food
    if (head.x === s.food.x && head.y === s.food.y) {
      s.score += 1;
      s.food = spawnFood(s.snake);
    } else {
      s.snake.pop();
    }

    draw();
    forceUpdate((n) => n + 1);
  }, [draw, spawnFood]);

  const startGame = useCallback(() => {
    const s = stateRef.current;
    s.snake = [{ x: 10, y: 10 }];
    s.food = spawnFood(s.snake);
    s.dir = "RIGHT";
    s.nextDir = "RIGHT";
    s.alive = true;
    s.score = 0;
    s.started = true;

    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(tick, TICK_MS);
    draw();
    forceUpdate((n) => n + 1);
  }, [draw, spawnFood, tick]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.alive) return;

      const key = e.key.toLowerCase();
      if ((key === "arrowup" || key === "w") && s.dir !== "DOWN") {
        e.preventDefault();
        s.nextDir = "UP";
        if (!s.started) startGame();
      } else if ((key === "arrowdown" || key === "s") && s.dir !== "UP") {
        e.preventDefault();
        s.nextDir = "DOWN";
        if (!s.started) startGame();
      } else if ((key === "arrowleft" || key === "a") && s.dir !== "RIGHT") {
        e.preventDefault();
        s.nextDir = "LEFT";
        if (!s.started) startGame();
      } else if ((key === "arrowright" || key === "d") && s.dir !== "LEFT") {
        e.preventDefault();
        s.nextDir = "RIGHT";
        if (!s.started) startGame();
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [startGame]);

  // Initial draw
  useEffect(() => {
    draw();
  }, [draw]);

  const s = stateRef.current;

  return (
    <div className="flex flex-col items-center justify-center h-full py-3 gap-2">
      {/* Score bar */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-[7px] text-white/30 uppercase tracking-wider">Score</p>
          <p className="text-lg font-bold text-emerald-400 tabular-nums">{s.score}</p>
        </div>
        <div className="text-center">
          <p className="text-[7px] text-white/30 uppercase tracking-wider">Best</p>
          <p className="text-lg font-bold text-amber-400 tabular-nums">{s.best}</p>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl border border-white/10 overflow-hidden" style={{ width: BOARD_PX, height: BOARD_PX }}>
        <canvas
          ref={canvasRef}
          width={BOARD_PX}
          height={BOARD_PX}
          className="block"
        />

        {/* Overlay messages */}
        {!s.started && s.alive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <p className="text-xs font-semibold text-white mb-1">Snake</p>
            <p className="text-[8px] text-white/50 mb-3">Use WASD or Arrow Keys</p>
            <Button size="sm" className="text-[9px] bg-emerald-600 hover:bg-emerald-500 text-white" onClick={startGame}>
              Start Game
            </Button>
          </div>
        )}
        {!s.alive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
            <p className="text-sm font-bold text-red-400 mb-1">Game Over</p>
            <p className="text-[9px] text-white/50 mb-3">Score: {s.score}</p>
            <Button size="sm" className="text-[9px] bg-emerald-600 hover:bg-emerald-500 text-white" onClick={startGame}>
              Play Again
            </Button>
          </div>
        )}
      </div>

      {/* Controls hint */}
      <div className="flex items-center gap-2 text-[7px] text-white/25">
        <span>W/↑ Up</span>
        <span>·</span>
        <span>A/← Left</span>
        <span>·</span>
        <span>S/↓ Down</span>
        <span>·</span>
        <span>D/→ Right</span>
      </div>
    </div>
  );
}

/* ─── Canvas Helper ─────────────────────────────────────────── */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
