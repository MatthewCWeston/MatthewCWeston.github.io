import {
  WRAP_BOUND, STAR_SIZE, HYPERSPACE_RECHARGE, HYPERSPACE_REENTRY,
  RENDER_DIM, VIEW_SCALE,
} from './constants.js';

const COLOR_P1     = '#ff8a3d';
const COLOR_P2     = '#4ad8ff';
const COLOR_P1_HI  = '#ffd9b0';
const COLOR_P2_HI  = '#d8f6ff';
const RGB_P1       = [255, 138,  61];
const RGB_P2       = [ 74, 216, 255];
const COLOR_WIN    = '#50ff80';
const COLOR_LOSE   = '#ff4040';
const COLOR_DRAW   = '#ffe040';
const COLOR_HSPACE = 'rgba(180, 80, 200, ALPHA)';
const WARP_FLASH_MS = 260;

// Minskytron — three coupled oscillators (the PDP-1 hyperspace patch, see
// https://www.masswerk.at/spacewar/sources/hyperspace85.txt):
//   y_i += (x_i + x_{i+1}) >> s_yi
//   x_i -= (y_i - y_{i+1}) >> s_xi
// Coupling via (x_i + x_{i+1}) sums is what produces the precessing rosette
// the original is famous for — three independent rotators give nested circles
// instead.  On a PDP-1 the integer ">>" truncation provided the damping that
// kept everything bounded; in double-precision floats the sum coupling pumps
// energy and the particles careen off.  We restore boundedness by
// renormalizing the sum of squared radii to 3·R0² after every iteration,
// which mimics the original's amplitude bound without altering the qualitative
// coupled dynamics.  Original shifts were [5, 5, 8, 4, 1, 6]; the 1 (factor
// 0.5) is too aggressive for floats so the s4 entry is capped here.
const ATOM_F        = [1/16, 1/16, 1/64, 1/16, 1/8, 1/64];  // y0,x0,y1,x1,y2,x2
const ATOM_R0       = 0.085;
const ATOM_ITERS    = 5;
const ATOM_TRAIL    = 110;       // per-particle ring-buffer trail length

/** Renders the game world into the canvas.  HUD is HTML; this only draws sim. */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = canvas.height = RENDER_DIM;
    this.ctx    = canvas.getContext('2d');
    this.dim    = canvas.width;
    this.hdim   = this.dim / 2;
    this.scale  = VIEW_SCALE;
    this.ssz    = STAR_SIZE * this.dim * this.scale;
    this.msz    = 3;
    // Physics ticks per render frame.  Used as the missile-burst threshold so
    // every expiring missile gets at least one frame in the enlarged "burst"
    // sprite before it's removed mid-batch.
    this.frameTickSpeed = 1;
    // Per-ship Minskytron atom state, lazily seeded the first frame a ship
    // is observed in warp_failed state.  Null until then; cleared by reset().
    this.atoms = [null, null];
  }

  /** Clears transient visual state between matches. */
  reset() {
    this.atoms = [null, null];
  }

  /** World pos in [-WRAP_BOUND, WRAP_BOUND] → canvas pixel coords. */
  toScreen(p) {
    return [
      (p[0] * this.scale + 1) * this.hdim,
      (p[1] * this.scale + 1) * this.hdim,
    ];
  }

  // ---------- primitive helpers ----------
  drawLine(x1, y1, x2, y2, color, w = 1) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth   = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  drawCircle(cx, cy, r, opts = {}) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2);
    if (opts.fill)   { ctx.fillStyle   = opts.fill;   ctx.fill(); }
    if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = opts.width || 1; ctx.stroke(); }
  }
  drawPoly(pts, fill) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // ---------- main render ----------
  render(env) {
    const ctx = this.ctx;
    const { dim, hdim, ssz } = this;

    // Phosphor burn-in: dim the previous frame instead of clearing outright.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(0, 0, dim, dim);

    // Central star — flickery cross with a warm phosphor glow.
    ctx.save();
    ctx.shadowColor = '#ffcc66';
    ctx.shadowBlur  = 10;
    for (let i = 0; i < 2; i++) {
      const sx = (Math.random() * 2 - 1) * ssz / 2;
      const sy = (Math.random() * 2 - 1) * ssz / 2;
      this.drawLine(hdim + sx, hdim + sy, hdim - sx, hdim - sy, '#fff5d0', 1.2);
    }
    ctx.restore();

    // Warp flashes — a thick, layered white bolt with starburst endpoints,
    // fading over WARP_FLASH_MS.  Drawn before ships so the destination ship
    // sits on top of its own arrival point.  Skipped on warp failure, where
    // the Minskytron atom takes over instead.
    const now = Date.now();
    for (let i = 0; i < 2; i++) {
      const sh = env.playerShips[i];
      if (sh.warp_failed || !sh.warp_from || !sh.warp_to) continue;
      const elapsed = now - sh.warp_flash_at;
      if (elapsed < 0 || elapsed >= WARP_FLASH_MS) continue;
      this._renderWarpFlash(sh.warp_from, sh.warp_to, 1 - elapsed / WARP_FLASH_MS);
    }

    // Minskytron atoms — replace the ship body for catastrophic warp
    // failures.  Centered on warp_from (the ship's pre-warp position), not
    // the star.
    for (let i = 0; i < 2; i++) {
      const sh = env.playerShips[i];
      if (!sh.warp_failed) { this.atoms[i] = null; continue; }
      if (!this.atoms[i]) this.atoms[i] = this._seedAtom(sh.warp_from);
      this._stepAndDrawAtom(this.atoms[i]);
    }

    // Ships
    for (let i = 0; i < 2; i++) {
      this._renderShip(env.playerShips[i], i, env.terminated, env.rewards[i]);
    }
    // Fragments — drawn before missiles so projectiles fly over debris.
    if (env.fragments && env.fragments.length) this._renderFragments(env.fragments);

    // Missiles — colored to match the firing ship.
    for (const m of env.missiles[0]) this._renderMissile(m, this.frameTickSpeed, COLOR_P1, COLOR_P1_HI, RGB_P1);
    for (const m of env.missiles[1]) this._renderMissile(m, this.frameTickSpeed, COLOR_P2, COLOR_P2_HI, RGB_P2);

    // Impact flashes — expanding fading white rings at missile-ship and
    // ship-star kills.  Drawn last so they sit on top of everything else.
    if (env.impacts && env.impacts.length) this._renderImpacts(env.impacts);
  }

  _renderFragments(fragments) {
    const ctx        = this.ctx;
    const worldToPx  = this.scale * this.hdim;     // world units → canvas px
    ctx.save();
    for (const f of fragments) {
      const [px, py] = this.toScreen(f.pos);
      const t        = f.life / f.maxLife;          // 1 → 0
      const accent   = f.playerIdx === 0 ? COLOR_P1 : COLOR_P2;
      const a        = f.ang * Math.PI / 180;
      const ca       = Math.cos(a), sa = Math.sin(a);
      // Same world→screen rotation as the renderer's ship "rot" helper.
      const pts = f.localVerts.map(([x, y]) => [
        px + ( x * ca + y * sa) * worldToPx,
        py + (-x * sa + y * ca) * worldToPx,
      ]);
      ctx.globalAlpha = Math.pow(t, 0.65);
      ctx.shadowColor = accent;
      ctx.shadowBlur  = 7;
      this.drawPoly(pts, accent);
    }
    ctx.restore();
  }

  _renderImpacts(impacts) {
    const ctx = this.ctx;
    const now = Date.now();
    const DUR = 420;
    ctx.save();
    ctx.shadowColor = '#ffffff';
    for (let i = impacts.length - 1; i >= 0; i--) {
      const imp = impacts[i];
      const elapsed = now - imp.at;
      if (elapsed >= DUR) { impacts.splice(i, 1); continue; }
      const t  = elapsed / DUR;
      const sc = imp.scale || 1;
      const [px, py] = this.toScreen(imp.pos);
      // Expanding ring — visible the whole duration, alpha falls off.
      ctx.globalAlpha = (1 - t) ** 1.3;
      ctx.shadowBlur  = 16;
      this.drawCircle(px, py, (6 + t * 32) * sc, { stroke: '#ffffff', width: 2 });
      // Bright inner flash for the first quarter — gives the punch on hit.
      if (t < 0.25) {
        const ti = 1 - t / 0.25;
        ctx.globalAlpha = ti;
        ctx.shadowBlur  = 20;
        this.drawCircle(px, py, (3 + t * 10) * sc, { fill: '#ffffff' });
      }
    }
    ctx.restore();
  }

  _renderMissile(m, burstThreshold, color, coreColor, rgb) {
    const ctx = this.ctx;
    // Minskytron-style trail — walk the missile's own ring buffer, drawing
    // connected segments with alpha rising toward the head.  Segments that
    // span a world wrap (a big jump from one edge to the other) are skipped
    // so the trail doesn't draw a stripe across the screen.
    const trail = m.trail;
    const n = trail.length >> 1;
    if (n >= 2) {
      ctx.save();
      ctx.lineCap   = 'round';
      ctx.lineWidth = 1.3;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 3;
      for (let j = 1; j < n; j++) {
        const x0 = trail[(j - 1) * 2];
        const y0 = trail[(j - 1) * 2 + 1];
        const x1 = trail[ j      * 2];
        const y1 = trail[ j      * 2 + 1];
        if (Math.abs(x1 - x0) > 0.5 || Math.abs(y1 - y0) > 0.5) continue;
        const t = j / n;
        ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(t * t) * 0.85})`;
        const [sx, sy] = this.toScreen([x0, y0]);
        const [ex, ey] = this.toScreen([x1, y1]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Missile head — colored ring with brighter inner core, 4× burst on the
    // last frame before timeout.
    const [mx, my] = this.toScreen(m.pos);
    const sz = m.life > burstThreshold ? this.msz : this.msz * 4;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = 6;
    this.drawCircle(mx, my, sz / 2, { fill: color });
    ctx.restore();
    this.drawCircle(mx, my, Math.max(0.5, sz / 4), { fill: coreColor });
  }

  _renderWarpFlash(from, to, t) {
    const [fx, fy] = this.toScreen(from);
    const [tx, ty] = this.toScreen(to);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.lineCap = 'round';
    // Wide, soft halo so the bolt reads even at a glance.
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur  = 30;
    this.drawLine(fx, fy, tx, ty, 'rgba(255, 255, 255, 0.35)', 10);
    // Mid white body.
    ctx.shadowBlur  = 16;
    this.drawLine(fx, fy, tx, ty, '#ffffff', 4.5);
    // Brilliant pin-thin core.
    ctx.shadowBlur  = 4;
    this.drawLine(fx, fy, tx, ty, '#ffffff', 1.25);
    // Endpoint starbursts — disc + 4-pointed cross.
    const burst = (cx, cy, r) => {
      ctx.shadowBlur = 22;
      this.drawCircle(cx, cy, r,        { fill: '#ffffff' });
      this.drawCircle(cx, cy, r * 1.9,  { fill: 'rgba(255, 255, 255, 0.35)' });
      ctx.shadowBlur = 14;
      const spike = r * 3.6;
      this.drawLine(cx - spike, cy, cx + spike, cy, '#ffffff', 1.5);
      this.drawLine(cx, cy - spike, cx, cy + spike, '#ffffff', 1.5);
    };
    burst(fx, fy, 2.4);
    burst(tx, ty, 3.2 + 1.6 * t);   // destination pops a touch brighter
    ctx.restore();
  }

  _seedAtom(center) {
    const r = ATOM_R0;
    // 120° apart so the (x_i + x_{i+1}) sum terms are immediately non-zero
    // and the coupling kicks in from iteration 1.
    const s = r * 0.866;        // sin(60°)
    return {
      center: [center[0], center[1]],
      x: [ r,  -r * 0.5,  -r * 0.5 ],
      y: [ 0,   s,         -s      ],
      trails: [[], [], []],
    };
  }

  _stepAndDrawAtom(atom) {
    const ctx = this.ctx;
    const [cx, cy] = atom.center;
    const [f0, f1, f2, f3, f4, f5] = ATOM_F;
    const targetR2 = 3 * ATOM_R0 * ATOM_R0;

    for (let k = 0; k < ATOM_ITERS; k++) {
      // Three coupled oscillators — sum on the y updates, difference on the
      // x updates, matching the PDP-1 "marvin" macro.
      atom.y[0] += (atom.x[0] + atom.x[1]) * f0;
      atom.x[0] -= (atom.y[0] - atom.y[1]) * f1;
      atom.y[1] += (atom.x[1] + atom.x[2]) * f2;
      atom.x[1] -= (atom.y[1] - atom.y[2]) * f3;
      atom.y[2] += (atom.x[2] + atom.x[0]) * f4;
      atom.x[2] -= (atom.y[2] - atom.y[0]) * f5;

      // Energy clamp — rescale so the system's total |r|² stays at 3·R0².
      // Allows energy to flow between the three particles (one orbit can
      // grow while another shrinks) but stops the whole system from
      // blowing up the way it does in unconstrained float arithmetic.
      let sumR2 = 0;
      for (let i = 0; i < 3; i++) {
        sumR2 += atom.x[i] * atom.x[i] + atom.y[i] * atom.y[i];
      }
      if (sumR2 > 1e-12) {
        const scale = Math.sqrt(targetR2 / sumR2);
        for (let i = 0; i < 3; i++) {
          atom.x[i] *= scale;
          atom.y[i] *= scale;
        }
      }

      for (let i = 0; i < 3; i++) {
        atom.trails[i].push(atom.x[i], atom.y[i]);
        if (atom.trails[i].length > ATOM_TRAIL * 2) atom.trails[i].splice(0, 2);
      }
    }

    // Render trails as connected segments with alpha rising toward the head.
    ctx.save();
    ctx.lineCap     = 'round';
    ctx.lineWidth   = 1.3;
    ctx.shadowColor = '#fff5d0';
    ctx.shadowBlur  = 4;
    for (let i = 0; i < 3; i++) {
      const trail = atom.trails[i];
      const n = trail.length >> 1;
      if (n < 2) continue;
      for (let j = 1; j < n; j++) {
        const t = j / n;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(t * t) * 0.9})`;
        const [x1, y1] = this.toScreen([cx + trail[(j - 1) * 2], cy + trail[(j - 1) * 2 + 1]]);
        const [x2, y2] = this.toScreen([cx + trail[ j      * 2], cy + trail[ j      * 2 + 1]]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      // Bright leading dot.
      ctx.shadowBlur = 12;
      const [hx, hy] = this.toScreen([cx + trail[(n - 1) * 2], cy + trail[(n - 1) * 2 + 1]]);
      this.drawCircle(hx, hy, 2.2, { fill: '#ffffff' });
      ctx.shadowBlur = 4;
    }
    ctx.restore();
  }

  _renderShip(ship, idx, terminated, reward) {
    // Catastrophic warp failure: ship is replaced by the Minskytron atom,
    // drawn earlier in render().  Don't paint anything for the body itself.
    if (ship.warp_failed) return;
    // Missile / star kill: ship has shattered into fragments — those draw in
    // a separate pass.  Hide the body so we're not leaving a corpse behind.
    if (ship.dead) return;

    const psz = ship.size * this.dim * this.scale;
    const [px, py] = this.toScreen(ship.pos);
    const accent = idx === 0 ? COLOR_P1    : COLOR_P2;
    const hilite = idx === 0 ? COLOR_P1_HI : COLOR_P2_HI;
    const ctx    = this.ctx;

    // In hyperspace → animated rings.
    if (ship.h_reload > HYPERSPACE_RECHARGE - HYPERSPACE_REENTRY) {
      const into = HYPERSPACE_RECHARGE - ship.h_reload;
      const perc = ((HYPERSPACE_REENTRY - into) % (HYPERSPACE_REENTRY / 3))
                   / (HYPERSPACE_REENTRY / 3);
      const alpha = 1 - perc;
      this.drawCircle(px, py, psz * perc,
        { stroke: COLOR_HSPACE.replace('ALPHA', Math.max(0, alpha)), width: 1 });
      if (perc < 0.5 && into <= HYPERSPACE_REENTRY * 2 / 3) {
        const p2 = perc + 0.5;
        this.drawCircle(px, py, psz * p2,
          { stroke: COLOR_HSPACE.replace('ALPHA', Math.max(0, 1 - p2)), width: 1 });
      } else if (perc > 0.5 && into > HYPERSPACE_REENTRY / 3) {
        const p2 = perc - 0.5;
        this.drawCircle(px, py, psz * p2,
          { stroke: COLOR_HSPACE.replace('ALPHA', Math.max(0, 1 - p2)), width: 1 });
      }
      return;
    }

    // On match-end, recolor the body to convey win/lose/draw.
    let bodyColor = accent, coreColor = hilite;
    if (terminated) {
      bodyColor = reward > 0 ? COLOR_WIN : reward < 0 ? COLOR_LOSE : COLOR_DRAW;
      coreColor = '#ffffff';
    }

    // From original: rotated_pt = (x*cos a + y*sin a, -x*sin a + y*cos a).
    const a = ship.ang * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rot = (x, y) => [
      x * ca + y * sa + px,
     -x * sa + y * ca + py,
    ];

    const body = [
      rot( psz / 2,        0       ),
      rot(-psz * 3 / 8,   -psz / 4 ),
      rot(-psz / 2,        0       ),
      rot(-psz * 3 / 8,    psz / 4 ),
    ];
    // Inner "cockpit" detail — same arrowhead, scaled down, offset forward.
    const core = [
      rot( psz * 5 / 16,   0          ),
      rot(-psz * 3 / 16,  -psz * 5 / 32),
      rot(-psz * 5 / 16,   0          ),
      rot(-psz * 3 / 16,   psz * 5 / 32),
    ];

    // Thrust flare (drawn under the body so it appears to come out the back).
    if (ship.last_act[0] === 1 && ship.fuel > 0) {
      const flicker = 3 + 5 * Math.random();
      const flare = [
        rot(-psz * flicker / 8,  0       ),
        rot(-psz * 15 / 32,     -psz / 16),
        rot(-psz / 2,             0       ),
        rot(-psz * 15 / 32,      psz / 16),
      ];
      ctx.save();
      ctx.shadowColor = '#ffe040';
      ctx.shadowBlur  = 8;
      this.drawPoly(flare, '#ffe040');
      ctx.restore();
    }

    // Body — accent color with phosphor glow.
    ctx.save();
    ctx.shadowColor = bodyColor;
    ctx.shadowBlur  = 10;
    this.drawPoly(body, bodyColor);
    ctx.restore();

    // Bright inner highlight — no extra glow, lets the silhouette read clean.
    this.drawPoly(core, coreColor);
  }
}
