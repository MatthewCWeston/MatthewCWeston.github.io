import {
  MISSILE_LIFE, STAR_SIZE, HYPERSPACE_RECHARGE, HYPERSPACE_REENTRY,
} from './constants.js';
import { wrap, rotatePt, egoPt, norm } from './math.js';

export class Missile {
  static REPR_SIZE = 5;
  static AUG_DIM   = 4;          // total per-missile obs is REPR + AUG = 9
  // Per-missile trail ring buffer (flat x,y,x,y,…), matching the Minskytron
  // particle trail style — the renderer walks it as connected segments.
  static TRAIL_MAX = 50;

  constructor(pos, vel) {
    this.pos = [pos[0], pos[1]];
    this.vel = [vel[0], vel[1]];
    this.life = MISSILE_LIFE;
    this.maxLife = MISSILE_LIFE;
    this.trail = [];
  }

  /**
   * Returns { hitShip, hitStar, expired } — hitShip is -1 if no ship was
   * struck.  Caller treats any of (hitShip !== -1 / hitStar / expired) as
   * cause to splice this missile out of the list.
   */
  update(ships, speed) {
    this.pos[0] += this.vel[0] * speed;
    this.pos[1] += this.vel[1] * speed;

    for (let si = 0; si < ships.length; si++) {
      const s = ships[si];
      // Dead ships are inert; hyperspace ships are intangible.
      if (s.dead || s.h_reload > HYPERSPACE_RECHARGE - HYPERSPACE_REENTRY) continue;
      const dx = this.pos[0] - s.pos[0];
      const dy = this.pos[1] - s.pos[1];
      if (Math.hypot(dx, dy) < s.size) return { hitShip: si, hitStar: false, expired: false };
    }
    if (Math.hypot(this.pos[0], this.pos[1]) < STAR_SIZE) {
      return { hitShip: -1, hitStar: true, expired: false };
    }

    wrap(this.pos);
    this.life -= 1 * speed;
    // Record post-wrap position into the trail.  Trimmed FIFO.
    this.trail.push(this.pos[0], this.pos[1]);
    if (this.trail.length > Missile.TRAIL_MAX * 2) this.trail.splice(0, 2);
    return { hitShip: -1, hitStar: false, expired: this.life <= 0 };
  }

  /** Egocentric, augmented obs (the only mode used in the deployed env). */
  getObs(ego) {
    const p = egoPt(this.pos, ego);
    const v = rotatePt(this.vel, -ego.ang);
    const obs = new Float32Array(Missile.REPR_SIZE + Missile.AUG_DIM);
    obs[0] = p[0]; obs[1] = p[1]; obs[2] = v[0]; obs[3] = v[1];
    obs[4] = this.life / this.maxLife;

    const dist = norm(p);
    const safeD = Math.max(dist, 1e-9);
    const egoVelEgo = rotatePt(ego.vel, -ego.ang);
    const closingSpeed =
      ((p[0] / safeD) * (v[0] - egoVelEgo[0]) +
       (p[1] / safeD) * (v[1] - egoVelEgo[1])) / 2;

    const angToObs = Math.atan2(p[0], p[1]) * 180 / Math.PI;
    const vMag = Math.max(norm(v), 1e-9);
    const bearing = rotatePt([v[0] / vMag, v[1] / vMag], -angToObs);

    obs[5] = bearing[0]; obs[6] = bearing[1];
    obs[7] = dist;       obs[8] = closingSpeed;
    return obs;
  }
}
