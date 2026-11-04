// Sound (docs/plans/2026-11-04-sound.md): one AudioContext with a master gain, a music bus and an effects bus.
// Browsers start audio only after a gesture, so the context is created on the first pointerdown, keydown or
// touchstart anywhere (the music then starts in whatever mode the view asked for). The mute choice is remembered
// in localStorage `synapse.sound` (strictly necessary; listed on /cookies). The context is suspended while the tab is
// hidden and resumed when it is visible again. Nothing here touches the sim: src/common stays pure.

export const SOUND_KEY = 'synapse.sound';

export interface Buses { ctx: AudioContext; master: GainNode; music: GainNode; sfx: GainNode }

let buses: Buses | null = null;
let muted = readMuted();
const onReady: ((b: Buses) => void)[] = [];

function readMuted(): boolean {
  try { return localStorage.getItem(SOUND_KEY) === 'off'; } catch { return false; }
}

/** The audio graph, once the first gesture has unlocked it (null until then). */
export const audio = (): Buses | null => buses;
export const isMuted = (): boolean => muted;
/** True when sound can be heard now: unlocked, running and not muted (the countdown then follows the music). */
export const audible = (): boolean => !!buses && !muted && buses.ctx.state === 'running';

/** Run f once the graph exists (now, if it already does). */
export function whenReady(f: (b: Buses) => void): void {
  if (buses) f(buses); else onReady.push(f);
}

function unlock(): void {
  if (buses) { if (!document.hidden) void buses.ctx.resume(); return; }
  const ctx = new AudioContext();
  const master = ctx.createGain(), music = ctx.createGain(), sfx = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  music.gain.value = 0.7;
  sfx.gain.value = 0.9;
  music.connect(master); sfx.connect(master); master.connect(ctx.destination);
  buses = { ctx, master, music, sfx };
  void ctx.resume();
  for (const f of onReady.splice(0)) f(buses);
  for (const ev of GESTURES) removeEventListener(ev, unlock, true);
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

export function setMuted(m: boolean): void {
  muted = m;
  try { localStorage.setItem(SOUND_KEY, m ? 'off' : 'on'); } catch { /* can't remember: lasts until the tab closes */ }
  if (buses) buses.master.gain.setTargetAtTime(m ? 0 : 1, buses.ctx.currentTime, 0.05);
  syncButtons();
}

/** Every speaker button (class `sound`) shows the same state: pressed = sound on. */
function syncButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('button.sound').forEach((b) => {
    b.setAttribute('aria-pressed', String(!muted));
    b.title = muted ? 'Sound off' : 'Sound on';
  });
}

/** Context time → performance.now() time of the moment it is heard. */
export function ctxToPerf(t: number): number {
  const b = buses;
  if (!b) return performance.now();
  const ts = b.ctx.getOutputTimestamp?.();
  if (ts && ts.performanceTime && ts.contextTime !== undefined) return ts.performanceTime + (t - ts.contextTime) * 1000;
  return performance.now() + (t - b.ctx.currentTime) * 1000;
}

const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">'
  + '<path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path class="on" d="M13 7.2a4 4 0 0 1 0 5.6M15.3 5a7 7 0 0 1 0 10"/>'
  + '<path class="off" d="M13.5 7.5l5 5m0-5l-5 5"/></svg>';

/** Wire up the page: gestures unlock, hidden tabs suspend, speaker buttons toggle. Call once. */
export function initAudio(): void {
  for (const ev of GESTURES) addEventListener(ev, unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!buses) return;
    if (document.hidden) void buses.ctx.suspend(); else void buses.ctx.resume();
  });
  document.querySelectorAll<HTMLButtonElement>('button.sound').forEach((b) => {
    b.innerHTML = ICON;
    b.setAttribute('aria-label', 'Sound');
    b.addEventListener('click', () => setMuted(!muted));
  });
  syncButtons();
}
