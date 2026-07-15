// Background music player. Looks for optional MP3s under public/music/ and
// loops them per screen (menu vs gameplay). Fails completely silent when the
// files aren't there, so the game works with or without a soundtrack.
//
//   public/music/menu.mp3  — ambient menu loop
//   public/music/game.mp3  — driving gameplay loop

export type MusicTrack = "menu" | "game";

// Relative to the page URL (not the domain root) so the game works when
// hosted under a subpath like GitHub Pages' /VimTrainer/.
const SOURCES: Record<MusicTrack, string> = {
  menu: "music/menu.mp3",
  game: "music/game.mp3",
};

const FADE_MS = 600;

export class MusicPlayer {
  private els = new Map<MusicTrack, HTMLAudioElement>();
  /** After a failed load/play, don't retry that track until this timestamp —
   *  keeps a missing file quiet without giving up forever (e.g. a dev-server
   *  hiccup, or autoplay being blocked until a later gesture). */
  private retryAt = new Map<MusicTrack, number>();
  private current: MusicTrack | null = null;
  private _volume = 0.6;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  get volume(): number {
    return this._volume;
  }

  /** True when a track is actually playing right now (for the HUD indicator). */
  get playing(): boolean {
    const el = this.current ? this.els.get(this.current) : null;
    return !!el && !el.paused;
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    const el = this.current ? this.els.get(this.current) : null;
    if (el && !this.fadeTimer) el.volume = this._volume;
    if (this._volume === 0) this.stopAll();
    else if (this.current) this.play(this.current); // resume if it was silenced
  }

  /** Switch to a track (with a short crossfade). Safe to call every transition;
   *  quietly does nothing if the file is unavailable, and retries later. */
  play(track: MusicTrack): void {
    if (this._volume === 0 || Date.now() < (this.retryAt.get(track) ?? 0)) return;
    if (this.current === track) {
      const el = this.els.get(track);
      if (el && el.paused) void el.play().catch(() => this.fail(track));
      return;
    }
    const from = this.current ? this.els.get(this.current) : null;
    this.current = track;

    let el = this.els.get(track);
    if (!el) {
      el = new Audio(SOURCES[track]);
      el.loop = true;
      el.addEventListener("error", () => this.fail(track));
      this.els.set(track, el);
    }
    el.volume = 0;
    void el.play().catch(() => this.fail(track));
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

  /** Clear failure backoff — e.g. a real click just happened, which unlocks
   *  audio in browsers whose autoplay policy ignores keyboard gestures. */
  retryNow(): void {
    this.retryAt.clear();
  }

  private fail(track: MusicTrack): void {
    this.els.get(track)?.pause();
    this.els.delete(track);
    if (this.current === track) this.current = null;
    this.retryAt.set(track, Date.now() + 3000);
    console.warn(`[music] couldn't load/play ${SOURCES[track]} — will retry`);
  }
}
