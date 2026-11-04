// Rate coding (principal 2026-10-31; brain v2 2026-11-04: "all neurons need a firing rate, shown with yellow flashes
// like the input ones"). One rule for every cell: it fires at SPIKE_MAX_HZ × its firing rate (0..1, brain.nodeRate),
// so a boundary cell near a wall fires fastest and a silent ReLU never fires. A spike is a short bright flash
// (FLASH_S). Driven by the real per-tick values; display only.

export const SPIKE_MAX_HZ = 14;
export const FLASH_S = 0.08;

export const spikeRate = (reading: number): number => SPIKE_MAX_HZ * Math.min(1, Math.abs(reading));

export class SpikeTrains {
  private readonly phase: Float64Array;
  private readonly last: Float64Array;
  /** Spikes per cell since the last reset, and the time-integral of |reading| over the same time (for checks). */
  readonly counts: Int32Array;
  readonly integral: Float64Array;
  elapsed = 0;

  constructor(readonly n: number) {
    // staggered starting phases so cells with the same reading do not flash in lockstep
    this.phase = Float64Array.from({ length: n }, (_, i) => (i * 0.382) % 1);
    this.last = new Float64Array(n).fill(-Infinity);
    this.counts = new Int32Array(n);
    this.integral = new Float64Array(n);
  }

  /** Advance dt seconds at time `now` with the current readings; cells with used[i] = 0 stay silent. */
  update(readings: ArrayLike<number>, used: ArrayLike<number>, dt: number, now: number): void {
    this.elapsed += dt;
    for (let i = 0; i < this.n; i++) {
      if (!used[i]) continue;
      this.integral[i] += Math.min(1, Math.abs(readings[i])) * dt;
      const rate = spikeRate(readings[i]);
      this.phase[i] += rate * dt;
      while (this.phase[i] >= 1) {
        this.phase[i] -= 1; this.counts[i]++;
        this.last[i] = now - this.phase[i] / rate; // when within this frame it fired (slow frames flash honestly)
      }
    }
  }

  /** Flash strength 0..1 of cell i at time `now` (1 just after a spike, fading over FLASH_S). */
  flash(i: number, now: number): number { return Math.max(0, 1 - (now - this.last[i]) / FLASH_S); }

  reset(): void { this.counts.fill(0); this.integral.fill(0); this.elapsed = 0; }
}
