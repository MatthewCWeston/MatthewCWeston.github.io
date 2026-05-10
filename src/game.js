import { SpaceWarEnv } from './env.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { AIPlayer } from './ai.js';
import { Input } from './input.js';

/**
 * Coordinates env, renderer, HUD, AI, input, and the main loop.
 *
 *   FPS    — visual frames per second  (default 20)
 *   speed  — physics ticks per visual frame  (default 5; the trained-with value)
 *
 *   Wall-clock game speed = FPS × speed  ticks/sec.
 *   AI inferences (or human input reads)  = FPS  per second.
 */
export class Game {
  constructor({ canvas, hudP1, hudP2, listeners }) {
    this.env       = new SpaceWarEnv();
    this.renderer  = new Renderer(canvas);
    this.hud       = new HUD(hudP1, hudP2);
    this.input     = new Input();
    this.ai        = new AIPlayer();

    this.mode      = 'cvc';                 // 'cvc' | 'hvc' | 'hotseat'
    this.speed     = 5;                     // physics ticks per render frame
    this.fps       = 20;                    // render frames per second
    this.frameMs   = 1000 / this.fps;
    this.stochastic = true;

    this.running   = false;
    this.paused    = false;
    this.loopId    = 0;
    this.currentActions = [[0,0,0,0],[0,0,0,0]];

    this.listeners = listeners || {};       // { onStateChange(state) }

    this.input.onRestart = () => this.start();
    this.input.onPause   = () => this.pause();
  }

  setMode(m)        { this.mode = m; }
  setSpeed(n)       { this.speed = n; }
  setFps(n)         { this.fps = n; this.frameMs = 1000 / n; }
  setStochastic(b)  { this.stochastic = b; }
  setTrails(b)      { this.renderer.showTrails = b; }

  isAI(playerIdx) {
    if (this.mode === 'cvc')     return true;
    if (this.mode === 'hotseat') return false;
    if (this.mode === 'hvc')     return playerIdx === 1;   // P0 = human, P1 = AI
    return false;
  }

  _emitState(s, payload = {}) {
    if (this.listeners.onStateChange) this.listeners.onStateChange(s, payload);
  }

  /** Initial render so the canvas isn't blank before the first match. */
  initialDraw() {
    this.renderer.render(this.env);
    this.hud.update(this.env);
  }

  start() {
    if (!this.ai.session) return;            // model not loaded yet
    this.env.reset();
    this.currentActions = [[0,0,0,0],[0,0,0,0]];
    this.running = true;
    this.paused  = false;
    this.renderer.trails.length = 0;
    this.loopId++;
    this._emitState('playing');
    this.tick(this.loopId);
  }

  pause() {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.loopId++;
      this._emitState('paused');
    } else {
      this.loopId++;
      this._emitState('playing');
      this.tick(this.loopId);
    }
  }

  /** Stop the match without starting a new one (e.g. mode change). */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    this.loopId++;
    this.env.reset();
    this.renderer.trails.length = 0;
    this.renderer.render(this.env);
    this.hud.update(this.env);
    this._emitState('ready');
  }

  _endMatch() {
    this.running = false;
    const r0 = this.env.rewards[0];
    let outcome, sub;
    if (r0 > 0)      { outcome = 'PLAYER 1 WINS'; sub = 'cyan victorious'; }
    else if (r0 < 0) { outcome = 'PLAYER 2 WINS'; sub = 'orange victorious'; }
    else             { outcome = 'TIME OUT';      sub = 'no contact made'; }
    this.renderer.render(this.env);          // lock in win/loss colors
    this.hud.update(this.env);
    this._emitState('match-over', { outcome, sub });
  }

  async tick(loopId) {
    if (loopId !== this.loopId)            return;
    if (!this.running || this.paused)      return;
    const now = performance.now();

    // 1) One action sample per rendered frame (matches training frame-skip).
    for (let i = 0; i < 2; i++) {
      if (this.isAI(i)) {
        try {
          this.currentActions[i] =
            await this.ai.getAction(this.env, i, this.stochastic);
        } catch (err) {
          console.error('Inference failed:', err);
          this.currentActions[i] = [0, 0, 0, 0];
        }
        if (loopId !== this.loopId) return;
      } else {
        this.currentActions[i] = this.input.read(i);
      }
    }

    // 2) Run physics `speed` times with the same action.
    for (let s = 0; s < this.speed; s++) {
      this.env.update(this.currentActions);
      if (this.env.terminated || this.env.time >= this.env.maxTime) break;
    }

    // 3) Render + HUD.
    this.renderer.render(this.env);
    this.hud.update(this.env);

    if (this.env.terminated || this.env.time >= this.env.maxTime) {
      this._endMatch();
      return;
    }

    const elapsed = performance.now() - now;
    const wait = Math.max(0, this.frameMs - elapsed);
    setTimeout(() => this.tick(loopId), wait);
  }
}
