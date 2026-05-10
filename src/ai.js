import { ACTION_NVEC } from './constants.js';

/** Greedy decode: argmax of each contiguous logit slice. */
export function perAxisArgmax(logits, nvec) {
  const out = [];
  let p = 0;
  for (const n of nvec) {
    let bi = 0, bv = logits[p];
    for (let i = 1; i < n; i++) if (logits[p + i] > bv) { bv = logits[p + i]; bi = i; }
    out.push(bi);
    p += n;
  }
  return out;
}

/** Gumbel-max sampling: equivalent to softmax sampling on each slice. */
export function perAxisSample(logits, nvec) {
  const out = [];
  let p = 0;
  for (const n of nvec) {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const g = -Math.log(-Math.log(u + 1e-20) + 1e-20);
      const s = logits[p + i] + g;
      if (s > bv) { bv = s; bi = i; }
    }
    out.push(bi);
    p += n;
  }
  return out;
}

export class AIPlayer {
  constructor(modelPath = './model.fp16.onnx', ortLib = globalThis.ort) {
    this.modelPath = modelPath;
    this.ort = ortLib;
    this.session = null;
  }

  async load() {
    if (this.session) return;
    this.session = await this.ort.InferenceSession.create(this.modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }

  /** Returns [thrust, turn, shoot, hspace] for the given player. */
  async getAction(env, playerIdx, stochastic) {
    const feeds = env.getFeeds(playerIdx, this.ort);
    const out = await this.session.run(feeds);
    const logits = out.logits.data;       // length = sum(ACTION_NVEC) = 9
    return stochastic
      ? perAxisSample(logits, ACTION_NVEC)
      : perAxisArgmax(logits, ACTION_NVEC);
  }
}
