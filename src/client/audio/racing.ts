// Leaving a race (principal 2026-11-04: "make sure to stop racing sound effects when leaving the racing part of the
// site"): THE one teardown for racing sounds. The arena calls it whenever its view changes or it is hidden, which every
// way out of training and driving goes through (Back, Keep training, Drive, the title link, a torn-down view): the
// engines fade out and every countdown blip still scheduled is cancelled, so "3, 2, 1, Go" never plays on after you
// leave. Only the music carries on, crossing to the next screen's own track.
import { cancelRace } from './music';
import { stopAllSfx } from './sfx';

export function stopRacingSounds(): void {
  stopAllSfx();
  cancelRace();
}
