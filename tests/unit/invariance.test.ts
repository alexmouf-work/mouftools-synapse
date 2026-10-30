// Upgrade invariance: adding w = 0 wires or neurons leaves every recorded output identical over 600 ticks, for all
// four transfer functions. Holds while the brain is under budget and "Energy left" is unwired: a new neuron's upkeep
// changes the energy use, which those two read by design.
import { describe, expect, it } from 'vitest';
import { ACTS, CONFIG, type Act } from '../../src/common/config';
import { compile } from '../../src/common/sim/brain';
import { newRecording, Runner } from '../../src/common/sim/race';
import type { BrainSpec, Genome } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { Rng } from '../../src/common/rng';

function base(act: Act): BrainSpec {
  const conns = [];
  for (const from of ['i:fl', 'i:f', 'i:fr', 'i:road', 'i:spd']) for (const to of ['n1', 'n2', 'n3']) conns.push({ from, to });
  for (const from of ['n1', 'n2', 'n3']) for (const to of ['o:fl', 'o:fr', 'o:rl', 'o:rr']) conns.push({ from, to });
  return { v: 1, layers: 1, nodes: ['n1', 'n2', 'n3'].map((id) => ({ id, layer: 1, act, dropout: 0 })), conns };
}

/** Same brain plus a neuron in line 1, a whole new line 2 with a neuron, and extra wires — all new weights 0. */
function upgraded(g: Genome, act: Act): Genome {
  const s = g.spec;
  const extra = [
    { from: 'i:f', to: 'n4' }, { from: 'n4', to: 'o:fl' }, { from: 'n4', to: 'n5' },
    { from: 'n1', to: 'n5' }, { from: 'n5', to: 'o:rr' }, { from: 'i:road', to: 'n5' },
  ];
  return {
    spec: {
      v: 1, layers: 2,
      nodes: [...s.nodes, { id: 'n4', layer: 1, act, dropout: 0 }, { id: 'n5', layer: 2, act, dropout: 0 }],
      conns: [...extra.slice(0, 2), ...s.conns, ...extra.slice(2)], // new wires both before and after the old ones
    },
    w: [0, 0, ...g.w, 0, 0, 0, 0],
  };
}

function record(g: Genome, seed: number) {
  const net = compile(g);
  const rec = newRecording(net, 600);
  new Runner().run(net, generateTrack(seed), { ticks: 600, budget: CONFIG.budget[0], noiseSeed: 99, earlyStop: false, record: rec });
  const wheels = new Float64Array(600 * 4);
  for (let k = 0; k < 600; k++) for (let o = 0; o < 4; o++) wheels[k * 4 + o] = rec.act[k * net.nNodes + net.outStart + o];
  return { wheels, x: rec.x, y: rec.y, v: rec.v, energy: rec.energy };
}

describe('upgrade invariance', () => {
  for (const act of ACTS) {
    it(`${act}: w = 0 additions change nothing over 600 ticks`, () => {
      for (const seed of [11, 12]) {
        const rng = new Rng(seed * 31 + act.length);
        const spec = base(act);
        const g: Genome = { spec, w: spec.conns.map(() => Math.max(-4, Math.min(4, rng.normal() * 1.2))) };
        const a = record(g, seed), b = record(upgraded(g, act), seed);
        expect(Math.max(...a.energy)).toBeLessThan(CONFIG.budget[0]); // stays under budget: no noise
        expect(Array.from(b.wheels)).toEqual(Array.from(a.wheels));
        expect(Array.from(b.x)).toEqual(Array.from(a.x));
        expect(Array.from(b.y)).toEqual(Array.from(a.y));
        expect(Array.from(b.v)).toEqual(Array.from(a.v));
      }
    });
  }
});
