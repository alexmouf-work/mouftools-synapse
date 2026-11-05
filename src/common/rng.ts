// Seeded randomness for the sim. Seeds are derived with the splitmix32 finaliser; streams are sfc32. All integer
// maths (Math.imul, >>>), so identical on every engine. Gaussian samples use the polar method with fmath.log.
import { log } from './fmath';

export function mix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Derive a child seed from a parent seed and a path of integer labels. */
export function derive(seed: number, ...path: number[]): number {
  let h = mix32(seed >>> 0);
  for (const p of path) h = mix32((h ^ Math.imul((p >>> 0) + 0x632be5ab, 0x9e3779b1)) >>> 0);
  return h;
}

/** Counter-based uniform in [0,1): the same (seed, a, b) always gives the same value, independent of call order. */
export function hashU(seed: number, a: number, b: number): number {
  let h = mix32((seed ^ Math.imul(a + 1, 0x27d4eb2f)) >>> 0);
  h = mix32((h ^ Math.imul(b + 1, 0x165667b1)) >>> 0);
  return h / 4294967296;
}

/** Labels for derive(); fixed numbers so a seed means the same thing forever. */
export const TAG = {
  track: 1,
  trainTrack: 2,
  unseenTrack: 3,
  trainNoise: 4,
  raceNoise: 5,
  trainer: 6,
  family: 7,
  starter: 8,
} as const;

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    let s = seed >>> 0;
    const next = () => (s = mix32(s));
    this.a = next(); this.b = next(); this.c = next(); this.d = next();
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number { return this.u32() / 4294967296; }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }

  /** Integer in [0, n). */
  int(n: number): number { return Math.floor(this.next() * n); }

  /** Standard normal (Marsaglia polar method). */
  normal(): number {
    if (this.hasSpare) { this.hasSpare = false; return this.spare; }
    for (;;) {
      const u = 2 * this.next() - 1, v = 2 * this.next() - 1;
      const s = u * u + v * v;
      if (s > 0 && s < 1) {
        const m = Math.sqrt(-2 * log(s) / s);
        this.spare = v * m; this.hasSpare = true;
        return u * m;
      }
    }
  }
}
