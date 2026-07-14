// Hit-stop: briefly freeze gameplay updates on impact so hits feel weighty.
// The loop keeps rendering; only mode.update is gated on !frozen.

export class HitStop {
  private remaining = 0;

  trigger(seconds: number): void {
    this.remaining = Math.max(this.remaining, seconds);
  }

  /** Advance the freeze timer with real time; returns whether gameplay is frozen. */
  tick(dt: number): boolean {
    if (this.remaining > 0) {
      this.remaining -= dt;
      return true;
    }
    return false;
  }

  get frozen(): boolean {
    return this.remaining > 0;
  }
}
