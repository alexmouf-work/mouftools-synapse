// Node worker: runs episode batches with the same EpisodeCore as the browser worker and the inline executor.
import { parentPort } from 'node:worker_threads';
import { EpisodeCore, type EpisodeSetup } from '../../src/common/train/episodes';
import type { RolloutJob } from '../../src/common/train/rollout';

type Msg =
  | { type: 'setup'; setup: EpisodeSetup } | { type: 'run'; id: number; w: Float64Array; count: number }
  | { type: 'rollout'; id: number; job: RolloutJob };

let core: EpisodeCore | null = null;
const port = parentPort;
if (!port) throw new Error('episodeWorker: not running in a worker');
port.on('message', (m: Msg) => {
  try {
    if (m.type === 'setup') { core = new EpisodeCore(m.setup); port.postMessage({ type: 'ready' }); return; }
    if (!core) throw new Error('episodeWorker: run before setup');
    if (m.type === 'rollout') {
      const lanes = core.rollout(m.job);
      port.postMessage({ type: 'lanes', id: m.id, lanes }, lanes.flatMap((l) => [l.grad.buffer as ArrayBuffer, l.stats.buffer as ArrayBuffer]));
      return;
    }
    const { out } = core.run(m.w, m.count);
    port.postMessage({ type: 'result', id: m.id, out }, [out.buffer as ArrayBuffer]);
  } catch (e) {
    port.postMessage({ type: 'error', message: e instanceof Error ? e.stack ?? e.message : String(e) });
  }
});
