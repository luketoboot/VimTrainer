# VimTrainer

A browser game that builds **Vim muscle memory** through reflex and puzzle gameplay.
The game world *is* a real Vim buffer — every mode runs on one authentic Vim engine.

Retro terminal aesthetic, hand-built juice (screen shake, hit-stop, particles, flash)
and procedural Web Audio SFX. No backend — progress saves to `localStorage`.

## Run it

```bash
npm install
npm run dev      # open the printed http://localhost:5173
```

Click the canvas so it has keyboard focus, then:

- **Menu:** `j`/`k` to pick a drill, `Enter` to start.
- **In a run:** move the cursor onto the highlighted target using Vim motions.
  Fewer keystrokes than a naive `hjkl` walk = **PERFECT**, which builds your combo.
- `Esc` bails out of a run back to the menu.

## Modes

All four are built. Pick a mode on the menu, then a level (`j/k`, `Enter`; `h`/`Esc`
to go back). Levels unlock as you clear the previous one (earn ≥1 star).

- **Tutorial** — a guided course (4 chapters: Motions, Editing, Power, Mastery) that
  teaches one key at a time and checks you actually performed it before advancing.
  **Start here.** Mastery covers the power tools: `:s`, macros, and visual block.
- **Cursor Rush** — race the cursor onto targets in the fewest keys. Reaching a
  target in fewer keys than a naive `hjkl` walk = **PERFECT** and builds your combo.
  Drills: `hjkl` bootcamp, word sprint (`w b e`), find & strike (`f t ;`),
  line leaper (`gg G` + counts), and a grand mixed rush.
- **Dodge** — bullet-hell. Move through a text field with real Vim motions to dodge
  bullets arriving from *any* angle: horizontal streams, vertical rain, edge-aimed
  shots, corner diagonals, fanned arcs, omnidirectional rings, rotating spirals, and
  walls-with-one-gap (which force big jumps like `gg`/`G`/`$`/`0`). Difficulty ramps
  within each level — waves get faster and denser as the clock runs — and across six
  levels from First Contact to Bullet Storm. Dense onscreen blooms (rings, spirals,
  walls) are **telegraphed** first so deaths feel earned. **Grazing** bullets charges
  a bomb you spend with `dd` to clear the screen. Big motions (`gg`/`G`/`$`/`w`/`f`)
  register as **leaps** — bonus score, a combo, and extra juice, so mastering the fast
  motions literally pays off. **★ pickups** drop across the field to reward seeking
  them out with a motion. HP + i-frames + near-miss scoring. The field is read-only —
  any edit (other than the `dd` bomb) is snapped back, so only motions matter.
- **Golf** — transform the start buffer into the target buffer under a keystroke
  **par**. A live diff shows what's left; beating par earns 3 stars. Trains
  operators, text objects, and dot-repeat.

## Music (optional)

Drop MP3s at `public/music/menu.mp3` (ambient menu loop) and
`public/music/game.mp3` (driving gameplay loop) and the game picks them up
automatically — crossfading between them as you enter/leave runs. No files, no
music, no errors. Music volume has its own dial in settings.

## Settings

On the menu, choose **SETTINGS**: volume, a **CRT bloom** dial (Vectrex-style
additive phosphor glow, 0–100%), CRT scanlines on/off, and green/amber phosphor
theme. Everything persists to `localStorage`.

### Keybinds

SETTINGS → **KEYBINDS** remaps keys like a real vimrc. Popular presets and
options, each explained in the UI:

- **Presets** — STANDARD (Vim defaults), **COLEMAK (HNEI)** (the QWERTY hjkl
  positions type `h n e i` on Colemak, so arrows stay under your fingers;
  jooize/vim-colemak style, displaced keys rotate to `j`=end-of-word,
  `k`=next-match, `u`=insert, `l`=undo), and **DVORAK (DHTN)** (`d h t n` become
  left/down/up/right per the classic vim.fandom config).
- **Caps Lock → Esc** — the classic: Esc without leaving the home row. Letter
  case is auto-corrected while the OS lock state is toggled.
- **Insert escape** — `jj` and/or `jk` in insert mode acts as Esc, the most
  popular escape mapping in vimrc files (a lone `j` still types after a beat).
- **`;` ⇄ `:` swap** — ex commands without Shift; a full swap so repeat-find
  survives on `:`.
- **Custom binds** — map any key to act as another: press Enter, the key to
  remap, then the key it should act as.

Remaps are Vim-faithful: normal/visual only, never while typing text, on the
`:` line, or after `f`/`t`/`r`/`m` — and they apply to menu navigation too.

## Scripts

```bash
npm run dev       # dev server with hot reload
npm run test      # engine + mode unit tests (Vitest, headless)
npm run build     # typecheck + production build to dist/
```

## Architecture

```
src/
  engine/    # authentic Vim engine (buffer, motions, operators, text objects,
             #   counts, insert/visual, undo/redo, dot-repeat) — fully unit-tested
  render/    # terminal grid renderer + shared buffer view
  juice/     # screen shake, hit-stop, flash, particles, Web Audio SFX
  modes/     # game modes consuming the engine (cursorRush; dodge/golf next)
  levels/    # the skill curriculum
  ui/        # menu / HUD
  core/      # game loop, input capture, localStorage
```

The engine is framework-agnostic (no DOM) and is the highest-risk component, so it
ships with a thorough test suite (`src/engine/engine.test.ts`). It implements the full
Vim grammar plus the power-user tier:

- motions, operators, text objects, counts, insert/visual, undo/redo, dot-repeat
- search `/ ? n N *`, match-pair `%`
- **macros** `q`/`@`/`@@`, **marks** `m`/`` ` ``/`'`
- **substitute** `:s` / `:%s` / ranges (literal, `g` and `i` flags)
- **visual block** `Ctrl-V` — rectangle `d`/`x`/`y` and block insert `I`/`A`/`c`

Every game mode is a thin wrapper adding win/lose rules, scoring, and juice reactions
to engine events. Tutorial lessons are self-validating: each carries the canonical
`idealKeys` that solve it, and a test replays them to prove every lesson is beatable.

Currently **141 tests** pass (`npm run test`).
