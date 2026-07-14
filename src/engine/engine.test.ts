import { describe, expect, it } from "vitest";
import { VimEngine } from "./engine.ts";
import type { Pos } from "./types.ts";

/** Build an engine, position the cursor, then feed a key string. Returns text + cursor. */
function run(text: string | string[], cursor: Pos, keys: string) {
  const e = new VimEngine();
  e.load(text, cursor);
  e.feedKeys(keys);
  return { text: e.getText(), cursor: e.cursor, mode: e.mode, e };
}

describe("basic motions (movement)", () => {
  const line = "the quick brown fox";
  it("hjkl move by one cell", () => {
    expect(run(line, { row: 0, col: 0 }, "l").cursor).toEqual({ row: 0, col: 1 });
    expect(run(line, { row: 0, col: 5 }, "h").cursor).toEqual({ row: 0, col: 4 });
  });
  it("counts multiply movement", () => {
    expect(run(line, { row: 0, col: 0 }, "3l").cursor).toEqual({ row: 0, col: 3 });
  });
  it("j/k keep desired column", () => {
    const two = "longer line here\nab";
    const r = run(two, { row: 0, col: 10 }, "jk");
    expect(r.cursor).toEqual({ row: 0, col: 10 });
  });
  it("0 ^ $ line motions", () => {
    expect(run("   hi there", { row: 0, col: 8 }, "0").cursor.col).toBe(0);
    expect(run("   hi there", { row: 0, col: 8 }, "^").cursor.col).toBe(3);
    expect(run(line, { row: 0, col: 0 }, "$").cursor.col).toBe(line.length - 1);
  });
  it("word motions w b e", () => {
    expect(run(line, { row: 0, col: 0 }, "w").cursor.col).toBe(4);
    expect(run(line, { row: 0, col: 0 }, "e").cursor.col).toBe(2);
    expect(run(line, { row: 0, col: 6 }, "b").cursor.col).toBe(4);
    expect(run(line, { row: 0, col: 0 }, "2w").cursor.col).toBe(10);
  });
  it("W treats punctuation as part of the WORD", () => {
    expect(run("foo.bar baz", { row: 0, col: 0 }, "w").cursor.col).toBe(3); // stops at '.'
    expect(run("foo.bar baz", { row: 0, col: 0 }, "W").cursor.col).toBe(8); // skips to 'baz'
  });
  it("gg and G", () => {
    const buf = "one\ntwo\nthree";
    expect(run(buf, { row: 2, col: 0 }, "gg").cursor.row).toBe(0);
    expect(run(buf, { row: 0, col: 0 }, "G").cursor.row).toBe(2);
    expect(run(buf, { row: 0, col: 0 }, "2G").cursor.row).toBe(1);
  });
  it("f/t and ; ,", () => {
    expect(run(line, { row: 0, col: 0 }, "fo").cursor.col).toBe(12);
    expect(run(line, { row: 0, col: 0 }, "to").cursor.col).toBe(11);
    expect(run("a.b.c.d", { row: 0, col: 0 }, "f.;").cursor.col).toBe(3);
    expect(run("a.b.c.d", { row: 0, col: 0 }, "f.f.,").cursor.col).toBe(1);
  });
});

describe("delete / change operators", () => {
  it("dw deletes a word", () => {
    expect(run("the quick brown", { row: 0, col: 0 }, "dw").text).toBe("quick brown");
  });
  it("dw on last word of line keeps no trailing char", () => {
    expect(run("abc", { row: 0, col: 0 }, "dw").text).toBe("");
    expect(run("hello world", { row: 0, col: 6 }, "dw").text).toBe("hello ");
  });
  it("dd deletes the line", () => {
    expect(run("a\nb\nc", { row: 1, col: 0 }, "dd").text).toBe("a\nc");
  });
  it("2dd deletes two lines", () => {
    expect(run("a\nb\nc\nd", { row: 0, col: 0 }, "2dd").text).toBe("c\nd");
  });
  it("d$ and D delete to end of line", () => {
    expect(run("hello world", { row: 0, col: 5 }, "d$").text).toBe("hello");
    expect(run("hello world", { row: 0, col: 5 }, "D").text).toBe("hello");
  });
  it("d2w and 2d3w multiply counts", () => {
    expect(run("a b c d e", { row: 0, col: 0 }, "d2w").text).toBe("c d e");
    expect(run("a b c d e f g", { row: 0, col: 0 }, "2d3w").text).toBe("g");
  });
  it("x deletes chars, X deletes before", () => {
    expect(run("abc", { row: 0, col: 0 }, "x").text).toBe("bc");
    expect(run("abc", { row: 0, col: 0 }, "3x").text).toBe("");
    expect(run("abc", { row: 0, col: 2 }, "X").text).toBe("ac");
  });
  it("cw changes to end of word and enters insert", () => {
    const r = run("hello world", { row: 0, col: 0 }, "cwbye");
    expect(r.text).toBe("bye world");
    expect(r.mode).toBe("insert");
  });
  it("dfx is inclusive, dtx stops before", () => {
    expect(run("abcXdef", { row: 0, col: 0 }, "dfX").text).toBe("def");
    expect(run("abcXdef", { row: 0, col: 0 }, "dtX").text).toBe("Xdef");
  });
});

describe("text objects", () => {
  it("diw / daw", () => {
    expect(run("foo bar baz", { row: 0, col: 4 }, "diw").text).toBe("foo  baz");
    expect(run("foo bar baz", { row: 0, col: 4 }, "daw").text).toBe("foo baz");
  });
  it('di" and da"', () => {
    expect(run('say "hi" now', { row: 0, col: 6 }, 'di"').text).toBe('say "" now');
    expect(run('say "hi" now', { row: 0, col: 6 }, 'da"').text).toBe("say  now");
  });
  it("di( and da( with nesting", () => {
    expect(run("foo(bar)baz", { row: 0, col: 5 }, "di(").text).toBe("foo()baz");
    expect(run("foo(bar)baz", { row: 0, col: 5 }, "da(").text).toBe("foobaz");
    expect(run("a(b(c)d)e", { row: 0, col: 4 }, "di(").text).toBe("a(b()d)e");
  });
  it("ci{ across lines (linewise inner, like Vim)", () => {
    expect(run("fn {\n  body\n}", { row: 1, col: 2 }, "di{").text).toBe("fn {\n}");
    const r = run("fn {\n  body\n}", { row: 1, col: 2 }, "ci{x<Esc>");
    expect(r.text).toBe("fn {\nx\n}");
  });
  it("dip deletes inner paragraph", () => {
    expect(run("a\nb\n\nc", { row: 0, col: 0 }, "dip").text).toBe("\nc");
  });
});

describe("yank and paste", () => {
  it("yy then p pastes line below", () => {
    const r = run("one\ntwo", { row: 0, col: 0 }, "yyp");
    expect(r.text).toBe("one\none\ntwo");
    expect(r.cursor.row).toBe(1);
  });
  it("yw then p pastes after cursor charwise", () => {
    const r = run("abc def", { row: 0, col: 0 }, "yw$p");
    // yank "abc " then paste after last char
    expect(r.text).toBe("abc defabc ");
  });
  it("dd then p moves a line down", () => {
    expect(run("a\nb\nc", { row: 0, col: 0 }, "ddp").text).toBe("b\na\nc");
  });
  it("P pastes before", () => {
    expect(run("abc", { row: 0, col: 0 }, "ylP").text).toBe("aabc");
  });
});

describe("insert mode entries", () => {
  it("i inserts at cursor", () => {
    expect(run("bc", { row: 0, col: 0 }, "iaX<Esc>").text).toBe("aXbc");
  });
  it("a appends after cursor", () => {
    expect(run("ac", { row: 0, col: 0 }, "ab<Esc>").text).toBe("abc");
  });
  it("A appends at line end", () => {
    expect(run("ab", { row: 0, col: 0 }, "Ac<Esc>").text).toBe("abc");
  });
  it("I inserts at first non-blank", () => {
    expect(run("  bc", { row: 0, col: 3 }, "Ia<Esc>").text).toBe("  abc");
  });
  it("o and O open lines", () => {
    expect(run("a\nb", { row: 0, col: 0 }, "ox<Esc>").text).toBe("a\nx\nb");
    expect(run("a\nb", { row: 1, col: 0 }, "Ox<Esc>").text).toBe("a\nx\nb");
  });
  it("<Esc> moves cursor left", () => {
    const r = run("", { row: 0, col: 0 }, "iabc<Esc>");
    expect(r.text).toBe("abc");
    expect(r.cursor.col).toBe(2);
  });
  it("newline in insert splits the line", () => {
    expect(run("ab", { row: 0, col: 1 }, "i<CR><Esc>").text).toBe("a\nb");
  });
  it("backspace joins lines", () => {
    expect(run("a\nb", { row: 1, col: 0 }, "i<BS><Esc>").text).toBe("ab");
  });
});

describe("undo / redo", () => {
  it("u undoes and <C-r> redoes", () => {
    const e = new VimEngine();
    e.load("abc", { row: 0, col: 0 });
    e.feedKeys("x");
    expect(e.getText()).toBe("bc");
    e.feedKeys("u");
    expect(e.getText()).toBe("abc");
    e.feedKeys("<C-r>");
    expect(e.getText()).toBe("bc");
  });
  it("undo restores multi-step edits", () => {
    const e = new VimEngine();
    e.load("hello", { row: 0, col: 0 });
    e.feedKeys("cwbye<Esc>");
    expect(e.getText()).toBe("bye");
    e.feedKeys("u");
    expect(e.getText()).toBe("hello");
  });
});

describe("dot repeat", () => {
  it(". repeats x", () => {
    expect(run("abcdef", { row: 0, col: 0 }, "x..").text).toBe("def");
  });
  it(". repeats a change on another word", () => {
    const r = run("aaa bbb ccc", { row: 0, col: 0 }, "ciwZZ<Esc>w.");
    expect(r.text).toBe("ZZ ZZ ccc");
  });
  it(". repeats dd", () => {
    expect(run("a\nb\nc\nd", { row: 0, col: 0 }, "dd.").text).toBe("c\nd");
  });
});

describe("visual mode", () => {
  it("v selects and d deletes charwise", () => {
    expect(run("abcdef", { row: 0, col: 0 }, "vlld").text).toBe("def");
  });
  it("V selects and d deletes linewise", () => {
    expect(run("a\nb\nc", { row: 1, col: 0 }, "Vd").text).toBe("a\nc");
  });
  it("visual y yanks the selection", () => {
    const r = run("abcdef", { row: 0, col: 0 }, "vll y$p");
    expect(r.text.startsWith("abcdef")).toBe(true);
  });
  it("visual text object selection: viw d", () => {
    expect(run("foo bar", { row: 0, col: 5 }, "viwd").text).toBe("foo ");
  });
});

describe("replace, join, tilde", () => {
  it("r replaces one char", () => {
    expect(run("cat", { row: 0, col: 0 }, "rb").text).toBe("bat");
  });
  it("3r replaces a run", () => {
    expect(run("aaaa", { row: 0, col: 0 }, "3rx").text).toBe("xxxa");
  });
  it("J joins lines with a space", () => {
    expect(run("foo\nbar", { row: 0, col: 0 }, "J").text).toBe("foo bar");
  });
  it("~ toggles case", () => {
    expect(run("abc", { row: 0, col: 0 }, "~").text).toBe("Abc");
  });
});

describe("search and match-pair", () => {
  const doc = "alpha beta\ngamma alpha\ndelta";
  it("/pattern jumps forward and wraps", () => {
    expect(run(doc, { row: 0, col: 0 }, "/gamma<CR>").cursor).toEqual({ row: 1, col: 0 });
    expect(run(doc, { row: 0, col: 0 }, "/alpha<CR>").cursor).toEqual({ row: 1, col: 6 });
  });
  it("?pattern searches backward", () => {
    expect(run(doc, { row: 2, col: 0 }, "?beta<CR>").cursor).toEqual({ row: 0, col: 6 });
  });
  it("n and N repeat and reverse", () => {
    const e = new VimEngine();
    e.load(doc, { row: 0, col: 0 });
    e.feedKeys("/alpha<CR>"); // -> row1 col6
    expect(e.cursor).toEqual({ row: 1, col: 6 });
    e.feedKeys("n"); // wraps back to row0 col0
    expect(e.cursor).toEqual({ row: 0, col: 0 });
    e.feedKeys("N"); // reverse -> row1 col6
    expect(e.cursor).toEqual({ row: 1, col: 6 });
  });
  it("* searches the word under the cursor", () => {
    expect(run(doc, { row: 0, col: 0 }, "*").cursor).toEqual({ row: 1, col: 6 });
  });
  it("<Esc> cancels the search line without moving", () => {
    expect(run(doc, { row: 0, col: 0 }, "/gamma<Esc>").cursor).toEqual({ row: 0, col: 0 });
  });
  it("% jumps between matching brackets", () => {
    expect(run("foo(bar)baz", { row: 0, col: 3 }, "%").cursor).toEqual({ row: 0, col: 7 });
    expect(run("foo(bar)baz", { row: 0, col: 7 }, "%").cursor).toEqual({ row: 0, col: 3 });
  });
  it("d% deletes through the matching bracket", () => {
    expect(run("a(bcd)e", { row: 0, col: 1 }, "d%").text).toBe("ae");
  });
  it("search on a missing pattern rings the bell and stays put", () => {
    const e = new VimEngine();
    e.load(doc, { row: 0, col: 0 });
    const ev = e.feedKeys("/zzz<CR>");
    expect(ev.some((x) => x.type === "bell")).toBe(true);
    expect(e.cursor).toEqual({ row: 0, col: 0 });
  });
});

describe("macros", () => {
  it("records with q{reg}..q and replays with @{reg}", () => {
    // On each line: capitalize-ish by appending ! at end, then go to next line.
    const e = new VimEngine();
    e.load("a\nb\nc", { row: 0, col: 0 });
    e.feedKeys("qzA!<Esc>jq"); // record into z: append !, down a line
    expect(e.getText()).toBe("a!\nb\nc");
    e.feedKeys("@z");
    expect(e.getText()).toBe("a!\nb!\nc");
  });
  it("replays with a count and @@ repeats the last macro", () => {
    const e = new VimEngine();
    e.load("1\n2\n3\n4", { row: 0, col: 0 });
    e.feedKeys("qaA.<Esc>jq"); // line 1 done
    expect(e.getText()).toBe("1.\n2\n3\n4");
    e.feedKeys("2@a"); // lines 2 and 3
    expect(e.getText()).toBe("1.\n2.\n3.\n4");
    e.feedKeys("@@"); // line 4
    expect(e.getText()).toBe("1.\n2.\n3.\n4.");
  });
});

describe("marks", () => {
  it("m sets a mark and ` jumps back to it", () => {
    const e = new VimEngine();
    e.load("alpha\nbeta\ngamma", { row: 0, col: 2 });
    e.feedKeys("ma"); // mark a at (0,2)
    e.feedKeys("G$"); // move away
    e.feedKeys("`a");
    expect(e.cursor).toEqual({ row: 0, col: 2 });
  });
  it("'mark jumps to the first non-blank of the mark's line", () => {
    const e = new VimEngine();
    e.load("  indented\nplain", { row: 0, col: 8 });
    e.feedKeys("mbGo x<Esc>"); // set mark b, then move/edit elsewhere
    e.feedKeys("'b");
    expect(e.cursor).toEqual({ row: 0, col: 2 });
  });
  it("d`mark deletes to the mark", () => {
    const e = new VimEngine();
    e.load("abcdef", { row: 0, col: 0 });
    e.feedKeys("ma"); // mark at 0
    e.feedKeys("3l"); // -> col 3
    e.feedKeys("d`a"); // delete from col3 back to mark (exclusive)
    expect(e.getText()).toBe("def");
  });
});

describe("visual block (Ctrl-V)", () => {
  const grid = ["abcd", "efgh", "ijkl"];
  it("block delete removes a rectangle from each row", () => {
    // Ctrl-V, down twice, right once -> 2-wide x 3-tall block at cols 0-1.
    expect(run(grid, { row: 0, col: 0 }, "<C-v>jjld").text).toBe("cd\ngh\nkl");
  });
  it("block I inserts the same text at the left of every row", () => {
    expect(run(grid, { row: 0, col: 0 }, "<C-v>jjI# <Esc>").text).toBe("# abcd\n# efgh\n# ijkl");
  });
  it("block A appends text after the block on every row", () => {
    expect(run(grid, { row: 0, col: 0 }, "<C-v>jjlA!<Esc>").text).toBe("ab!cd\nef!gh\nij!kl");
  });
  it("block c changes the rectangle across rows", () => {
    expect(run(grid, { row: 0, col: 0 }, "<C-v>jjlcXY<Esc>").text).toBe("XYcd\nXYgh\nXYkl");
  });
});

describe("substitute (:s)", () => {
  it(":s/a/b/ replaces the first match on the current line", () => {
    expect(run("foo foo foo", { row: 0, col: 0 }, ":s/foo/bar/<CR>").text).toBe("bar foo foo");
  });
  it(":s/a/b/g replaces all on the line", () => {
    expect(run("foo foo foo", { row: 0, col: 0 }, ":s/foo/bar/g<CR>").text).toBe("bar bar bar");
  });
  it(":%s/a/b/g replaces across all lines", () => {
    expect(run("x x\ny x", { row: 0, col: 0 }, ":%s/x/z/g<CR>").text).toBe("z z\ny z");
  });
  it("range :1,2s/a/b/g targets specific lines", () => {
    expect(run("a\na\na", { row: 0, col: 0 }, ":1,2s/a/Z/<CR>").text).toBe("Z\nZ\na");
  });
  it(":s with a missing pattern rings the bell", () => {
    const e = new VimEngine();
    e.load("hello", { row: 0, col: 0 });
    const ev = e.feedKeys(":s/zzz/x/<CR>");
    expect(ev.some((x) => x.type === "bell")).toBe(true);
    expect(e.getText()).toBe("hello");
  });
  it("substitute is undoable in one step", () => {
    const e = new VimEngine();
    e.load("a a a", { row: 0, col: 0 });
    e.feedKeys(":s/a/b/g<CR>");
    expect(e.getText()).toBe("b b b");
    e.feedKeys("u");
    expect(e.getText()).toBe("a a a");
  });
  it(":42 jumps to a line", () => {
    expect(run("1\n2\n3\n4\n5", { row: 0, col: 0 }, ":3<CR>").cursor.row).toBe(2);
  });
});

describe("engine events", () => {
  it("emits move events on motion", () => {
    const e = new VimEngine();
    e.load("abcdef", { row: 0, col: 0 });
    const ev = e.feedKey("l");
    expect(ev.some((x) => x.type === "move")).toBe(true);
  });
  it("emits a mode event entering insert", () => {
    const e = new VimEngine();
    e.load("abc", { row: 0, col: 0 });
    const ev = e.feedKey("i");
    expect(ev.some((x) => x.type === "mode")).toBe(true);
  });
  it("emits bell on invalid command", () => {
    const e = new VimEngine();
    e.load("abc", { row: 0, col: 0 });
    const ev = e.feedKey("z");
    expect(ev.some((x) => x.type === "bell")).toBe(true);
  });
});
