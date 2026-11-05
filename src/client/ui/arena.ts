// The arena: one full-screen canvas and one 3-D stage, shared by the training, drive and race views (each with
// its own overlay). The stage is created on first use (three.js loads then) and kept; if WebGL is unavailable the
// views carry on without it and say so.
import type { Stage } from '../render/stage';
import { stopRacingSounds } from '../audio/racing';

let stage: Stage | null = null;
let failed = false;

const el = (id: string) => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`arena: #${id} missing`);
  return e;
};

/** The shared stage, or null if WebGL is unavailable. */
export async function getStage(): Promise<Stage | null> {
  if (stage || failed) return stage;
  const q = new URLSearchParams(location.search).get('quality');
  try {
    const { Stage } = await import('../render/stage');
    stage = new Stage(el('scene') as HTMLCanvasElement, q === 'low' || q === 'high' ? q : undefined);
  } catch (e) {
    console.warn('arena: no 3-D view', e);
    failed = true;
    const p = document.createElement('p');
    p.className = 'tv-nogl';
    p.textContent = 'The 3-D view needs WebGL, which this browser has turned off. Everything else still works; the numbers are in the panels.';
    el('arena').appendChild(p);
  }
  stage?.resize();
  return stage;
}

/** Every change of race view (training ↔ drive ↔ race, a new run, a new track) starts from silence: no leftover effects. */
export function showArena(which: 'train' | 'drive' | 'race'): void {
  stopRacingSounds();
  document.body.classList.add('training');
  el('arena').hidden = false;
  el('arena').classList.toggle('train', which === 'train'); // the training view's camera sits right of its panel
  el('trainOverlay').hidden = which !== 'train';
  el('driveOverlay').hidden = which !== 'drive';
  el('raceOverlay').hidden = which !== 'race';
  stage?.resize();
}

/** Leaving the race views for good (Back, the title): their effects stop; the music carries on. */
export function hideArena(): void {
  stopRacingSounds();
  el('arena').hidden = true;
  document.body.classList.remove('training');
}

window.addEventListener('resize', () => { stage?.resize(); });
