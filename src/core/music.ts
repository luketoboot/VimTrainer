// Background music player. Looks for optional MP3s under public/music/ and
// loops them per screen (menu vs gameplay). Fails completely silent when the
// files aren't there, so the game works with or without a soundtrack.
//
//   public/music/menu.mp3  — ambient menu loop
//   public/music/game.mp3  — driving gameplay loop

export type MusicTrack = "menu" | "game";

const SOURCES: Record<MusicTrack, string> = {
  menu: "/music/menu.mp3",
  game: "/music/game.mp3",
};

const FADE_MS = 600;

export class MusicPlayer {
  private els = new Map<MusicTrack, HTMLAudioElement>();
  private missing = new Set<MusicTrack>();
  private current: MusicTrack | null = null;
  private _volume = 0.6;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    const el = this.current ? this.els.get(this.current) : null;
    if (el && !this.fadeTimer) el.volume = this._volume;
    if (this._volume === 0) this.stopAll();
    else if (this.current) this.play(this.current); // resume if it was silenced
  }

  /** Switch to a track (with a short crossfade). Safe to call every transition;
   *  does nothing if it's already playing or the file doesn't exist. */
  play(track: MusicTrack): void {
    if (this._volume === 0 || this.missing.has(track)) return;
    if (this.current === track) {
      const el = this.els.get(track);
      if (el && el.paused) void el.play().catch(() => this.markMissing(track));
      return;
    }
    const from = this.current ? this.els.get(this.current) : null;
    this.current = track;

    let el = this.els.get(track);
    if (!el) {
      el = new Audio(SOURCES[track]);
      el.loop = true;
      el.addEventListener("error", () => this.markMissing(track));
      this.els.set(track, el);
    }
    el.volume = 0;
    void el.play().catch(() => this.markMissing(track));
    this.crossfade(from ?? null, el);
  }

  stopAll(): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    for (const el of this.els.values()) el.pause();
    this.current = null;
  }

  private crossfade(from: HTMLAudioElement | null, to: HTMLAudioElement): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const steps = 12;
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step++;
      const t = step / steps;
      to.volume = this._volume * t;
      if (from) from.volume = this._volume * (1 - t);
      if (step >= steps) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        if (from) from.pause();
      }
    }, FADE_MS / steps);
  }

  private markMissing(track: MusicTrack): void {
    this.missing.add(track);
    this.els.get(track)?.pause();
    this.els.delete(track);
    if (this.current === track) this.current = null;
  }
}
