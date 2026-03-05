# pi-snake 🐍

Terminal Snake game for [pi](https://github.com/nicobailon/pi-mono) — classic arcade with power-ups, walls, portals, and skins.

## Install

```bash
npm install -g pi-snake
```

## Play

```
/snake          # Normal mode — walls at higher levels
/snake classic  # Wrap-around edges, no walls
/snake turbo    # Fast mode for experts
```

## Controls

| Key | Action |
|-----|--------|
| ←→↑↓ / WASD | Move |
| K | Cycle skin (Neon, Lava, Ice, Toxic, Royal, Gold) |
| P / ESC | Pause |
| R | Restart (game over) |
| Q | Quit |

## Features

- **6 Snake Skins** — Neon, Lava, Ice, Toxic, Royal, Gold
- **5 Power-ups** — ⚡ Speed boost, 👻 Ghost (phase through walls/self), 🧲 Magnet (pulls food), ✂ Shrink, ❄ Freeze (slow time)
- **Progressive difficulty** — walls and portals appear at higher levels
- **Portal pairs** — teleport across the board
- **Persistent high scores** — saved across sessions
- **3 Game modes** — Normal, Classic (wrap), Turbo

## Architecture

Single-file pi extension (`extensions/pi-snake.ts`). Uses pi TUI component API with `handleInput`/`render`/`invalidate`. Box-drawing chrome matches pi-tetris style.

## License

MIT
