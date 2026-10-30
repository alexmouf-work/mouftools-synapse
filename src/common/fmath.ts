// Own transcendental functions, built only from + − × ÷, sqrt, floor and round (all exactly specified by IEEE 754),
// so every JS engine computes the same bits. Engine Math.sin/exp/… may differ between browsers, and multiplayer will
// re-run races on every client. Accuracy is ~1e-15; determinism is the point, not the last ulp.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;
const LN2_HI = 0.6931471803691238; // Cody–Waite split of ln 2
const LN2_LO = 1.9082149292705877e-10;
const PIO2_HI = 1.5707963267341256; // Cody–Waite split of π/2
const PIO2_LO = 6.077100506506192e-11;

// 2^k for k in [-1022, 1023], built by exact doubling/halving.
const POW2 = new Float64Array(2046);
{
  let p = 1;
  for (let k = 0; k <= 1023; k++) { POW2[k + 1022] = p; p *= 2; }
  p = 1;
  for (let k = 0; k >= -1022; k--) { POW2[k + 1022] = p; p *= 0.5; }
}

// sin and cos of r for |r| <= π/4 (Taylor, Horner form; truncation error < 1e-16).
function sinK(r: number): number {
  const z = r * r;
  return r * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 +
    z * (1 / 6227020800 + z * (-1 / 1307674368000))))))));
}
function cosK(r: number): number {
  const z = r * r;
  return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 + z * (1 / 479001600 +
    z * (-1 / 87178291200 + z * (1 / 20922789888000))))))));
}

function quadrant(x: number): { r: number; q: number } {
  const k = Math.round(x / HALF_PI);
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  const q = ((k % 4) + 4) % 4;
  return { r, q };
}

export function sin(x: number): number {
  const { r, q } = quadrant(x);
  if (q === 0) return sinK(r);
  if (q === 1) return cosK(r);
  if (q === 2) return -sinK(r);
  return -cosK(r);
}

export function cos(x: number): number {
  const { r, q } = quadrant(x);
  if (q === 0) return cosK(r);
  if (q === 1) return -sinK(r);
  if (q === 2) return -cosK(r);
  return sinK(r);
}

// e^r − 1 for |r| <= ~0.35 (Taylor to r^13; keeps precision near 0).
function expm1K(r: number): number {
  return r * (1 + r * (1 / 2 + r * (1 / 6 + r * (1 / 24 + r * (1 / 120 + r * (1 / 720 + r * (1 / 5040 + r * (1 / 40320 +
    r * (1 / 362880 + r * (1 / 3628800 + r * (1 / 39916800 + r * (1 / 479001600 + r * (1 / 6227020800)))))))))))));
}

export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 700) x = 700; // callers (sigmoid, tanh) saturate long before; keeps 2^k in the normal range
  if (x < -700) x = -700;
  const k = Math.round(x / LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  return (1 + expm1K(r)) * POW2[k + 1022];
}

export function tanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const y = 2 * x;
  const em1 = (y > -0.35 && y < 0.35) ? expm1K(y) : exp(y) - 1;
  return em1 / (em1 + 2);
}

export function sigmoid(x: number): number {
  return 1 / (1 + exp(-x));
}

// Natural log for x > 0 (used by the Gaussian sampler).
export function log(x: number): number {
  if (!(x > 0)) throw new Error(`fmath.log: domain error (${x})`);
  if (x === Infinity) return Infinity;
  let e = 0;
  while (x >= 2) { x *= 0.5; e++; }
  while (x < 1) { x *= 2; e--; }
  if (x > 1.4142135623730951) { x *= 0.5; e++; }
  const s = (x - 1) / (x + 1);
  const z = s * s;
  // 2·atanh(s), |s| <= 0.172
  const at = s * (1 + z * (1 / 3 + z * (1 / 5 + z * (1 / 7 + z * (1 / 9 + z * (1 / 11 + z * (1 / 13 + z * (1 / 15 +
    z * (1 / 17 + z * (1 / 19 + z * (1 / 21 + z * (1 / 23 + z * (1 / 25)))))))))))));
  return e * LN2 + 2 * at;
}

// atan for |t| <= tan(π/16) ≈ 0.199 (Taylor to t^25).
function atanK(t: number): number {
  const z = t * t;
  return t * (1 + z * (-1 / 3 + z * (1 / 5 + z * (-1 / 7 + z * (1 / 9 + z * (-1 / 11 + z * (1 / 13 + z * (-1 / 15 +
    z * (1 / 17 + z * (-1 / 19 + z * (1 / 21 + z * (-1 / 23 + z * (1 / 25)))))))))))));
}

export function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  let inv = false;
  if (a > 1) { a = 1 / a; inv = true; }
  // two half-angle reductions: atan(a) = 2·atan(a / (1 + sqrt(1 + a²)))
  a = a / (1 + Math.sqrt(1 + a * a));
  a = a / (1 + Math.sqrt(1 + a * a));
  let r = 4 * atanK(a);
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  a = a - TAU * Math.floor((a + PI) / TAU);
  return a === -PI ? PI : a;
}
