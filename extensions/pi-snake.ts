/**
 * Snake extension — classic arcade snake with power-ups, walls, and skins.
 * /snake          Play in embedded TUI
 * /snake classic  No walls, wrap-around edges
 * /snake turbo    Fast mode
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const W = 30;  // board width in cells
const H = 20;  // board height in cells
const TICK_BASE = 120;  // ms per tick at level 1
const TICK_MIN = 40;    // fastest tick
const FOOD_SCORE = 10;
const POWER_SCORE = 25;
const LEVEL_UP_EVERY = 50;  // points per level

type Dir = "up" | "down" | "left" | "right";
type CellType = null | "snake" | "food" | "power" | "wall" | "portal";

interface Pos { x: number; y: number }

interface PowerUp {
  type: "speed" | "ghost" | "magnet" | "shrink" | "freeze";
  pos: Pos;
  ttl: number; // ticks until despawn
}

interface GameState {
  snake: Pos[];
  dir: Dir;
  nextDir: Dir;
  food: Pos;
  powerUps: PowerUp[];
  walls: Pos[];
  portals: Pos[];  // pairs: [0]→[1], [2]→[3]
  score: number;
  level: number;
  highScore: number;
  gameOver: boolean;
  ticks: number;
  // Active effects
  ghostMode: number;  // ticks remaining
  speedBoost: number;
  magnetMode: number;
  freezeMode: number;
  // Mode
  mode: "normal" | "classic" | "turbo";
  skin: number;
}

// ─── SKINS ───────────────────────────────────────────────────────────────────

const SKINS = [
  { name: "Neon",    head: "\x1b[38;2;0;255;100m██",  body: "\x1b[38;2;0;200;80m██",  tail: "\x1b[38;2;0;140;60m██" },
  { name: "Lava",    head: "\x1b[38;2;255;100;0m██",   body: "\x1b[38;2;200;60;0m██",  tail: "\x1b[38;2;140;40;0m██" },
  { name: "Ice",     head: "\x1b[38;2;150;220;255m██",  body: "\x1b[38;2;100;180;230m██", tail: "\x1b[38;2;60;140;200m██" },
  { name: "Toxic",   head: "\x1b[38;2;180;255;0m██",   body: "\x1b[38;2;130;200;0m██",  tail: "\x1b[38;2;80;150;0m██" },
  { name: "Royal",   head: "\x1b[38;2;200;100;255m██",  body: "\x1b[38;2;160;60;220m██", tail: "\x1b[38;2;120;30;180m██" },
  { name: "Gold",    head: "\x1b[38;2;255;215;0m██",   body: "\x1b[38;2;218;165;32m██", tail: "\x1b[38;2;184;134;11m██" },
];

const FOOD_CHAR = "\x1b[38;2;255;60;60m●\x1b[0m ";
const POWER_CHARS: Record<string, string> = {
  speed:  "\x1b[38;2;255;255;0m⚡\x1b[0m",
  ghost:  "\x1b[38;2;150;150;255m👻\x1b[0m",
  magnet: "\x1b[38;2;255;100;200m🧲\x1b[0m",
  shrink: "\x1b[38;2;100;255;200m✂\x1b[0m ",
  freeze: "\x1b[38;2;100;200;255m❄\x1b[0m ",
};
const WALL_CHAR = "\x1b[38;2;80;80;100m▓▓\x1b[0m";
const PORTAL_CHAR = "\x1b[38;2;200;100;255m◎\x1b[0m ";
const EMPTY_CHAR = "\x1b[2m· \x1b[0m";
const RST = "\x1b[0m";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

function posEq(a: Pos, b: Pos): boolean { return a.x === b.x && a.y === b.y; }
function posIn(p: Pos, arr: Pos[]): boolean { return arr.some(a => posEq(a, p)); }

function randomFreePos(state: GameState): Pos {
  const occupied = new Set<string>();
  for (const s of state.snake) occupied.add(`${s.x},${s.y}`);
  occupied.add(`${state.food.x},${state.food.y}`);
  for (const w of state.walls) occupied.add(`${w.x},${w.y}`);
  for (const p of state.portals) occupied.add(`${p.x},${p.y}`);
  for (const pu of state.powerUps) occupied.add(`${pu.pos.x},${pu.pos.y}`);

  for (let attempt = 0; attempt < 500; attempt++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * H);
    if (!occupied.has(`${x},${y}`)) return { x, y };
  }
  return { x: 0, y: 0 };
}

function generateWalls(level: number): Pos[] {
  const walls: Pos[] = [];
  if (level < 3) return walls;

  // Add walls based on level
  const patterns = [
    // Level 3-4: center cross
    () => { for (let i = 8; i < 22; i++) { walls.push({ x: i, y: H / 2 }); } for (let i = 6; i < 14; i++) { walls.push({ x: W / 2, y: i }); } },
    // Level 5-6: border pillars
    () => { for (let y = 3; y < 7; y++) { walls.push({ x: 5, y }); walls.push({ x: W - 6, y }); walls.push({ x: 5, y: H - y - 1 }); walls.push({ x: W - 6, y: H - y - 1 }); } },
    // Level 7+: maze chunks
    () => {
      for (let i = 0; i < 4; i++) {
        const bx = 4 + Math.floor(Math.random() * (W - 8));
        const by = 3 + Math.floor(Math.random() * (H - 6));
        const horiz = Math.random() > 0.5;
        for (let j = 0; j < 5; j++) walls.push(horiz ? { x: bx + j, y: by } : { x: bx, y: by + j });
      }
    },
  ];

  if (level >= 7) patterns[2]();
  else if (level >= 5) patterns[1]();
  else patterns[0]();

  return walls;
}

function generatePortals(level: number): Pos[] {
  if (level < 4) return [];
  const p1: Pos = { x: 2 + Math.floor(Math.random() * 5), y: 2 + Math.floor(Math.random() * 5) };
  const p2: Pos = { x: W - 7 + Math.floor(Math.random() * 5), y: H - 7 + Math.floor(Math.random() * 5) };
  return [p1, p2];
}

function createState(mode: "normal" | "classic" | "turbo" = "normal", skin = 0): GameState {
  const snake: Pos[] = [];
  const startX = Math.floor(W / 2), startY = Math.floor(H / 2);
  for (let i = 0; i < 4; i++) snake.push({ x: startX - i, y: startY });

  const state: GameState = {
    snake, dir: "right", nextDir: "right",
    food: { x: 0, y: 0 }, powerUps: [], walls: [], portals: [],
    score: 0, level: 1, highScore: 0, gameOver: false, ticks: 0,
    ghostMode: 0, speedBoost: 0, magnetMode: 0, freezeMode: 0,
    mode, skin,
  };
  state.food = randomFreePos(state);
  return state;
}

// ─── GAME LOGIC ──────────────────────────────────────────────────────────────

function tick(state: GameState): void {
  if (state.gameOver) return;
  state.ticks++;
  state.dir = state.nextDir;

  // Decrement active effects
  if (state.ghostMode > 0) state.ghostMode--;
  if (state.speedBoost > 0) state.speedBoost--;
  if (state.magnetMode > 0) state.magnetMode--;
  if (state.freezeMode > 0) state.freezeMode--;

  // Move head
  const head = state.snake[0];
  let nx = head.x, ny = head.y;
  if (state.dir === "up") ny--;
  else if (state.dir === "down") ny++;
  else if (state.dir === "left") nx--;
  else if (state.dir === "right") nx++;

  // Wrap or wall collision
  if (state.mode === "classic") {
    nx = ((nx % W) + W) % W;
    ny = ((ny % H) + H) % H;
  } else {
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) {
      state.gameOver = true;
      state.highScore = Math.max(state.highScore, state.score);
      return;
    }
  }

  const newHead: Pos = { x: nx, y: ny };

  // Portal check
  for (let i = 0; i < state.portals.length; i += 2) {
    if (i + 1 < state.portals.length) {
      if (posEq(newHead, state.portals[i])) { newHead.x = state.portals[i + 1].x; newHead.y = state.portals[i + 1].y; break; }
      if (posEq(newHead, state.portals[i + 1])) { newHead.x = state.portals[i].x; newHead.y = state.portals[i].y; break; }
    }
  }

  // Wall collision (unless ghost mode)
  if (state.ghostMode <= 0 && posIn(newHead, state.walls)) {
    state.gameOver = true;
    state.highScore = Math.max(state.highScore, state.score);
    return;
  }

  // Self collision (unless ghost mode)
  if (state.ghostMode <= 0 && posIn(newHead, state.snake)) {
    state.gameOver = true;
    state.highScore = Math.max(state.highScore, state.score);
    return;
  }

  state.snake.unshift(newHead);

  // Food?
  let ate = false;
  if (posEq(newHead, state.food)) {
    state.score += FOOD_SCORE;
    state.food = randomFreePos(state);
    ate = true;

    // Level up?
    const newLevel = Math.floor(state.score / LEVEL_UP_EVERY) + 1;
    if (newLevel > state.level) {
      state.level = newLevel;
      state.walls = state.mode !== "classic" ? generateWalls(state.level) : [];
      state.portals = state.mode !== "classic" ? generatePortals(state.level) : [];
    }

    // Spawn power-up chance (20%)
    if (Math.random() < 0.2) {
      const types: PowerUp["type"][] = ["speed", "ghost", "magnet", "shrink", "freeze"];
      state.powerUps.push({ type: types[Math.floor(Math.random() * types.length)], pos: randomFreePos(state), ttl: 80 });
    }
  }

  // Power-up pickup
  for (let i = state.powerUps.length - 1; i >= 0; i--) {
    const pu = state.powerUps[i];
    pu.ttl--;
    if (pu.ttl <= 0) { state.powerUps.splice(i, 1); continue; }
    if (posEq(newHead, pu.pos)) {
      state.score += POWER_SCORE;
      state.powerUps.splice(i, 1);
      switch (pu.type) {
        case "speed":  state.speedBoost = 60; break;
        case "ghost":  state.ghostMode = 40; break;
        case "magnet": state.magnetMode = 50; break;
        case "shrink":
          if (state.snake.length > 4) { state.snake.length = Math.max(4, state.snake.length - 3); }
          break;
        case "freeze": state.freezeMode = 30; break;
      }
      ate = true;
    }
  }

  // Magnet: pull food closer
  if (state.magnetMode > 0) {
    const dx = Math.sign(newHead.x - state.food.x);
    const dy = Math.sign(newHead.y - state.food.y);
    const fx = state.food.x + dx, fy = state.food.y + dy;
    if (fx >= 0 && fx < W && fy >= 0 && fy < H) { state.food.x = fx; state.food.y = fy; }
  }

  if (!ate) state.snake.pop(); // remove tail unless we ate

  state.highScore = Math.max(state.highScore, state.score);
}

function getTickMs(state: GameState): number {
  let ms = TICK_BASE - (state.level - 1) * 8;
  if (state.mode === "turbo") ms *= 0.6;
  if (state.speedBoost > 0) ms *= 0.5;
  if (state.freezeMode > 0) ms *= 2;
  return Math.max(TICK_MIN, ms);
}

// ─── TUI COMPONENT ──────────────────────────────────────────────────────────

class SnakeComponent {
  private state: GameState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private version = 0;
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private cachedVersion = -1;

  constructor(
    private tui: any,
    private onQuit: () => void,
    private onSave: (state: GameState | null) => void,
    saved?: GameState,
  ) {
    this.state = saved || createState();
    this.scheduleNext();
  }

  private scheduleNext() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.paused && !this.state.gameOver) {
        tick(this.state);
        this.version++;
        this.tui.requestRender();
      }
      this.scheduleNext();
    }, getTickMs(this.state));
  }

  handleInput(data: string) {
    if (data === "q" || data === "Q" || data === "\x03") {
      this.onSave(this.state);
      this.dispose();
      this.onQuit();
      return;
    }
    if (data === "\x1b" || data === "p" || data === "P") {
      this.paused = !this.paused;
      this.version++;
      this.tui.requestRender();
      return;
    }
    if (this.paused) { this.paused = false; this.version++; this.tui.requestRender(); return; }

    if (this.state.gameOver) {
      if (data === "r" || data === "R") {
        const skin = this.state.skin;
        const mode = this.state.mode;
        const hs = this.state.highScore;
        this.state = createState(mode, skin);
        this.state.highScore = hs;
        this.version++;
        this.tui.requestRender();
      }
      return;
    }

    // Direction
    const dir = this.state.dir;
    if ((matchesKey(data, "up") || data === "w" || data === "W") && dir !== "down") this.state.nextDir = "up";
    else if ((matchesKey(data, "down") || data === "s" || data === "S") && dir !== "up") this.state.nextDir = "down";
    else if ((matchesKey(data, "left") || data === "a" || data === "A") && dir !== "right") this.state.nextDir = "left";
    else if ((matchesKey(data, "right") || data === "d" || data === "D") && dir !== "left") this.state.nextDir = "right";

    // Skin cycle
    if (data === "k" || data === "K") {
      this.state.skin = (this.state.skin + 1) % SKINS.length;
      this.version++;
      this.tui.requestRender();
    }
  }

  invalidate() { this.cachedWidth = 0; }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.version) return this.cachedLines;

    const lines: string[] = [];
    const skin = SKINS[this.state.skin];
    const cellW = 2;
    const boardW = W * cellW;
    const sideW = 16;
    const totalW = boardW + 1 + sideW;

    const boxLine = (content: string, bw: number): string => {
      const cLen = visibleWidth(content);
      const pad = Math.max(0, bw - cLen);
      return dim(" │") + content + " ".repeat(pad) + dim("│");
    };

    // Build display grid
    const grid: CellType[][] = Array.from({ length: H }, () => Array(W).fill(null));
    for (const w2 of this.state.walls) grid[w2.y][w2.x] = "wall";
    for (const p of this.state.portals) if (p.y >= 0 && p.y < H && p.x >= 0 && p.x < W) grid[p.y][p.x] = "portal";
    grid[this.state.food.y][this.state.food.x] = "food";
    for (const pu of this.state.powerUps) grid[pu.pos.y][pu.pos.x] = "power";
    for (const s of this.state.snake) if (s.y >= 0 && s.y < H && s.x >= 0 && s.x < W) grid[s.y][s.x] = "snake";

    // Title
    const modeStr = this.state.mode === "classic" ? " classic" : this.state.mode === "turbo" ? " turbo" : "";
    lines.push(this.pad(dim(` ╭${"─".repeat(totalW)}╮`), width));
    lines.push(this.pad(boxLine(` ${bold(green("SNAKE"))}${cyan(modeStr)} │ Lv ${bold(yellow(String(this.state.level)))} │ ${skin.head}${RST} ${dim(SKINS[this.state.skin].name)}`, totalW), width));
    lines.push(this.pad(dim(` ├${"─".repeat(boardW)}┬${"─".repeat(sideW)}┤`), width));

    // Board + side panel
    for (let y = 0; y < H; y++) {
      let row = "";
      for (let x = 0; x < W; x++) {
        const cell = grid[y][x];
        if (cell === "snake") {
          const idx = this.state.snake.findIndex(s => s.x === x && s.y === y);
          const ghost = this.state.ghostMode > 0;
          if (idx === 0) row += (ghost ? "\x1b[2m" : "") + skin.head + RST;
          else if (idx >= this.state.snake.length - 2) row += (ghost ? "\x1b[2m" : "") + skin.tail + RST;
          else row += (ghost ? "\x1b[2m" : "") + skin.body + RST;
        } else if (cell === "food") {
          row += FOOD_CHAR;
        } else if (cell === "power") {
          const pu = this.state.powerUps.find(p => p.pos.x === x && p.pos.y === y);
          row += (pu ? POWER_CHARS[pu.type] || "? " : "? ") + " ";
        } else if (cell === "wall") {
          row += WALL_CHAR;
        } else if (cell === "portal") {
          row += PORTAL_CHAR;
        } else {
          row += EMPTY_CHAR;
        }
      }

      // Side panel
      let side = "";
      if (y === 0) side = ` ${bold("SCORE")}`;
      else if (y === 1) side = ` ${yellow(String(this.state.score))}`;
      else if (y === 3) side = ` ${bold("HIGH")}`;
      else if (y === 4) side = ` ${yellow(String(this.state.highScore))}`;
      else if (y === 6) side = ` ${bold("LENGTH")}`;
      else if (y === 7) side = ` ${cyan(String(this.state.snake.length))}`;
      else if (y === 9) side = ` ${bold("EFFECTS")}`;
      else if (y === 10) {
        const fx: string[] = [];
        if (this.state.ghostMode > 0)  fx.push("👻");
        if (this.state.speedBoost > 0) fx.push("⚡");
        if (this.state.magnetMode > 0) fx.push("🧲");
        if (this.state.freezeMode > 0) fx.push("❄");
        side = fx.length ? ` ${fx.join(" ")}` : ` ${dim("none")}`;
      }
      else if (y === 12) side = ` ${bold("LEVEL")}`;
      else if (y === 13) side = ` ${green(String(this.state.level))}`;
      else if (y === 15) side = ` ${bold("SPEED")}`;
      else if (y === 16) side = ` ${dim(getTickMs(this.state) + "ms")}`;
      else if (y === 18) side = ` ${dim(`K=skin`)}`;
      else if (y === 19) side = ` ${dim(`P=pause`)}`;

      const sideVis = visibleWidth(side);
      const sidePad = Math.max(0, sideW - sideVis);
      lines.push(this.pad(dim(" │") + row + dim("│") + side + " ".repeat(sidePad) + dim("│"), width));
    }

    // Bottom
    lines.push(this.pad(dim(` ├${"─".repeat(boardW)}┴${"─".repeat(sideW)}┤`), width));
    let footer: string;
    if (this.paused) footer = `${yellow(bold("PAUSED"))} — any key to resume, ${bold("Q")} quit`;
    else if (this.state.gameOver) footer = `${red(bold("GAME OVER!"))} Score: ${this.state.score} — ${bold("R")} restart, ${bold("Q")} quit`;
    else footer = `←→↑↓/WASD move  ${bold("K")} skin  ${bold("P")} pause  ${bold("Q")} quit`;
    lines.push(this.pad(boxLine(` ${footer}`, totalW), width));
    lines.push(this.pad(dim(` ╰${"─".repeat(totalW)}╯`), width));

    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;
    return lines;
  }

  private pad(line: string, w: number): string {
    return line + " ".repeat(Math.max(0, w - visibleWidth(line)));
  }

  dispose() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────

const SAVE_TYPE = "snake-save";
const HS_DIR = join(process.env.HOME || process.env.USERPROFILE || ".", ".pi", "agent", "data");
const HS_FILE = join(HS_DIR, "snake-highscore.json");

function loadHS(): number {
  try { if (existsSync(HS_FILE)) return JSON.parse(readFileSync(HS_FILE, "utf-8")).highScore ?? 0; } catch {} return 0;
}
function saveHS(score: number, level: number, length: number) {
  try {
    mkdirSync(HS_DIR, { recursive: true });
    if (score > loadHS()) writeFileSync(HS_FILE, JSON.stringify({ highScore: score, level, length, date: new Date().toISOString() }));
  } catch {}
}

// ─── EXTENSION ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("snake", {
    description: [
      "Play Snake! Classic arcade game with power-ups, walls, portals, and skins.",
      "Modes: /snake (normal) | /snake classic (wrap edges) | /snake turbo (fast)",
      "Controls: ←→↑↓ or WASD, K=skin, P=pause, Q=quit",
      "Power-ups: ⚡speed  👻ghost  🧲magnet  ✂shrink  ❄freeze",
      "Walls & portals appear at higher levels. 6 snake skins.",
    ].join("\n"),
    handler: async (args, ctx) => {
      if (!ctx.hasUI) { ctx.ui.notify("Snake requires interactive mode", "error"); return; }

      const arg = (args || "").trim().toLowerCase();
      const mode: GameState["mode"] = arg === "classic" ? "classic" : arg === "turbo" ? "turbo" : "normal";

      // Load saved state
      const entries = ctx.sessionManager.getEntries();
      let saved: GameState | undefined;
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.type === "custom" && e.customType === SAVE_TYPE) { saved = e.data as GameState; break; }
      }
      const persistHS = loadHS();
      if (saved) saved.highScore = Math.max(saved.highScore, persistHS);

      await ctx.ui.custom((tui: any, _theme: any, _kb: any, done: (v: undefined) => void) => {
        return new SnakeComponent(
          tui,
          () => done(undefined),
          (state) => {
            if (state) { pi.appendEntry(SAVE_TYPE, state); saveHS(state.highScore, state.level, state.snake.length); }
          },
          saved ? saved : persistHS > 0 ? { ...createState(mode), highScore: persistHS } : createState(mode),
        );
      });
    },
  });
}
