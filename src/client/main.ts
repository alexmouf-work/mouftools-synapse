// App entry: styles (one font site-wide: Arial, 400 and 700), then the title screen, which the page opens on (B2c).
// Sandbox opens the brain designer. Train opens the training view and Drive the drive view, all in the same page (no
// reload) over one shared 3-D stage. vs CPU opens its settings screen (ui/cpuSettings: your name and the map; tracks-v2
// T2), then a 5-round match (ui/rounds/rounds.ts: build → train → race each round, then the standings; Play again
// back to the settings). Multiplayer (B8, B9) opens its own screen: the room code, your name, then the room's lobby;
// when the host starts a match, every client plays the same 5 timed rounds from the server's clock
// (ui/rounds/roomRounds.ts, match-flow v2 §M2). Every screen but the title has a Main menu button (sidebar plan 2026-11-05): back to the title,
// asking first mid-match or in a room. Landscape only (B9): an upright phone gets "Turn your phone sideways" over
// everything (ui/landscape.ts). `?view=sandbox`, `?view=train`, `?view=drive`, `?view=cpu` and `?view=race` (a round's
// race with the saved brain; `&round=`) open those on load (checks). Music plays from the first tap or key on: the race
// track's quiet pool on the title, the lounge in the sandbox, the race sections while training and driving.
import './ui/designer/designer.css';
import './ui/training/training.css';
import { audio, initAudio, soundOn } from './audio/audio';
import { musicMode, musicPlaying, musicReady, phraseNow, preloadMusic, setMode, win, winnerSeconds } from './audio/music';
import { showNotice } from './legal/notice';
import { leaveDrive, openDrive } from './ui/drive/driveView';
import { leaveTraining, openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, setDesignerMode, start, timeUp, useMatchBrain } from './ui/designer/designer';
import { leaveRace } from './ui/race/raceView';
import { inRoom, leaveCurrentRoom, roomPlayers, showLobby, startLobby, watchMatch } from './ui/lobby/lobby';
import { abortMatch, inMatch, matchTrain, startMatch, type MatchViews } from './ui/rounds/rounds';
import { abortRoomMatch, inRoomMatch, roomTrain, startRoomMatch, type RoomViews } from './ui/rounds/roomRounds';
import { hideArena } from './ui/arena';
import { startLandscape } from './ui/landscape';
import { showTitle, startTitle } from './ui/title/title';
import { cpuSettingsShown, showCpuSettings, startCpuSettings } from './ui/cpuSettings/cpuSettings';
import { loadName } from './ui/tracks/tracks';
import { liveSfx } from './audio/sfx';
import { level } from './audio/audio';
import type { Saved } from './ui/designer/store';
import type { MapSetting } from '../common/sim/match';
import { CONFIG } from '../common/config';
import { stopPhaseTimer } from './ui/phaseTimer';
import { validTemperature } from '../common/train/trainer';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');
/** Which way the designer was opened: Sandbox, vs CPU or a room (both match mode). */
let where: 'sandbox' | 'cpu' | 'room' = 'sandbox';
const designerOff = () => { setActive(false); app!.hidden = true; showTitle(false); };
/** The sandbox designer: from the title, and back from training or driving. */
function sandbox() { stopPhaseTimer(); document.body.classList.remove('rounds'); where = 'sandbox'; useMatchBrain(null); setDesignerMode('sandbox'); showLobby(false); showTitle(false); app!.hidden = false; setActive(true); setMode('lounge'); }
/** vs CPU's views: each round's build in the designer (its own brain, the round's budget), training and the race. */
const matchViews: MatchViews = {
  build: (g, limit) => { where = 'cpu'; document.body.classList.add('rounds'); useMatchBrain(g); setDesignerMode('match', limit); showLobby(false); showCpuSettings(false); showTitle(false); app!.hidden = false; setActive(true); setMode('build'); },
  away: () => { designerOff(); setMode('race'); },
  timeUp,
  title: () => title(),
  again: () => cpu(),
};
/** A room's match: the same views on the room's timed rounds; between them the lobby (watching, joined mid-match). */
const roomViews: RoomViews = {
  build: (g, limit) => { where = 'room'; document.body.classList.add('rounds'); useMatchBrain(g); setDesignerMode('match', limit); showLobby(false); showTitle(false); app!.hidden = false; setActive(true); setMode('build'); },
  away: () => { showLobby(false); designerOff(); setMode('race'); },
  timeUp,
  watch: (text) => { where = 'room'; setActive(false); app!.hidden = true; leaveRace(); hideArena(); watchMatch(text); setMode('build'); },
  players: roomPlayers,
  menu: () => menu(),
  // the final standings' Play again: the lobby, where the host can change the settings and start the next match
  again: () => { abortRoomMatch(); hideArena(); useMatchBrain(null); document.body.classList.remove('rounds'); lobby(); },
};
/** vs CPU from the title (and Play again): its settings screen; no designer until the match starts. */
function cpu() {
  abortMatch(); leaveTraining(); leaveRace(); hideArena(); stopPhaseTimer();
  if (where === 'cpu') { useMatchBrain(null); where = 'sandbox'; }
  document.body.classList.remove('rounds');
  showLobby(false); setActive(false); app!.hidden = true; showTitle(false); showCpuSettings(true); setMode('build');
}
/** The settings screen's Start match. `?race=` (checks) fixes the match seed, so its race seeds. */
function cpuStart(name: string, map: MapSetting) {
  const q = new URLSearchParams(location.search).get('race');
  startMatch(matchViews, { seed: q !== null && /^\d+$/.test(q) ? Number(q) : undefined, name, map });
}
/** The room's lobby (or, if the host removed you meanwhile, Multiplayer's code screen saying so). */
function lobby() { stopPhaseTimer(); where = 'room'; showLobby(true); setMode('lounge'); } // the lobby plays the title's lounge (senses plan §1)
const back = () => (where === 'room' ? lobby() : sandbox());
/** Back to the title from anywhere: whatever runs stops (a match, training, a race, a drive). */
function title() {
  abortMatch(); abortRoomMatch(); leaveTraining(); leaveRace(); leaveDrive(); hideArena(); stopPhaseTimer();
  if (where === 'cpu' || where === 'room') { useMatchBrain(null); where = 'sandbox'; }
  document.body.classList.remove('rounds');
  showLobby(false); showCpuSettings(false); setActive(false); app!.hidden = true; showTitle(true); setMode('lounge');
}
/** Main menu (every screen but the title): mid-match or in a room it asks first, in the page. */
function menu() {
  const ask = (q: string, go: () => void) => {
    const d = document.getElementById('leaveDlg') as HTMLDialogElement;
    document.getElementById('lvQ')!.textContent = q;
    document.getElementById('lvStay')!.onclick = () => d.close();
    document.getElementById('lvGo')!.onclick = () => { d.close(); go(); };
    d.showModal();
  };
  if (where === 'cpu' && inMatch()) ask('Leave the match?', title);
  else if (cpuSettingsShown()) title();
  else if (where === 'room' && inRoom()) ask('Leave the room?', () => { leaveTraining(); leaveRace(); hideArena(); leaveCurrentRoom(); });
  else title();
}

function train(s: Saved, generations: number, temperature = 0) {
  stopPhaseTimer();
  if (where === 'cpu' && inMatch()) { matchTrain(s); return; }
  if (where === 'room' && inRoomMatch()) { roomTrain(s); return; }
  setMode('race');
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  openTraining(s, generations, temperature, { save: (next) => replaceSaved(next), back, drive }, false)
    .catch((e) => { console.error(e); });
}

function drive(s: Saved) {
  stopPhaseTimer();
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  openDrive(s, { back }).catch((e) => { console.error(e); });
}

startLandscape();
initAudio();
start({ onTrain: train });
startTitle({ onSandbox: sandbox, onCpu: () => cpu() });
startCpuSettings({ start: cpuStart, menu: () => title() });
startLobby({
  show: (on) => { if (on) { stopPhaseTimer(); setActive(false); app!.hidden = true; showTitle(false); setMode('lounge'); } else title(); },
  match: (info) => { where = 'room'; startRoomMatch(roomViews, info); },
  // removed from the room (or it closed) mid-match: whatever the match showed stops; the code screen says why
  lost: () => { abortRoomMatch(); leaveTraining(); leaveRace(); hideArena(); stopPhaseTimer(); useMatchBrain(null); document.body.classList.remove('rounds'); setActive(false); app!.hidden = true; },
});
for (const id of ['toTitle', 'tvMenu', 'rcMenu', 'dvMenu', 'lbMenu']) document.getElementById(id)!.onclick = menu;
showNotice();
requestAnimationFrame(() => setTimeout(preloadMusic, 0)); // after first paint: never in the workbench's way

// for checks (Playwright): the sound as it is now
declare global {
  interface Window {
    __audio?: {
      state: string; mode: string; phrase: string | null; playing: boolean; ready: boolean; winnerS: number; win(): void;
      /** The two toggles, and the master / music-bus / effects-bus gains now. */
      music: boolean; sfx: boolean; master: number; musicGain: number; sfxGain: number;
      /** Racing effects still sounding or scheduled (engines, countdown blips). */
      liveSfx: number;
      /** Output levels now (RMS): the master (for the music-continuity check), the music bus and the effects bus. */
      level: number; musicLevel: number; sfxLevel: number;
    };
  }
}
Object.defineProperty(window, '__audio', {
  get: () => {
    const b = audio();
    return {
      state: b?.ctx.state ?? 'locked', mode: musicMode(), phrase: phraseNow(), playing: musicPlaying(), ready: musicReady(),
      ...soundOn(), master: b ? b.master.gain.value : 0, musicGain: b ? b.music.gain.value : 0, sfxGain: b ? b.sfx.gain.value : 0,
      winnerS: winnerSeconds(), win, liveSfx: liveSfx(), level: level(), musicLevel: level('music'), sfxLevel: level('sfx'),
    };
  },
});
const view = new URLSearchParams(location.search).get('view');
if (view === 'train') {
  const q = new URLSearchParams(location.search), t = Number(q.get('temp') ?? 0);
  train(currentSaved(), Number(q.get('gens')) || CONFIG.train.defaultGenerations, validTemperature(t) ? t : 0);
}
else if (view === 'drive') drive(currentSaved());
else if (view === 'sandbox') sandbox();
else if (view === 'cpu') cpu();
else if (view === 'race') {
  // a round's race with the saved brain (checks): `race` fixes the match seed (so the track), `round` which round
  const q = new URLSearchParams(location.search), num = (k: string) => (/^\d+$/.test(q.get(k) ?? '') ? Number(q.get(k)) : undefined);
  where = 'cpu';
  startMatch(matchViews, { seed: num('race'), round: num('round') ?? 1, raceWith: currentSaved(), name: loadName() || undefined });
}
else title();
