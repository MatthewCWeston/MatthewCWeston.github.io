import {
  WRAP_BOUND, NUM_MISSILES, DEFAULT_MAX_TIME, PLAYER_SIZE,
} from './constants.js';
import { encodeRepeated } from './math.js';
import { Ship } from './ship.js';
import { Missile } from './missile.js';

class RNG {
  uniform() { return Math.random(); }
}

export class SpaceWarEnv {
  constructor() {
    this.maxTime  = DEFAULT_MAX_TIME;
    this.speed    = 1;            // env.self_speed; always 1 (frame-skip lives in Game)
    this.rng      = new RNG();
    this.reset();
  }

  reset() {
    this.missiles    = [[], []];
    this.time        = 0;
    this.terminated  = false;
    this.rewards     = { 0: 0, 1: 0 };
    // Spawn convention (corrected from the Python source):
    //   P0 (cyan)   at upper-right, facing DOWN  (lower-left in math coords)
    //   P1 (orange) at lower-left,  facing UP    (upper-right in math coords)
    // In screen-space: lower-left ship points up, upper-right ship points down.
    this.playerShips = [
      new Ship([ 0.5 * WRAP_BOUND, -0.5 * WRAP_BOUND], 270),
      new Ship([-0.5 * WRAP_BOUND,  0.5 * WRAP_BOUND],  90),
    ];
  }

  /** Single physics tick. */
  update(actions) {
    this.time += this.speed;
    for (let i = 0; i < 2; i++) {
      const ship = this.playerShips[i];
      ship.update(actions[i], this.missiles[i], this.speed, this.rng);
      if (Math.hypot(ship.pos[0], ship.pos[1]) < PLAYER_SIZE) {
        this.terminated = true;
        this.rewards[i]           = -1;
        this.rewards[(i + 1) % 2] =  1;
      }
    }
    for (let m = 0; m < this.missiles.length; m++) {
      const list = this.missiles[m];
      for (let i = list.length - 1; i >= 0; i--) {
        const [si, dead] = list[i].update(this.playerShips, this.speed);
        if (dead) list.splice(i, 1);
        if (si !== -1) {
          this.terminated = true;
          this.rewards[si]           = -1;
          this.rewards[(si + 1) % 2] =  1;
        }
      }
    }
  }

  /** Per-player ONNX feed dict. */
  getFeeds(playerIdx, ort) {
    const ego = this.playerShips[playerIdx];
    const opp = this.playerShips[(playerIdx + 1) % 2];
    const friendly = this.missiles[playerIdx]      .map(mm => mm.getObs(ego));
    const hostile  = this.missiles[(playerIdx + 1) % 2].map(mm => mm.getObs(ego));
    const childDim = Missile.REPR_SIZE + Missile.AUG_DIM;
    const fEnc = encodeRepeated(friendly, NUM_MISSILES, childDim);
    const hEnc = encodeRepeated(hostile,  NUM_MISSILES, childDim);
    return {
      self:              new ort.Tensor('float32', ego.getObs(ego, true),  [1, 16]),
      opponent:          new ort.Tensor('float32', opp.getObs(ego, false), [1, 22]),
      missiles_friendly: new ort.Tensor('float32', fEnc, [1, fEnc.length]),
      missiles_hostile:  new ort.Tensor('float32', hEnc, [1, hEnc.length]),
    };
  }
}
