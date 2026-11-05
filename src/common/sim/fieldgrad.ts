// Gradients of the sense cells with respect to their field parameters (B2e, plan §3ad), for backprop: the error at
// each input cell (δ from train/grad.ts backward) times ∂(cell value)/∂(field parameter), at the state the cell read.
// What has a gradient: head direction (preferred angle), grid (scale, offset, orientation), speed (gain), landmark
// (direction and width through the smooth angular tuning, range through the distance falloff) and boundary (range
// only). A boundary cell samples its field with rays, so its direction and width change which wall a ray hits, not
// smoothly how strongly it fires: they have no gradient and stay as they are under backprop (evolution moves them).
import { CONFIG } from '../config';
import { atan2, cos, exp, PI, sin, wrapAngle } from '../fmath';
import { SENSE_CODE, type Net } from './brain';
import { finishPoint } from './sensors';
import type { CarState } from './car';
import type { Track } from './track';

const DEG = PI / 180, TWO_PI = 2 * PI;
const GC = [0, 1, 2].map((a) => cos((a * PI) / 3)), GS = [0, 1, 2].map((a) => sin((a * PI) / 3));

/**
 * Add scale · δ_i · ∂x_i/∂p into grad at every input cell's field parameters (net.fieldAt[i] + j), for car c on
 * track t (the state the inputs were read from). The chain factors ∂(tuning)/∂p are in net.tuneD.
 */
export function fieldGrads(net: Net, c: CarState, t: Track, delta: ArrayLike<number>, grad: Float64Array, scale = 1): void {
  const { tune, tuneD, fieldAt } = net;
  for (let i = 0; i < net.nIn; i++) {
    const di = delta[i];
    if (di === 0) continue;
    const q = 4 * i, at = fieldAt[i], s = scale * di;
    switch (net.sense[i]) {
      case SENSE_CODE.boundary: {
        // the strongest of the three rays (kept by the reading this tick); only its distance falloff depends smoothly
        // on the range: x = e · (1 − d/R), ∂x/∂R = e · d / R²
        const R = tune[q + 2], bd = net.ray[2 * i], be = net.ray[2 * i + 1];
        if (be > 0 && bd < R) grad[at + 2] += s * be * (bd / (R * R)) * tuneD[q + 2];
        break;
      }
      case SENSE_CODE.landmark: {
        const dir = tune[q], w = tune[q + 1], R = tune[q + 2];
        const { qx, qy } = finishPoint(c, t), dx = qx - c.x, dy = qy - c.y, d = Math.sqrt(dx * dx + dy * dy);
        const near = 1 - d / R;
        if (near <= 0) break;
        const bearing = d > 1e-9 ? -wrapAngle(atan2(dy, dx) - c.hdg) / DEG : 0;
        let off = bearing - dir;
        off -= 360 * Math.round(off / 360);
        const e = exp(-((off / w) * (off / w)));
        grad[at] += s * e * near * ((2 * off) / (w * w)) * tuneD[q];
        grad[at + 1] += s * e * near * ((2 * off * off) / (w * w * w)) * tuneD[q + 1];
        grad[at + 2] += s * e * (d / (R * R)) * tuneD[q + 2];
        break;
      }
      case SENSE_CODE.hd:
        grad[at] += s * sin(wrapAngle(c.hdg - tune[q])) * tuneD[q];
        break;
      case SENSE_CODE.grid: {
        const sc = tune[q], ox = tune[q + 1], oy = tune[q + 2], rot = tune[q + 3], ph = net.gridPhase[i];
        const dx = c.x - ox, dy = c.y - oy, cr = cos(rot), sr = sin(rot);
        const X = cr * dx + sr * dy, Y = -sr * dx + cr * dy;
        let g = 0, gS = 0, gX = 0, gY = 0;
        for (let a = 0; a < 3; a++) {
          const u = X * GC[a] + Y * GS[a], arg = (u / sc) * TWO_PI + ph, sn = sin(arg);
          g += cos(arg);
          gS += sn * ((u * TWO_PI) / (sc * sc)); // −sin · ∂arg/∂scale, ∂arg/∂scale = −u·2π/scale²
          gX -= sn * (GC[a] * TWO_PI) / sc; // −sin · ∂arg/∂X
          gY -= sn * (GS[a] * TWO_PI) / sc;
        }
        const v = (g + 1.5) / 4.5;
        if (v <= 0 || v >= 1) break;
        const k = 1 / 4.5;
        // X, Y against the offset and the orientation
        const dXox = -cr, dYox = sr, dXoy = -sr, dYoy = -cr, dXr = Y, dYr = -X;
        grad[at] += s * k * gS * tuneD[q];
        grad[at + 1] += s * k * (gX * dXox + gY * dYox) * tuneD[q + 1];
        grad[at + 2] += s * k * (gX * dXoy + gY * dYoy) * tuneD[q + 2];
        grad[at + 3] += s * k * (gX * dXr + gY * dYr) * tuneD[q + 3];
        break;
      }
      default: {
        const x = (c.v * tune[q]) / CONFIG.car.wheelSpeed;
        if (x > -1 && x < 1) grad[at] += s * (c.v / CONFIG.car.wheelSpeed) * tuneD[q];
      }
    }
  }
}


