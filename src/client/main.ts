// App entry: styles (one font site-wide: Arial, 400 and 700), then the title screen, which the page opens on (B2c).
// Sandbox opens the brain designer; the designer's wordmark goes back to the title. Train opens the training view and
// Drive the drive view, all in the same page (no reload) over one shared 3-D stage. vs CPU (B7) opens the designer in
// match mode: Train spends the fixed budget T, then Race → the race view → results → Race again or Back to the
// designer. Multiplayer (B8, B9) opens its own screen: the room code, your name, then the room's lobby: Build your brain
// (the match designer; training ends with Hand in), and when the host starts, the race on every client; Back to room.
// Landscape only (B9): an upright phone gets "Turn your phone sideways" over everything (ui/landscape.ts). `?view=sandbox`, `?view=train`, `?view=drive`, `?view=cpu` and `?view=race` open those on load (checks). Music plays from the first tap or key on: the race track's quiet
// pool on the title, the lounge in the sandbox, the race sections while training and driving; it never stops after.
import './ui/designer/designer.css';
import './ui/training/training.css';
import { audio, initAudio, soundOn } from './audio/audio';
import { musicMode, musicPlaying, musicReady, phraseNow, preloadMusic, setMode, win, winnerSeconds } from './audio/music';
import { showNotice } from './legal/notice';
import { openDrive } from './ui/drive/driveView';
import { openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, setDesignerMode, start } from './ui/designer/designer';
import { cpuSetup, firstSeed, openRace } from './ui/race/raceView';
import { handIn, inRoom, reportResult, showLobby, startLobby } from './ui/lobby/lobby';
import { startLandscape } from './ui/landscape';
import { showTitle, startTitle } from './ui/title/title';
import { liveSfx } from './audio/sfx';
import { level } from './audio/audio';
import type { Saved } from './ui/designer/store';
import { CONFIG } from '../common/config';
import { validTemperature } from '../common/train/trainer';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');
/** Which way the designer was opened: Sandbox, vs CPU or a room (both match mode). */
let where: 'sandbox' | 'cpu' | 'room' = 'sandbox';
/** The sandbox designer: from the title, and back from training or driving. */
function sandbox() { where = 'sandbox'; setDesignerMode('sandbox'); showLobby(false); showTitle(false); app!.hidden = false; setActive(true); setMode('lounge'); }
/** vs CPU (and a room's Build and train): the designer in match mode, with the lobby's building music (sound plan). */
function cpu(w: 'cpu' | 'room' = 'cpu') { where = w; setDesignerMode('match'); showLobby(false); showTitle(false); app!.hidden = false; setActive(true); setMode('build'); }
/** The room's lobby (or, if the host removed you meanwhile, Multiplayer's code screen saying so). */
function lobby() { where = 'room'; showLobby(true); setMode('build'); }
const back = () => (where === 'room' ? lobby() : where === 'cpu' ? cpu() : sandbox());
function title() { showLobby(false); setActive(false); app!.hidden = true; showTitle(true); setMode('lounge'); }

function train(s: Saved, generations: number, temperature = 0) {
  setMode('race');
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  const room = where === 'room';
  const hand = (next: Saved) => { handIn(next).then(lobby).catch((e) => { console.error(e); lobby(); }); };
  openTraining(s, generations, temperature, { save: (next) => replaceSaved(next), back, drive, race: room ? hand : race, raceLabel: room ? 'Hand in' : 'Race' }, where !== 'sandbox')
    .catch((e) => { console.error(e); });
}

/** vs CPU: race the brain; Race again draws a new race. */
function race(s: Saved, seed = firstSeed()) {
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  openRace(cpuSetup(s, seed), { back, again: () => race(currentSaved(), crypto.getRandomValues(new Uint32Array(1))[0]) }).catch((e) => { console.error(e); });
}

function drive(s: Saved) {
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  openDrive(s, { back }).catch((e) => { console.error(e); });
}

startLandscape();
initAudio();
start({ onTrain: train });
startTitle({ onSandbox: sandbox, onCpu: () => cpu() });
startLobby({
  show: (on) => { if (on) { setActive(false); app!.hidden = true; showTitle(false); setMode('build'); } else title(); },
  build: () => cpu('room'),
  race: (setup) => {
    showTitle(false); setActive(false); app!.hidden = true;
    openRace(setup, { back: lobby, result: (row) => reportResult(row, setup.raceNo ?? 0) }).catch((e) => { console.error(e); });
  },
});
document.getElementById('toTitle')!.onclick = () => (where === 'room' && inRoom() ? lobby() : title());
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
else if (view === 'race') { where = 'cpu'; setDesignerMode('match'); race(currentSaved()); }
else title();
