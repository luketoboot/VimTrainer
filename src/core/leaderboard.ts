// Online leaderboards backed by Cloud Firestore's REST API — no SDK needed.
// The web API key is public by design; Firestore security rules are the actual
// enforcement layer: reads are open, writes are strictly-validated appends
// ({initials: /^[A-Z0-9]{3}$/, score: 0..1e6}), edits/deletes impossible.

export interface BoardEntry {
  initials: string;
  score: number;
}

const PROJECT_ID = "vimtrainer-arcade";
const API_KEY = "AIzaSyAk44vm4I3rtROga5wteMFas1SfwxmLYbY";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const FETCH_TIMEOUT_MS = 6000;

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  return { signal: ctl.signal, done: () => clearTimeout(t) };
}

/** Append a score to a level's board. Resolves false on any failure. */
export async function submitScore(levelId: string, initials: string, score: number): Promise<boolean> {
  const t = withTimeout();
  try {
    const res = await fetch(`${BASE}/boards/${encodeURIComponent(levelId)}/scores?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: t.signal,
      body: JSON.stringify({
        fields: {
          initials: { stringValue: initials },
          score: { integerValue: String(Math.floor(score)) },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.done();
  }
}

/** Top scores for a level, best first. Resolves null when unreachable. */
export async function fetchTop(levelId: string, limit = 10): Promise<BoardEntry[] | null> {
  const t = withTimeout();
  try {
    const res = await fetch(`${BASE}/boards/${encodeURIComponent(levelId)}:runQuery?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: t.signal,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "scores" }],
          orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }],
          limit,
        },
      }),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      document?: { fields?: { initials?: { stringValue?: string }; score?: { integerValue?: string } } };
    }>;
    return rows
      .filter((r) => r.document?.fields)
      .map((r) => ({
        initials: r.document!.fields!.initials?.stringValue ?? "???",
        score: Number(r.document!.fields!.score?.integerValue ?? 0),
      }));
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/** Normalize typed input into board initials: A-Z and 0-9 only, uppercased. */
export function initialsChar(token: string): string | null {
  if (/^[a-zA-Z0-9]$/.test(token)) return token.toUpperCase();
  return null;
}
