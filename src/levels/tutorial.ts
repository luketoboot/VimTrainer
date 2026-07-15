// Guided tutorial content. Each lesson teaches ONE key/idea and carries the
// canonical `idealKeys` that solve it. Reach-lessons derive their target cell by
// running idealKeys on a scratch engine, so the highlight can never disagree with
// what the key actually does. A unit test replays idealKeys to prove every lesson
// is solvable.

export interface BaseLesson {
  instruction: string;
  teach: string; // key(s) shown as a badge
  /** Real-world use case: when/why you'd reach for this key while editing. */
  why: string;
  buffer: string[];
  cursor: { row: number; col: number };
  idealKeys: string; // canonical solution (also the shown hint)
}

export type Lesson =
  | (BaseLesson & { kind: "reach" })
  | (BaseLesson & { kind: "text"; target: string[] });

export interface TutorialChapter {
  id: string;
  title: string;
  skill: string;
  hint: string;
  lessons: Lesson[];
}

const TRACK = "· · · · · · · · · ·"; // a movement "track", 19 cols
const PROSE = "the quick brown fox jumps over lazy dogs";

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: "tut-motions",
    title: "Chapter 1 · Motions",
    skill: "move without arrows",
    hint: "Learn the core cursor motions one at a time.",
    lessons: [
      { kind: "reach", teach: "l", why: "Fine positioning for a char or two. For real distance, w/f/$ are faster — the drills score you on it.", instruction: "Move RIGHT. Press l to reach the marker.", buffer: [TRACK], cursor: { row: 0, col: 0 }, idealKeys: "llll" },
      { kind: "reach", teach: "h", why: "Small nudges left. If it's more than a few chars, b, 0, or F beat holding h.", instruction: "Move LEFT with h.", buffer: [TRACK], cursor: { row: 0, col: 8 }, idealKeys: "hhhh" },
      { kind: "reach", teach: "j", why: "Skim down through code. Add a count — 10j — to drop exactly ten lines while reading.", instruction: "Move DOWN with j.", buffer: [TRACK, TRACK, TRACK, TRACK], cursor: { row: 0, col: 6 }, idealKeys: "jjj" },
      { kind: "reach", teach: "k", why: "Climb back up to reread the function you just passed. Counts work here too: 5k.", instruction: "Move UP with k.", buffer: [TRACK, TRACK, TRACK, TRACK], cursor: { row: 3, col: 6 }, idealKeys: "kkk" },
      { kind: "reach", teach: "w", why: "The workhorse motion: hop word-to-word across a line instead of tapping l ten times.", instruction: "Leap by WORD with w.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "ww" },
      { kind: "reach", teach: "b", why: "Overshot with w? b walks back a word at a time — no arrow keys, no mouse.", instruction: "Go BACK a word with b.", buffer: [PROSE], cursor: { row: 0, col: 20 }, idealKeys: "bb" },
      { kind: "reach", teach: "e", why: "Lands ON a word's last char — set up an append (ea) or grab through word-end (ye).", instruction: "Jump to the END of the word with e.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "e" },
      { kind: "reach", teach: "$", why: "Line endings matter: append a ; with $a, or check what a long line ends with.", instruction: "Jump to the END of the line with $.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "$" },
      { kind: "reach", teach: "0", why: "Column zero instantly. Pair with ^ (first non-blank) when the line is indented.", instruction: "Jump to the START of the line with 0.", buffer: [PROSE], cursor: { row: 0, col: 20 }, idealKeys: "0" },
      { kind: "reach", teach: "G", why: "Bottom of the file in one key — end of logs, EOF, the code you just appended.", instruction: "Jump to the LAST line with G.", buffer: [PROSE, "second line", "the last line"], cursor: { row: 0, col: 0 }, idealKeys: "G" },
      { kind: "reach", teach: "gg", why: "Top of the file: imports, headers, the config key you need. 15G jumps to line 15.", instruction: "Jump to the FIRST line with gg.", buffer: [PROSE, "second line", "the last line"], cursor: { row: 2, col: 3 }, idealKeys: "gg" },
      { kind: "reach", teach: "f", why: "Snipe any char on this line: f( dives into a call's args, f, hops between params.", instruction: "Find a char: press f then q to land on 'q'.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "fq" },
    ],
  },
  {
    id: "tut-editing",
    title: "Chapter 2 · Editing",
    skill: "delete, change, insert",
    hint: "Operators + insert mode — the real power of Vim.",
    lessons: [
      { kind: "text", teach: "x", why: "The typo-zapper: delete the char under the cursor without ever entering insert mode.", instruction: "Delete the extra 'l' with x.", buffer: ["helllo"], cursor: { row: 0, col: 2 }, idealKeys: "x", target: ["hello"] },
      { kind: "text", teach: "dw", why: "Delete from here to the next word — clean out a word plus its trailing space.", instruction: "Delete the word 'bad ' with dw.", buffer: ["keep bad keep"], cursor: { row: 0, col: 5 }, idealKeys: "dw", target: ["keep keep"] },
      { kind: "text", teach: "dd", why: "Kill whole lines: dead code, stray debug logs. Takes a count — 3dd removes three.", instruction: "Delete the whole middle line with dd.", buffer: ["line one", "DELETE ME", "line two"], cursor: { row: 1, col: 0 }, idealKeys: "dd", target: ["line one", "line two"] },
      { kind: "text", teach: "i", why: "The front door to insert mode: start typing right where the cursor sits.", instruction: "Insert the missing 'l': press i, type l, then Esc.", buffer: ["helo"], cursor: { row: 0, col: 3 }, idealKeys: "il<Esc>", target: ["hello"] },
      { kind: "text", teach: "A", why: "End-of-line + insert in ONE key. The fastest way to add a missing ; or comma.", instruction: "Append a semicolon: A then ; then Esc.", buffer: ["let x = 1"], cursor: { row: 0, col: 0 }, idealKeys: "A;<Esc>", target: ["let x = 1;"] },
      { kind: "text", teach: "o", why: "Open a new line below and start typing — no reaching for End then Enter.", instruction: "Open a line below: o, type second, Esc.", buffer: ["first", "third"], cursor: { row: 0, col: 0 }, idealKeys: "osecond<Esc>", target: ["first", "second", "third"] },
      { kind: "text", teach: "ciw", why: "Rename in place: works from ANYWHERE inside the word — no need to find its start.", instruction: "Change the word 'foo' to bar: ciw then bar.", buffer: ["let foo = 1"], cursor: { row: 0, col: 4 }, idealKeys: "ciwbar<Esc>", target: ["let bar = 1"] },
      { kind: "text", teach: "yy p", why: "Duplicate a line, then tweak the copy — faster than retyping a similar statement.", instruction: "Duplicate the line: yy then p.", buffer: ["copy me"], cursor: { row: 0, col: 0 }, idealKeys: "yyp", target: ["copy me", "copy me"] },
    ],
  },
  {
    id: "tut-advanced",
    title: "Chapter 3 · Power",
    skill: "find, search, match, visual",
    hint: "The moves that make you fast.",
    lessons: [
      { kind: "reach", teach: "t", why: "Stop just short: ct, changes text up to a comma; dt) deletes up to the paren.", instruction: "Stop just BEFORE the 'o': t then o.", buffer: ["hello world"], cursor: { row: 0, col: 0 }, idealKeys: "to" },
      { kind: "reach", teach: "%", why: "Bounce between matching ( ) { } [ ] — find what a stray bracket opens or closes.", instruction: "Jump to the matching ) with %.", buffer: ["sum = (a + b)"], cursor: { row: 0, col: 6 }, idealKeys: "%" },
      { kind: "text", teach: "di(", why: "Clear a call's arguments without touching the parens. da( eats them too.", instruction: "Delete inside the parens with di(.", buffer: ["call(1, 2)"], cursor: { row: 0, col: 5 }, idealKeys: "di(", target: ["call()"] },
      { kind: "reach", teach: "/", why: "Search is the fastest long-range motion there is: /name Enter, then n for next hit.", instruction: "Search: type /needle then Enter.", buffer: ["find the needle here"], cursor: { row: 0, col: 0 }, idealKeys: "/needle<CR>" },
      { kind: "reach", teach: "*", why: "Find every usage of the word under your cursor — instant symbol search, no typing.", instruction: "Jump to the next 'cat' with *.", buffer: ["cat dog cat bird"], cursor: { row: 0, col: 0 }, idealKeys: "*" },
      { kind: "text", teach: "v d", why: "When no single motion fits, select exactly what you mean first, then operate on it.", instruction: "Select 'abc' (v l l) then delete with d.", buffer: ["abcdef"], cursor: { row: 0, col: 0 }, idealKeys: "vlld", target: ["def"] },
    ],
  },
  {
    id: "tut-mastery",
    title: "Chapter 4 · Mastery",
    skill: "substitute, macros, block",
    hint: "The power tools: :s, macros, and visual block.",
    lessons: [
      { kind: "text", teach: ":s//g", why: "Fix every occurrence on the line in one command instead of hunting each one.", instruction: "Replace every 'foo' with 'bar' on the line: :s/foo/bar/g then Enter.", buffer: ["foo foo foo"], cursor: { row: 0, col: 0 }, idealKeys: ":s/foo/bar/g<CR>", target: ["bar bar bar"] },
      { kind: "text", teach: ":%s", why: "File-wide find & replace — the classic rename-the-variable-everywhere refactor.", instruction: "Substitute across ALL lines: :%s/x/y/g then Enter.", buffer: ["x = 1", "x = 2"], cursor: { row: 0, col: 0 }, idealKeys: ":%s/x/y/g<CR>", target: ["y = 1", "y = 2"] },
      { kind: "text", teach: "^V I", why: "Edit many lines at once: comment out a whole block by inserting '# ' down a column.", instruction: "Comment out all 3 lines: Ctrl-V, jj, I, type '# ', Esc.", buffer: ["line1", "line2", "line3"], cursor: { row: 0, col: 0 }, idealKeys: "<C-v>jjI# <Esc>", target: ["# line1", "# line2", "# line3"] },
      { kind: "text", teach: "^V A", why: "Append down a column — add trailing commas to a list or ; to statement lines.", instruction: "Append ; to all 3 lines: Ctrl-V, jj, A, type ';', Esc.", buffer: ["a", "b", "c"], cursor: { row: 0, col: 0 }, idealKeys: "<C-v>jjA;<Esc>", target: ["a;", "b;", "c;"] },
      { kind: "text", teach: "^V d", why: "Delete a rectangle: strip leading markers, a column of indent, or aligned junk.", instruction: "Delete the leading X column: Ctrl-V, jj, d.", buffer: ["Xa", "Xb", "Xc"], cursor: { row: 0, col: 0 }, idealKeys: "<C-v>jjd", target: ["a", "b", "c"] },
      { kind: "text", teach: "q @", why: "Automation without plugins: record a fix once, replay it on every line that needs it.", instruction: "Record a macro (qa A. Esc j q) then replay it twice (2@a).", buffer: ["1", "2", "3"], cursor: { row: 0, col: 0 }, idealKeys: "qaA.<Esc>jq2@a", target: ["1.", "2.", "3."] },
      { kind: "reach", teach: "m `", why: "Bookmark where you are, go dig somewhere else, then snap straight back with `a.", instruction: "Set a mark (ma), roam (0), then fly back with `a.", buffer: ["one two three"], cursor: { row: 0, col: 0 }, idealKeys: "wwma0`a" },
    ],
  },
];

export function getChapter(id: string): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS.find((c) => c.id === id);
}
