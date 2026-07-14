// Screen shake via a decaying "trauma" model. Modes add trauma on impact;
// the offset is fed to the renderer's camera each frame.

export class ScreenShake {
  private trauma = 0;
  private t = 0;
  maxOffset = 14;

  /** amount in [0,1]; stacks up to 1. */
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
  }

  get offset(): { x: number; y: number } {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const power = this.trauma * this.trauma; // quadratic falloff feels punchier
    const mag = this.maxOffset * power;
    // Deterministic-ish oscillation with layered sines (no RNG needed per frame).
    const x = mag * Math.sin(this.t * 57.1) * Math.sin(this.t * 13.3);
    const y = mag * Math.sin(this.t * 47.7) * Math.sin(this.t * 19.9);
    return { x, y };
  }
}
