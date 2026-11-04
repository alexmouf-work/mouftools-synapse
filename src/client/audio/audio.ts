// Sound (docs/plans/2026-11-04-sound.md): one AudioContext with a master gain, a music bus and an effects bus.
// Browsers start audio only after a gesture, so the context is created on the first pointerdown, keydown or
// touchstart anywhere (the music then starts in whatever mode the view asked for) and never stops after that, even in
// a hidden or unfocused tab (principal 2026-11-04: "it should keep playing even when not focused"). Two toggles are the
// only off switches (2026-11-04: "have one toggle for engine sounds and another for music."): Music mutes the music bus,
// Sound effects mutes the effects bus (engines, tyres, countdown blips); the master stays at 1. Both are remembered in
// localStorage `synapse.sound` as {"music":true,"sfx":true} (strictly necessary; listed on /cookies); the old 'off' /
// 'on' reads as both off / both on.
// Nothing here touches the sim: src/common stays pure.

export const SOUND_KEY = 'synapse.sound';

export interface Buses {
  ctx: AudioContext; master: GainNode; music: GainNode; sfx: GainNode;
  /** Level meters after the master and after each bus's gain (for the checks). */
  meter: { master: AnalyserNode; music: AnalyserNode; sfx: AnalyserNode };
}

let buses: Buses | null = null;
export interface SoundOn { music: boolean; sfx: boolean }
const MUSIC_GAIN = 0.7, SFX_GAIN = 0.9;
let on: SoundOn = readSound();
const onReady: ((b: Buses) => void)[] = [];

/** The stored choice: {"music":bool,"sfx":bool}; the B2b-era 'off' / 'on' means both. Anything else: both on. */
export function parseSound(v: string | null): SoundOn {
  if (v === 'off') return { music: false, sfx: false };
  if (v === null || v === 'on') return { music: true, sfx: true };
  try {
    const o = JSON.parse(v) as Partial<SoundOn>;
    return { music: o.music !== false, sfx: o.sfx !== false };
  } catch { return { music: true, sfx: true }; }
}

function readSound(): SoundOn {
  try { return parseSound(localStorage.getItem(SOUND_KEY)); } catch { return { music: true, sfx: true }; }
}

/** The audio graph, once the first gesture has unlocked it (null until then). */
export const audio = (): Buses | null => buses;
export const soundOn = (): SoundOn => ({ ...on });
/**
 * True once audio is unlocked and running. The countdown then follows the music clock, whichever toggles are off (the
 * music runs on, silent, under a muted music bus); only a locked page uses the plain timer.
 */
export const running = (): boolean => !!buses && buses.ctx.state === 'running';

/** Run f once the graph exists (now, if it already does). */
export function whenReady(f: (b: Buses) => void): void {
  if (buses) f(buses); else onReady.push(f);
}

function unlock(): void {
  if (buses) { if (!document.hidden) void buses.ctx.resume(); return; }
  const ctx = new AudioContext();
  const master = ctx.createGain(), music = ctx.createGain(), sfx = ctx.createGain();
  master.gain.value = 1;
  music.gain.value = on.music ? MUSIC_GAIN : 0;
  sfx.gain.value = on.sfx ? SFX_GAIN : 0;
  const an = (from: AudioNode): AnalyserNode => { const a = ctx.createAnalyser(); a.fftSize = 1024; from.connect(a); return a; };
  music.connect(master); sfx.connect(master); master.connect(ctx.destination);
  const meter = { master: an(master), music: an(music), sfx: an(sfx) };
  buses = { ctx, master, music, sfx, meter };
  void ctx.resume();
  for (const f of onReady.splice(0)) f(buses);
  for (const ev of GESTURES) removeEventListener(ev, unlock, true);
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Turn the music or the sound effects on or off; neither touches the other's bus. */
export function setSound(which: keyof SoundOn, value: boolean): void {
  on = { ...on, [which]: value };
  try { localStorage.setItem(SOUND_KEY, JSON.stringify(on)); } catch { /* can't remember: lasts until the tab closes */ }
  if (buses) {
    const g = which === 'music' ? buses.music : buses.sfx;
    g.gain.setTargetAtTime(value ? (which === 'music' ? MUSIC_GAIN : SFX_GAIN) : 0, buses.ctx.currentTime, 0.05);
  }
  syncButtons();
}

const LABEL: Record<keyof SoundOn, string> = { music: 'Music', sfx: 'Sound effects' };
const kindOf = (b: HTMLButtonElement): keyof SoundOn => (b.classList.contains('music') ? 'music' : 'sfx');

/** Every toggle shows the same state as its twins elsewhere: pressed = on. */
function syncButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('button.sound').forEach((b) => {
    const k = kindOf(b);
    b.setAttribute('aria-pressed', String(on[k]));
    b.title = `${LABEL[k]} ${on[k] ? 'on' : 'off'}`;
  });
}

let meterBuf: Float32Array<ArrayBuffer> | null = null;
/** The output level now of the master, the music bus or the effects bus (RMS of the last 1024 samples); 0 before audio starts. */
export function level(of: keyof Buses['meter'] = 'master'): number {
  const b = buses;
  if (!b) return 0;
  if (!meterBuf) meterBuf = new Float32Array(1024);
  b.meter[of].getFloatTimeDomainData(meterBuf);
  let s = 0;
  for (const x of meterBuf) s += x * x;
  return Math.sqrt(s / meterBuf.length);
}

/** Context time → performance.now() time of the moment it is heard. */
export function ctxToPerf(t: number): number {
  const b = buses;
  if (!b) return performance.now();
  const ts = b.ctx.getOutputTimestamp?.();
  if (ts && ts.performanceTime && ts.contextTime !== undefined) return ts.performanceTime + (t - ts.contextTime) * 1000;
  return performance.now() + (t - b.ctx.currentTime) * 1000;
}

const NOTE = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">'
  + '<path d="M8 14.5V4.5l8-1.8v10" /><ellipse cx="6" cy="14.6" rx="2.2" ry="1.7" fill="currentColor"/>'
  + '<ellipse cx="14" cy="12.8" rx="2.2" ry="1.7" fill="currentColor"/><path class="off" d="M3 3l14 14"/></svg>';
const SPEAKER = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">'
  + '<path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path class="on" d="M13 7.2a4 4 0 0 1 0 5.6M15.3 5a7 7 0 0 1 0 10"/>'
  + '<path class="off" d="M13.5 7.5l5 5m0-5l-5 5"/></svg>';

/** Wire up the page: gestures unlock; the Music (class `sound music`) and Sound effects (`sound sfx`) buttons toggle. Call once. */
export function initAudio(): void {
  for (const ev of GESTURES) addEventListener(ev, unlock, true);
  // no suspending when the tab is hidden: the music keeps playing (a browser that suspends anyway is resumed on return)
  document.addEventListener('visibilitychange', () => { if (buses && !document.hidden && buses.ctx.state !== 'running') void buses.ctx.resume(); });
  document.querySelectorAll<HTMLButtonElement>('button.sound').forEach((b) => {
    const k = kindOf(b);
    b.innerHTML = k === 'music' ? NOTE : SPEAKER;
    b.setAttribute('aria-label', LABEL[k]);
    b.addEventListener('click', () => setSound(k, !on[k]));
  });
  syncButtons();
}
