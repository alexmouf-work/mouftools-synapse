// The checks' fixed brain. New brains start random (brain v2 plan §3c: 2–6 input cells), but the checks compare the
// page against Node runs of defaultSpec(), so every page a check opens starts with that brain saved, unless the check
// saves its own first (an init script that writes only when nothing is stored).
import type { BrowserContext } from 'playwright';
import { defaultGenome } from '../../src/common/sim/brain';
import { SENSE_IDS, type Genome } from '../../src/common/sim/spec';
import { DEFAULT_NAME, NO_TRAINING, SAVE_KEY, serialize } from '../../src/client/ui/designer/store';

export async function fixtureBrain(ctx: BrowserContext): Promise<void> {
  const v = serialize({ name: DEFAULT_NAME, genome: defaultGenome(), train: NO_TRAINING, trainer: 'evolution' });
  await ctx.addInitScript(([k, s]) => { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, s); } catch { /* no storage */ } }, [SAVE_KEY, v] as const);
}

/** A new brain as plan §3c draws it: 2–6 input cells, one at least a boundary vector cell, 3 tanh neurons, untrained. */
export function isStarter(g: Genome): boolean {
  const n = SENSE_IDS.reduce((a, id) => a + g.spec.senses[id], 0);
  return n >= 2 && n <= 6 && g.spec.senses.boundary >= 1 && g.spec.layers.length === 1 && g.spec.layers[0].n === 3
    && g.spec.layers[0].fn === 'tanh' && g.w.every((w) => w === 0);
}
