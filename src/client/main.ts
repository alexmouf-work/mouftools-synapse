// App entry: fonts (self-hosted), styles, then the workbench. Train opens the training view and Drive the drive view,
// both in the same page (no reload) over one shared 3-D stage. `?view=train` / `?view=drive` open them on load.
// Sound: the lounge plays on the (sandbox) workbench and the race music in the training and drive views, once the
// first tap or key has unlocked audio; its files are fetched after first paint.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700-italic.css';
import './ui/workbench/workbench.css';
import './ui/training/training.css';
import { audio, initAudio, isMuted } from './audio/audio';
import { musicMode, musicPlaying, musicReady, phraseNow, preloadMusic, setMode, win, winnerSeconds } from './audio/music';
import { showNotice } from './legal/notice';
import { openDrive } from './ui/drive/driveView';
import { openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, start } from './ui/workbench/workbench';
import type { Saved } from './ui/workbench/store';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');
const back = () => { app.hidden = false; setActive(true); setMode('lounge'); };

function train(s: Saved) {
  setMode('race');
  setActive(false);
  app!.hidden = true;
  openTraining(s, { save: (next) => replaceSaved(next), back, drive }).catch((e) => { console.error(e); });
}

function drive(s: Saved) {
  setActive(false);
  app!.hidden = true;
  openDrive(s, { back }).catch((e) => { console.error(e); });
}

initAudio();
start({ onTrain: train, onDrive: drive });
showNotice();
requestAnimationFrame(() => setTimeout(preloadMusic, 0)); // after first paint: never in the workbench's way

// for checks (Playwright): the sound as it is now
declare global {
  interface Window {
    __audio?: { state: string; mode: string; phrase: string | null; playing: boolean; ready: boolean; muted: boolean; master: number; winnerS: number; win(): void };
  }
}
Object.defineProperty(window, '__audio', {
  get: () => {
    const b = audio();
    return {
      state: b?.ctx.state ?? 'locked', mode: musicMode(), phrase: phraseNow(), playing: musicPlaying(), ready: musicReady(),
      muted: isMuted(), master: b ? b.master.gain.value : 0, winnerS: winnerSeconds(), win,
    };
  },
});
const view = new URLSearchParams(location.search).get('view');
if (view === 'train') train(currentSaved());
else if (view === 'drive') drive(currentSaved());
