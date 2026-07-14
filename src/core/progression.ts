// Level unlock gating. The first level of each mode is always open; clearing a
// level (>=1 star) unlocks the next one in that mode's list.

import { Storage } from "./storage.ts";

export function isLevelUnlocked(ids: string[], index: number): boolean {
  if (index <= 0) return true;
  const id = ids[index];
  return id ? Storage.isUnlocked(id) : false;
}

export function unlockNext(ids: string[], currentId: string): void {
  const i = ids.indexOf(currentId);
  if (i >= 0 && i + 1 < ids.length) Storage.unlock(ids[i + 1]!);
}
