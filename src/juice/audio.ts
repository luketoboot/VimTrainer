// Procedural Web Audio SFX — punchy, zero-latency, no asset loading.
// The AudioContext is created lazily on the first sound after a user gesture
// (browsers block audio until then). All sounds are short synthesized blips.

type Sfx = "move" | "land" | "perfect" | "combo" | "error" | "hit" | "start";

export class AudioFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private _volume = 0.5;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this._volume;
  }
  get volume(): number {
    return this._volume;
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.4,
    slideTo?: number,
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain = 0.4): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  play(sfx: Sfx): void {
    switch (sfx) {
      case "move":
        this.blip(220, 0.04, "square", 0.08);
        return;
      case "land":
        this.blip(520, 0.12, "triangle", 0.35, 780);
        return;
      case "perfect":
        this.blip(660, 0.1, "square", 0.3, 990);
        this.blip(990, 0.14, "triangle", 0.2, 1320);
        return;
      case "combo":
        this.blip(880, 0.1, "square", 0.28, 1200);
        return;
      case "error":
        this.blip(120, 0.12, "sawtooth", 0.3, 80);
        return;
      case "hit":
        this.noise(0.18, 0.5);
        this.blip(90, 0.18, "sawtooth", 0.4, 50);
        return;
      case "start":
        this.blip(440, 0.09, "triangle", 0.3, 660);
        return;
    }
  }
}
