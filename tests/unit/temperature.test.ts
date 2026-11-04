import { describe, expect, it } from 'vitest';
import { defaultSpec } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';
import { tempScale, validTemperature } from '../../src/common/train/trainer';

describe('temperature (brain v2 plan §3ac)', () => {
  it('the multiplier is 2^t on the slider\'s quarter steps, exact at whole steps', () => {
    expect(tempScale(0)).toBe(1);
    expect(tempScale(1)).toBe(2);
    expect(tempScale(2)).toBe(4);
    expect(tempScale(-2)).toBe(0.25);
    for (let k = -8; k <= 8; k++) expect(Math.abs(tempScale(k / 4) - 2 ** (k / 4))).toBeLessThan(1e-15 * 4);
    expect(tempScale(-0.75) * tempScale(0.75)).toBeCloseTo(1, 15);
  });
  it('only the slider\'s values are valid', () => {
    for (const t of [-2, -1.75, 0, 0.25, 2]) expect(validTemperature(t)).toBe(true);
    for (const t of [-2.25, 2.25, 0.3, NaN, Infinity]) expect(validTemperature(t)).toBe(false);
    expect(() => tempScale(0.1)).toThrow();
  });
  it('is a run input: ×2 changes evolution\'s result and repeats exactly; backprop ignores it', async () => {
    const o = { T: 1_000_000 }; // a few generations (the first is drawn before any mutation)
    const cool = await runPhase(new InlineExecutor(), defaultSpec(), 5, o);
    const hot = await runPhase(new InlineExecutor(), defaultSpec(), 5, { ...o, temperature: 1 });
    const again = await runPhase(new InlineExecutor(), defaultSpec(), 5, { ...o, temperature: 1 });
    expect(hot.hash).not.toBe(cool.hash);
    expect(again.hash).toBe(hot.hash);
    const bp = await runPhase(new InlineExecutor(), defaultSpec(), 5, { ...o, trainer: 'backprop' });
    const bpHot = await runPhase(new InlineExecutor(), defaultSpec(), 5, { ...o, trainer: 'backprop', temperature: 1 });
    expect(bpHot.hash).toBe(bp.hash);
  }, 120_000);
});
