// Global keyboard capture. Normalizes events to Vim tokens, prevents the browser
// from acting on game keys (scrolling, quick-find, etc.), and forwards tokens to a sink.

import { normalizeKeyEvent, type KeyToken, type NormalizeOpts } from "../engine/keymap.ts";

export type KeyHandler = (token: KeyToken) => void;

export class InputManager {
  private handler: KeyHandler | null = null;
  private el: HTMLElement;
  private opts: () => NormalizeOpts;

  constructor(target: HTMLElement, opts: () => NormalizeOpts = () => ({})) {
    this.el = target;
    this.opts = opts;
  }

  onKey(handler: KeyHandler): void {
    this.handler = handler;
  }

  attach(): void {
    this.el.addEventListener("keydown", this.handleKeyDown);
    // Keep focus on the canvas so keystrokes are always captured.
    this.el.addEventListener("blur", this.refocus);
    this.el.focus();
  }

  detach(): void {
    this.el.removeEventListener("keydown", this.handleKeyDown);
    this.el.removeEventListener("blur", this.refocus);
  }

  private refocus = (): void => {
    // Small delay avoids fighting the browser's own focus handling.
    setTimeout(() => this.el.focus(), 0);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const token = normalizeKeyEvent(e, this.opts());
    if (token === null) return; // let the browser handle it (F5 reload, devtools, etc.)
    // Note: <C-r> is redo in-game, so Ctrl-R won't reload the page. Use F5 during dev.
    e.preventDefault();
    this.handler?.(token);
  };
}
