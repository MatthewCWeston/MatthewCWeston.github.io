import {
  WRAP_BOUND, NUM_MISSILES, DEFAULT_MAX_TIME, PLAYER_SIZE, STAR_SIZE,
  GRAV_CONST,
} from './constants.js';
import { encodeRepeated } from './math.js';
import { Ship } from './ship.js';
import { Missile } from './missile.js';

class RNG {
  uniform() { return Math.random(); }
}

const FRAG_LIFE        = 80;        // physics ticks
const FRAG_KICK_MIN    = 0.0014;
const FRAG_KICK_MAX    = 0.0040;
const FRAG_ANGVEL      = 28;        // ± degrees per tick
const FRAG_MISSILE_BIAS = 0.45;     // share of the killing missile's velocity

// Geometric breakdown of the ship body — the same arrowhead the renderer
// draws, cut into 6 pieces by three lines:
//   • y = 0          (main axis → top / bottom halves)
//   • x = 0.0625     (mid-front line → tip / mid)
//   • x = -0.375     (back-vertex line → mid / back)
// The six polygons tile the original shape exactly, so at t = 0 the fragments
// sit on top of each other in the same configuration as the intact ship and
// then separate.  Vertices are in body-local coords as fractions of psz; one
// psz corresponds to (ship.size * dim * scale) screen px, equivalently
// (2 * ship.size) world units since dim = 2 * hdim.
const SHATTER_PIECES = (() => {
  const raw = [
    // top-tip:    nose, mid-front (top), mid-front (axis)
    [[ 0.5,    0    ], [ 0.0625,  0.125], [ 0.0625, 0    ]],
    // top-mid:    mid-front (top), back-right, back-axis, mid-front (axis)
    [[ 0.0625, 0.125], [-0.375,   0.25 ], [-0.375,  0    ], [ 0.0625, 0    ]],
    // top-back:   back-axis, back-right, tail
    [[-0.375,  0    ], [-0.375,   0.25 ], [-0.5,    0    ]],
    // bottom-tip: nose, mid-front (axis), mid-front (bottom)
    [[ 0.5,    0    ], [ 0.0625,  0    ], [ 0.0625,-0.125]],
    // bottom-mid: mid-front (axis), back-axis, back-left, mid-front (bottom)
    [[ 0.0625, 0    ], [-0.375,   0    ], [-0.375, -0.25 ], [ 0.0625,-0.125]],
    // bottom-back: back-axis, tail, back-left
    [[-0.375,  0    ], [-0.5,     0    ], [-0.375, -0.25 ]],
  ];
  return raw.map(verts => {
    let cx = 0, cy = 0;
    for (const [x, y] of verts) { cx += x; cy += y; }
    cx /= verts.length; cy /= verts.length;
    return {
      centroid:   [cx, cy],
      // Vertices stored relative to the piece's own centroid, so each
      // fragment rotates around its center of mass.
      localVerts: verts.map(([x, y]) => [x - cx, y - cy]),
    };
  });
})();

/** Debris shard from a shattered ship — flies outward, falls under gravity. */
class Fragment {
  constructor(pos, vel, ang, angVel, playerIdx, localVerts, life) {
    this.pos        = [pos[0], pos[1]];
    this.vel        = [vel[0], vel[1]];
    this.ang        = ang;
    this.angVel     = angVel;
    this.playerIdx  = playerIdx;
    this.localVerts = localVerts;          // body-local vertices, world units
    this.life       = life;
    this.maxLife    = life;
  }
  update(speed) {
    this.pos[0] += this.vel[0] * speed;
    this.pos[1] += this.vel[1] * speed;
    // 1/r² pull toward the star, but with r² floored at STAR_SIZE² so
    // fragments spawned near the origin (e.g. warp-failure explosions) feel
    // a finite force instead of being yanked away at huge velocity.
    const rSq = Math.max(
      this.pos[0] * this.pos[0] + this.pos[1] * this.pos[1],
      STAR_SIZE * STAR_SIZE,
    );
    const r3 = rSq * Math.sqrt(rSq);
    const f  = GRAV_CONST * speed / r3;
    this.vel[0] -= this.pos[0] * f;
    this.vel[1] -= this.pos[1] * f;
    this.ang  += this.angVel * speed;
    this.life -= speed;
  }
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
    this.impacts     = [];     // transient {pos, at} entries the renderer draws
    this.fragments   = [];     // shards from shattered ships (Fragment instances)
    // Spawn convention:
    //   P0 (orange) at lower-left,  facing UP   (upper-right in math coords)
    //   P1 (cyan)   at upper-right, facing DOWN (lower-left in math coords)
    this.playerShips = [
      new Ship([-0.5 * WRAP_BOUND,  0.5 * WRAP_BOUND],  90),
      new Ship([ 0.5 * WRAP_BOUND, -0.5 * WRAP_BOUND], 270),
    ];
  }

  /** Single physics tick. */
  update(actions) {
    this.time += this.speed;
    for (let i = 0; i < 2; i++) {
      const ship = this.playerShips[i];
      if (ship.dead) continue;                       // physics frozen for the dead
      ship.update(actions[i], this.missiles[i], this.speed, this.rng);
      if (Math.hypot(ship.pos[0], ship.pos[1]) < PLAYER_SIZE) {
        ship.dead = true;
        // Pick where the ship visually explodes.  For a warp failure the
        // ship was teleported to the star to trigger this proximity check,
        // but the explosion belongs back at warp_from — where the ship
        // actually was when the warp went wrong, and where the Minskytron
        // atom is playing.  Normal star collisions explode at ship.pos.
        const exPos = (ship.warp_failed && ship.warp_from)
          ? [ship.warp_from[0], ship.warp_from[1]]
          : [ship.pos[0],       ship.pos[1]];
        this.impacts.push({ pos: exPos, at: Date.now(), scale: 1.8 });
        this._spawnFragments(ship, i, null, exPos);
        if (!this.terminated) {
          this.terminated = true;
          this.rewards[i]           = -1;
          this.rewards[(i + 1) % 2] =  1;
        }
      }
    }
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.update(this.speed);
      // No star-proximity cull — warp-failure shards start inside the star
      // and we want them to fly out, not vanish the tick they spawn.
      if (f.life <= 0 || Math.hypot(f.pos[0], f.pos[1]) > 2 * WRAP_BOUND) {
        this.fragments.splice(i, 1);
      }
    }
    for (let m = 0; m < this.missiles.length; m++) {
      const list = this.missiles[m];
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i].update(this.playerShips, this.speed);
        if (r.hitShip !== -1) {
          const target = this.playerShips[r.hitShip];
          if (!target.dead) {
            target.dead = true;
            this.impacts.push({ pos: [target.pos[0], target.pos[1]], at: Date.now(), scale: 1.8 });
            this._spawnFragments(target, r.hitShip, list[i].vel);
            if (!this.terminated) {
              this.terminated = true;
              this.rewards[r.hitShip]           = -1;
              this.rewards[(r.hitShip + 1) % 2] =  1;
            }
          }
          list.splice(i, 1);
        } else if (r.hitStar || r.expired) {
          // Missile vanishes silently — no impact ring at the star, since
          // that just looks like a stray flash on the central body.
          list.splice(i, 1);
        }
      }
    }
  }

  /**
   * Shatter the ship along the geometric piece decomposition.  Each piece
   * keeps its original shape relative to the ship's frame, gets propelled
   * outward from the ship's center along its own centroid direction, and
   * optionally picks up a fraction of the killing missile's velocity so the
   * shrapnel carries through in the direction of the hit.
   */
  _spawnFragments(ship, idx, missileVel = null, atPos = null) {
    const aRad = ship.ang * Math.PI / 180;
    const ca   = Math.cos(aRad);
    const sa   = Math.sin(aRad);
    // Body-local → world rotation, matching the renderer's "rot(x, y)" helper.
    const rotate = (x, y) => [x * ca + y * sa, -x * sa + y * ca];
    // psz = ship.size * dim * scale screen px == (2 * ship.size) world units,
    // so body-local fractions convert to world by multiplying by 2 * ship.size.
    const BS = ship.size * 2;
    // Where the explosion is anchored.  Defaults to the ship's current
    // position (a normal kill), but warp failures override it with warp_from.
    const center = atPos || ship.pos;

    for (const piece of SHATTER_PIECES) {
      const [bcx, bcy]       = piece.centroid;                    // body-local
      const [wcx, wcy]       = rotate(bcx * BS, bcy * BS);         // world offset
      const pos              = [center[0] + wcx, center[1] + wcy];

      // Outward kick — from ship center to piece centroid, normalized.  If a
      // piece happens to sit at the ship origin, fall back to a random
      // direction so it still moves.
      const len = Math.hypot(wcx, wcy);
      let dx, dy;
      if (len > 1e-9) { dx = wcx / len; dy = wcy / len; }
      else {
        const t = this.rng.uniform() * Math.PI * 2;
        dx = Math.cos(t); dy = Math.sin(t);
      }
      const kick = FRAG_KICK_MIN + this.rng.uniform() * (FRAG_KICK_MAX - FRAG_KICK_MIN);
      const vel  = [ ship.vel[0] + dx * kick, ship.vel[1] + dy * kick ];
      if (missileVel) {
        vel[0] += missileVel[0] * FRAG_MISSILE_BIAS;
        vel[1] += missileVel[1] * FRAG_MISSILE_BIAS;
      }

      // Vertices in world units, still in body-local frame (rotation is
      // applied at render time via fragment.ang).
      const localVerts = piece.localVerts.map(([x, y]) => [x * BS, y * BS]);

      this.fragments.push(new Fragment(
        pos,
        vel,
        ship.ang,                                  // start matching the ship
        (this.rng.uniform() * 2 - 1) * FRAG_ANGVEL,
        idx,
        localVerts,
        FRAG_LIFE * (0.75 + this.rng.uniform() * 0.5),
      ));
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
