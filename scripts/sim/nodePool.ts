// Node worker_threads executor. Same split as the browser pool (splitEven); results reassembled in policy order.
import { Worker } from 'node:worker_threads';
import { RESULT_STRIDE, splitEven, type EpisodeSetup, type Executor } from '../../src/common/train/episodes';

type Reply = { type: 'ready' } | { type: 'result'; id: number; out: Float64Array } | { type: 'error'; message: string };

export class NodePool implements Executor {
  private ws: Worker[] = [];
  private nW = 0;
  private nT = 0;
  private seq = 0;
  constructor(readonly workers: number) {
    if (!(workers >= 1)) throw new Error(`nodePool: ${workers} workers`);
    for (let k = 0; k < workers; k++) this.ws.push(new Worker(new URL('./episodeWorker.boot.mjs', import.meta.url)));
  }
  private ask(w: Worker, msg: unknown, transfer: ArrayBuffer[] = []): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const onMsg = (r: Reply) => { off(); r.type === 'error' ? reject(new Error(r.message)) : resolve(r); };
      const onErr = (e: Error) => { off(); reject(e); };
      const off = () => { w.off('message', onMsg); w.off('error', onErr); };
      w.on('message', onMsg); w.on('error', onErr);
      w.postMessage(msg, transfer);
    });
  }
  async setup(s: EpisodeSetup): Promise<void> {
    this.nW = s.spec.conns.length; this.nT = s.trackSeeds.length;
    await Promise.all(this.ws.map((w) => this.ask(w, { type: 'setup', setup: s })));
  }
  async run(w: Float64Array, count: number): Promise<Float64Array> {
    const parts = splitEven(count, this.ws.length);
    const replies = await Promise.all(parts.map(([a, b], k) => {
      const chunk = w.slice(a * this.nW, b * this.nW);
      return this.ask(this.ws[k], { type: 'run', id: this.seq++, w: chunk, count: b - a }, [chunk.buffer]);
    }));
    const out = new Float64Array(count * this.nT * RESULT_STRIDE);
    replies.forEach((r, k) => {
      if (r.type !== 'result') throw new Error('nodePool: unexpected reply');
      out.set(r.out, parts[k][0] * this.nT * RESULT_STRIDE);
    });
    return out;
  }
  async close(): Promise<void> { await Promise.all(this.ws.map((w) => w.terminate())); this.ws = []; }
}
