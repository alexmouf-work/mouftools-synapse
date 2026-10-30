// Browser worker pool executor. Same split as the Node pool (splitEven); results reassembled in policy order, so the
// worker count can never change a result.
import {
  joinPaths, pathSamples, RESULT_STRIDE, splitEven, type EpisodeSetup, type Executor, type Paths,
} from '../../common/train/episodes';

type Reply = { type: 'ready' } | { type: 'result'; id: number; out: Float64Array; paths: Paths | null } | { type: 'error'; message: string };

export class BrowserPool implements Executor {
  private ws: Worker[] = [];
  private nW = 0;
  private nT = 0;
  private seq = 0;
  private samples = 0;
  /** Set before a run to get that run's track-0 paths in lastPaths (display only; results are unaffected). */
  record = false;
  lastPaths: Paths | null = null;
  constructor(readonly workers: number) {
    if (!(workers >= 1)) throw new Error(`pool: ${workers} workers`);
    for (let k = 0; k < workers; k++) {
      this.ws.push(new Worker(new URL('./train.worker.ts', import.meta.url), { type: 'module' }));
    }
  }
  private ask(w: Worker, msg: unknown, transfer: Transferable[] = []): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const off = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
      const onMsg = (e: MessageEvent<Reply>) => { off(); e.data.type === 'error' ? reject(new Error(e.data.message)) : resolve(e.data); };
      const onErr = (e: ErrorEvent) => { off(); reject(new Error(e.message)); };
      w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
      w.postMessage(msg, transfer);
    });
  }
  async setup(s: EpisodeSetup): Promise<void> {
    this.nW = s.spec.conns.length; this.nT = s.trackSeeds.length; this.samples = pathSamples(s.episodeTicks);
    await Promise.all(this.ws.map((w) => this.ask(w, { type: 'setup', setup: s })));
  }
  async run(w: Float64Array, count: number): Promise<Float64Array> {
    const parts = splitEven(count, this.ws.length);
    const replies = await Promise.all(parts.map(([a, b], k) => {
      const chunk = w.slice(a * this.nW, b * this.nW);
      return this.ask(this.ws[k], { type: 'run', id: this.seq++, w: chunk, count: b - a, record: this.record }, [chunk.buffer]);
    }));
    const record = this.record;
    this.record = false;
    const out = new Float64Array(count * this.nT * RESULT_STRIDE);
    replies.forEach((r, k) => {
      if (r.type !== 'result') throw new Error('pool: unexpected reply');
      out.set(r.out, parts[k][0] * this.nT * RESULT_STRIDE);
    });
    if (record) {
      const ps = replies.map((r) => (r.type === 'result' ? r.paths : null));
      if (ps.some((p) => !p)) throw new Error('pool: a worker returned no paths');
      this.lastPaths = joinPaths(ps as Paths[], this.samples);
    }
    return out;
  }
  async close(): Promise<void> { for (const w of this.ws) w.terminate(); this.ws = []; }
}
