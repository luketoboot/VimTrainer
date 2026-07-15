// Text layout helpers shared by screens that draw prose onto the grid.

/** Greedy word-wrap capped at maxLines (last line ellipsized if truncated). */
export function wrapText(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length + 1 > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1]!.slice(0, width - 1) + "…";
  }
  return lines;
}
