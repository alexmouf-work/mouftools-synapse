// vs CPU's settings screen (tracks-v2 plan, stage T2): title → vs CPU opens it, and the final standings' Play again
// comes back to it. Your name, required (1–16 characters, spaces collapsed, as in Multiplayer), remembered on the device
// as `synapse.name` and filled in next time; the map for the five rounds: "New track each round" (the default), "One
// family" or "One track" (a family, shuffled to one track). Start match begins round 1's build; Main menu goes back.
// There is no designer here: building starts with the match (principal 2026-11-05).
import './cpuSettings.css';
import { NEW_EACH_ROUND, type MapSetting } from '../../../common/sim/match';
import { cleanName } from '../../net/rooms';
import { createPicker, loadName, NAME_MAX, saveName, type Picker } from '../tracks/tracks';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`cpuSettings: #${id} missing`);
  return e as T;
};

let picker: Picker | null = null;
let shown = false;
/** The map as last set this visit (Play again keeps it); a new visit starts on "New track each round". */
let map: MapSetting = NEW_EACH_ROUND;

export interface CpuSettingsHooks { start(name: string, map: MapSetting): void; menu(): void }

export function startCpuSettings(h: CpuSettingsHooks): void {
  const name = $<HTMLInputElement>('csName');
  name.maxLength = NAME_MAX;
  name.addEventListener('input', sync);
  $('csForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = cleanName(name.value);
    if (!n) { sync(); name.focus(); return; }
    saveName(n);
    h.start(n, picker!.get());
  });
  $('csMenu').onclick = () => h.menu();
  picker = createPicker({ kind: 'match', value: map, id: 'csMap', onChange: (m) => { map = m; } });
  $('csPick').appendChild(picker.el);
}

/** The name as typed: spaces collapsed (a leading one dropped), the counter; Start needs one. */
function sync(): void {
  const input = $<HTMLInputElement>('csName');
  const v = input.value.replace(/\s+/g, ' ').replace(/^ /, '').slice(0, NAME_MAX);
  if (v !== input.value) input.value = v;
  $('csCount').textContent = `${v.length} / ${NAME_MAX}`;
  const ok = cleanName(v) !== '';
  $<HTMLButtonElement>('csStart').disabled = !ok;
  $('csErr').textContent = ok ? '' : 'Type your name to start (1–16 characters).';
}

/** Show the screen (your remembered name filled in), or hide it. */
export function showCpuSettings(on: boolean): void {
  shown = on;
  $('cpuSet').hidden = !on;
  if (!on) return;
  const input = $<HTMLInputElement>('csName');
  if (!cleanName(input.value)) input.value = loadName();
  picker!.set(map);
  sync();
  requestAnimationFrame(() => picker?.redraw());
  if (!input.value) setTimeout(() => input.focus(), 0);
}
export const cpuSettingsShown = (): boolean => shown;

// for checks (Playwright)
declare global { interface Window { __cpuSet?: { shown: () => boolean; name: () => string; map: () => MapSetting | null } } }
window.__cpuSet = { shown: () => shown, name: () => ($('csName') as HTMLInputElement).value, map: () => picker?.get() ?? null };
