import { ACTION_NVEC } from './constants.js';

/** Gumbel-max sampling: equivalent to softmax sampling on each MultiDiscrete
 *  slice.  The policy is PPO-trained against this distribution, so argmax
 *  decoding would just produce a stale degenerate behavior — always sample. */
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
  async getAction(env, playerIdx) {
    const feeds = env.getFeeds(playerIdx, this.ort);
    const out = await this.session.run(feeds);
    const logits = out.logits.data;       // length = sum(ACTION_NVEC) = 9
    return perAxisSample(logits, ACTION_NVEC);
  }
}
