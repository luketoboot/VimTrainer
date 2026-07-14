// Shared engine types. The engine is framework-agnostic: no DOM, no canvas.

export interface Pos {
  row: number;
  col: number;
}

export type Mode =
  | "normal"
  | "insert"
  | "visual" // charwise
  | "visual-line"
  | "visual-block"; // charwise rectangle (Ctrl-V)

/** How a motion/range spans text — affects how operators cut it. */
export type Wise = "charwise" | "linewise";

/** A register holds yanked/deleted text plus how it should paste back. */
export interface Register {
  text: string;
  wise: Wise;
}

/** Result of resolving a motion from a position. */
export interface MotionResult {
  pos: Pos;
  wise: Wise;
  /** Whether the target cell is included when an operator uses this motion. */
  inclusive: boolean;
}

/** A text-object span (used by iw, a", i(, ...). end is inclusive. */
export interface TextObjectRange {
  start: Pos;
  end: Pos;
  wise: Wise;
}

/** Events emitted per key so modes can react (juice, scoring) without re-parsing. */
export type EngineEvent =
  | { type: "move"; from: Pos; to: Pos }
  | { type: "mode"; from: Mode; to: Mode }
  | { type: "edit"; kind: EditKind; at: Pos; text?: string }
  | { type: "yank"; text: string; wise: Wise }
  | { type: "search"; pattern: string; found: boolean; to?: Pos }
  | { type: "bell" }; // invalid / no-op command

export type EditKind =
  | "delete"
  | "insert"
  | "change"
  | "replace"
  | "paste"
  | "join"
  | "undo"
  | "redo";

/** A read-only snapshot the renderer/modes consume each frame. */
export interface VimStateView {
  lines: readonly string[];
  cursor: Pos;
  mode: Mode;
  /** Anchor of the current visual selection, or null outside visual mode. */
  visualAnchor: Pos | null;
  /** The pending command prefix (e.g. "2d", "\"ay") for display. */
  pending: string;
  /** Command/search line being typed (":..." or "/..."), or null. */
  cmdline: string | null;
}
