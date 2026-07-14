// Normalizes raw browser KeyboardEvents into Vim-style key tokens.
// Single-character printable keys pass through as themselves ("h", "d", "2", "$").
// Special keys use angle-bracket notation ("<Esc>", "<CR>", "<BS>", "<C-r>", "<Space>").
// Returns null for keys the game never consumes (modifiers alone, F-keys, etc.).

export type KeyToken = string;

const SPECIAL: Record<string, KeyToken> = {
  Escape: "<Esc>",
  Enter: "<CR>",
  Backspace: "<BS>",
  Tab: "<Tab>",
  " ": "<Space>",
  ArrowLeft: "<Left>",
  ArrowRight: "<Right>",
  ArrowUp: "<Up>",
  ArrowDown: "<Down>",
  Delete: "<Del>",
  Home: "<Home>",
  End: "<End>",
};

export interface NormalizeOpts {
  /** Treat Caps Lock as Esc (the classic remap). Also compensates letter case
   *  while the OS lock state is on, since the browser can't suppress the toggle. */
  capsEsc?: boolean;
}

export function normalizeKeyEvent(e: KeyboardEvent, opts: NormalizeOpts = {}): KeyToken | null {
  const k = e.key;

  if (k === "CapsLock") return opts.capsEsc ? "<Esc>" : null;

  // Ignore standalone modifier presses.
  if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") {
    return null;
  }

  // Ctrl-chords: <C-r>, <C-d>, <C-u>, <C-v>, <C-o> ...
  if (e.ctrlKey && k.length === 1) {
    const lower = k.toLowerCase();
    if (lower >= "a" && lower <= "z") return `<C-${lower}>`;
  }
  // Let real Ctrl/Meta combos we don't map fall through to the browser.
  if ((e.ctrlKey || e.metaKey) && !(k in SPECIAL)) {
    return null;
  }

  if (k in SPECIAL) return SPECIAL[k]!;

  // Printable single character (already reflects Shift for letters/symbols).
  if (k.length === 1) {
    // Using Caps Lock as Esc still toggles the OS lock state (browsers can't
    // prevent that), which would invert every letter. Undo the inversion so
    // the key means what the player's finger meant.
    if (opts.capsEsc && /[a-zA-Z]/.test(k) && e.getModifierState?.("CapsLock")) {
      return e.shiftKey ? k.toUpperCase() : k.toLowerCase();
    }
    return k;
  }

  return null;
}

/** Which tokens the game consumes, so we can preventDefault only on those. */
export function isGameKey(token: KeyToken | null): boolean {
  return token !== null;
}
