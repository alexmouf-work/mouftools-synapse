// App entry: styles (one font site-wide: Arial, 400 and 700), then the title screen, which the page opens on (B2c).
// Sandbox opens the brain designer; the designer's wordmark goes back to the title. Train opens the training view and
// Drive the drive view, all in the same page (no reload) over one shared 3-D stage. `?view=sandbox`, `?view=train` and
// `?view=drive` open those on load (for the checks). Music plays from the first tap or key on: the race track's quiet
// pool on the title, the lounge in the sandbox, the race sections while training and driving; it never stops after.
import './ui/designer/designer.css';
import './ui/training/training.css';
import { audio, initAudio, soundOn } from './audio/audio';
import { musicMode, musicPlaying, musicReady, phraseNow, preloadMusic, setMode, win, winnerSeconds } from './audio/music';
import { showNotice } from './legal/notice';
import { openDrive } from './ui/drive/driveView';
import { openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, start } from './ui/designer/designer';
import { showTitle, startTitle } from './ui/title/title';
import { liveSfx } from './audio/sfx';
import { level } from './audio/audio';
import type { Saved } from './ui/designer/store';
import { CONFIG } from '../common/config';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');
/** The sandbox designer: from the title, and back from training or driving. */
function sandbox() { showTitle(false); app!.hidden = false; setActive(true); setMode('lounge'); }
const back = sandbox;
function title() { setActive(false); app!.hidden = true; showTitle(true); setMode('build'); }

function train(s: Saved, generations: number) {
  setMode('race');
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  openTraining(s, generations, { save: (next) => replaceSaved(next), back, drive }).catch((e) => { console.error(e); });
}

function drive(s: Saved) {
  showTitle(false);
  setActive(false);
  app!.hidden = true;
  openDrive(s, { back }).catch((e) => { console.error(e); });
}

initAudio();
start({ onTrain: train });
startTitle({ onSandbox: sandbox });
document.getElementById('toTitle')!.onclick = title;
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
if (view === 'train') train(currentSaved(), Number(new URLSearchParams(location.search).get('gens')) || CONFIG.train.defaultGenerations);
else if (view === 'drive') drive(currentSaved());
else if (view === 'sandbox') sandbox();
else title();
