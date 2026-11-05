// First-visit storage notice (UK GDPR / PECR). Synapse stores only what it needs to work: the brain you build
// (`synapse.brain`), the name you play under (`synapse.name`), the sandbox's chosen track (`synapse.track`), whether you
// turned the music or sound effects off (`synapse.sound`) and the fact that you've seen this notice (`synapse.notice`). All are strictly necessary, so no consent is needed; the notice tells you, links the cookie
// policy, and goes away once dismissed. No cookies are set.
// Storage can be missing or throw (private windows, blocked site data): the notice then shows and simply can't remember.
import './notice.css';

export const NOTICE_KEY = 'synapse.notice';
/** Bump when what Synapse stores changes, so everyone sees the notice again. */
export const NOTICE_VERSION = '3';

function seen(): boolean {
  try { return localStorage.getItem(NOTICE_KEY) === NOTICE_VERSION; } catch { return false; }
}

export function showNotice(): void {
  if (seen() || document.getElementById('notice')) return;
  const bar = document.createElement('div');
  bar.id = 'notice';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Cookies and storage');
  bar.innerHTML = '<p>Synapse keeps your brain, your name, your chosen track and whether the sound is off on this device so they are there next time. No tracking, no ads, no '
    + 'cookies. <a href="/cookies">Cookie policy</a></p><button type="button">OK</button>';
  bar.querySelector('button')!.addEventListener('click', () => {
    try { localStorage.setItem(NOTICE_KEY, NOTICE_VERSION); } catch { /* can't remember: it shows again next time */ }
    ro.disconnect();
    bar.remove();
    document.body.classList.remove('notice-open');
    document.documentElement.style.removeProperty('--notice-h');
    dispatchEvent(new Event('resize')); // views that size to the window re-fit to the space given back
  });
  document.body.appendChild(bar);
  // the page makes room for the notice rather than hiding controls under it
  const ro = new ResizeObserver(() => { document.documentElement.style.setProperty('--notice-h', `${bar.offsetHeight}px`); dispatchEvent(new Event('resize')); });
  ro.observe(bar);
  document.body.classList.add('notice-open');
}
