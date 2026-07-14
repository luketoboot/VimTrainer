// Guided tutorial content. Each lesson teaches ONE key/idea and carries the
// canonical `idealKeys` that solve it. Reach-lessons derive their target cell by
// running idealKeys on a scratch engine, so the highlight can never disagree with
// what the key actually does. A unit test replays idealKeys to prove every lesson
// is solvable.

export interface BaseLesson {
  instruction: string;
  teach: string; // key(s) shown as a badge
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
      { kind: "reach", teach: "l", instruction: "Move RIGHT. Press l to reach the marker.", buffer: [TRACK], cursor: { row: 0, col: 0 }, idealKeys: "llll" },
      { kind: "reach", teach: "h", instruction: "Move LEFT with h.", buffer: [TRACK], cursor: { row: 0, col: 8 }, idealKeys: "hhhh" },
      { kind: "reach", teach: "j", instruction: "Move DOWN with j.", buffer: [TRACK, TRACK, TRACK, TRACK], cursor: { row: 0, col: 6 }, idealKeys: "jjj" },
      { kind: "reach", teach: "k", instruction: "Move UP with k.", buffer: [TRACK, TRACK, TRACK, TRACK], cursor: { row: 3, col: 6 }, idealKeys: "kkk" },
      { kind: "reach", teach: "w", instruction: "Leap by WORD with w.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "ww" },
      { kind: "reach", teach: "b", instruction: "Go BACK a word with b.", buffer: [PROSE], cursor: { row: 0, col: 20 }, idealKeys: "bb" },
      { kind: "reach", teach: "e", instruction: "Jump to the END of the word with e.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "e" },
      { kind: "reach", teach: "$", instruction: "Jump to the END of the line with $.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "$" },
      { kind: "reach", teach: "0", instruction: "Jump to the START of the line with 0.", buffer: [PROSE], cursor: { row: 0, col: 20 }, idealKeys: "0" },
      { kind: "reach", teach: "G", instruction: "Jump to the LAST line with G.", buffer: [PROSE, "second line", "the last line"], cursor: { row: 0, col: 0 }, idealKeys: "G" },
      { kind: "reach", teach: "gg", instruction: "Jump to the FIRST line with gg.", buffer: [PROSE, "second line", "the last line"], cursor: { row: 2, col: 3 }, idealKeys: "gg" },
      { kind: "reach", teach: "f", instruction: "Find a char: press f then q to land on 'q'.", buffer: [PROSE], cursor: { row: 0, col: 0 }, idealKeys: "fq" },
    ],
  },
  {
    id: "tut-editing",
    title: "Chapter 2 · Editing",
    skill: "delete, change, insert",
    hint: "Operators + insert mode — the real power of Vim.",
    lessons: [
      { kind: "text", teach: "x", instruction: "Delete the extra 'l' with x.", buffer: ["helllo"], cursor: { row: 0, col: 2 }, idealKeys: "x", target: ["hello"] },
      { kind: "text", teach: "dw", instruction: "Delete the word 'bad ' with dw.", buffer: ["keep bad keep"], cursor: { row: 0, col: 5 }, idealKeys: "dw", target: ["keep keep"] },
      { kind: "text", teach: "dd", instruction: "Delete the whole middle line with dd.", buffer: ["line one", "DELETE ME", "line two"], cursor: { row: 1, col: 0 }, idealKeys: "dd", target: ["line one", "line two"] },
      { kind: "text", teach: "i", instruction: "Insert the missing 'l': press i, type l, then Esc.", buffer: ["helo"], cursor: { row: 0, col: 3 }, idealKeys: "il<Esc>", target: ["hello"] },
      { kind: "text", teach: "A", instruction: "Append a semicolon: A then ; then Esc.", buffer: ["let x = 1"], cursor: { row: 0, col: 0 }, idealKeys: "A;<Esc>", target: ["let x = 1;"] },
      { kind: "text", teach: "o", instruction: "Open a line below: o, type second, Esc.", buffer: ["first", "third"], cursor: { row: 0, col: 0 }, idealKeys: "osecond<Esc>", target: ["first", "second", "third"] },
      { kind: "text", teach: "ciw", instruction: "Change the word 'foo' to bar: ciw then bar.", buffer: ["let foo = 1"], cursor: { row: 0, col: 4 }, idealKeys: "ciwbar<Esc>", target: ["let bar = 1"] },
      { kind: "text", teach: "yy p", instruction: "Duplicate the line: yy then p.", buffer: ["copy me"], cursor: { row: 0, col: 0 }, idealKeys: "yyp", target: ["copy me", "copy me"] },
    ],
  },
  {
    id: "tut-advanced",
    title: "Chapter 3 · Power",
    skill: "find, search, match, visual",
    hint: "The moves that make you fast.",
    lessons: [
      { kind: "reach", teach: "t", instruction: "Stop just BEFORE the 'o': t then o.", buffer: ["hello world"], cursor: { row: 0, col: 0 }, idealKeys: "to" },
      { kind: "reach", teach: "%", instruction: "Jump to the matching ) with %.", buffer: ["sum = (a + b)"], cursor: { row: 0, col: 6 }, idealKeys: "%" },
      { kind: "text", teach: "di(", instruction: "Delete inside the parens with di(.", buffer: ["call(1, 2)"], cursor: { row: 0, col: 5 }, idealKeys: "di(", target: ["call()"] },
      { kind: "reach", teach: "/", instruction: "Search: type /needle then Enter.", buffer: ["find the needle here"], cursor: { row: 0, col: 0 }, idealKeys: "/needle<CR>" },
      { kind: "reach", teach: "*", instruction: "Jump to the next 'cat' with *.", buffer: ["cat dog cat bird"], cursor: { row: 0, col: 0 }, idealKeys: "*" },
      { kind: "text", teach: "v d", instruction: "Select 'abc' (v l l) then delete with d.", buffer: ["abcdef"], cursor: { row: 0, col: 0 }, idealKeys: "vlld", target: ["def"] },
    ],
  },
  {
    id: "tut-mastery",
    title: "Chapter 4 · Mastery",
    skill: "substitute, macros, block",
    hint: "The power tools: :s, macros, and visual block.",
    lessons: [
      { kind: "text", teach: ":s//g", instruction: "Replace every 'foo' with 'bar' on the line: :s/foo/bar/g then Enter.", buffer: ["foo foo foo"], cursor: { row: 0, col: 0 }, idealKeys: ":s/foo/bar/g<CR>", target: ["bar bar bar"] },
      { kind: "text", teach: ":%s", instruction: "Substitute across ALL lines: :%s/x/y/g then Enter.", buffer: ["x = 1", "x = 2"], cursor: { row: 0, col: 0 }, idealKeys: ":%s/x/y/g<CR>", target: ["y = 1", "y = 2"] },
      { kind: "text", teach: "^V I", instruction: "Comment out all 3 lines: Ctrl-V, jj, I, type '# ', Esc.", buffer: ["line1", "line2", "line3"], cursor: { row: 0, col: 0 }, idealKeys: "<C-v>jjI# <Esc>", target: ["# line1", "# line2", "# line3"] },
      { kind: "text", teach: "^V A", instruction: "Append ; to all 3 lines: Ctrl-V, jj, A, type ';', Esc.", buffer: ["a", "b", "c"], cursor: { row: 0, col: 0 }, idealKeys: "<C-v>jjA;<Esc>", target: ["a;", "b;", "c;"] },
      { kind: "text", teach: "^V d", instruction: "Delete the leading X column: Ctrl-V, jj, d.", buffer: ["Xa", "Xb", "Xc"], cursor: { row: 0, col: 0 }, idealKeys: "<C-v>jjd", target: ["a", "b", "c"] },
      { kind: "text", teach: "q @", instruction: "Record a macro (qa A. Esc j q) then replay it twice (2@a).", buffer: ["1", "2", "3"], cursor: { row: 0, col: 0 }, idealKeys: "qaA.<Esc>jq2@a", target: ["1.", "2.", "3."] },
      { kind: "reach", teach: "m `", instruction: "Set a mark (ma), roam (0), then fly back with `a.", buffer: ["one two three"], cursor: { row: 0, col: 0 }, idealKeys: "wwma0`a" },
    ],
  },
];

export function getChapter(id: string): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS.find((c) => c.id === id);
}
