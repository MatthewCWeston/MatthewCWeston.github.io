import {
  WRAP_BOUND, STAR_SIZE, HYPERSPACE_RECHARGE, HYPERSPACE_REENTRY,
  RENDER_DIM, VIEW_SCALE,
} from './constants.js';

const COLOR_P1     = '#4ad8ff';
const COLOR_P2     = '#ff8a3d';
const COLOR_WIN    = '#50ff80';
const COLOR_LOSE   = '#ff4040';
const COLOR_DRAW   = '#ffe040';
const COLOR_HSPACE = 'rgba(180, 80, 200, ALPHA)';

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
    this.trails = [];
    this.showTrails = false;
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

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, dim, dim);

    // Star — flickery cross.
    for (let i = 0; i < 2; i++) {
      const sx = (Math.random() * 2 - 1) * ssz / 2;
      const sy = (Math.random() * 2 - 1) * ssz / 2;
      this.drawLine(hdim + sx, hdim + sy, hdim - sx, hdim - sy, '#fff', 1);
    }

    // Trails (optional)
    if (this.showTrails) {
      for (let i = this.trails.length - 1; i >= 0; i--) {
        const t = this.trails[i];
        t.age++;
        if (t.age > 15) { this.trails.splice(i, 1); continue; }
        const [tx, ty] = this.toScreen(t.pos);
        const alpha = 1 - t.age / 15;
        ctx.fillStyle = t.color === 'orange'
          ? `rgba(255, 138, 61, ${alpha * 0.6})`
          : `rgba(255, 220, 80, ${alpha * 0.6})`;
        ctx.fillRect(tx - 1, ty - 1, 2, 2);
      }
    }

    // Ships
    for (let i = 0; i < 2; i++) {
      this._renderShip(env.playerShips[i], i, env.terminated, env.rewards[i]);
    }
    // Missiles
    for (const m of env.missiles[0]) this._renderMissile(m, env.speed, '#ffdc50');
    for (const m of env.missiles[1]) this._renderMissile(m, env.speed, '#ff8a3d');
  }

  _renderMissile(m, envspeed, color) {
    const [mx, my] = this.toScreen(m.pos);
    const sz = m.life > envspeed ? this.msz : this.msz * 4;
    this.drawCircle(mx, my, sz / 2, { fill: color, stroke: color });
    if (this.showTrails) {
      this.trails.push({
        pos: [m.prevPos[0], m.prevPos[1]],
        age: 0,
        color: color === '#ff8a3d' ? 'orange' : 'yellow',
      });
    }
  }

  _renderShip(ship, idx, terminated, reward) {
    const psz = ship.size * this.dim * this.scale;
    const [px, py] = this.toScreen(ship.pos);
    const accent = idx === 0 ? COLOR_P1 : COLOR_P2;

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

    let outline;
    if (terminated)  outline = reward > 0 ? COLOR_WIN : reward < 0 ? COLOR_LOSE : COLOR_DRAW;
    else             outline = accent;

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
    this.drawCircle(px, py, psz / 2, { stroke: outline, width: 1 });
    this.drawPoly(body, '#ffffff');

    if (ship.last_act[0] === 1 && ship.fuel > 0) {
      const flicker = 3 + 5 * Math.random();
      const flare = [
        rot(-psz * flicker / 8,  0       ),
        rot(-psz * 15 / 32,     -psz / 16),
        rot(-psz / 2,             0       ),
        rot(-psz * 15 / 32,      psz / 16),
      ];
      this.drawPoly(flare, COLOR_P2);
    }
  }
}
