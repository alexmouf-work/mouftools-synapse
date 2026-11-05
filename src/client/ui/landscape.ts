// Landscape only (B9, docs/plans/2026-11-05-lobby-and-landscape.md §4; principal: "don't offer portrait mode."). An
// upright phone or tablet (portrait, its shorter side under 900 px) gets the full-screen "Turn your phone sideways"
// card. It is a modal dialog, so the page under it is inert (no taps, no focus) and it opens on top of any other
// dialog; Escape does not close it. Music and sound carry on. Where the browser allows it (an installed app or
// fullscreen), the screen is locked to landscape; a refusal is ignored. A desktop window taller than it is wide keeps
// working when its shorter side is 900 px or more.

const UPRIGHT = '(orientation: portrait) and (max-width: 899.98px)';

/** Try to lock the screen to landscape (most browsers allow it only installed or fullscreen). */
function lock(): void {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  if (!o || typeof o.lock !== 'function') return;
  try { o.lock('landscape').catch(() => undefined); } catch { /* not allowed here */ }
}

export function startLandscape(): void {
  const card = document.getElementById('rotate') as HTMLDialogElement | null;
  if (!card) throw new Error('landscape: #rotate missing');
  const mq = matchMedia(UPRIGHT);
  const sync = () => {
    if (mq.matches && !card.open) card.showModal();
    else if (!mq.matches && card.open) card.close();
  };
  card.addEventListener('cancel', (e) => e.preventDefault()); // Escape: still upright
  mq.addEventListener('change', sync);
  sync();
  lock();
  document.addEventListener('fullscreenchange', lock);
}

declare global { interface Window { __landscape?: () => { card: boolean } } }
window.__landscape = () => ({ card: (document.getElementById('rotate') as HTMLDialogElement | null)?.open ?? false });
