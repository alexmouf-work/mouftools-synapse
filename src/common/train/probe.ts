// Probe helpers shared by every trainer (the `signal` channel all trainers declare).
import { compile, evalNet, signalOf } from '../sim/brain';
import { startCar } from '../sim/car';
import { readSensors } from '../sim/sensors';
import type { Genome } from '../sim/spec';
import type { Env } from './env';

/** signal = sender output × weight on the first tick of training track 0 (no car-tick is spent). */
export function firstTickSignal(env: Env, g: Genome): Float64Array {
  const net = compile(g);
  const t = env.track(0);
  const c = startCar(t);
  const inputs = new Float64Array(net.nIn), vals = new Float64Array(net.nNodes);
  readSensors(c, t, net, inputs);
  evalNet(net, inputs, vals);
  return signalOf(net, vals);
}
