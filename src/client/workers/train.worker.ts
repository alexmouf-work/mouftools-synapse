// Browser worker: runs episode batches with the same EpisodeCore as the Node worker and the inline executor.
// On request it also returns the display-only track-0 paths of its slice.
import { EpisodeCore, type EpisodeSetup } from '../../common/train/episodes';

type Msg = { type: 'setup'; setup: EpisodeSetup } | { type: 'run'; id: number; w: Float64Array; count: number; record: boolean };

let core: EpisodeCore | null = null;
const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'setup') { core = new EpisodeCore(m.setup); post({ type: 'ready' }); return; }
    if (!core) throw new Error('train.worker: run before setup');
    const { out, paths } = core.run(m.w, m.count, m.record);
    const t: Transferable[] = [out.buffer as ArrayBuffer];
    if (paths) t.push(paths.data.buffer as ArrayBuffer, paths.ticks.buffer as ArrayBuffer);
    post({ type: 'result', id: m.id, out, paths }, t);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
};
