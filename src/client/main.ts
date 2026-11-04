// App entry: fonts (self-hosted), styles, then the workbench. Train opens the training view and Drive the drive view,
// both in the same page (no reload) over one shared 3-D stage. `?view=train` / `?view=drive` open them on load.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700-italic.css';
import './ui/workbench/workbench.css';
import './ui/training/training.css';
import { showNotice } from './legal/notice';
import { openDrive } from './ui/drive/driveView';
import { openTraining } from './ui/training/trainingView';
import { currentSaved, replaceSaved, setActive, start } from './ui/workbench/workbench';
import type { Saved } from './ui/workbench/store';

const app = document.querySelector<HTMLElement>('.app');
if (!app) throw new Error('main: .app missing');
const back = () => { app.hidden = false; setActive(true); };

function train(s: Saved) {
  setActive(false);
  app!.hidden = true;
  openTraining(s, { save: (next) => replaceSaved(next), back, drive }).catch((e) => { console.error(e); });
}

function drive(s: Saved) {
  setActive(false);
  app!.hidden = true;
  openDrive(s, { back }).catch((e) => { console.error(e); });
}

start({ onTrain: train, onDrive: drive });
showNotice();
const view = new URLSearchParams(location.search).get('view');
if (view === 'train') train(currentSaved());
else if (view === 'drive') drive(currentSaved());
