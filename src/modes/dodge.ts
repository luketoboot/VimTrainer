// Dodge — bullet-hell where you survive escalating waves using Vim motions.
// The cursor moves through a text field via the real Vim engine (movement only:
// any edit or mode change is snapped back). Slow bullets you dodge with hjkl;
// fast walls with a single gap force big jumps (gg/G/$/0) — that's the lesson.

import { VimEngine } from "../engine/engine.ts";
import type { KeyToken } from "../engine/keymap.ts";
import { drawBuffer } from "../render/bufferView.ts";
import type { DodgeLevel, DodgePattern } from "../levels/curriculum.ts";
import { Storage } from "../core/storage.ts";
import { contextForEngine, engineWantsEsc, type RemapContext } from "../core/keybinds.ts";
import type { GameMode, GameServices, ModeResult } from "./mode.ts";

interface Projectile {
  x: number; // cell-space, float
  y: number;
  vx: number; // cells/sec
  vy: number;
  glyph: string;
  color: string;
  near: boolean; // already counted for a near-miss?
}

// A pending "bloom": we flash warning glyphs on the cells it will occupy, then
// fire it once the timer runs out. Telegraphing makes dense onscreen patterns
// (rings, spirals, walls) fair to read — deaths feel earned, not cheap.
interface Telegraph {
  cells: { x: number; y: number }[];
  timer: number; // seconds until it fires
  duration: number; // original warning window (for blink timing)
  fire: () => void;
}

// A collectible dropped on a cell. Reaching it with a motion (f{char}, w, gg…)
// rewards you — it turns dodging into active target-seeking.
interface Pickup {
  x: number;
  y: number;
  ttl: number; // seconds left before it fades
  maxTtl: number;
}

// A short-lived rising label ("+12 LEAP") for satisfying, legible feedback.
interface Floater {
  x: number; // pixel-space
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

const TELEGRAPH_DELAY = 0.75; // seconds of warning before a bloom fires
const LEAP_DISTANCE = 3; // cells moved in one key to count as a mastery "leap"

const BACKDROP_POOL = [
  "const engine = require('vim'); // stay sharp and keep moving through the noise",
  "function survive() { while (alive) { dodge(); read(lanes); reposition(fast); } }",
  "let hp = 3; let score = 0; const motions = ['h','j','k','l','w','b','gg','G'];",
  "// walls have exactly one gap :: snap to it :: hjkl is far too slow for that",
  "for (let t = 0; t < duration; t++) spawn(pattern[t % patterns.length]);",
];

export class DodgeMode implements GameMode {
  private svc: GameServices;
  private level: DodgeLevel;
  private engine = new VimEngine();
  private backdrop: string[] = [];
  private backdropText = "";

  private cols = 40;
  private rows = 16;

  private projectiles: Projectile[] = [];
  private spawnTimer = 0;
  private elapsed = 0;
  private hp: number;
  private score = 0;
  private nearMisses = 0;
  private invuln = 0; // seconds of remaining i-frames
  private blink = 0;
  private lastKey = "";
  private survived = false;
  private spiralPhase = 0; // rotating-emitter angle, seeded in init()

  private telegraphs: Telegraph[] = [];
  private pickups: Pickup[] = [];
  private floaters: Floater[] = [];
  private pickupTimer = 6; // seconds until the next collectible drops

  // Mastery: big motions build juice + a leap combo.
  private leaps = 0;
  private leapCombo = 0;
  private leapTimer = 0; // combo decays if you go too long without a leap

  // Feel: grazing charges a bomb you spend with `dd` to clear the screen.
  private bomb = 0; // 0..1 charge
  private bombsUsed = 0;

  done = false;
  private result: ModeResult | null = null;

  /** All gameplay randomness flows through `rand`, so a seeded rng makes the
   *  whole run deterministic — the daily challenge gives everyone the same waves. */
  private rand: () => number;

  constructor(svc: GameServices, level: DodgeLevel, rng: () => number = Math.random) {
    this.svc = svc;
    this.level = level;
    this.hp = level.startHp;
    this.rand = rng;
  }

  init(): void {
    this.spiralPhase = this.rand() * Math.PI * 2;
    this.cols = Math.max(20, this.svc.term.cols);
    this.rows = Math.max(8, this.svc.term.rows - 2); // leave HUD + statusline
    this.buildBackdrop();
    this.engine.load(this.backdrop, { row: Math.floor(this.rows / 2), col: Math.floor(this.cols / 2) });
    this.spawnTimer = 0.8;
    this.svc.audio.play("start");
  }

  private buildBackdrop(): void {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      const base = BACKDROP_POOL[r % BACKDROP_POOL.length]!;
      let line = base;
      while (line.length < this.cols) line += "  " + base;
      lines.push(line.slice(0, this.cols));
    }
    this.backdrop = lines;
    this.backdropText = lines.join("\n");
  }

  // --- input: movement only ---

  remapContext(): RemapContext {
    return contextForEngine(this.engine);
  }

  wantsEsc(): boolean {
    return engineWantsEsc(this.engine);
  }

  handleKey(token: KeyToken): void {
    if (this.done) return;
    this.svc.coach.observe(token, this.remapContext());
    const prevKey = this.lastKey;
    this.lastKey = token;

    // `dd` fires the bomb when charged — a thematic "delete everything on the
    // line of fire". Intercept it before the engine treats it as an edit.
    if (token === "d" && prevKey === "d" && this.bomb >= 1) {
      this.fireBomb();
      return;
    }

    const before = { ...this.engine.cursor };
    this.engine.feedKey(token);
    // Snap back any edit or mode change — Dodge is a read-only field.
    if (this.engine.mode !== "normal" || this.engine.getText() !== this.backdropText) {
      const c = { ...this.engine.cursor };
      this.engine.load(this.backdrop, c);
    }

    // Mastery reward: a single key that moved the cursor a long way is a "leap".
    const moved = Math.max(
      Math.abs(this.engine.cursor.row - before.row),
      Math.abs(this.engine.cursor.col - before.col),
    );
    if (moved >= LEAP_DISTANCE) this.onLeap(moved);

    this.collectPickups();
  }

  // --- simulation ---

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    this.blink += dt;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.leapTimer > 0) {
      this.leapTimer = Math.max(0, this.leapTimer - dt);
      if (this.leapTimer === 0) this.leapCombo = 0; // combo cooled off
    }

    const difficulty = Math.min(1, this.elapsed / this.level.duration);

    // Spawning.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnWave(difficulty);
      const interval = lerp(this.level.baseSpawnInterval, this.level.minSpawnInterval, difficulty);
      this.spawnTimer = interval * (0.7 + this.rand() * 0.6);
    }

    // Telegraphs: warn, then bloom.
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i]!;
      t.timer -= dt;
      if (t.timer <= 0) {
        t.fire();
        this.telegraphs.splice(i, 1);
      }
    }

    this.updatePickups(dt);
    this.updateFloaters(dt);

    // Move projectiles + cull.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -2 || p.x > this.cols + 2 || p.y < -2 || p.y > this.rows + 2) {
        this.projectiles.splice(i, 1);
      }
    }

    this.resolveCollisions();

    // Win by surviving to the end.
    if (this.elapsed >= this.level.duration) {
      this.survived = true;
      this.finish();
    }
  }

  private resolveCollisions(): void {
    const cr = this.engine.cursor.row;
    const cc = this.engine.cursor.col;
    for (const p of this.projectiles) {
      const pr = Math.round(p.y);
      const pc = Math.round(p.x);
      const cheb = Math.max(Math.abs(pr - cr), Math.abs(pc - cc));
      if (cheb === 0) {
        if (this.invuln <= 0) this.onHit(p);
      } else if (cheb === 1 && !p.near) {
        p.near = true;
        this.nearMisses++;
        this.score += 5;
        // Grazing is risky — reward it by charging the bomb.
        if (this.bomb < 1) {
          this.bomb = Math.min(1, this.bomb + 0.05);
          if (this.bomb >= 1) {
            this.svc.audio.play("combo");
            this.pushFloater(cc, cr, "BOMB READY — dd", this.svc.term.theme.accent);
          }
        }
      }
    }
  }

  private onHit(p: Projectile): void {
    this.hp--;
    this.invuln = 0.9;
    this.svc.audio.play("hit");
    this.svc.shake.add(0.7);
    this.svc.flash.trigger(this.svc.term.theme.danger, 0.4, 4);
    this.svc.hitstop.trigger(0.08);
    const px = pixelForCell(this.svc.term, p.x, p.y);
    this.svc.particles.burst(px.x, px.y, { color: this.svc.term.theme.danger, count: 24, speed: 240 });
    if (this.hp <= 0) {
      this.hp = 0;
      this.survived = false;
      this.finish();
    }
  }

  // --- wave patterns ---

  private spawnWave(difficulty: number): void {
    if (this.projectiles.length > 160) return; // safety cap
    const speed = lerp(this.level.baseSpeed, this.level.maxSpeed, difficulty);
    // Denser late-game: fire more patterns per tick as difficulty ramps in.
    const intensity = this.level.intensity ?? 0;
    const extra = Math.floor(difficulty * intensity + this.rand() * 0.5);
    const waves = 1 + Math.max(0, extra);
    for (let w = 0; w < waves; w++) {
      const pattern = this.level.patterns[Math.floor(this.rand() * this.level.patterns.length)]!;
      this.emit(pattern, speed, difficulty);
    }
  }

  // Dense onscreen blooms get a telegraph so they're readable; edge-fed patterns
  // (streams, rain, aimed, diagonal, arc) come from offscreen and fire at once.
  private emit(pattern: DodgePattern, speed: number, difficulty: number): void {
    const rint = (n: number): number => Math.floor(this.rand() * n);
    switch (pattern) {
      case "ring": {
        const ox = 3 + rint(Math.max(1, this.cols - 6));
        const oy = 2 + rint(Math.max(1, this.rows - 4));
        this.addTelegraph(ringPreview(ox, oy), () => this.spawnRing(ox, oy, speed, difficulty));
        return;
      }
      case "spiral": {
        const ox = Math.floor(this.cols / 2);
        const oy = Math.floor(this.rows / 2);
        this.addTelegraph([{ x: ox, y: oy }], () => this.spawnSpiral(speed, difficulty));
        return;
      }
      case "wall": {
        const gap = rint(this.rows);
        const cells = [];
        for (let r = 0; r < this.rows; r++) if (r !== gap) cells.push({ x: this.cols - 1, y: r });
        this.addTelegraph(cells, () => this.spawnWall(gap, speed));
        return;
      }
      default:
        this.spawn(pattern, speed, difficulty);
    }
  }

  private addTelegraph(cells: { x: number; y: number }[], fire: () => void): void {
    this.telegraphs.push({ cells, timer: TELEGRAPH_DELAY, duration: TELEGRAPH_DELAY, fire });
  }

  private spawn(pattern: DodgePattern, speed: number, difficulty: number): void {
    const th = this.svc.term.theme;
    const rint = (n: number): number => Math.floor(this.rand() * n);
    switch (pattern) {
      case "stream": {
        const row = rint(this.rows);
        const burst = 1 + rint(2 + Math.floor(difficulty * 2));
        for (let i = 0; i < burst; i++) {
          this.projectiles.push({
            x: this.cols + 1 + i * 1.5,
            y: row,
            vx: -speed,
            vy: 0,
            glyph: "●",
            color: th.danger,
            near: false,
          });
        }
        return;
      }
      case "rain": {
        const col = rint(this.cols);
        this.projectiles.push({
          x: col,
          y: -1,
          vx: 0,
          vy: speed * 0.9,
          glyph: "●",
          color: th.accentAlt,
          near: false,
        });
        return;
      }
      case "aimed": {
        // Fire from a random point on any of the four edges, straight at the cursor.
        const { x: sx, y: sy } = this.edgePoint();
        const angle = Math.atan2(this.engine.cursor.row - sy, this.engine.cursor.col - sx);
        this.pushAngled(sx, sy, angle, speed, "◆", th.accent);
        return;
      }
      case "diagonal": {
        // A short stream sliding in at 45° from one of the four corners.
        const fromLeft = this.rand() < 0.5;
        const fromTop = this.rand() < 0.5;
        const sx = fromLeft ? -1 : this.cols + 1;
        const sy = fromTop ? -1 : this.rows + 1;
        const angle = Math.atan2(fromTop ? 1 : -1, fromLeft ? 1 : -1);
        const burst = 2 + rint(2 + Math.floor(difficulty * 3));
        for (let i = 0; i < burst; i++) {
          const back = i * 1.4;
          this.pushAngled(
            sx - Math.cos(angle) * back,
            sy - Math.sin(angle) * back,
            angle,
            speed,
            "◇",
            th.accentAlt,
          );
        }
        return;
      }
      case "arc": {
        // A fan of bullets from an edge point, spread around the cursor direction.
        const { x: sx, y: sy } = this.edgePoint();
        const center = Math.atan2(this.engine.cursor.row - sy, this.engine.cursor.col - sx);
        const count = 3 + Math.floor(difficulty * 4);
        const spread = 0.9; // radians, total fan width
        for (let i = 0; i < count; i++) {
          const t = count === 1 ? 0.5 : i / (count - 1);
          const angle = center + (t - 0.5) * spread;
          this.pushAngled(sx, sy, angle, speed, "◆", th.accent);
        }
        return;
      }
      case "ring": {
        const ox = 3 + rint(Math.max(1, this.cols - 6));
        const oy = 2 + rint(Math.max(1, this.rows - 4));
        this.spawnRing(ox, oy, speed, difficulty);
        return;
      }
      case "spiral": {
        this.spawnSpiral(speed, difficulty);
        return;
      }
      case "wall": {
        this.spawnWall(rint(this.rows), speed);
        return;
      }
    }
  }

  // Omnidirectional burst from an interior point — bullets fly out at every angle.
  private spawnRing(ox: number, oy: number, speed: number, difficulty: number): void {
    const count = 8 + Math.floor(difficulty * 8);
    const offset = this.rand() * Math.PI * 2;
    const ringSpeed = speed * 0.8;
    for (let i = 0; i < count; i++) {
      const angle = offset + (i / count) * Math.PI * 2;
      this.pushAngled(ox, oy, angle, ringSpeed, "○", this.svc.term.theme.accentAlt);
    }
  }

  // Rotating emitter at the center: each tick lays down arms, sweeping every angle.
  private spawnSpiral(speed: number, difficulty: number): void {
    const ox = Math.floor(this.cols / 2);
    const oy = Math.floor(this.rows / 2);
    const arms = 2 + Math.floor(difficulty * 2);
    const spiralSpeed = speed * 0.75;
    for (let a = 0; a < arms; a++) {
      const angle = this.spiralPhase + (a / arms) * Math.PI * 2;
      this.pushAngled(ox, oy, angle, spiralSpeed, "◦", this.svc.term.theme.accent);
    }
    this.spiralPhase += 0.6; // advance the sweep for next tick
  }

  // A full column advancing from the right with one escape row — forces a big jump.
  private spawnWall(gap: number, speed: number): void {
    const wallSpeed = speed * 0.75;
    for (let r = 0; r < this.rows; r++) {
      if (r === gap) continue; // the one escape row
      this.projectiles.push({
        x: this.cols + 1,
        y: r,
        vx: -wallSpeed,
        vy: 0,
        glyph: "█",
        color: this.svc.term.theme.danger,
        near: false,
      });
    }
  }

  /** A random point just outside one of the four edges. */
  private edgePoint(): { x: number; y: number } {
    switch (Math.floor(this.rand() * 4)) {
      case 0:
        return { x: -1, y: Math.floor(this.rand() * this.rows) }; // left
      case 1:
        return { x: this.cols + 1, y: Math.floor(this.rand() * this.rows) }; // right
      case 2:
        return { x: Math.floor(this.rand() * this.cols), y: -1 }; // top
      default:
        return { x: Math.floor(this.rand() * this.cols), y: this.rows + 1 }; // bottom
    }
  }

  /** Push a projectile travelling at `angle` (radians) with the given speed. */
  private pushAngled(
    x: number,
    y: number,
    angle: number,
    speed: number,
    glyph: string,
    color: string,
  ): void {
    this.projectiles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      glyph,
      color,
      near: false,
    });
  }

  // --- mastery: big-motion leaps ---

  private onLeap(dist: number): void {
    this.leapCombo++;
    this.leapTimer = 2.5; // window to keep the combo alive
    this.leaps++;
    const bonus = Math.round(dist * 2 * (1 + (this.leapCombo - 1) * 0.25));
    this.score += bonus;
    const th = this.svc.term.theme;
    const label = this.leapCombo > 1 ? `+${bonus} LEAP x${this.leapCombo}` : `+${bonus} LEAP`;
    this.pushFloater(this.engine.cursor.col, this.engine.cursor.row, label, th.accent);
    const px = pixelForCell(this.svc.term, this.engine.cursor.col, this.engine.cursor.row);
    this.svc.particles.burst(px.x, px.y, {
      color: th.accent,
      count: Math.min(24, 6 + dist * 2),
      speed: 160,
    });
    this.svc.audio.play(this.leapCombo > 2 ? "combo" : "land");
  }

  // --- feel: the graze-charged bomb ---

  private fireBomb(): void {
    this.bomb = 0;
    this.bombsUsed++;
    const cleared = this.projectiles.length;
    this.score += cleared * 3;
    // Blow away everything currently on the field, plus any pending blooms.
    for (const p of this.projectiles) {
      const px = pixelForCell(this.svc.term, p.x, p.y);
      this.svc.particles.burst(px.x, px.y, { color: this.svc.term.theme.accent, count: 4, speed: 120 });
    }
    this.projectiles = [];
    this.telegraphs = [];
    this.invuln = Math.max(this.invuln, 0.4); // brief breather after detonating
    this.svc.audio.play("perfect");
    this.svc.shake.add(0.9);
    this.svc.flash.trigger(this.svc.term.theme.accent, 0.5, 5);
    this.svc.hitstop.trigger(0.14);
    this.pushFloater(this.engine.cursor.col, this.engine.cursor.row, "BOMB!", this.svc.term.theme.accent);
  }

  // --- feel: collectible pickups ---

  private updatePickups(dt: number): void {
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupTimer = 7 + this.rand() * 5;
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]!;
      pk.ttl -= dt;
      if (pk.ttl <= 0) this.pickups.splice(i, 1);
    }
  }

  private spawnPickup(): void {
    // Drop it a good distance from the cursor so reaching it takes a real motion.
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = 2 + Math.floor(this.rand() * Math.max(1, this.cols - 4));
      y = 1 + Math.floor(this.rand() * Math.max(1, this.rows - 2));
      const far = Math.max(Math.abs(x - this.engine.cursor.col), Math.abs(y - this.engine.cursor.row));
      if (far >= 4) break;
    }
    this.pickups.push({ x, y, ttl: 6, maxTtl: 6 });
  }

  private collectPickups(): void {
    const cr = this.engine.cursor.row;
    const cc = this.engine.cursor.col;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]!;
      if (pk.x === cc && pk.y === cr) {
        this.pickups.splice(i, 1);
        this.score += 30;
        this.bomb = Math.min(1, this.bomb + 0.25);
        const th = this.svc.term.theme;
        this.pushFloater(cc, cr, "+30 ★", th.accentAlt);
        const px = pixelForCell(this.svc.term, cc, cr);
        this.svc.particles.burst(px.x, px.y, { color: th.accentAlt, count: 18, speed: 200 });
        this.svc.audio.play("perfect");
      }
    }
  }

  // --- feel: floating score labels ---

  private pushFloater(xCell: number, yCell: number, text: string, color: string): void {
    const px = pixelForCell(this.svc.term, xCell, yCell);
    this.floaters.push({ x: px.x, y: px.y, text, color, life: 0, maxLife: 0.9 });
  }

  private updateFloaters(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.life += dt;
      f.y -= dt * 26; // drift upward
      if (f.life >= f.maxLife) this.floaters.splice(i, 1);
    }
  }

  // --- finish ---

  private finish(): void {
    if (this.done) return;
    this.done = true;
    let stars = 0;
    if (this.survived) {
      stars = 1;
      if (this.hp >= Math.ceil(this.level.startHp * 0.5)) stars = 2;
      if (this.hp >= this.level.startHp) stars = 3;
    }
    const timeScore = Math.floor(this.elapsed * 10);
    this.score += timeScore;
    const isBest = Storage.recordScore(this.level.id, this.score, stars);
    this.result = {
      levelId: this.level.id,
      title: this.level.title,
      score: this.score,
      stars,
      lines: [
        this.survived ? "YOU SURVIVED!" : "DOWN — but wiser",
        `survived ${this.elapsed.toFixed(1)}s   HP left: ${this.hp}/${this.level.startHp}`,
        `near misses: ${this.nearMisses} (+${this.nearMisses * 5})   leaps: ${this.leaps}   bombs: ${this.bombsUsed}`,
        isBest ? "NEW BEST!" : `best: ${Storage.getHighScore(this.level.id)}`,
      ],
    };
    this.svc.audio.play(this.survived ? "perfect" : "error");
  }

  getResult(): ModeResult | null {
    return this.result;
  }

  // --- render ---

  render(): void {
    const term = this.svc.term;
    term.clear();
    const th = term.theme;
    // Backdrop, dim, no cursor (we draw our own so it can blink during i-frames).
    drawBuffer(term, this.engine.getView(), { dimText: true, showCursor: false });

    // Telegraphs: pulse a warning glyph on cells a bloom is about to occupy,
    // blinking faster as the moment of fire approaches.
    for (const t of this.telegraphs) {
      const rate = t.timer < 0.3 ? 16 : 7;
      const hot = Math.floor(this.blink * rate) % 2 === 0;
      for (const c of t.cells) {
        term.drawGlyphAtCell(c.x, c.y, hot ? "▓" : "░", hot ? th.danger : th.dim, true);
      }
    }

    // Pickups: a star to seek out; blinks as it's about to fade.
    for (const pk of this.pickups) {
      const fading = pk.ttl < 1.5 && Math.floor(this.blink * 10) % 2 === 0;
      if (!fading) term.drawGlyphAtCell(pk.x, pk.y, "★", th.accentAlt, true);
    }

    // Projectiles.
    for (const p of this.projectiles) {
      term.drawGlyphAtCell(p.x, p.y, p.glyph, p.color, true);
    }

    // Cursor: bright block; blink while invulnerable.
    const visible = this.invuln <= 0 || Math.floor(this.blink * 12) % 2 === 0;
    if (visible) {
      const ch = this.engine.lines[this.engine.cursor.row]?.[this.engine.cursor.col] ?? " ";
      term.drawGlyphAtCell(this.engine.cursor.col, this.engine.cursor.row, "▊", th.fg, true);
      void ch;
    }

    this.svc.flash.render(term.context, term.canvas.width, term.canvas.height);
    this.svc.particles.render(term.context, th.fontFamily);
    this.renderFloaters(term);

    // HUD.
    const hearts = "♥".repeat(this.hp) + "·".repeat(Math.max(0, this.level.startHp - this.hp));
    const timeLeft = Math.max(0, this.level.duration - this.elapsed).toFixed(1);
    term.drawText(0, 0, this.level.hint.slice(0, term.cols), { fg: th.dim });
    const filled = Math.round(this.bomb * 5);
    const bombLabel =
      this.bomb >= 1 ? "BOMB:dd" : `bomb ${"▮".repeat(filled)}${"▯".repeat(5 - filled)}`;
    const combo = this.leapCombo > 1 ? `  LEAP x${this.leapCombo}` : "";
    term.drawStatusLine(
      ` ${this.level.title}   ${hearts}   ⏱ ${timeLeft}s${combo}`,
      `${bombLabel}   score ${this.score} `,
    );
  }

  private renderFloaters(term: GameServices["term"]): void {
    const ctx = term.context;
    const size = Math.round(term.metrics.fontSize * 0.62);
    ctx.save();
    ctx.font = `bold ${size}px ${term.theme.fontFamily}`;
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.life / f.maxLife);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// The warning footprint for a ring: its origin plus the four cardinal neighbours,
// so the player can read where the burst will bloom from.
function ringPreview(ox: number, oy: number): { x: number; y: number }[] {
  return [
    { x: ox, y: oy },
    { x: ox + 1, y: oy },
    { x: ox - 1, y: oy },
    { x: ox, y: oy + 1 },
    { x: ox, y: oy - 1 },
  ];
}

function pixelForCell(
  term: GameServices["term"],
  xCell: number,
  yCell: number,
): { x: number; y: number } {
  const m = term.metrics;
  return {
    x: m.padding + xCell * m.cellW + m.cellW / 2,
    y: m.padding + yCell * m.cellH + m.cellH / 2,
  };
}
