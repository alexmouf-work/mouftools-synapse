// The checks' fixed brain. New brains start random (brain v2 plan §3c: 2–6 input cells), but the checks compare the
// page against Node runs of defaultSpec(), so every page a check opens starts with that brain saved, unless the check
// saves its own first (an init script that writes only when nothing is stored).
import type { BrowserContext } from 'playwright';
import { defaultGenome } from '../../src/common/sim/brain';
import { SENSE_IDS, type Genome } from '../../src/common/sim/spec';
import { DEFAULT_NAME, NO_TRAINING, SAVE_KEY, serialize } from '../../src/client/ui/designer/store';

export async function fixtureBrain(ctx: BrowserContext): Promise<void> {
  const v = serialize({ name: DEFAULT_NAME, genome: defaultGenome(), train: NO_TRAINING, trainer: 'evolution' });
  await ctx.addInitScript(([k, s]) => { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, s); } catch { /* no storage */ } }, [SAVE_KEY, v] as const);
}

/** A new brain as plan §3c draws it: 2–6 input cells, one at least a boundary vector cell, 3 Linear neurons, untrained. */
export function isStarter(g: Genome): boolean {
  const n = SENSE_IDS.reduce((a, id) => a + g.spec.senses[id], 0);
  return n >= 2 && n <= 6 && g.spec.senses.boundary >= 1 && g.spec.layers.length === 1 && g.spec.layers[0].n === 3
    && g.spec.layers[0].fn === 'linear' && g.w.every((w) => w === 0);
}

/** The standings panel against the round's countdown, as the page lays it out (see STANDINGS_LAYOUT). */
export interface StandingsLayout { timer: boolean; gap: number; title: boolean; head: boolean; fits: boolean; onScreen: boolean; page: boolean; places: string[]; you: string | null }
/**
 * The round's standings while their countdown shows (page.evaluate this string: no bundler helpers in the page): the
 * gap from the timer's bottom to the panel's top, the title and column headers on view above the rows, every row on
 * view without scrolling, the panel on screen and the page not scrolling; each row's place ("⋯" for the gap row) and
 * your row's place.
 */
export const STANDINGS_LAYOUT = `(() => {
  const tm = document.getElementById('phaseTimer'), t = tm.getBoundingClientRect(), p = document.getElementById('rcResults').getBoundingClientRect();
  const sc = document.getElementById('rcScroll'), s = sc.getBoundingClientRect(), h = document.getElementById('rcResT').getBoundingClientRect();
  const th = document.querySelector('#rcHead th').getBoundingClientRect(), rows = [...document.querySelectorAll('#rcRows tr')], you = document.querySelector('#rcRows tr.you');
  return { timer: !tm.hidden, gap: p.top - t.bottom, title: h.top >= p.top && h.bottom <= s.top, head: th.top >= s.top - 0.5 && th.bottom <= s.bottom,
    fits: sc.scrollHeight <= sc.clientHeight + 1, onScreen: p.top >= 0 && p.bottom <= innerHeight + 0.5, page: document.documentElement.scrollHeight <= innerHeight,
    places: rows.map((r) => (r.classList.contains('gap') ? '⋯' : r.cells[0].textContent)), you: you ? you.cells[0].textContent : null };
})()`;
/**
 * Clear of the timer by at least a gap, title and headers on view, and the sidebar's rule: at most 10 player rows
 * (all of them up to 10), places 1–3, your row among them, "⋯" only where the two groups don't meet.
 */
export function standingsClear(l: StandingsLayout, players: number, gap = 6): boolean {
  const rows = l.places.filter((x) => x !== '⋯'), gaps = l.places.length - rows.length;
  const contiguous = rows.every((x, i) => i === 0 || Number(x) === Number(rows[i - 1]) + 1 || (i === 3 && l.places[3] === '⋯'));
  return l.timer && l.gap >= gap && l.title && l.head && l.fits && l.onScreen && l.page && rows.length === Math.min(10, players)
    && ['1', '2', '3'].every((x) => rows.includes(x)) && (l.you === null || rows.includes(l.you)) && gaps <= 1 && (gaps === 0 || l.places[3] === '⋯') && contiguous;
}
