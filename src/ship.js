import {
  WRAP_BOUND, NUM_MISSILES, MISSILE_VEL, MISSILE_RELOAD_TIME,
  SHIP_FUEL, SHIP_TURN_RATE, SHIP_ACC, GRAV_CONST, PLAYER_SIZE,
  HYPERSPACE_CHARGES, HYPERSPACE_RECHARGE, HYPERSPACE_REENTRY,
  S_HSPACE_MAXSPEED,
} from './constants.js';
import { wrap, rotatePt, egoPt, getRaycasts, dot, norm, clip01 } from './math.js';
import { Missile } from './missile.js';

export class Ship {
  static REPR_SIZE     = 11;
  static ALL_AUG_DIM   = 5;
  static OTHER_AUG_DIM = Ship.ALL_AUG_DIM + 6;     // 11 total aug for opponent obs

  constructor(pos, ang, vel = null) {
    this.pos = [pos[0], pos[1]];
    this.ang = ang;
    this.vel = vel ? [vel[0], vel[1]] : [0, 0];
    this.size = PLAYER_SIZE;
    this.stored_missiles = NUM_MISSILES;
    this.fuel = SHIP_FUEL;
    this.reloadTime = 0;
    this.last_act = [0, 0, 0, 0];
    this.h_charges = HYPERSPACE_CHARGES;
    this.h_reload = 0;
    this.angUV = [0, 0];
    this.updateAngUV();
    // Warp-flash bookkeeping (UI-only, ignored by physics/obs).
    this.warp_from     = null;
    this.warp_to       = null;
    this.warp_flash_at = 0;
    this.warp_failed   = false;
    // True once this ship has been destroyed.  Physics is skipped for dead
    // ships so the remaining alive ship can keep playing during the
    // post-termination grace window.
    this.dead          = false;
  }

  updateAngUV() {
    const r = this.ang * Math.PI / 180;
    this.angUV = [Math.cos(r), -Math.sin(r)];
  }

  /**
   * Faithful port of Ship.update with stochastic_hspace=True (only mode used).
   * Order: hyperspace handling → thrust → turn → shoot → hspace entry →
   *        position update → vel clip → wrap → gravity.
   */
  update(action, missiles, speed, rng) {
    if (this.h_reload > 0) {
      const before = this.h_reload;
      this.h_reload = Math.max(this.h_reload - speed, 0);
      if (this.h_reload <= HYPERSPACE_RECHARGE - HYPERSPACE_REENTRY) {
        if (before > HYPERSPACE_RECHARGE - HYPERSPACE_REENTRY) {
          // Crossed the re-entry threshold this tick — stochastic exit.
          if (rng.uniform() > this.h_charges / HYPERSPACE_CHARGES) {
            // Catastrophic failure: dropped at the star.  No warp_to /
            // warp_flash_at write — the warp-flash render path skips
            // warp-failed ships, and the atom/explosion at warp_from is the
            // entire visual.
            this.pos = [0, 0];
            this.vel = [0, 0];
            this.warp_failed = true;
            return;
          }
          this.pos = [rng.uniform() * WRAP_BOUND, rng.uniform() * WRAP_BOUND];
          const velAng = rng.uniform() * 2 * Math.PI;
          const speedMag = rng.uniform() * S_HSPACE_MAXSPEED;
          this.vel = [Math.cos(velAng) * speedMag, -Math.sin(velAng) * speedMag];
          this.ang = rng.uniform() * 360;
          this.updateAngUV();
          this.warp_to       = [this.pos[0], this.pos[1]];
          this.warp_flash_at = Date.now();
        }
      } else {
        return;       // still in hyperspace; skip the rest of the update
      }
    }

    this.last_act = action;

    // Thrust
    if (action[0] === 1 && this.fuel > 0) {
      this.vel[0] += SHIP_ACC * this.angUV[0] * speed;
      this.vel[1] += SHIP_ACC * this.angUV[1] * speed;
      this.fuel = Math.max(this.fuel - speed, 0);
    }
    // Turn
    if (action[1] === 1) {
      this.ang += SHIP_TURN_RATE * speed;
      this.updateAngUV();
    } else if (action[1] === 2) {
      this.ang -= SHIP_TURN_RATE * speed;
      this.updateAngUV();
    }
    // Shoot
    if (action[2] === 1 && this.stored_missiles > 0 && this.reloadTime <= 0) {
      const mp = [this.pos[0] + this.angUV[0] * this.size,
                  this.pos[1] + this.angUV[1] * this.size];
      const mv = [this.vel[0] + this.angUV[0] * MISSILE_VEL,
                  this.vel[1] + this.angUV[1] * MISSILE_VEL];
      missiles.push(new Missile(mp, mv));
      this.stored_missiles -= 1;
      this.reloadTime = MISSILE_RELOAD_TIME;
    } else {
      this.reloadTime = Math.max(this.reloadTime - speed, 0);
    }
    // Hyperspace entry
    if (this.h_charges > 0 && this.h_reload === 0 && action[3] === 1) {
      this.h_reload = HYPERSPACE_RECHARGE;
      this.h_charges -= 1;
      this.warp_from = [this.pos[0], this.pos[1]];
    }
    // Position update
    this.pos[0] += this.vel[0] * speed;
    this.pos[1] += this.vel[1] * speed;
    this.vel[0] = clip01(this.vel[0]);
    this.vel[1] = clip01(this.vel[1]);
    wrap(this.pos);
    // Gravity (1/r²)
    const r2 = this.pos[0] * this.pos[0] + this.pos[1] * this.pos[1];
    const r3 = r2 * Math.sqrt(r2);
    if (r3 > 0) {
      const f = GRAV_CONST * speed / r3;
      this.vel[0] -= this.pos[0] * f;
      this.vel[1] -= this.pos[1] * f;
    }
  }

  /**
   * Egocentric augmented obs.  asSelf=true → 16-dim (this is the ego),
   * asSelf=false → 22-dim (this is the opponent of the ego).
   */
  getObs(ego, asSelf) {
    let p, auv;
    if (asSelf) {
      p = rotatePt([-this.pos[0], -this.pos[1]], -ego.ang);
      auv = getRaycasts(this.pos, this.ang);
    } else {
      p = egoPt(this.pos, ego);
      const angToObs = Math.atan2(p[0], p[1]) * 180 / Math.PI;
      auv = rotatePt(this.angUV, -angToObs);
    }
    const v = rotatePt(this.vel, -ego.ang);

    const len = asSelf
      ? Ship.REPR_SIZE + Ship.ALL_AUG_DIM
      : Ship.REPR_SIZE + Ship.OTHER_AUG_DIM;
    const obs = new Float32Array(len);

    // Base: [p, v, auv, ammo, reloadTime, fuel, h_charges, h_reload]
    obs[0]  = p[0];   obs[1]  = p[1];
    obs[2]  = v[0];   obs[3]  = v[1];
    obs[4]  = auv[0]; obs[5]  = auv[1];
    obs[6]  = this.stored_missiles / NUM_MISSILES;
    obs[7]  = this.reloadTime / MISSILE_RELOAD_TIME;
    obs[8]  = this.fuel / SHIP_FUEL;
    obs[9]  = this.h_charges / HYPERSPACE_CHARGES;
    obs[10] = this.h_reload / HYPERSPACE_RECHARGE;

    // Aug for both: [rad_vel, tan_vel, speed, star_dist, in_hspace]
    const starDist = Math.hypot(this.pos[0], this.pos[1]);
    const safeDS = Math.max(starDist, 1e-6);
    const starAUV = [-this.pos[0] / safeDS, -this.pos[1] / safeDS];
    const radVel  = dot(starAUV, this.vel);
    const tanVel  = dot([starAUV[1], -starAUV[0]], this.vel);
    const speedMag = norm(this.vel);
    const inHspace = this.h_reload > HYPERSPACE_RECHARGE - HYPERSPACE_REENTRY ? 1 : 0;
    obs[11] = radVel;   obs[12] = tanVel;   obs[13] = speedMag;
    obs[14] = starDist; obs[15] = inHspace;

    if (!asSelf) {
      // Opponent-only extra aug: star_coords (2), opp_bearing (2), dist, closing_speed
      const starCoords = rotatePt([-this.pos[0], -this.pos[1]], -ego.ang);
      const dist = norm(p);
      const safeD = Math.max(dist, 1e-9);
      const oppBearing = dist === 0 ? [p[0], p[1]] : [p[0] / safeD, p[1] / safeD];
      const egoVelEgo = rotatePt(ego.vel, -ego.ang);
      const closing = (oppBearing[0] * (v[0] - egoVelEgo[0]) +
                       oppBearing[1] * (v[1] - egoVelEgo[1])) / 2;
      obs[16] = starCoords[0]; obs[17] = starCoords[1];
      obs[18] = oppBearing[0]; obs[19] = oppBearing[1];
      obs[20] = dist;          obs[21] = closing;
    }

    // Match `obs.clip(-1, 1)` from the Python.
    for (let k = 0; k < obs.length; k++) {
      if (obs[k] >  1) obs[k] = 1;
      else if (obs[k] < -1) obs[k] = -1;
    }
    return obs;
  }
}
