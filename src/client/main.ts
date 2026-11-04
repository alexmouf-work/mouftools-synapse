// App entry: styles (one font site-wide: Arial, 400 and 700), then the brain designer (the workbench). Train opens the training view and Drive the drive view,
// both in the same page (no reload) over one shared 3-D stage. `?view=train` / `?view=drive` open them on load.
// Sound: the lounge plays on the (sandbox) workbench and the race music in the training and drive views, once the
// first tap or key has unlocked audio; its files are fetched after first paint.
import './ui/designer/designer.css';
import './ui/training/training.css';
import { audio, initAudio, isMuted } from './audio/audio';
import { musicMode, musicPlaying, musicReady, phraseNow, preloadMusic, setMode, win, winnerSeconds } from './audio/music';
import { showNotice } from './legal/notice';
import { openDrive } from './ui/drive/driveView';
import { openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, start } from './ui/designer/designer';
import type { Saved } from './ui/designer/store';
import { CONFIG } from '../common/config';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');
const back = () => { app.hidden = false; setActive(true); setMode('lounge'); };

function train(s: Saved, generations: number) {
  setMode('race');
  setActive(false);
  app!.hidden = true;
  openTraining(s, generations, { save: (next) => replaceSaved(next), back, drive }).catch((e) => { console.error(e); });
}

function drive(s: Saved) {
  setActive(false);
  app!.hidden = true;
  openDrive(s, { back }).catch((e) => { console.error(e); });
}

initAudio();
start({ onTrain: train });
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
if (view === 'train') train(currentSaved(), Number(new URLSearchParams(location.search).get('gens')) || CONFIG.train.defaultGenerations);
else if (view === 'drive') drive(currentSaved());
