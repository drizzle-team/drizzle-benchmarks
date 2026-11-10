// Stateless, deterministic per-iteration randomness.
//
// Every value is a pure function of (seed, iter): the same seed gives the same request
// sequence in every worker, every run and against every target — no files, no state.

/** murmur3 finalizer: good avalanche for sequential inputs */
function fmix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const INV_2_32 = 1 / 4294967296;

/** Random stream for one iteration. Reseeded in place (no allocation per request). */
export class Rng {
  private state = 0;
  private readonly seedHash: number;

  constructor(seed = 1) {
    this.seedHash = fmix32(seed ^ 0x9e3779b9);
  }

  /** Position the stream at iteration `iter`. */
  at(iter: number): this {
    this.state = fmix32((iter ^ this.seedHash) >>> 0) ^ this.seedHash;
    return this;
  }

  /** uint32 */
  u32(): number {
    this.state = (this.state + 0x9e3779b9) | 0; // splitmix-style increment
    return fmix32(this.state);
  }

  /** float in [0, 1) */
  next(): number {
    return this.u32() * INV_2_32;
  }

  /** integer in [min, max] (inclusive) */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}

export interface Route {
  /** relative frequency */
  weight: number;
  /** build the path from this iteration's random stream */
  path(r: Rng): string;
}

/**
 * Weighted request mix as a `path(iter)` function for run().
 *
 *   path: mix([
 *     { weight: 100, path: (r) => `/order?id=${r.int(1, 50_000)}` },
 *     { weight: 20,  path: (r) => `/customer?id=${r.int(1, 10_000)}` },
 *   ], { seed: 42 })
 */
export function mix(routes: readonly Route[], opts: { seed?: number } = {}): (iter: number) => string {
  const live = routes.filter((r) => r.weight > 0);
  if (!live.length) throw new Error('mix(): no routes with weight > 0');
  const total = live.reduce((s, r) => s + r.weight, 0);
  const cdf = new Float64Array(live.length);
  let acc = 0;
  live.forEach((r, i) => (cdf[i] = acc += r.weight / total));
  cdf[cdf.length - 1] = 1;
  const rng = new Rng(opts.seed ?? 1);

  return (iter) => {
    rng.at(iter);
    const u = rng.next();
    let i = 0;
    while (u >= cdf[i]!) i++;
    return live[i]!.path(rng);
  };
}
