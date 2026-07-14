// A small particle pool. Modes spawn bursts (e.g. exploding a cell) on impact.
// Particles are simple squares/glyph fragments with gravity + drag.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  ch?: string;
}

export class ParticlePool {
  private pool: Particle[] = [];

  burst(
    x: number,
    y: number,
    opts: {
      count?: number;
      color?: string;
      speed?: number;
      chars?: string;
      spread?: number;
      gravity?: boolean;
    } = {},
  ): void {
    const count = opts.count ?? 14;
    const color = opts.color ?? "#39ff87";
    const speed = opts.speed ?? 180;
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pool.push({
        x,
        y,
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
        color,
        ch: opts.chars
          ? opts.chars[Math.floor(Math.random() * opts.chars.length)]
          : undefined,
      });
    }
    void opts.spread;
    void opts.gravity;
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.pool.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 320 * dt; // gravity
      p.vx *= 1 - 2 * dt; // drag
    }
  }

  /** Rendered in screen space (unaffected by grid camera). */
  render(ctx: CanvasRenderingContext2D, fontFamily: string): void {
    for (const p of this.pool) {
      const a = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      if (p.ch) {
        ctx.font = `${8 + p.size * 2}px ${fontFamily}`;
        ctx.fillText(p.ch, p.x, p.y);
      } else {
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.restore();
    }
  }

  get count(): number {
    return this.pool.length;
  }
}
