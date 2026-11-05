// Choosing tracks (tracks-v2 plan, stage T2). One picker, three places:
// - the sandbox's Track button (designer top bar): Random, or one of the seven families as map previews, each with a
//   Shuffle that draws another track of that family; the chosen track's big preview shows its length and features
//   (the T1 validator's `Track.features`). Remembered on the device as `synapse.track` (family and seed). It is the track
//   Drive uses and training's first track; training's second is another track of the same family (chosenTrainTracks).
// - vs CPU's settings screen and a room's Settings: the map for the match's five rounds: "New track each round",
//   "One family" (a new track of it each round) or "One track" (a family, shuffled to one track for all five rounds).
// A chosen track is a plain seed whose own family is the family (seedOfFamily), so every view that takes a track seed
// takes it unchanged. Also here: the player's name for vs CPU and Multiplayer (`synapse.name`). Storage can be missing
// or throw (private windows, blocked site data): every access is guarded; nothing is remembered then.
import './tracks.css';
import { FAMILIES, generateTrack, seedOfFamily, type Family, type Track } from '../../../common/sim/track';
import { validMap, type MapMode, type MapSetting } from '../../../common/sim/match';
import { CONFIG } from '../../../common/config';
import { chosenTrainTracks } from '../../../common/train/phase';
import { TrackMap } from '../training/map';
import { cleanName } from '../../net/rooms';

export const NAME_KEY = 'synapse.name';
export const TRACK_KEY = 'synapse.track';
export const NAME_MAX = 16;


export function loadName(): string {
  try { const v = localStorage.getItem(NAME_KEY); return v ? cleanName(v).slice(0, NAME_MAX) : ''; } catch { return ''; }
}
export function saveName(n: string): void {
  const v = cleanName(n);
  if (!v) return;
  try { localStorage.setItem(NAME_KEY, v.slice(0, NAME_MAX)); } catch { /* not remembered */ }
}

/** The sandbox's track: a family and a seed of it, or null for Random (new tracks, as before T2). */
export type TrackChoice = { family: Family; seed: number } | null;
export function loadTrack(): TrackChoice {
  try {
    const o = JSON.parse(localStorage.getItem(TRACK_KEY) ?? 'null') as { family?: string; seed?: number } | null;
    if (!o || !FAMILIES.includes(o.family as Family)) return null;
    const m = validMap({ mode: 'track', family: o.family as Family, seed: o.seed });
    return { family: m.family, seed: m.seed };
  } catch { return null; }
}
export function saveTrack(c: TrackChoice): void {
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(c ? { family: c.family, seed: c.seed } : { family: 'random' })); } catch { /* not remembered */ }
}
/** Training tracks for a sandbox Train (undefined: the phase's own, Random). */
export function sandboxTrainTracks(seed: number, phase: number): number[] | undefined {
  const c = loadTrack();
  return c ? chosenTrainTracks(c.seed, c.family, seed, phase) : undefined;
}

export const FAMILY_NAMES: Record<Family, string> = { loop: 'Loop', kidney: 'Kidney', hairpin: 'Hairpin', chicane: 'Chicane', dogleg: 'Dogleg', clover: 'Clover', eight: 'Figure eight' };
export const MODE_NAMES: Record<MapMode, string> = { each: 'New track each round', family: 'One family', track: 'One track' };

const tracks = new Map<number, Track>();
/** A seed's track (generated once per page; ~2 ms each). */
export function trackOf(seed: number): Track {
  let t = tracks.get(seed);
  if (!t) { t = generateTrack(seed); tracks.set(seed, t); if (tracks.size > 64) tracks.delete(tracks.keys().next().value!); }
  return t;
}
export const fmtLen = (t: Track): string => `${(t.len / 1000).toFixed(2)} km`;
/** The features the validator found, counted ("2 hairpins · chicane"); the figure eight's bridge. */
export function featureText(t: Track): string {
  const n = new Map<string, number>();
  for (const f of t.features) n.set(f.kind, (n.get(f.kind) ?? 0) + 1);
  const parts = [...n].map(([k, c]) => (c > 1 ? `${c} ${k === 'esses' ? 'esses' : `${k}s`}` : k));
  if (t.crossing) parts.push('a bridge over the crossing');
  return parts.join(' · ');
}
/** A map setting in words (the lobby's read-only line). */
export function mapText(m: MapSetting): string {
  if (m.mode === 'each') return MODE_NAMES.each;
  if (m.mode === 'family') return `One family: ${FAMILY_NAMES[m.family]}`;
  const t = trackOf(m.seed);
  return `One track: ${FAMILY_NAMES[m.family]}, ${fmtLen(t)}`;
}

/** A fresh base for Shuffle (crypto: display only, never inside the sim). */
const freshBase = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
/** Each family's preview before any Shuffle: the same on every visit. */
const firstSeed = (f: Family): number => seedOfFamily(f, FAMILIES.indexOf(f) + 1);

export interface Picker {
  el: HTMLElement;
  get(): MapSetting;
  set(v: MapSetting): void;
  setReadOnly(on: boolean): void;
  /** Draw the previews (after the picker is shown: a hidden canvas has no size). */
  redraw(): void;
}

/**
 * A track picker. `sandbox`: Random and the seven families, each with Shuffle; the value's mode is 'each' (Random) or
 * 'track'. `match`: the three map modes; the families show in "One family" and "One track", Shuffle in "One track".
 * `onChange` hears every pick (not `set`).
 */
export function createPicker(o: { kind: 'sandbox' | 'match'; value: MapSetting; onChange?(v: MapSetting): void; id: string }): Picker {
  const sandbox = o.kind === 'sandbox';
  let v = validMap(o.value), ro = false;
  const seeds = Object.fromEntries(FAMILIES.map((f) => [f, firstSeed(f)])) as Record<Family, number>;
  if (v.mode === 'track') seeds[v.family] = v.seed;
  const el = document.createElement('div');
  el.className = `tp ${o.kind}`;
  el.id = o.id;
  const modes = sandbox ? '' : `<div class="tp-modes" role="radiogroup" aria-label="Map">${(['each', 'family', 'track'] as MapMode[]).map((m) => `<button type="button" role="radio" data-mode="${m}">${MODE_NAMES[m]}</button>`).join('')}</div>`;
  const cells = [
    ...(sandbox ? ['<div class="tp-cell"><button type="button" class="tp-card" role="radio" data-f="random"><span class="tp-rand" aria-hidden="true">?</span><b>Random</b></button></div>'] : []),
    ...FAMILIES.map((f) => `<div class="tp-cell"><button type="button" class="tp-card" role="radio" data-f="${f}"><canvas aria-hidden="true"></canvas><b>${FAMILY_NAMES[f]}</b></button><button type="button" class="tp-shuf" data-f="${f}" aria-label="Shuffle ${FAMILY_NAMES[f]}">Shuffle</button></div>`),
  ].join('');
  el.innerHTML = `${modes}<div class="tp-body"><div class="tp-grid" role="radiogroup" aria-label="Track">${cells}</div>`
    + '<div class="tp-big" aria-live="polite"><canvas class="tp-bigmap" aria-label="The chosen track"></canvas><div class="tp-info"><b class="tp-name"></b><span class="tp-len"></span><span class="tp-feat"></span></div></div></div>';
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const maps = new Map<string, TrackMap>();
  const mapFor = (c: HTMLCanvasElement, key: string) => { let m = maps.get(key); if (!m) { m = new TrackMap(c); maps.set(key, m); } return m; };
  /** Show the value: modes, cards, Shuffle buttons, the big preview. */
  const show = () => {
    el.dataset.mode = v.mode;
    el.querySelectorAll<HTMLButtonElement>('.tp-modes [data-mode]').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.mode === v.mode)); b.disabled = ro; });
    const fam = v.mode === 'each' ? (sandbox ? 'random' : '') : v.family;
    el.querySelectorAll<HTMLButtonElement>('.tp-card').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.f === fam)); b.disabled = ro; });
    el.querySelectorAll<HTMLButtonElement>('.tp-shuf').forEach((b) => { b.hidden = !sandbox && v.mode !== 'track'; b.disabled = ro; });
    const name = q('.tp-name'), len = q('.tp-len'), feat = q('.tp-feat'), big = q<HTMLCanvasElement>('.tp-bigmap');
    if (v.mode === 'each') {
      big.hidden = true;
      name.textContent = sandbox ? 'Random' : MODE_NAMES.each;
      len.textContent = sandbox ? 'Training and Drive draw new tracks from every family.' : 'Every round races on a new track, from any family.';
      feat.textContent = '';
    } else {
      const t = trackOf(v.mode === 'track' ? v.seed : seeds[v.family]);
      big.hidden = false;
      name.textContent = FAMILY_NAMES[v.family];
      len.textContent = v.mode === 'family' ? `A new ${FAMILY_NAMES[v.family].toLowerCase()} track each round, like this one (${fmtLen(t)}).` : fmtLen(t);
      feat.textContent = v.mode === 'family' ? '' : featureText(t);
    }
    el.dataset.seed = v.mode === 'track' ? String(v.seed) : '';
    redraw();
  };
  const redraw = () => {
    for (const f of FAMILIES) {
      const m = mapFor(el.querySelector<HTMLCanvasElement>(`.tp-card[data-f="${f}"] canvas`)!, f);
      m.setTrack(trackOf(seeds[f])); m.draw([]);
    }
    if (v.mode !== 'each') {
      const m = mapFor(q<HTMLCanvasElement>('.tp-bigmap'), 'big');
      m.setTrack(trackOf(v.mode === 'track' ? v.seed : seeds[v.family])); m.draw([]);
    }
  };
  const pick = (next: MapSetting) => { v = validMap(next); show(); o.onChange?.(v); };
  el.addEventListener('click', (e) => {
    if (ro) return;
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.mode) { const m = b.dataset.mode as MapMode; pick({ mode: m, family: v.family, seed: m === 'track' ? seeds[v.family] : v.seed }); return; }
    const f = b.dataset.f;
    if (!f) return;
    if (f === 'random') { pick({ mode: 'each', family: v.family, seed: v.seed }); return; }
    const fam = f as Family;
    if (b.classList.contains('tp-shuf')) seeds[fam] = seedOfFamily(fam, freshBase(), seeds[fam]);
    pick({ mode: sandbox ? 'track' : v.mode === 'each' ? 'family' : v.mode, family: fam, seed: seeds[fam] });
  });
  new ResizeObserver(() => redraw()).observe(el);
  show();
  return {
    el,
    get: () => v,
    set: (n) => { v = validMap(n); if (v.mode === 'track') seeds[v.family] = v.seed; show(); },
    setReadOnly: (on) => { if (on !== ro) { ro = on; el.classList.toggle('ro', on); show(); } },
    redraw,
  };
}

/** The sandbox's choice as a picker value, and back. */
export const choiceToMap = (c: TrackChoice): MapSetting => (c ? { mode: 'track', family: c.family, seed: c.seed } : { mode: 'each', family: 'loop', seed: 0 });
export const mapToChoice = (m: MapSetting): TrackChoice => (m.mode === 'track' ? { family: m.family, seed: m.seed } : null);

// ---- the sandbox's Track dialog ----
let sandboxPicker: Picker | null = null;
/** The designer's Track button: open the picker; every pick is remembered at once (Done closes it). */
export function openTrackDialog(): void {
  const d = document.getElementById('trackDlg') as HTMLDialogElement;
  if (!sandboxPicker) {
    sandboxPicker = createPicker({ kind: 'sandbox', value: choiceToMap(loadTrack()), id: 'trackPick', onChange: (m) => { saveTrack(mapToChoice(m)); syncTrackButton(); } });
    document.getElementById('tdPick')!.appendChild(sandboxPicker.el);
    document.getElementById('tkDone')!.onclick = () => d.close();
  } else sandboxPicker.set(choiceToMap(loadTrack()));
  d.showModal();
  requestAnimationFrame(() => sandboxPicker?.redraw());
}
/** The Track button names what is chosen (its tooltip and label: the top bar has room for "Track" only). */
export function syncTrackButton(): void {
  const b = document.getElementById('trackBtn');
  if (!b) return;
  const c = loadTrack(), what = `Track: ${c ? `${FAMILY_NAMES[c.family]}, ${fmtLen(trackOf(c.seed))}` : 'Random'}`;
  b.title = what; b.setAttribute('aria-label', what);
}

// for checks (Playwright): the sandbox's choice as stored, and the tracks it gives (training's and Drive's)
declare global {
  interface Window {
    __tracks?: {
      choice: () => TrackChoice; trainTracks: (seed: number, phase: number) => number[] | null; picker: () => MapSetting | null; trainCount: number;
      /** The track Drive opens on for an untrained brain (set by the drive view). */
      drive?: () => number;
    };
  }
}
window.__tracks = {
  choice: loadTrack,
  trainTracks: (seed, phase) => sandboxTrainTracks(seed, phase) ?? null,
  picker: () => sandboxPicker?.get() ?? null,
  trainCount: CONFIG.train.trainTracks,
};
