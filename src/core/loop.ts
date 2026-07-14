// Fixed-timestep game loop over requestAnimationFrame.
// update(dt) runs on a fixed accumulator; render(alpha) runs once per frame.

export interface LoopCallbacks {
  update: (dt: number) => void; // dt in seconds, fixed
  render: (alpha: number) => void; // alpha = interpolation fraction [0,1)
}

const FIXED_DT = 1 / 120; // seconds
const MAX_FRAME = 0.25; // clamp huge stalls (tab was backgrounded)

export class GameLoop {
  private cbs: LoopCallbacks;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private rafId = 0;

  constructor(cbs: LoopCallbacks) {
    this.cbs = cbs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > MAX_FRAME) frameTime = MAX_FRAME;

    this.accumulator += frameTime;
    while (this.accumulator >= FIXED_DT) {
      this.cbs.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    this.cbs.render(this.accumulator / FIXED_DT);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
