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

    this.running   = false;
    this.paused    = false;
    this.loopId    = 0;
    this.currentActions = [[0,0,0,0],[0,0,0,0]];
    // Wall-clock deadline for the post-termination grace window.  Set the
    // first tick after env.terminated flips; _endMatch fires once we reach
    // it.  `deathRemaining` carries the leftover ms across pause/resume.
    this.deathEndsAt  = null;
    this.deathRemaining = 0;

    this.listeners = listeners || {};       // { onStateChange(state) }

    this.input.onRestart = () => this.start();
    this.input.onPause   = () => this.pause();
  }

  setMode(m)        { this.mode = m; }
  setSpeed(n)       { this.speed = n; this.renderer.frameTickSpeed = n; }
  setFps(n)         { this.fps = n; this.frameMs = 1000 / n; }

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
    this.deathEndsAt = null;
    this.deathRemaining = 0;
    this.renderer.reset();
    this.loopId++;
    this._emitState('playing');
    this.tick(this.loopId);
  }

  pause() {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.paused) {
      // Stash remaining death-window time so it survives the pause.
      if (this.deathEndsAt) {
        this.deathRemaining = Math.max(0, this.deathEndsAt - performance.now());
        this.deathEndsAt = null;
      }
      this.loopId++;
      this._emitState('paused');
    } else {
      if (this.deathRemaining > 0) {
        this.deathEndsAt = performance.now() + this.deathRemaining;
        this.deathRemaining = 0;
      }
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
    this.deathEndsAt = null;
    this.deathRemaining = 0;
    this.loopId++;
    this.env.reset();
    this.renderer.reset();
    this.renderer.render(this.env);
    this.hud.update(this.env);
    this._emitState('ready');
  }

  _endMatch() {
    this.running = false;
    this.deathEndsAt = null;
    this.deathRemaining = 0;
    const r0 = this.env.rewards[0];
    let outcome, sub;
    if (r0 > 0)      { outcome = 'PLAYER 1 WINS'; sub = 'orange victorious'; }
    else if (r0 < 0) { outcome = 'PLAYER 2 WINS'; sub = 'cyan victorious'; }
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
          this.currentActions[i] = await this.ai.getAction(this.env, i);
        } catch (err) {
          console.error('Inference failed:', err);
          this.currentActions[i] = [0, 0, 0, 0];
        }
        if (loopId !== this.loopId) return;
      } else {
        this.currentActions[i] = this.input.read(i);
      }
    }

    // 2) Run physics `speed` times.  We *don't* break on termination —
    //    the alive ship keeps playing through the post-termination grace
    //    window so the world doesn't freeze while the death-anim plays.
    //    env.update skips dead ships and locks the rewards on first kill.
    for (let s = 0; s < this.speed; s++) {
      this.env.update(this.currentActions);
    }

    // 3) On the first frame the env is terminated (or the time-out hits),
    //    start the grace-window timer.  Longer if a Minskytron atom is
    //    playing — that animation needs room to develop.
    if (!this.deathEndsAt &&
        (this.env.terminated || this.env.time >= this.env.maxTime)) {
      const warpFailed = this.env.playerShips.some(s => s.warp_failed);
      this.deathEndsAt = now + (warpFailed ? 1800 : 700);
    }

    // 4) Render + HUD.
    this.renderer.render(this.env);
    this.hud.update(this.env);

    // 5) End the match once the grace window expires.
    if (this.deathEndsAt && performance.now() >= this.deathEndsAt) {
      this._endMatch();
      return;
    }

    const elapsed = performance.now() - now;
    const wait = Math.max(0, this.frameMs - elapsed);
    setTimeout(() => this.tick(loopId), wait);
  }
}
