import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ════════════════════════════════════════════════════════════
   Arcade overlay — mini-games: Tic Tac Toe, Snake, Flappy Bird
   ════════════════════════════════════════════════════════════ */

type ArcadeGame = "ttt" | "snake" | "flappy";

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
        <button
          className={cn(
            "px-3 py-1 rounded-md text-[9px] font-medium transition-all",
            game === "flappy" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
          )}
          onClick={() => setGame("flappy")}
        >
          Flappy Bird
        </button>
      </div>

      {/* Game area */}
      <div className="flex-1 overflow-hidden">
        {game === "ttt" ? <TicTacToeGame /> : game === "snake" ? <SnakeGame /> : <FlappyBirdGame />}
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
    let attempts = 0;
    do {
      pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
      attempts++;
      if (attempts > 500) break; // safety valve
    } while (occupied.has(`${pos.x},${pos.y}`));
    return pos;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;

    // Clear canvas completely to prevent frame stacking
    ctx.clearRect(0, 0, BOARD_PX, BOARD_PX);
    // Opaque dark background for visibility
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

    // Grid dots
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        ctx.fillRect(x * CELL_PX + CELL_PX / 2 - 0.5, y * CELL_PX + CELL_PX / 2 - 0.5, 1, 1);
      }
    }

    // Food — draw with glow ring for visibility
    ctx.save();
    const fx = s.food.x * CELL_PX + CELL_PX / 2;
    const fy = s.food.y * CELL_PX + CELL_PX / 2;
    // Outer glow
    ctx.fillStyle = "rgba(248,113,113,0.15)";
    ctx.beginPath();
    ctx.arc(fx, fy, CELL_PX / 2 + 2, 0, Math.PI * 2);
    ctx.fill();
    // Food dot
    ctx.fillStyle = "#f87171";
    ctx.shadowColor = "#f87171";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(fx, fy, CELL_PX / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Snake
    s.snake.forEach((p, i) => {
      ctx.save();
      const isHead = i === 0;
      const alpha = 1 - i * (0.5 / s.snake.length);
      ctx.fillStyle = isHead
        ? s.alive
          ? "#34d399"
          : "#f87171"
        : `rgba(52,211,153,${alpha})`;
      if (isHead) {
        ctx.shadowColor = s.alive ? "#34d399" : "#f87171";
        ctx.shadowBlur = 6;
      }
      const r = isHead ? 5 : 3;
      roundRect(ctx, p.x * CELL_PX + 1, p.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2, r);
      ctx.restore();
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

/* ════════════════════════════════════════════════════════════
   Flappy Bird
   ════════════════════════════════════════════════════════════ */

const FLAPPY_W = 320;
const FLAPPY_H = 380;
const BIRD_SIZE = 14;
const PIPE_WIDTH = 36;
const PIPE_GAP = 100;
const GRAVITY = 0.35;
const JUMP_VEL = -5.5;
const PIPE_SPEED = 2;
const PIPE_SPAWN_INTERVAL = 100; // frames

interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

interface FlappyState {
  birdY: number;
  birdVel: number;
  pipes: Pipe[];
  score: number;
  best: number;
  alive: boolean;
  started: boolean;
  frameCount: number;
}

function FlappyBirdGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<FlappyState>({
    birdY: FLAPPY_H / 2,
    birdVel: 0,
    pipes: [],
    score: 0,
    best: parseInt(localStorage.getItem("gv_flappy_best") || "0", 10),
    alive: true,
    started: false,
    frameCount: 0,
  });
  const animRef = useRef<number>(0);
  const [, forceUpdate] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;

    ctx.clearRect(0, 0, FLAPPY_W, FLAPPY_H);

    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, FLAPPY_H);
    grad.addColorStop(0, "#0c1222");
    grad.addColorStop(1, "#1a1a2e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FLAPPY_W, FLAPPY_H);

    // Stars
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    for (let i = 0; i < 30; i++) {
      const sx = ((i * 97 + 13) % FLAPPY_W);
      const sy = ((i * 53 + 7) % (FLAPPY_H - 40));
      ctx.fillRect(sx, sy, 1, 1);
    }

    // Ground
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, FLAPPY_H - 20, FLAPPY_W, 20);
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, FLAPPY_H - 20, FLAPPY_W, 2);

    // Pipes
    s.pipes.forEach((pipe) => {
      const topH = pipe.gapY - PIPE_GAP / 2;
      const botY = pipe.gapY + PIPE_GAP / 2;

      // Top pipe
      ctx.fillStyle = "#10b981";
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, topH);
      ctx.fillStyle = "#059669";
      ctx.fillRect(pipe.x - 3, topH - 12, PIPE_WIDTH + 6, 12);

      // Bottom pipe
      ctx.fillStyle = "#10b981";
      ctx.fillRect(pipe.x, botY, PIPE_WIDTH, FLAPPY_H - 20 - botY);
      ctx.fillStyle = "#059669";
      ctx.fillRect(pipe.x - 3, botY, PIPE_WIDTH + 6, 12);
    });

    // Bird
    ctx.save();
    const birdX = 60;
    const rotation = Math.min(Math.max(s.birdVel * 3, -30), 70) * (Math.PI / 180);
    ctx.translate(birdX, s.birdY);
    ctx.rotate(rotation);

    // Body
    ctx.fillStyle = s.alive ? "#fbbf24" : "#ef4444";
    ctx.shadowColor = s.alive ? "#fbbf24" : "#ef4444";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, BIRD_SIZE, BIRD_SIZE * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wing
    ctx.fillStyle = s.alive ? "#f59e0b" : "#dc2626";
    ctx.beginPath();
    const wingFlap = Math.sin(s.frameCount * 0.3) * 3;
    ctx.ellipse(-3, wingFlap, 8, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(6, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(7.5, -3, 2, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.moveTo(BIRD_SIZE - 2, -2);
    ctx.lineTo(BIRD_SIZE + 6, 1);
    ctx.lineTo(BIRD_SIZE - 2, 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Score
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(s.score), FLAPPY_W / 2, 35);

    if (s.best > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "9px sans-serif";
      ctx.fillText(`Best: ${s.best}`, FLAPPY_W / 2, 52);
    }
  }, []);

  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s.alive || !s.started) {
      draw();
      return;
    }

    s.frameCount++;
    s.birdVel += GRAVITY;
    s.birdY += s.birdVel;

    // Ground/ceiling
    if (s.birdY > FLAPPY_H - 20 - BIRD_SIZE || s.birdY < BIRD_SIZE) {
      s.alive = false;
      if (s.score > s.best) {
        s.best = s.score;
        localStorage.setItem("gv_flappy_best", String(s.score));
      }
      draw();
      forceUpdate((n) => n + 1);
      return;
    }

    // Spawn pipes
    if (s.frameCount % PIPE_SPAWN_INTERVAL === 0) {
      const gapY = 60 + Math.random() * (FLAPPY_H - 140);
      s.pipes.push({ x: FLAPPY_W, gapY, passed: false });
    }

    // Move + collide
    const birdX = 60;
    s.pipes = s.pipes.filter((p) => p.x + PIPE_WIDTH > -10);
    for (const pipe of s.pipes) {
      pipe.x -= PIPE_SPEED;
      if (!pipe.passed && pipe.x + PIPE_WIDTH < birdX) {
        pipe.passed = true;
        s.score++;
      }
      if (birdX + BIRD_SIZE > pipe.x && birdX - BIRD_SIZE < pipe.x + PIPE_WIDTH) {
        const topH = pipe.gapY - PIPE_GAP / 2;
        const botY = pipe.gapY + PIPE_GAP / 2;
        if (s.birdY - BIRD_SIZE * 0.8 < topH || s.birdY + BIRD_SIZE * 0.8 > botY) {
          s.alive = false;
          if (s.score > s.best) {
            s.best = s.score;
            localStorage.setItem("gv_flappy_best", String(s.score));
          }
          draw();
          forceUpdate((n) => n + 1);
          return;
        }
      }
    }

    draw();
    animRef.current = requestAnimationFrame(tick);
  }, [draw]);

  const jump = useCallback(() => {
    const s = stateRef.current;
    if (!s.started || !s.alive) {
      s.birdY = FLAPPY_H / 2;
      s.birdVel = 0;
      s.pipes = [];
      s.score = 0;
      s.alive = true;
      s.started = true;
      s.frameCount = 0;
      s.birdVel = JUMP_VEL;
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(tick);
      forceUpdate((n) => n + 1);
      return;
    }
    s.birdVel = JUMP_VEL;
  }, [tick]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        jump();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [jump]);

  useEffect(() => {
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const s = stateRef.current;

  return (
    <div className="flex flex-col items-center justify-center h-full py-3 gap-2">
      <div
        className="relative rounded-xl border border-white/10 overflow-hidden cursor-pointer"
        style={{ width: FLAPPY_W, height: FLAPPY_H }}
        onClick={jump}
      >
        <canvas ref={canvasRef} width={FLAPPY_W} height={FLAPPY_H} className="block" />
        {!s.started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
            <p className="text-sm font-bold text-amber-400 mb-1">Flappy Bird</p>
            <p className="text-[9px] text-white/50 mb-2">Click or press Space to fly</p>
            {s.best > 0 && <p className="text-[8px] text-white/30">Best: {s.best}</p>}
          </div>
        )}
        {s.started && !s.alive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <p className="text-sm font-bold text-red-400 mb-0.5">Game Over</p>
            <p className="text-[10px] text-white/70 mb-1">Score: {s.score}</p>
            {s.score >= s.best && s.score > 0 && (
              <p className="text-[8px] text-amber-400 mb-1">New Best!</p>
            )}
            <p className="text-[8px] text-white/40">Click or Space to retry</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-[8px] text-white/30">
        <span>Space / Click to flap</span>
        <span>·</span>
        <span>Score: {s.score}</span>
        <span>·</span>
        <span>Best: {s.best}</span>
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
