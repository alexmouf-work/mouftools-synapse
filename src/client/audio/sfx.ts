// Sound effects, synthesised (no files; ported from reference/sound-test.html): the countdown blips, pitched to the
// track (F♯ minor / D major: F♯5 for 5…1, Go an F♯–A–C♯ chord an octave up), and the car: electric motors, one per
// wheel, so a whine that rises with speed, road roar that grows with it, and tyre squeal when one side's wheels outrun
// the other's (skid-steer cornering). Every parameter moves with setTargetAtTime, so nothing clicks.
import { audio } from './audio';

/** Every countdown blip scheduled or sounding (so leaving a race can cancel them), and every live engine. */
const blips: { g: GainNode; osc: OscillatorNode[]; end: number }[] = [];
const engines = new Set<Engine>();

/** A countdown blip at context time t (Go: the chord). */
export function blip(t: number, go: boolean): void {
  const b = audio();
  if (!b) return;
  const { ctx, sfx } = b;
  const f = go ? [1479.98, 1760.0, 2217.46] : [739.99];
  const g = ctx.createGain();
  g.connect(sfx);
  const len = go ? 0.6 : 0.14;
  const rec = { g, osc: [] as OscillatorNode[], end: t + len + 0.05 };
  blips.push(rec);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(go ? 0.32 : 0.45, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  for (const hz of f) {
    for (const [type, mul] of [['triangle', 1], ['sine', 2]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type; o.frequency.value = hz * mul;
      og.gain.value = mul === 1 ? 1 / f.length : 0.25 / f.length;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + len + 0.05);
      rec.osc.push(o);
    }
  }
}

/** Racing effects still sounding or scheduled: live engines plus blips not yet over. */
export function liveSfx(): number {
  const b = audio();
  if (!b) return 0;
  const now = b.ctx.currentTime;
  for (let i = blips.length - 1; i >= 0; i--) if (blips[i].end <= now) blips.splice(i, 1);
  return engines.size + blips.length;
}

/**
 * Silence every racing effect now: engines fade out (no click) and every countdown blip still to come is cancelled
 * (a source stopped before it starts never sounds). The music is not touched.
 */
export function stopAllSfx(): void {
  const b = audio();
  for (const e of [...engines]) e.stop();
  if (!b) { blips.length = 0; return; }
  const t = b.ctx.currentTime;
  for (const r of blips.splice(0)) {
    r.g.gain.cancelScheduledValues(t);
    r.g.gain.setTargetAtTime(0, t, 0.01);
    for (const o of r.osc) { try { o.stop(t + 0.05); } catch { /* already stopped */ } }
  }
}

let noise: AudioBuffer | null = null;
/** Two seconds of smoothed noise (display only, so Math.random is fine here: this is not the sim). */
function noiseBuf(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); d[i] = last * 6; }
  return (noise = b);
}

const K = 0.06; // s: time constant every parameter eases with

/** One car's sound. `level` scales it (1 for your car in the drive view; quieter for the training view's car). */
export class Engine {
  private nodes: { out: GainNode; whine: OscillatorNode; whine2: OscillatorNode; lp: BiquadFilterNode; rg: GainNode; bp: BiquadFilterNode; sg: GainNode; src: AudioScheduledSourceNode[] } | null = null;
  constructor(private readonly level: number) {}

  /** Build the graph if audio is unlocked (cheap to call every frame until it is). */
  private ensure(): boolean {
    if (this.nodes) return true;
    const b = audio();
    if (!b) return false;
    const { ctx, sfx } = b;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(sfx);
    const whine = ctx.createOscillator(); whine.type = 'sawtooth';
    const whine2 = ctx.createOscillator(); whine2.type = 'square';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    const wg = ctx.createGain(); wg.gain.value = 0.18;
    const w2g = ctx.createGain(); w2g.gain.value = 0.05;
    whine.connect(wg).connect(lp); whine2.connect(w2g).connect(lp); lp.connect(out);
    const nb = noiseBuf(ctx);
    const road = ctx.createBufferSource(); road.buffer = nb; road.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    const rg = ctx.createGain(); rg.gain.value = 0;
    road.connect(bp).connect(rg).connect(out);
    const sq = ctx.createBufferSource(); sq.buffer = nb; sq.loop = true; sq.playbackRate.value = 1.7;
    const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 2600; sbp.Q.value = 9;
    const sg = ctx.createGain(); sg.gain.value = 0;
    sq.connect(sbp).connect(sg).connect(out);
    const src = [whine, whine2, road, sq];
    src.forEach((n) => n.start());
    out.gain.setTargetAtTime(this.level, ctx.currentTime, 0.1);
    this.nodes = { out, whine, whine2, lp, rg, bp, sg, src };
    engines.add(this);
    return true;
  }

  /** speed: 0..1 of top wheel speed · turn: 0..1, how much one side's wheels outrun the other's. */
  set(speed: number, turn: number): void {
    if (!this.ensure()) return;
    const n = this.nodes!, t = (audio() as NonNullable<ReturnType<typeof audio>>).ctx.currentTime;
    const v = Math.max(0, Math.min(1, speed)), tr = Math.max(0, Math.min(1, turn));
    const hz = 70 + 520 * v; // the motor whine follows wheel speed
    n.whine.frequency.setTargetAtTime(hz, t, K);
    n.whine2.frequency.setTargetAtTime(hz * 1.5, t, K);
    n.lp.frequency.setTargetAtTime(500 + 3200 * v, t, K);
    n.rg.gain.setTargetAtTime(0.02 + 0.22 * v, t, K);
    n.bp.frequency.setTargetAtTime(250 + 900 * v, t, K);
    n.sg.gain.setTargetAtTime(tr > 0.35 ? (tr - 0.35) * 0.5 * (0.3 + v) : 0, t, K);
  }

  /** Fade out and release. */
  stop(): void {
    const n = this.nodes, b = audio();
    this.nodes = null;
    engines.delete(this);
    if (!n || !b) return;
    const t = b.ctx.currentTime;
    n.out.gain.setTargetAtTime(0, t, 0.08);
    n.src.forEach((s) => s.stop(t + 0.5));
  }
}
