// The arena: one full-screen canvas and one 3-D stage, shared by the training view and the drive view (each with
// its own overlay). The stage is created on first use (three.js loads then) and kept; if WebGL is unavailable the
// views carry on without it and say so.
import type { Stage } from '../render/stage';

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

export function showArena(which: 'train' | 'drive'): void {
  document.body.classList.add('training');
  el('arena').hidden = false;
  el('trainOverlay').hidden = which !== 'train';
  el('driveOverlay').hidden = which !== 'drive';
  stage?.resize();
}

export function hideArena(): void {
  el('arena').hidden = true;
  document.body.classList.remove('training');
}

window.addEventListener('resize', () => { stage?.resize(); });
