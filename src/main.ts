// App orchestrator: wires input + loop + renderer + juice, and drives the screen
// state machine (menu -> playing -> result) across all three game modes.

import { GameLoop } from "./core/loop.ts";
import { InputManager } from "./core/input.ts";
import { Storage } from "./core/storage.ts";
import { unlockNext } from "./core/progression.ts";
import { KeyRemapper } from "./core/keybinds.ts";
import { MusicPlayer } from "./core/music.ts";
import { TerminalRenderer } from "./render/terminal.ts";
import { AMBER_PHOSPHOR, GREEN_PHOSPHOR, scaledMetrics } from "./render/theme.ts";
import { ScreenShake } from "./juice/shake.ts";
import { ParticlePool } from "./juice/particles.ts";
import { Flash } from "./juice/flash.ts";
import { HitStop } from "./juice/hitstop.ts";
import { AudioFx } from "./juice/audio.ts";
import { MenuScreen, type MenuAction } from "./ui/menu.ts";
import { CursorRushMode } from "./modes/cursorRush.ts";
import { DodgeMode } from "./modes/dodge.ts";
import { GolfMode } from "./modes/golf.ts";
import { TutorialMode } from "./modes/tutorial.ts";
import {
  CURSOR_RUSH_LEVELS,
  DODGE_LEVELS,
  GOLF_PUZZLES,
} from "./levels/curriculum.ts";
import { TUTORIAL_CHAPTERS } from "./levels/tutorial.ts";
import type { GameMode, GameServices, ModeResult } from "./modes/mode.ts";
import type { KeyToken } from "./engine/keymap.ts";

type Screen = "menu" | "playing" | "result";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const settings = Storage.getSettings();

const term = new TerminalRenderer(canvas, settings.theme === "amber" ? AMBER_PHOSPHOR : GREEN_PHOSPHOR);
const audio = new AudioFx();
audio.volume = settings.volume;
const music = new MusicPlayer();
music.volume = settings.musicVolume;

const services: GameServices = {
  term,
  shake: new ScreenShake(),
  particles: new ParticlePool(),
  flash: new Flash(),
  hitstop: new HitStop(),
  audio,
};

const menu = new MenuScreen(term, settings);
let screen: Screen = "menu";
let mode: GameMode | null = null;
let result: ModeResult | null = null;
let lastLevelIds: string[] = [];
let lastLevelId = "";

// --- sizing ---
// Cap the board to a fixed design size so it stays a tidy rectangle centered by
// the flex container (#app), instead of stretching to fill the whole window and
// hugging the top-left. On small windows it shrinks to fit. The cap is sized to
// the content (menus ~48 cols, drill buffers ~44) — much wider and the screens
// visibly hug the canvas's own top-left corner instead.
const MAX_COLS = 56;
const MAX_ROWS = 28;
function fit(): void {
  const app = document.getElementById("app")!;
  // The screen-size dial zooms the cells; the grid stays the same, so gameplay
  // is identical at every size. Shrinks to fit small windows either way.
  const m = scaledMetrics(settings.screenScale);
  term.metrics = m;
  const availCols = Math.floor((app.clientWidth - m.padding * 2) / m.cellW);
  const availRows = Math.floor((app.clientHeight - m.padding * 2) / m.cellH);
  const cols = Math.max(20, Math.min(MAX_COLS, availCols));
  const rows = Math.max(10, Math.min(MAX_ROWS, availRows));
  term.resize(cols * m.cellW + m.padding * 2, rows * m.cellH + m.padding * 2);
}
window.addEventListener("resize", fit);
fit();

// --- input routing ---
// Raw key events -> (caps-aware) tokens -> remap layer -> current screen.
function dispatch(token: KeyToken): void {
  if (screen === "menu") {
    handleMenuAction(menu.handleKey(token));
  } else if (screen === "playing") {
    // Esc quits the run only when the engine has no use for it; otherwise it
    // leaves insert mode / cancels a pending command like real Vim.
    if (token === "<Esc>" && !(mode?.wantsEsc?.() ?? false)) {
      returnToMenu();
      return;
    }
    mode?.handleKey(token);
  } else if (screen === "result") {
    if (token === "<CR>" || token === "<Space>" || token === "<Esc>") returnToMenu();
  }
}

const remapper = new KeyRemapper(
  () => settings.keybinds,
  () => (screen === "playing" && mode?.remapContext ? mode.remapContext() : "normal"),
  dispatch,
);

const input = new InputManager(canvas, () => ({ capsEsc: settings.keybinds.capsEsc }));
input.onKey((token: KeyToken) => {
  // The keybind-capture flow needs the raw key, not its remapped meaning.
  if (screen === "menu" && menu.capturingKey) dispatch(token);
  else remapper.feed(token);
  // Browsers only allow audio after a user gesture, so (re)sync music on keys.
  syncMusic();
});
input.attach();

// Keep the soundtrack matched to where the player is. Silent no-op when the
// optional MP3s (public/music/*.mp3) aren't present.
function syncMusic(): void {
  music.play(screen === "playing" ? "game" : "menu");
}

// Firefox/Safari only unlock audio on a real click — keyboard gestures don't
// count for their autoplay policy. Any click anywhere kicks the music awake.
window.addEventListener("pointerdown", () => {
  music.retryNow();
  syncMusic();
});

function handleMenuAction(action: MenuAction): void {
  if (action.type === "settingsChanged") {
    audio.volume = settings.volume;
    music.volume = settings.musicVolume;
    term.theme = settings.theme === "amber" ? AMBER_PHOSPHOR : GREEN_PHOSPHOR;
    fit(); // screen-size dial changes the metrics — resize live
    Storage.setSettings(settings);
    return;
  }
  if (action.type !== "start") return;
  if (action.mode === "tutorial") {
    lastLevelIds = TUTORIAL_CHAPTERS.map((c) => c.id);
    lastLevelId = action.chapter.id;
    mode = new TutorialMode(services, action.chapter);
  } else if (action.mode === "rush") {
    lastLevelIds = CURSOR_RUSH_LEVELS.map((l) => l.id);
    lastLevelId = action.level.id;
    mode = new CursorRushMode(services, action.level);
  } else if (action.mode === "dodge") {
    lastLevelIds = DODGE_LEVELS.map((l) => l.id);
    lastLevelId = action.level.id;
    mode = new DodgeMode(services, action.level);
  } else {
    lastLevelIds = GOLF_PUZZLES.map((p) => p.id);
    lastLevelId = action.puzzle.id;
    mode = new GolfMode(services, action.puzzle);
  }
  mode.init();
  screen = "playing";
}

function returnToMenu(): void {
  screen = "menu";
  mode = null;
}

// --- loop ---
function update(dt: number): void {
  services.shake.update(dt);
  services.particles.update(dt);
  services.flash.update(dt);

  if (screen === "playing" && mode) {
    const frozen = services.hitstop.tick(dt);
    if (!frozen) mode.update(dt);
    if (mode.done) {
      result = mode.getResult();
      if (result && result.stars >= 1) unlockNext(lastLevelIds, lastLevelId);
      screen = "result";
      mode = null;
    }
  }
}

function render(): void {
  const shake = services.shake.offset;
  term.offsetX = shake.x;
  term.offsetY = shake.y;

  if (screen === "menu") menu.render();
  else if (screen === "playing" && mode) mode.render();
  else if (screen === "result" && result) renderResult(result);

  // Tiny music state indicator (menu only): ♪ = playing, ♪0 = muted in
  // settings, ♪✕ = should play but isn't. Makes silence diagnosable at a glance.
  if (screen === "menu") {
    const label = music.playing ? " ♪" : settings.musicVolume === 0 ? "♪0" : "♪✕";
    term.drawText(0, Math.max(0, term.cols - 3), label, {
      fg: music.playing ? term.theme.dim : term.theme.danger,
    });
  }

  // CRT post stack: phosphor bloom first so glyphs glow, then the scanline mask
  // and vignette stay crisp on top of the glow.
  term.drawBloom(settings.bloom);
  if (settings.scanlines) term.drawScanlines();
}

function renderResult(r: ModeResult): void {
  term.clear();
  const th = term.theme;
  const center = (len: number): number => Math.max(0, Math.floor((term.cols - len) / 2));

  term.drawText(3, center(r.title.length), r.title, { fg: th.fg, bold: true });
  const stars = "★".repeat(r.stars) + "·".repeat(3 - r.stars);
  term.drawText(5, center(stars.length * 2), stars.split("").join(" "), { fg: th.accent, bold: true });

  r.lines.forEach((line, i) => {
    term.drawText(8 + i, center(line.length), line, { fg: i === 0 ? th.accentAlt : th.dim, bold: i === 0 });
  });

  const cont = "Enter — menu";
  term.drawText(8 + r.lines.length + 2, center(cont.length), cont, { fg: th.statusFg });

  services.flash.render(term.context, term.canvas.width, term.canvas.height);
  services.particles.render(term.context, term.theme.fontFamily);
  term.drawStatusLine(` result — ${r.title} `, "VimTrainer ");
}

const loop = new GameLoop({ update, render });
loop.start();
