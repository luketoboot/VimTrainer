// Front-end navigation: mode select -> level/puzzle select -> settings.
// Reports the chosen level back to the app via a MenuAction. Reads unlock/star
// state from storage so progression shows up in the list.

import type { KeyToken } from "../engine/keymap.ts";
import type { TerminalRenderer } from "../render/terminal.ts";
import { wrapText } from "../render/text.ts";
import {
  CURSOR_RUSH_LEVELS,
  DODGE_LEVELS,
  GOLF_PUZZLES,
  type CursorRushLevel,
  type DodgeLevel,
  type GolfPuzzle,
} from "../levels/curriculum.ts";
import { TUTORIAL_CHAPTERS, type TutorialChapter } from "../levels/tutorial.ts";
import { HOTFIX_LEVELS, type HotfixLevel } from "../levels/hotfix.ts";
import { Storage, type Settings } from "../core/storage.ts";
import { isLevelUnlocked } from "../core/progression.ts";
import { getPreset, type InsertEsc, type PresetId } from "../core/keybinds.ts";
import { todayId } from "../core/daily.ts";
import { categoryMix, emptyStats, fingerprintVerdict, neverUsed, topKeys } from "../core/stats.ts";

export type ModeKey = "tutorial" | "rush" | "dodge" | "golf" | "hotfix";

export type MenuAction =
  | { type: "none" }
  | { type: "settingsChanged" }
  | { type: "daily" }
  | { type: "start"; mode: "tutorial"; chapter: TutorialChapter }
  | { type: "start"; mode: "rush"; level: CursorRushLevel }
  | { type: "start"; mode: "dodge"; level: DodgeLevel }
  | { type: "start"; mode: "golf"; puzzle: GolfPuzzle }
  | { type: "start"; mode: "hotfix"; level: HotfixLevel };

interface Entry {
  id: string;
  title: string;
  skill: string;
  hint: string;
}

interface ModeDef {
  key: ModeKey;
  title: string;
  subtitle: string;
  entries: Entry[];
}

const MODES: ModeDef[] = [
  { key: "tutorial", title: "TUTORIAL", subtitle: "learn the keys one at a time — start here", entries: TUTORIAL_CHAPTERS },
  { key: "rush", title: "CURSOR RUSH", subtitle: "race the cursor onto targets — fewest keys wins", entries: CURSOR_RUSH_LEVELS },
  { key: "dodge", title: "DODGE", subtitle: "survive bullet-hell using Vim motions", entries: DODGE_LEVELS },
  { key: "golf", title: "GOLF", subtitle: "transform text under a keystroke par", entries: GOLF_PUZZLES },
  { key: "hotfix", title: "HOTFIX", subtitle: "real edits against the deploy clock — :wq ships", entries: HOTFIX_LEVELS },
];

type State = "mode" | "levels" | "settings" | "keybinds" | "stats";
const SETTINGS_ROWS = ["volume", "music", "bloom", "screen", "scanlines", "theme", "coach", "keybinds", "back"] as const;

// Rows of the keybinds sub-screen. Custom binds are appended dynamically.
type KbRow =
  | { kind: "preset" }
  | { kind: "caps" }
  | { kind: "iesc" }
  | { kind: "swap" }
  | { kind: "add" }
  | { kind: "custom"; src: string; dst: string }
  | { kind: "back" };

const PRESET_ORDER: PresetId[] = ["standard", "colemak", "dvorak"];
const IESC_ORDER: InsertEsc[] = ["off", "jj", "jk", "both"];

const KB_WHY: Record<string, string> = {
  caps:
    "The classic remap: Caps Lock is prime home-row real estate doing nothing, so it " +
    "becomes Esc — no more reaching for the top-left corner. (The OS lock light may " +
    "still toggle; the game auto-corrects letter case so nothing breaks.)",
  iesc:
    "Rolling jj or jk in insert mode escapes without leaving the home row — the most " +
    "popular escape mapping in vimrc files. A lone j still types after a short beat.",
  swap:
    "; enters ex commands without holding Shift — you type : constantly, so this pays " +
    "off fast. It's a full swap, so : takes over repeat-find and nothing is lost.",
  add:
    "Map any key to act as another in normal/visual mode. Never applies while typing " +
    "text, on the : line, or after f/t/r/m — exactly like real Vim mappings.",
  custom: "Enter or x removes this mapping.",
  back: "",
};

export class MenuScreen {
  private term: TerminalRenderer;
  private settings: Settings;
  private state: State = "mode";
  private modeIndex = 0;
  private levelIndex = 0;
  private settingsIndex = 0;
  private keybindIndex = 0;
  /** Two-step key capture for adding a custom bind. */
  private capture: { stage: "src" | "dst"; src?: string } | null = null;

  /** While capturing, the app must deliver raw tokens (no remapping). */
  get capturingKey(): boolean {
    return this.capture !== null;
  }

  constructor(term: TerminalRenderer, settings: Settings) {
    this.term = term;
    this.settings = settings;
  }

  private get mode(): ModeDef {
    return MODES[this.modeIndex]!;
  }
  private ids(): string[] {
    return this.mode.entries.map((e) => e.id);
  }

  handleKey(token: KeyToken): MenuAction {
    if (this.state === "mode") return this.handleMode(token);
    if (this.state === "levels") return this.handleLevels(token);
    if (this.state === "keybinds") return this.handleKeybinds(token);
    if (this.state === "stats") return this.handleStats(token);
    return this.handleSettings(token);
  }

  private handleMode(token: KeyToken): MenuAction {
    const total = MODES.length + 3; // + daily + stats + settings
    switch (token) {
      case "j":
      case "<Down>":
        this.modeIndex = (this.modeIndex + 1) % total;
        return { type: "none" };
      case "k":
      case "<Up>":
        this.modeIndex = (this.modeIndex - 1 + total) % total;
        return { type: "none" };
      case "<CR>":
      case "<Space>":
      case "l":
      case "<Right>":
        if (this.modeIndex === MODES.length) return { type: "daily" };
        if (this.modeIndex === MODES.length + 1) {
          this.state = "stats";
        } else if (this.modeIndex === MODES.length + 2) {
          this.state = "settings";
          this.settingsIndex = 0;
        } else {
          this.state = "levels";
          this.levelIndex = 0;
        }
        return { type: "none" };
      default:
        return { type: "none" };
    }
  }

  private handleStats(token: KeyToken): MenuAction {
    if (token === "<Esc>" || token === "h" || token === "<Left>" || token === "<CR>" || token === "q") {
      this.state = "mode";
    }
    return { type: "none" };
  }

  private handleLevels(token: KeyToken): MenuAction {
    const n = this.mode.entries.length;
    switch (token) {
      case "j":
      case "<Down>":
        this.levelIndex = (this.levelIndex + 1) % n;
        return { type: "none" };
      case "k":
      case "<Up>":
        this.levelIndex = (this.levelIndex - 1 + n) % n;
        return { type: "none" };
      case "<Esc>":
      case "h":
      case "<Left>":
        this.state = "mode";
        return { type: "none" };
      case "<CR>":
      case "<Space>":
      case "l":
      case "<Right>":
        return this.start();
      default:
        return { type: "none" };
    }
  }

  private start(): MenuAction {
    if (!isLevelUnlocked(this.ids(), this.levelIndex)) return { type: "none" };
    const m = this.mode;
    if (m.key === "tutorial") return { type: "start", mode: "tutorial", chapter: TUTORIAL_CHAPTERS[this.levelIndex]! };
    if (m.key === "rush") return { type: "start", mode: "rush", level: CURSOR_RUSH_LEVELS[this.levelIndex]! };
    if (m.key === "dodge") return { type: "start", mode: "dodge", level: DODGE_LEVELS[this.levelIndex]! };
    if (m.key === "hotfix") return { type: "start", mode: "hotfix", level: HOTFIX_LEVELS[this.levelIndex]! };
    return { type: "start", mode: "golf", puzzle: GOLF_PUZZLES[this.levelIndex]! };
  }

  private handleSettings(token: KeyToken): MenuAction {
    const row = SETTINGS_ROWS[this.settingsIndex]!;
    switch (token) {
      case "j":
      case "<Down>":
        this.settingsIndex = (this.settingsIndex + 1) % SETTINGS_ROWS.length;
        return { type: "none" };
      case "k":
      case "<Up>":
        this.settingsIndex = (this.settingsIndex - 1 + SETTINGS_ROWS.length) % SETTINGS_ROWS.length;
        return { type: "none" };
      case "h":
      case "<Left>":
      case "l":
      case "<Right>": {
        const dir = token === "h" || token === "<Left>" ? -1 : 1;
        return this.adjustSetting(row, dir, token);
      }
      case "<CR>":
      case "<Space>":
        if (row === "back") {
          this.state = "mode";
          return { type: "none" };
        }
        if (row === "keybinds") {
          this.state = "keybinds";
          this.keybindIndex = 0;
          return { type: "none" };
        }
        return this.adjustSetting(row, 1, token);
      case "<Esc>":
        this.state = "mode";
        return { type: "none" };
      default:
        return { type: "none" };
    }
  }

  private adjustSetting(row: (typeof SETTINGS_ROWS)[number], dir: number, token: KeyToken): MenuAction {
    if (row === "volume") {
      this.settings.volume = clamp01(Math.round((this.settings.volume + dir * 0.1) * 10) / 10);
      return { type: "settingsChanged" };
    }
    if (row === "music") {
      this.settings.musicVolume = clamp01(Math.round((this.settings.musicVolume + dir * 0.1) * 10) / 10);
      return { type: "settingsChanged" };
    }
    if (row === "bloom") {
      this.settings.bloom = clamp01(Math.round((this.settings.bloom + dir * 0.1) * 10) / 10);
      return { type: "settingsChanged" };
    }
    if (row === "screen") {
      const next = Math.round((this.settings.screenScale + dir * 0.1) * 10) / 10;
      this.settings.screenScale = Math.max(0.7, Math.min(1.5, next));
      return { type: "settingsChanged" };
    }
    if (row === "scanlines") {
      this.settings.scanlines = token === "<CR>" || token === "<Space>" ? !this.settings.scanlines : dir > 0;
      return { type: "settingsChanged" };
    }
    if (row === "theme") {
      this.settings.theme = this.settings.theme === "green" ? "amber" : "green";
      return { type: "settingsChanged" };
    }
    if (row === "coach") {
      this.settings.coachTips = token === "<CR>" || token === "<Space>" ? !this.settings.coachTips : dir > 0;
      return { type: "settingsChanged" };
    }
    if (row === "keybinds" && dir > 0) {
      this.state = "keybinds";
      this.keybindIndex = 0;
    }
    return { type: "none" };
  }

  // --- keybinds sub-screen ---

  private keybindRows(): KbRow[] {
    const custom = Object.entries(this.settings.keybinds.custom);
    return [
      { kind: "preset" },
      { kind: "caps" },
      { kind: "iesc" },
      { kind: "swap" },
      { kind: "add" },
      ...custom.map(([src, dst]) => ({ kind: "custom" as const, src, dst })),
      { kind: "back" },
    ];
  }

  private handleKeybinds(token: KeyToken): MenuAction {
    const kb = this.settings.keybinds;

    // Two-step capture: source key, then what it should act as. Esc cancels.
    if (this.capture) {
      if (token === "<Esc>") {
        this.capture = null;
        return { type: "none" };
      }
      if (this.capture.stage === "src") {
        this.capture = { stage: "dst", src: token };
        return { type: "none" };
      }
      const src = this.capture.src!;
      this.capture = null;
      if (token === src) return { type: "none" }; // identity map — pointless
      kb.custom[src] = token;
      return { type: "settingsChanged" };
    }

    const rows = this.keybindRows();
    const row = rows[this.keybindIndex]!;
    switch (token) {
      case "j":
      case "<Down>":
        this.keybindIndex = (this.keybindIndex + 1) % rows.length;
        return { type: "none" };
      case "k":
      case "<Up>":
        this.keybindIndex = (this.keybindIndex - 1 + rows.length) % rows.length;
        return { type: "none" };
      case "<Esc>":
        this.state = "settings";
        return { type: "none" };
      case "h":
      case "<Left>":
      case "l":
      case "<Right>":
        return this.adjustKeybind(row, token === "h" || token === "<Left>" ? -1 : 1);
      case "x":
      case "<Del>":
        return this.removeCustom(row);
      case "<CR>":
      case "<Space>":
        if (row.kind === "back") {
          this.state = "settings";
          return { type: "none" };
        }
        if (row.kind === "add") {
          this.capture = { stage: "src" };
          return { type: "none" };
        }
        if (row.kind === "custom") return this.removeCustom(row);
        return this.adjustKeybind(row, 1);
      default:
        return { type: "none" };
    }
  }

  private adjustKeybind(row: KbRow, dir: number): MenuAction {
    const kb = this.settings.keybinds;
    if (row.kind === "preset") {
      const i = PRESET_ORDER.indexOf(kb.preset);
      kb.preset = PRESET_ORDER[(i + dir + PRESET_ORDER.length) % PRESET_ORDER.length]!;
      return { type: "settingsChanged" };
    }
    if (row.kind === "caps") {
      kb.capsEsc = !kb.capsEsc;
      return { type: "settingsChanged" };
    }
    if (row.kind === "iesc") {
      const i = IESC_ORDER.indexOf(kb.insertEsc);
      kb.insertEsc = IESC_ORDER[(i + dir + IESC_ORDER.length) % IESC_ORDER.length]!;
      return { type: "settingsChanged" };
    }
    if (row.kind === "swap") {
      kb.swapColon = !kb.swapColon;
      return { type: "settingsChanged" };
    }
    return { type: "none" };
  }

  private removeCustom(row: KbRow): MenuAction {
    if (row.kind !== "custom") return { type: "none" };
    delete this.settings.keybinds.custom[row.src];
    this.keybindIndex = Math.min(this.keybindIndex, this.keybindRows().length - 1);
    return { type: "settingsChanged" };
  }

  // --- render ---

  render(): void {
    if (this.state === "mode") this.renderMode();
    else if (this.state === "levels") this.renderLevels();
    else if (this.state === "keybinds") this.renderKeybinds();
    else if (this.state === "stats") this.renderStats();
    else this.renderSettings();
  }

  private title(): void {
    const term = this.term;
    const th = term.theme;
    const t = "V I M T R A I N E R";
    term.drawText(1, cx(term, t.length), t, { fg: th.fg, bold: true });
    term.drawText(2, cx(term, 24), "build the muscle memory", { fg: th.dim });
  }

  private renderMode(): void {
    const term = this.term;
    const th = term.theme;
    term.clear();
    this.title();
    MODES.forEach((m, i) => {
      const row = 5 + i * 3;
      const sel = i === this.modeIndex;
      const stars = totalStars(m.entries);
      term.drawText(row, 4, `${sel ? "▶ " : "  "}${m.title}`, { fg: sel ? th.accent : th.fg, bold: sel });
      term.drawText(row + 1, 6, m.subtitle, { fg: th.dim });
      term.drawText(row, 40, `★ ${stars}/${m.entries.length * 3}`, { fg: th.accentAlt });
    });
    // Daily challenge row.
    const dailyRow = 5 + MODES.length * 3;
    const dailySel = this.modeIndex === MODES.length;
    const rec = Storage.getDaily();
    const playedToday = rec?.date === todayId();
    term.drawText(dailyRow, 4, `${dailySel ? "▶ " : "  "}DAILY GAUNTLET`, { fg: dailySel ? th.accent : th.fg, bold: dailySel });
    term.drawText(
      dailyRow + 1,
      6,
      playedToday
        ? `today: ${rec!.score} pts ${"★".repeat(rec!.stars)} — Enter to view board`
        : "one attempt — same waves for everyone, global board",
      { fg: playedToday ? th.accentAlt : th.dim },
    );

    const statsRow = dailyRow + 3;
    const statsSel = this.modeIndex === MODES.length + 1;
    term.drawText(statsRow, 4, `${statsSel ? "▶ " : "  "}STATS`, { fg: statsSel ? th.accent : th.fg, bold: statsSel });
    term.drawText(statsRow, 40, "your fingerprint", { fg: th.dim });

    const setRow = statsRow + 2;
    const setSel = this.modeIndex === MODES.length + 2;
    term.drawText(setRow, 4, `${setSel ? "▶ " : "  "}SETTINGS`, { fg: setSel ? th.accent : th.fg, bold: setSel });

    term.drawStatusLine(" j/k move   Enter select ", "VimTrainer ");
  }

  private renderLevels(): void {
    const term = this.term;
    const th = term.theme;
    term.clear();
    const m = this.mode;
    term.drawText(1, 4, m.title, { fg: th.accent, bold: true });
    term.drawText(2, 4, m.subtitle, { fg: th.dim });

    const ids = this.ids();
    // Long lists scroll behind a fixed-height viewport so every row — and the
    // hint under the list — always stays on the grid. "more" markers show
    // what's hidden above/below.
    const n = m.entries.length;
    const maxVisible = Math.max(3, Math.floor((term.rows - 9) / 2));
    const shown = Math.min(n, maxVisible);
    const first = Math.max(0, Math.min(this.levelIndex - Math.floor(maxVisible / 2), n - shown));
    if (first > 0) term.drawText(3, 4, `↑ ${first} more`, { fg: th.dim });
    m.entries.slice(first, first + shown).forEach((e, vi) => {
      const i = first + vi;
      const row = 4 + vi * 2;
      const sel = i === this.levelIndex;
      const unlocked = isLevelUnlocked(ids, i);
      const stars = Storage.getStars(e.id);
      // Single-cell glyph: the grid draws one UTF-16 unit per cell, so emoji
      // (surrogate pairs) come out as two broken boxes.
      const lock = unlocked ? "" : "× ";
      const starStr = "★".repeat(stars).padEnd(3, "·");
      const marker = sel ? "▶ " : "  ";
      const fg = !unlocked ? th.dim : sel ? th.fg : th.statusFg;
      term.drawText(row, 4, `${marker}${lock}${e.title}`.padEnd(26), { fg, bold: sel && unlocked });
      term.drawText(row, 32, unlocked ? starStr : "", { fg: th.accent });
      term.drawText(row, 38, e.skill.slice(0, Math.max(0, term.cols - 38)), { fg: th.dim });
    });
    const below = n - first - shown;
    if (below > 0) term.drawText(4 + shown * 2, 4, `↓ ${below} more`, { fg: th.dim });

    const detail = 4 + shown * 2 + 1;
    const sel = m.entries[this.levelIndex];
    if (sel) {
      const unlocked = isLevelUnlocked(ids, this.levelIndex);
      const hint = unlocked ? sel.hint : "Clear the previous level to unlock this one.";
      const hintLines = wrapText(hint, Math.max(20, term.cols - 8), 2);
      hintLines.forEach((line, i) => {
        term.drawText(detail + i, 4, line, { fg: unlocked ? th.statusFg : th.dim });
      });
      const best = this.bestLabel(m.key, sel.id);
      if (best) term.drawText(detail + hintLines.length, 4, best, { fg: th.accentAlt });
    }
    term.drawStatusLine(" j/k move   Enter start   h/Esc back ", "VimTrainer ");
  }

  private bestLabel(mode: ModeKey, id: string): string {
    if (mode === "tutorial") return Storage.getStars(id) > 0 ? "✓ completed" : "";
    const raw = Storage.getHighScore(id);
    if (raw <= 0) return "";
    if (mode === "golf") return `best: ${10000 - raw} keys`;
    return `best score: ${raw}`;
  }

  private renderSettings(): void {
    const term = this.term;
    const th = term.theme;
    term.clear();
    term.drawText(1, 4, "SETTINGS", { fg: th.accent, bold: true });
    const kb = this.settings.keybinds;
    const extras = [
      kb.capsEsc ? "caps" : "",
      kb.insertEsc !== "off" ? kb.insertEsc : "",
      kb.swapColon ? ";:" : "",
      Object.keys(kb.custom).length > 0 ? `${Object.keys(kb.custom).length} custom` : "",
    ].filter(Boolean);
    const kbSummary = getPreset(kb.preset).name + (extras.length ? `  +${extras.join(" +")}` : "");
    const rows: [string, string][] = [
      ["Volume", `${Math.round(this.settings.volume * 100)}%   ${bar(this.settings.volume)}`],
      ["Music", `${Math.round(this.settings.musicVolume * 100)}%   ${bar(this.settings.musicVolume)}`],
      ["CRT Bloom", `${Math.round(this.settings.bloom * 100)}%   ${bar(this.settings.bloom)}`],
      ["Screen size", `${Math.round(this.settings.screenScale * 100)}%   ${bar((this.settings.screenScale - 0.7) / 0.8)}`],
      ["Scanlines", this.settings.scanlines ? "ON" : "OFF"],
      ["Theme", this.settings.theme === "green" ? "GREEN phosphor" : "AMBER phosphor"],
      ["Coach tips", this.settings.coachTips ? "ON" : "OFF"],
      ["Keybinds →", kbSummary],
      ["← Back", ""],
    ];
    rows.forEach(([label, value], i) => {
      const row = 4 + i * 2;
      const sel = i === this.settingsIndex;
      term.drawText(row, 4, `${sel ? "▶ " : "  "}${label}`.padEnd(16), { fg: sel ? th.fg : th.statusFg, bold: sel });
      term.drawText(row, 22, value, { fg: th.accentAlt });
    });
    // No brand on the right — this line needs every column for its own words.
    term.drawStatusLine(" j/k move   h/l adjust   Enter toggle   Esc back ");
  }

  private renderStats(): void {
    const term = this.term;
    const th = term.theme;
    term.clear();
    const stats = Storage.getStats() ?? emptyStats();

    // Everything wraps/scales to the grid width so no line runs off-screen.
    const left = 4;
    const width = Math.max(20, term.cols - left * 2);
    let row = 1;

    term.drawText(row++, left, "YOUR VIM FINGERPRINT", { fg: th.accent, bold: true });
    for (const line of wrapText(fingerprintVerdict(stats), width, 2)) {
      term.drawText(row++, left, line, { fg: th.dim });
    }
    term.drawText(row++, left, `${stats.runs} runs   ${stats.totalKeys} keys pressed`, { fg: th.statusFg });
    row++;

    // Top keys — bar chart sized so bar + count end inside the grid.
    const top = topKeys(stats, 7);
    term.drawText(row++, left, "── most used ──", { fg: th.accentAlt });
    const max = top[0]?.count ?? 1;
    const barCol = left + 7;
    const barMax = Math.max(6, Math.min(22, term.cols - barCol - String(max).length - left - 1));
    top.forEach((t) => {
      const bar = "█".repeat(Math.max(1, Math.round((t.count / max) * barMax)));
      term.drawText(row, left, t.key.padEnd(7).slice(0, 7), { fg: th.fg, bold: true });
      term.drawText(row, barCol, bar, { fg: th.accent });
      term.drawText(row, barCol + barMax + 1, String(t.count), { fg: th.dim });
      row++;
    });
    if (top.length === 0) term.drawText(row++, left, "no keys recorded yet — go play!", { fg: th.dim });
    row++;

    // Category mix — label + meter + percent, columns derived from the width.
    term.drawText(row++, left, "── motion mix ──", { fg: th.accentAlt });
    const mixBarW = Math.max(6, Math.min(16, term.cols - left - 20 - 6 - left));
    const mixNameW = Math.min(20, Math.max(10, term.cols - left - mixBarW - 6 - left));
    categoryMix(stats).forEach((c) => {
      const pct = Math.round(c.share * 100);
      const bar = "▰".repeat(Math.round(c.share * mixBarW)).padEnd(mixBarW, "▱");
      term.drawText(row, left, c.name.slice(0, mixNameW).padEnd(mixNameW), { fg: th.statusFg });
      term.drawText(row, left + mixNameW, bar, { fg: th.accentAlt });
      term.drawText(row, left + mixNameW + mixBarW + 2, `${pct}%`, { fg: th.dim });
      row++;
    });
    row++;

    // Untouched power tools — the coach's long-term voice.
    const unused = neverUsed(stats);
    if (stats.totalKeys >= 100 && unused.length > 0) {
      term.drawText(row++, left, "── never touched ──", { fg: th.accentAlt });
      for (const line of wrapText(unused.join("   "), width, 2)) {
        term.drawText(row++, left, line, { fg: th.danger });
      }
      for (const line of wrapText("each of these is a speed upgrade — try them in a run", width, 2)) {
        term.drawText(row++, left, line, { fg: th.dim });
      }
    } else if (stats.totalKeys >= 100) {
      for (const line of wrapText("every power tool touched — nothing left on the table ★", width, 2)) {
        term.drawText(row++, left, line, { fg: th.accent });
      }
    }

    term.drawStatusLine(" Esc back ", "VimTrainer ");
  }

  private renderKeybinds(): void {
    const term = this.term;
    const th = term.theme;
    const kb = this.settings.keybinds;
    term.clear();
    term.drawText(1, 4, "KEYBINDS", { fg: th.accent, bold: true });
    term.drawText(2, 4, "remap keys like a real vimrc — presets or your own", { fg: th.dim });

    const rows = this.keybindRows();
    const labels: Record<KbRow["kind"], string> = {
      preset: "Preset",
      caps: "Caps Lock → Esc",
      iesc: "Insert escape",
      swap: "; ⇄ : swap",
      add: "+ Add custom bind",
      custom: "",
      back: "← Back",
    };
    rows.forEach((row, i) => {
      const y = 4 + i * 2;
      const sel = i === this.keybindIndex;
      const label = row.kind === "custom" ? `  ${row.src} → ${row.dst}` : labels[row.kind];
      let value = "";
      if (row.kind === "preset") value = getPreset(kb.preset).name;
      else if (row.kind === "caps") value = kb.capsEsc ? "ON" : "OFF";
      else if (row.kind === "iesc") value = kb.insertEsc === "off" ? "OFF" : kb.insertEsc === "both" ? "jj + jk" : kb.insertEsc;
      else if (row.kind === "swap") value = kb.swapColon ? "ON" : "OFF";
      else if (row.kind === "custom") value = "(Enter/x removes)";
      term.drawText(y, 4, `${sel ? "▶ " : "  "}${label}`.padEnd(24), { fg: sel ? th.fg : th.statusFg, bold: sel });
      term.drawText(y, 28, value, { fg: th.accentAlt });
    });

    // Why-you'd-want-this explanation for the selected row. Wrapped to the
    // grid and capped so it never runs into the capture prompt or off-screen.
    const row = rows[this.keybindIndex]!;
    const why = row.kind === "preset" ? getPreset(kb.preset).why : KB_WHY[row.kind] ?? "";
    const whyRow = 4 + rows.length * 2 + 1;
    const whyMax = Math.max(1, term.rows - whyRow - 3);
    const whyLines = why ? wrapText(why, Math.max(20, term.cols - 8), whyMax) : [];
    whyLines.forEach((line, i) => {
      term.drawText(whyRow + i, 4, line, { fg: th.dim });
    });

    if (this.capture) {
      const msg =
        this.capture.stage === "src"
          ? "PRESS the key you want to remap…   (Esc cancels)"
          : `"${this.capture.src}" will act as…   PRESS the target key   (Esc cancels)`;
      wrapText(msg, Math.max(20, term.cols - 8), 2).forEach((line, i) => {
        term.drawText(whyRow + whyLines.length + 1 + i, 4, line, { fg: th.accent, bold: true });
      });
    }

    // No brand on the right — this line needs every column for its own words.
    term.drawStatusLine(this.capture ? " capturing key… " : " j/k move   h/l adjust   Enter select   Esc back ");
  }
}

function cx(term: TerminalRenderer, len: number): number {
  return Math.max(0, Math.floor((term.cols - len) / 2));
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function bar(v: number): string {
  const n = Math.round(v * 10);
  return "█".repeat(n) + "░".repeat(10 - n);
}
function totalStars(entries: Entry[]): number {
  return entries.reduce((s, e) => s + Storage.getStars(e.id), 0);
}
