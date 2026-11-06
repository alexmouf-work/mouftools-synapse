// A phase countdown (docs/plans/2026-11-05-build-timer-and-cell-minus.md §2, reusable for every timed phase): a big
// label-over-number block in the vs CPU yellow, placed top centre in a host element; red under a threshold; in the
// last 5 s a pulse each second (none with reduced motion) and a tick on the Sound effects bus; at 0 an "up" text
// (e.g. "Time's up"), then onZero. One phase runs at a time: starting another replaces it. Runs on the client clock
// (display only, never the sim). While it shows, <body> carries `timed` (the designer makes room for it).
import { tick } from '../audio/sfx';

export interface PhaseOptions {
  /** Small caps over the number, e.g. "Build time". */
  label: string;
  /** Whole seconds to count down from. */
  seconds: number;
  /**
   * Or the moment 0 is reached (performance.now() ms), when the phase is measured from a timestamp it shares with
   * something else: a race's timer ends at its Go + 30 s, the moment its replay ends (match polish §4).
   */
  until?: number;
  /** Red at or under this many seconds (default 10). */
  red?: number;
  /** Pulse and tick at or under this many seconds (default 5). */
  pulse?: number;
  /** Shown at 0 (default "Time’s up"), for `upMs` before onZero runs (default 800 ms). */
  upText?: string;
  upMs?: number;
  /** Where the block sits (top centre of it; the host is made position: relative). */
  host: HTMLElement;
  /** Runs once, at 0, after the up text has shown. */
  onZero: () => void;
}

type State = 'off' | 'running' | 'up';
let state: State = 'off', deadline = 0, shown = -1, opts: PhaseOptions | null = null;
let loop: ReturnType<typeof setInterval> | undefined, upTimer: ReturnType<typeof setTimeout> | undefined;
let node: { box: HTMLElement; label: HTMLElement; num: HTMLElement; sub: HTMLElement } | null = null;

function ensure(): NonNullable<typeof node> {
  if (node) return node;
  const box = document.createElement('div'), label = document.createElement('span'), num = document.createElement('b'), sub = document.createElement('small');
  box.className = 'ptimer'; box.id = 'phaseTimer'; box.setAttribute('role', 'timer'); box.hidden = true;
  num.id = 'ptN'; sub.id = 'ptSub'; sub.hidden = true;
  box.append(label, num, sub);
  return (node = { box, label, num, sub });
}
const left = () => Math.max(0, Math.ceil((deadline - performance.now()) / 1000 - 1e-9));

function show(): void {
  if (state !== 'running' || !opts || !node) return;
  const n = left();
  if (n === shown) return;
  shown = n;
  const { box, num } = node, o = opts;
  if (n <= 0) {
    state = 'up';
    clearInterval(loop);
    num.textContent = o.upText ?? 'Time’s up';
    box.classList.add('red', 'up');
    box.classList.remove('pulse');
    upTimer = setTimeout(() => { if (state === 'up' && opts === o) o.onZero(); }, o.upMs ?? 800);
    return;
  }
  num.textContent = String(n);
  box.classList.toggle('red', n <= (o.red ?? 10));
  if (n <= (o.pulse ?? 5)) {
    box.classList.remove('pulse');
    void box.offsetWidth; // restart the pulse each second
    box.classList.add('pulse');
    tick();
  }
}

/** Start a phase countdown (replacing any running one). */
export function startPhaseTimer(o: PhaseOptions): void {
  stopPhaseTimer();
  opts = o;
  const n = ensure();
  if (n.box.parentElement !== o.host) o.host.appendChild(n.box);
  if (getComputedStyle(o.host).position === 'static') o.host.style.position = 'relative';
  n.label.textContent = o.label;
  n.sub.textContent = ''; n.sub.hidden = true;
  state = 'running'; deadline = o.until ?? performance.now() + o.seconds * 1000; shown = -1;
  n.box.hidden = false;
  n.box.classList.remove('red', 'pulse', 'up');
  document.body.classList.add('timed');
  show();
  loop = setInterval(show, 100);
}

/** A second line under the number (the training view's "gen n"), or '' for none. No-op while no countdown shows. */
export function setPhaseSub(text: string): void {
  if (!node || state === 'off') return;
  if (node.sub.textContent !== text) node.sub.textContent = text;
  node.sub.hidden = !text;
}
export const phaseShowing = (): boolean => state !== 'off';

/**
 * A Multiplayer match's timers follow the server's clock: set the running countdown to `seconds` left if it is more
 * than 0.3 s off (a better clock estimate, or a check's skip). No-op unless one is running.
 */
export function retimePhase(seconds: number): void {
  if (state !== 'running') return;
  const want = performance.now() + seconds * 1000;
  if (Math.abs(want - deadline) > 300) { deadline = want; shown = -1; show(); }
}

/** A Multiplayer match follows the server's clock: a check's skipTo moves that clock on too (ms skipped). */
let skipped: ((ms: number) => void) | null = null;
export function onPhaseSkip(fn: ((ms: number) => void) | null): void { skipped = fn; }

/** Cancel it (the phase ended early, or the player left). */
export function stopPhaseTimer(): void {
  clearInterval(loop); clearTimeout(upTimer);
  state = 'off'; shown = -1; opts = null;
  if (node) { node.box.hidden = true; node.box.classList.remove('red', 'pulse', 'up'); }
  document.body.classList.remove('timed');
}

// for checks (Playwright): the countdown as shown, and a way to jump it ahead (phases are wall-clock seconds)
declare global {
  interface Window {
    /** `ms` is the time left to 0; skipTo returns the ms it skipped (a room's checks move the server's clock as much). */
    __phase?: { state: State; label: string; left: number; ms: number; text: string; red: boolean; pulse: boolean; skipTo(seconds: number): number };
  }
}
Object.defineProperty(window, '__phase', {
  get: () => ({
    state, label: node?.label.textContent ?? '', left: state === 'running' ? left() : 0, ms: state === 'running' ? deadline - performance.now() : 0,
    text: node?.num.textContent ?? '', red: node?.box.classList.contains('red') ?? false, pulse: node?.box.classList.contains('pulse') ?? false,
    skipTo: (s: number) => {
      if (state !== 'running') return 0;
      const was = deadline;
      deadline = performance.now() + s * 1000;
      skipped?.(was - deadline);
      show();
      return was - deadline;
    },
  }),
});
