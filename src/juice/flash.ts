// Full-screen colour flash / tint that decays. Used for landings (accent) and hits (red).

export class Flash {
  private color = "#ffffff";
  private alpha = 0;
  private decay = 4;

  trigger(color: string, strength = 0.5, decay = 4): void {
    this.color = color;
    this.alpha = Math.max(this.alpha, strength);
    this.decay = decay;
  }

  update(dt: number): void {
    if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - dt * this.decay);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
