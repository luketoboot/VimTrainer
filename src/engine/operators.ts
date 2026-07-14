// Turns a resolved motion or text object into a concrete range an operator cuts.
// Charwise ranges use an inclusive start and EXCLUSIVE end (matches TextBuffer.deleteRange).

import { cmpPos } from "./buffer.ts";
import type { MotionResult, Pos, TextObjectRange, Wise } from "./types.ts";

export interface OpRange {
  wise: Wise;
  // charwise:
  start: Pos; // inclusive
  end: Pos; // exclusive
  // linewise:
  startRow: number;
  endRow: number;
}

export function motionToRange(from: Pos, m: MotionResult): OpRange {
  if (m.wise === "linewise") {
    const startRow = Math.min(from.row, m.pos.row);
    const endRow = Math.max(from.row, m.pos.row);
    return {
      wise: "linewise",
      startRow,
      endRow,
      start: { row: startRow, col: 0 },
      end: { row: endRow, col: 0 },
    };
  }
  let lo = from;
  let hi = m.pos;
  if (cmpPos(lo, hi) > 0) [lo, hi] = [hi, lo];
  // Inclusive motions include the char the cursor lands on -> push exclusive end one past it.
  const end: Pos = m.inclusive ? { row: hi.row, col: hi.col + 1 } : { row: hi.row, col: hi.col };
  return {
    wise: "charwise",
    start: { row: lo.row, col: lo.col },
    end,
    startRow: lo.row,
    endRow: hi.row,
  };
}

export function textObjectToRange(o: TextObjectRange): OpRange {
  if (o.wise === "linewise") {
    return {
      wise: "linewise",
      startRow: o.start.row,
      endRow: o.end.row,
      start: o.start,
      end: o.end,
    };
  }
  return {
    wise: "charwise",
    start: o.start,
    end: { row: o.end.row, col: o.end.col + 1 }, // text objects have inclusive end
    startRow: o.start.row,
    endRow: o.end.row,
  };
}
