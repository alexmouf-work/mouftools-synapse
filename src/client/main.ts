// App entry: fonts (self-hosted), styles, then the workbench. Train opens the training view in the same page (no
// reload); its result is saved into the workbench's brain. `?view=train` starts training the saved brain on load.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/workbench/workbench.css';
import './ui/training/training.css';
import { openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, start } from './ui/workbench/workbench';
import type { Saved } from './ui/workbench/store';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');

function train(s: Saved) {
  setActive(false);
  app!.hidden = true;
  openTraining(s, {
    save: (next) => replaceSaved(next),
    back: () => { app!.hidden = false; setActive(true); },
  }).catch((e) => { console.error(e); });
}

start({ onTrain: train });
if (new URLSearchParams(location.search).get('view') === 'train') train(currentSaved());
