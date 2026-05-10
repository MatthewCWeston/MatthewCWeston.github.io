// Math + encoding helpers.  Mirrors the helpers in SpaceWar_objects.py and
// classes/repeated_space.py.

import { WRAP_BOUND } from './constants.js';

/** In-place wrap of a 2-vector inside [-WRAP_BOUND, WRAP_BOUND]. */
export function wrap(p) {
  for (let i = 0; i < 2; i++) {
    if (p[i] >  WRAP_BOUND) p[i] -= 2 * WRAP_BOUND;
    else if (p[i] < -WRAP_BOUND) p[i] += 2 * WRAP_BOUND;
  }
}

/**
 * rotate_pt(p, a) from the Python source.  Note the angle is *negated*
 * internally — passing a=90 returns [0, -1] for [1, 0] (matches the env's
 * y-down screen convention where angUV = (cos a, -sin a)).
 */
export function rotatePt(p, a) {
  const r  = -a * Math.PI / 180;
  const sa = Math.sin(r);
  const ca = Math.cos(r);
  return [p[0] * ca - p[1] * sa, p[1] * ca + p[0] * sa];
}

/** Position of `p` in `ego`'s frame, with wrapping applied first. */
export function egoPt(p, ego) {
  const diff = [p[0] - ego.pos[0], p[1] - ego.pos[1]];
  wrap(diff);
  return rotatePt(diff, -ego.ang);
}

/**
 * Signed distance from `p` to the nearest wrap-rectangle edge along angle a.
 * Positive = forward in the direction of a, negative = backward.
 */
export function grHelper(p, a) {
  const r = a * Math.PI / 180;
  const m = Math.tan(r) + 1e-12;
  const i = p[1] - m * p[0];
  const cosA = Math.cos(r);
  const pois = [
    [(WRAP_BOUND - i) / m,  WRAP_BOUND],
    [(-WRAP_BOUND - i) / m, -WRAP_BOUND],
    [WRAP_BOUND,  m * WRAP_BOUND + i],
    [-WRAP_BOUND, -m * WRAP_BOUND + i],
  ];
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let k = 0; k < 4; k++) {
    const dx = pois[k][0] - p[0];
    const dy = pois[k][1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestIdx = k; }
  }
  const x = pois[bestIdx];
  const sign = Math.sign(x[0] - p[0]) * Math.sign(cosA * (bestIdx < 2 ? -1 : 1));
  return Math.sqrt(bestDist) * sign;
}

/** Two raycasts: forward, and 90° starboard.  Used for the SELF aug obs. */
export function getRaycasts(p, a) {
  return [grHelper(p, a), grHelper(p, a - 90)];
}

export function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
export function norm(a)   { return Math.hypot(a[0], a[1]); }
export function clip01(x) { return x > 1 ? 1 : x < -1 ? -1 : x; }

/**
 * Mirrors classes/repeated_space.py RepeatedCustom.encode_obs.
 *   layout: [ mask(maxLen) | obs0(childDim) | obs1(childDim) | … | zeros ]
 */
export function encodeRepeated(items, maxLen, childDim) {
  const out = new Float32Array(maxLen + maxLen * childDim);
  const lim = Math.min(items.length, maxLen);
  for (let i = 0; i < lim; i++) {
    out[i] = 1.0;
    const off = maxLen + i * childDim;
    const o = items[i];
    for (let j = 0; j < childDim; j++) out[off + j] = o[j];
  }
  return out;
}
