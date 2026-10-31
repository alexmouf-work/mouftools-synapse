// How a wire's weight looks, on the workbench and the live brain panel (principal, 2026-10-31): colour from red at
// w = −1 through black at 0 to green at +1 (clamped beyond ±1); thickness and brightness (opacity) grow with |w| up
// to the weight cap. A new wire (w = 0) is thin, dark and faint.
import { CONFIG } from '../../common/config';

const RED: [number, number, number] = [225, 45, 55];
const GREEN: [number, number, number] = [45, 200, 85];

export interface WireStyle { rgb: [number, number, number]; css: string; width: number; alpha: number }

export function weightStyle(w: number): WireStyle {
  const t = Math.max(-1, Math.min(1, w));
  const base = t < 0 ? RED : GREEN, k = Math.abs(t);
  const rgb: [number, number, number] = [Math.round(base[0] * k), Math.round(base[1] * k), Math.round(base[2] * k)];
  const m = Math.sqrt(Math.min(Math.abs(w), CONFIG.brain.weightCap) / CONFIG.brain.weightCap); // 0..1, eased
  return { rgb, css: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, width: 1 + 3 * m, alpha: 0.3 + 0.7 * m };
}
