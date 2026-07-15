// The skill curriculum: ordered levels that gate which Vim motions each drill
// emphasizes. Cursor Rush levels drive the MVP; more modes plug in later.

export type TargetKind = "anyChar" | "wordStart" | "lineStart" | "findChar";

export interface CursorRushLevel {
  id: string;
  title: string;
  skill: string; // human label for the tier
  hint: string; // one-line teaching tip shown in the HUD
  buffer: string[];
  targetCount: number;
  timeLimit: number; // seconds
  targetKind: TargetKind;
  minDistance: number; // targets spawn at least this Manhattan distance away
}

const PROSE = [
  "the quick brown fox jumps over the lazy dog",
  "pack my box with five dozen liquor jugs",
  "how vexingly quick daft zebras jump today",
  "the five boxing wizards jump very quickly",
  "sphinx of black quartz judge my vow now",
];

const CODE = [
  "function greet(name) {",
  "  const msg = 'hello, ' + name;",
  "  console.log(msg);",
  "  return msg.length;",
  "}",
  "",
  "const users = [alice, bob, carol];",
  "users.forEach((u) => greet(u));",
];

const GRID = [
  "· · · · · · · · · · · · · · ·",
  "· x · · · o · · · x · · · o ·",
  "· · · · · · · · · · · · · · ·",
  "· o · · x · · · o · · · x · ·",
  "· · · · · · · · · · · · · · ·",
  "· x · · · o · · · x · · · o ·",
];

export const CURSOR_RUSH_LEVELS: CursorRushLevel[] = [
  {
    id: "rush-hjkl",
    title: "hjkl Bootcamp",
    skill: "Basic motion",
    hint: "Move with h ← j ↓ k ↑ l →. Reach the highlighted cell.",
    buffer: GRID,
    targetCount: 10,
    timeLimit: 45,
    targetKind: "anyChar",
    minDistance: 3,
  },
  {
    id: "rush-words",
    title: "Word Sprint",
    skill: "Word motion",
    hint: "Use w / b / e to leap word-by-word instead of spamming l.",
    buffer: PROSE,
    targetCount: 12,
    timeLimit: 45,
    targetKind: "wordStart",
    minDistance: 5,
  },
  {
    id: "rush-find",
    title: "Find & Strike",
    skill: "Find on line",
    hint: "f{char} jumps to a character; t stops just before it; ; repeats.",
    buffer: PROSE,
    targetCount: 12,
    timeLimit: 45,
    targetKind: "findChar",
    minDistance: 6,
  },
  {
    id: "rush-search",
    title: "Search Party",
    skill: "Search (/ n)",
    hint: "Type /word then Enter to fly to it; n repeats. Way faster than stepping.",
    buffer: PROSE,
    targetCount: 12,
    timeLimit: 50,
    targetKind: "wordStart",
    minDistance: 10,
  },
  {
    id: "rush-lines",
    title: "Line Leaper",
    skill: "Screen/file motion",
    hint: "gg to top, G to bottom, or 5G to jump to a line. Counts save keys!",
    buffer: CODE,
    targetCount: 10,
    timeLimit: 50,
    targetKind: "lineStart",
    minDistance: 3,
  },
  {
    id: "rush-mixed",
    title: "Grand Rush",
    skill: "Everything",
    hint: "Mix motions freely — the fewer keys per target, the bigger the combo.",
    buffer: CODE,
    targetCount: 15,
    timeLimit: 60,
    targetKind: "anyChar",
    minDistance: 5,
  },
];

export function getLevel(id: string): CursorRushLevel | undefined {
  return CURSOR_RUSH_LEVELS.find((l) => l.id === id);
}

// --- Dodge mode ------------------------------------------------------------

export interface DodgeLevel {
  id: string;
  title: string;
  skill: string;
  hint: string;
  duration: number; // seconds of escalating waves to survive
  startHp: number;
  /** Difficulty knobs, scaled from 0 (start) to 1 (end of level). */
  baseSpawnInterval: number; // seconds between spawns at difficulty 0
  minSpawnInterval: number; // seconds between spawns at difficulty 1
  baseSpeed: number; // projectile cells/sec at difficulty 0
  maxSpeed: number; // projectile cells/sec at difficulty 1
  patterns: DodgePattern[];
  /**
   * Extra simultaneous waves at difficulty 1 (0 = one pattern per spawn tick).
   * Ramps in with difficulty, so late-game gets denser. Defaults to 0.
   */
  intensity?: number;
}

export type DodgePattern =
  | "stream" // horizontal line of bullets from left/right
  | "rain" // vertical drop from the top
  | "aimed" // single shot from any edge, straight at the cursor
  | "wall" // full column with one gap — forces a big jump
  | "diagonal" // stream angled in from a corner
  | "arc" // a fan of bullets from an edge, spread around the cursor
  | "ring" // omnidirectional burst from an interior point
  | "spiral"; // rotating emitter that sweeps bullets in every direction

export const DODGE_LEVELS: DodgeLevel[] = [
  {
    id: "dodge-basics",
    title: "First Contact",
    skill: "hjkl under fire",
    hint: "Dodge with h j k l. Stay calm — read the lanes.",
    duration: 40,
    startHp: 3,
    baseSpawnInterval: 1.1,
    minSpawnInterval: 0.55,
    baseSpeed: 7,
    maxSpeed: 12,
    patterns: ["stream", "rain"],
  },
  {
    id: "dodge-aimed",
    title: "Aimbot Alley",
    skill: "Reposition fast",
    hint: "Bullets aim where you ARE, from every side. Keep moving — w/b/$ cover ground fast.",
    duration: 50,
    startHp: 3,
    baseSpawnInterval: 1.0,
    minSpawnInterval: 0.42,
    baseSpeed: 8,
    maxSpeed: 15,
    patterns: ["stream", "rain", "aimed", "diagonal"],
    intensity: 1,
  },
  {
    id: "dodge-walls",
    title: "Wall Run",
    skill: "Jumps: gg G $ 0",
    hint: "Walls have ONE gap. Snap to it with gg / G / $ / 0 — hjkl is too slow.",
    duration: 55,
    startHp: 4,
    baseSpawnInterval: 1.25,
    minSpawnInterval: 0.62,
    baseSpeed: 6,
    maxSpeed: 12,
    patterns: ["wall", "aimed", "rain", "arc"],
    intensity: 1,
  },
  {
    id: "dodge-crossfire",
    title: "Crossfire",
    skill: "Angles everywhere",
    hint: "Fire pours in at every angle. Watch the diagonals — h/j/k/l alone won't cut it.",
    duration: 55,
    startHp: 4,
    baseSpawnInterval: 1.0,
    minSpawnInterval: 0.4,
    baseSpeed: 8,
    maxSpeed: 16,
    patterns: ["diagonal", "aimed", "arc", "stream", "rain"],
    intensity: 2,
  },
  {
    id: "dodge-vortex",
    title: "Vortex",
    skill: "Rotating fire",
    hint: "Rings and spirals bloom outward. Find the gaps in the rotation and slip through.",
    duration: 60,
    startHp: 4,
    baseSpawnInterval: 1.15,
    minSpawnInterval: 0.5,
    baseSpeed: 7,
    maxSpeed: 14,
    patterns: ["ring", "spiral", "aimed", "arc"],
    intensity: 2,
  },
  {
    id: "dodge-storm",
    title: "Bullet Storm",
    skill: "Everything",
    hint: "Every pattern, every angle, no mercy. Use every motion you know.",
    duration: 65,
    startHp: 5,
    baseSpawnInterval: 0.85,
    minSpawnInterval: 0.34,
    baseSpeed: 8,
    maxSpeed: 18,
    patterns: ["stream", "rain", "aimed", "wall", "diagonal", "arc", "ring", "spiral"],
    intensity: 3,
  },
];

export function getDodgeLevel(id: string): DodgeLevel | undefined {
  return DODGE_LEVELS.find((l) => l.id === id);
}

// --- Golf mode -------------------------------------------------------------

export interface GolfPuzzle {
  id: string;
  title: string;
  skill: string;
  hint: string;
  start: string[];
  target: string[];
  par: number; // keystroke par (Esc counts, like real vimgolf)
  /** Canonical par solution, replayable key-by-key. Verified by test. */
  solution: string;
  startCursor?: { row: number; col: number };
}

export const GOLF_PUZZLES: GolfPuzzle[] = [
  {
    id: "golf-delete-line",
    solution: "dd",
    title: "Tidy Up",
    skill: "Line delete (dd)",
    hint: "Remove the debug line. Think dd.",
    start: ["const x = 1;", "console.log('debug');", "const y = 2;"],
    target: ["const x = 1;", "const y = 2;"],
    par: 3,
    startCursor: { row: 1, col: 0 },
  },
  {
    id: "golf-swap-word",
    solution: "ciwbar<Esc>",
    title: "Rename",
    skill: "Change word (ciw)",
    hint: "Turn foo into bar. ciw is your friend.",
    start: ["let foo = 42;"],
    target: ["let bar = 42;"],
    par: 8,
    startCursor: { row: 0, col: 4 },
  },
  {
    id: "golf-quote",
    solution: "ci\"hello<Esc>",
    title: "Quote It",
    skill: "Inside quotes ci\"",
    hint: 'Replace the placeholder text between the quotes with hello.',
    start: ['msg = "xxxxx";'],
    target: ['msg = "hello";'],
    par: 9,
    startCursor: { row: 0, col: 7 },
  },
  {
    id: "golf-args",
    solution: "ci(a, b<Esc>",
    title: "Swap the Guts",
    skill: "Inside parens ci(",
    hint: "Change the args inside ( ) to a, b. Try ci(.",
    start: ["call(1, 2, 3)"],
    target: ["call(a, b)"],
    par: 8,
    startCursor: { row: 0, col: 5 },
  },
  {
    id: "golf-append",
    solution: "A;<Esc>j.j.",
    title: "Semicolons",
    skill: "Append at end (A)",
    hint: "Add a semicolon to each line. A;<Esc> then j. and repeat, or . to repeat.",
    start: ["let a = 1", "let b = 2", "let c = 3"],
    target: ["let a = 1;", "let b = 2;", "let c = 3;"],
    par: 12,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-reverse",
    solution: "ddp",
    title: "Flip Order",
    skill: "Move line (dd p)",
    hint: "Move the first line below the second. dd then p.",
    start: ["second", "first"],
    target: ["first", "second"],
    par: 3,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-empty-call",
    solution: "di(",
    title: "Empty the Call",
    skill: "Inside parens di(",
    hint: "Clear everything between the parentheses. di( does it in one move.",
    start: ["render(a, b, c)"],
    target: ["render()"],
    par: 4,
    startCursor: { row: 0, col: 7 },
  },
  {
    id: "golf-dup",
    solution: "yyp",
    title: "Twins",
    skill: "Duplicate (yy p)",
    hint: "Make a second, identical line. Yank it with yy, paste with p.",
    start: ["clone"],
    target: ["clone", "clone"],
    par: 3,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-substitute",
    solution: ":s/a/b/g<CR>",
    title: "Find & Replace",
    skill: "Substitute (:s//g)",
    hint: "Replace every 'a' with 'b' at once. :s/a/b/g beats doing it by hand.",
    start: ["a a a a a"],
    target: ["b b b b b"],
    par: 10,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-block-strip",
    solution: "<C-v>jjld",
    title: "Strip the Column",
    skill: "Visual block ^V",
    hint: "Delete the leading '# ' from every line with a visual block: Ctrl-V, select, d.",
    start: ["# alpha", "# beta", "# gamma"],
    target: ["alpha", "beta", "gamma"],
    par: 6,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-join",
    solution: "J",
    title: "Reunite",
    skill: "Join lines (J)",
    hint: "Two halves of one statement. J joins the next line up with a single space.",
    start: ["const x =", "42;"],
    target: ["const x = 42;"],
    par: 2,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-typo",
    solution: "f2r1",
    title: "Typo Strike",
    skill: "Replace char (r)",
    hint: "One digit is wrong. f2 jumps straight to it, r1 overwrites it — no insert mode.",
    start: ["const PI = 3.24159"],
    target: ["const PI = 3.14159"],
    par: 4,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-shout",
    solution: "5~",
    title: "Shout It",
    skill: "Toggle case (~)",
    hint: "Make hello shout: ~ flips case under the cursor, and 5~ flips five at once.",
    start: ["hello world"],
    target: ["HELLO world"],
    par: 3,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-tail",
    solution: "f;lD",
    title: "Cut the Tail",
    skill: "Delete to end (D)",
    hint: "Everything after the semicolon is junk. D deletes from the cursor to the line's end.",
    start: ["keep this; delete all of it"],
    target: ["keep this;"],
    par: 5,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-vanish",
    solution: "daw",
    title: "Vanish",
    skill: "Around word (daw)",
    hint: "Remove 'remove' from anywhere inside it: daw takes the word and its space.",
    start: ["keep remove keep"],
    target: ["keep keep"],
    par: 3,
    startCursor: { row: 0, col: 6 },
  },
  {
    id: "golf-echo",
    solution: "dwj.j.",
    title: "Repeat Yourself",
    skill: "Dot repeat (.)",
    hint: "Fix the first line with dw, then let . repeat it: j. j. finishes the column.",
    start: ["TODO buy milk", "TODO call mom", "TODO fix bug"],
    target: ["buy milk", "call mom", "fix bug"],
    par: 6,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-seek",
    solution: "/delta<CR>ciwomega<Esc>",
    title: "Seek & Change",
    skill: "Search + change",
    hint: "Fly to the typo with /delta, then ciw rewrites the word in place.",
    start: ["alpha beta", "gamma delta"],
    target: ["alpha beta", "gamma omega"],
    par: 16,
    startCursor: { row: 0, col: 0 },
  },
  {
    id: "golf-factory",
    solution: "qaI- <Esc>jq3@a",
    title: "Macro Factory",
    skill: "Macros (q @)",
    hint: "Record the fix once: qa I- Esc j q. Then 3@a replays it down the column.",
    start: ["red", "green", "blue", "cyan"],
    target: ["- red", "- green", "- blue", "- cyan"],
    par: 11,
    startCursor: { row: 0, col: 0 },
  },
];

export function getGolfPuzzle(id: string): GolfPuzzle | undefined {
  return GOLF_PUZZLES.find((p) => p.id === id);
}
