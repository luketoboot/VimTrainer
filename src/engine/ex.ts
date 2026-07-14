// Minimal Ex command parser — enough to teach :substitute and :{line}.
// Substitution is LITERAL (patterns are matched as plain text, not regex) so the
// behaviour is predictable in a trainer and golf pars stay deterministic.

export type ExCommand =
  | { type: "substitute"; startRow: number; endRow: number; pat: string; rep: string; global: boolean; ignoreCase: boolean }
  | { type: "goto"; row: number }
  | { type: "noop" } // :w :q :wq :x etc. — accepted, do nothing
  | { type: "error" };

export interface ExContext {
  cursorRow: number;
  lineCount: number;
}

export function parseEx(input: string, ctx: ExContext): ExCommand {
  let s = input.trim();
  if (s === "") return { type: "noop" };

  // Range prefix.
  const range = parseRange(s, ctx);
  s = range.rest;
  let { start, end } = range;

  // Bare address -> jump to line (e.g. :42, :$).
  if (s === "") {
    if (range.had) return { type: "goto", row: clamp(end, 0, ctx.lineCount - 1) };
    return { type: "noop" };
  }

  // Write / quit family: accept and ignore.
  if (/^(w|q|wq|x|write|quit)\b/.test(s)) return { type: "noop" };

  // Substitute: s/pat/rep/flags  (delimiter is the char right after s).
  if (s[0] === "s") {
    const delim = s[1];
    if (!delim || /[a-zA-Z0-9\\]/.test(delim)) return { type: "error" };
    const parts = splitDelim(s.slice(2), delim);
    if (parts.length < 2) return { type: "error" };
    const [pat, rep, flags = ""] = parts;
    if (!range.had) {
      start = ctx.cursorRow;
      end = ctx.cursorRow;
    }
    return {
      type: "substitute",
      startRow: clamp(start, 0, ctx.lineCount - 1),
      endRow: clamp(end, 0, ctx.lineCount - 1),
      pat: pat ?? "",
      rep: rep ?? "",
      global: flags.includes("g"),
      ignoreCase: flags.includes("i"),
    };
  }

  return { type: "error" };
}

interface Range {
  rest: string;
  start: number;
  end: number;
  had: boolean;
}

function parseRange(s: string, ctx: ExContext): Range {
  if (s[0] === "%") return { rest: s.slice(1), start: 0, end: ctx.lineCount - 1, had: true };
  const a1 = parseAddr(s, ctx);
  if (!a1) return { rest: s, start: ctx.cursorRow, end: ctx.cursorRow, had: false };
  let rest = a1.rest;
  let start = a1.row;
  let end = a1.row;
  if (rest[0] === ",") {
    const a2 = parseAddr(rest.slice(1), ctx);
    if (a2) {
      end = a2.row;
      rest = a2.rest;
    } else {
      rest = rest.slice(1);
    }
  }
  return { rest, start, end, had: true };
}

function parseAddr(s: string, ctx: ExContext): { row: number; rest: string } | null {
  if (s[0] === ".") return { row: ctx.cursorRow, rest: s.slice(1) };
  if (s[0] === "$") return { row: ctx.lineCount - 1, rest: s.slice(1) };
  const m = /^(\d+)/.exec(s);
  if (m) return { row: parseInt(m[1]!, 10) - 1, rest: s.slice(m[1]!.length) };
  return null;
}

/** Split "a/b/c" on an unescaped delimiter into up to 3 parts. */
function splitDelim(s: string, delim: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === delim) {
      cur += delim;
      i++;
    } else if (s[i] === delim) {
      parts.push(cur);
      cur = "";
    } else {
      cur += s[i];
    }
  }
  parts.push(cur);
  return parts;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Literal replace on a single line. Returns [newLine, count]. */
export function substituteLine(line: string, pat: string, rep: string, global: boolean, ignoreCase: boolean): [string, number] {
  if (pat === "") return [line, 0];
  const hay = ignoreCase ? line.toLowerCase() : line;
  const needle = ignoreCase ? pat.toLowerCase() : pat;
  let out = "";
  let i = 0;
  let count = 0;
  for (;;) {
    const idx = hay.indexOf(needle, i);
    if (idx < 0 || (count >= 1 && !global)) {
      out += line.slice(i);
      break;
    }
    out += line.slice(i, idx) + rep;
    i = idx + pat.length;
    count++;
    if (!global) {
      out += line.slice(i);
      break;
    }
  }
  return [out, count];
}
