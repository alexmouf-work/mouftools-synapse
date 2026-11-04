// Drive view: the trained brain drives 60 s on an unseen track. The whole run is computed first (runDrive, the same
// function a Node replay uses, so the hash matches) and then played back in real time: the yellow car with wheels at
// their outputs, eye rays, the live brain panel (weights as colours, inputs spiking), chase / broadcast / showroom
// cameras. Distance and best lap in a
// plain overlay; a stall shows "Stuck against the wall" with the time while the camera stays on the car. New track
// re-seeds; the run loops after a short pause at the end. Opening (and New track) counts down "5, 4, 3, 2, 1, Go"
// over the scene, on the music's beat when sound is on: the car is held on the line until Go, then the recorded run
// plays from tick 0, so the drive itself (and its hash) is exactly the same. The engine sound follows the car.
import { CONFIG } from '../../../common/config';
import { energyLeft, noiseLevel, percentOfBudget, poolFor } from '../../../common/sim/energy';
import { runDrive } from '../../../common/sim/race';
import { eyeDirection } from '../../../common/sim/sensors';
import { EYE_COUNT } from '../../../common/sim/spec';
import { locate } from '../../../common/sim/track';
import { phaseSeeds } from '../../../common/train/phase';
import type { CamMode, DrivePose } from '../../render/drive';
import type { Stage } from '../../render/stage';
import { raceCountdown } from '../../audio/countdown';
import { Engine } from '../../audio/sfx';
import { getStage, hideArena, showArena } from '../arena';
import type { Saved } from '../workbench/store';
import { BrainPanel } from './brainPanel';
import { SpikeTrains } from './spikes';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`drive: #${id} missing`);
  return e as T;
};
const HZ = CONFIG.tick.hz;
const END_PAUSE_S = 3;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtLap = (ticks: number) => `${(ticks / HZ).toFixed(1)} s`;

export interface DriveStatus {
  trackSeed: number; hash: string; ticks: number; tick: number; distance: number; laps: number; bestLap: number | null;
  /** Energy used so far, % of the minute's pool. */
  usedPct: number;
  stuck: boolean; noise: number; cam: CamMode; frames: number; webgl: boolean; finalProg: number;
  probe?: () => { mean: number; sd: number; w: number; h: number };
  bloomAudit?: (mask?: boolean) => { over: number; max: number; mask?: string };
  seek(seconds: number): void;
  /** Seek, snap the camera, draw that frame and run the bloom audit on it (deterministic). */
  auditAt(seconds: number): { over: number; max: number };
  camPos(): number[];
  /** Spikes per input since resetSpikes, and each input's mean |reading| over that time. */
  spikes(): { counts: number[]; mean: number[]; seconds: number; used: number[] };
  resetSpikes(): void;
  /** For the car's current pose: each eye's beam direction as drawn (world x, z) and the sim's eye direction (x, y). */
  beamCheck(): { hdg: number; beams: number[][]; sim: number[][] };
  setCam(m: CamMode): void;
  /** What the countdown shows now ('', '5' … '1', 'Go'), every label it has shown so far, and whether Go has passed. */
  countdown: string;
  countdownSeen: string[];
  go: boolean;
  /** True if the countdown follows the music (sound on), false on the plain timer. */
  countdownMusic: boolean;
}
declare global { interface Window { __drive?: DriveStatus } }

export interface DriveHooks { back(): void }

function newSeed(): number { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }

/** The first track a brain drives: the unseen track of its last training run (reproducible), else a fresh one. */
export function firstTrack(s: Saved): number {
  const q = new URLSearchParams(location.search).get('track');
  if (q !== null && /^\d+$/.test(q)) return Number(q);
  if (s.train.seed !== null && s.train.phases > 0) return phaseSeeds(s.train.seed, s.train.phases - 1).unseenTrack;
  return newSeed();
}

let raf = 0;

export async function openDrive(saved: Saved, hooks: DriveHooks, trackSeed = firstTrack(saved)): Promise<void> {
  cancelAnimationFrame(raf);
  showArena('drive');
  $('dvName').textContent = saved.name;
  const run = runDrive(saved.draft.genome, trackSeed);
  const { net, track, rec } = run;
  const ticks = rec.ticks, nN = net.nNodes;
  // per-tick facts for the overlay: laps, stalls, noise
  const lapAt: number[] = [];
  for (let k = 0, next = track.len; k < ticks; k++) if (rec.prog[k] >= next) { lapAt.push(k + 1); next += track.len; }
  const stuckSince = new Int32Array(ticks).fill(-1);
  const S = CONFIG.train.stallTicks;
  let maxP = -Infinity;
  const maxProg = new Float64Array(ticks);
  for (let k = 0; k < ticks; k++) { maxP = Math.max(maxP, rec.prog[k]); maxProg[k] = maxP; }
  for (let k = S; k < ticks; k++) {
    if (maxProg[k] - maxProg[k - S] < CONFIG.train.stallMetres) stuckSince[k] = stuckSince[k - 1] >= 0 ? stuckSince[k - 1] : k - S;
  }
  // the minute's pool (ruling 2026-10-31): noise only once it is spent, from the total before the tick
  const pool = poolFor(CONFIG.drive.ticks);
  const noiseAt = (k: number) => (k > 0 ? noiseLevel(rec.used[k - 1], pool) : 0);
  const eyesUsed = net.inUsed.subarray(0, 6);

  const stage: Stage | null = await getStage();
  if (stage) { await stage.setTrack(track, 'drive'); stage.drive.setMode('chase', reduce()); }
  const panel = new BrainPanel($('dvBrain') as HTMLCanvasElement, net);
  const spikes = new SpikeTrains(net.nIn);
  let playT = 0, frames = 0, cam: CamMode = 'chase', guess = track.startIdx, lastUi = -1;
  const cd = raceCountdown(), engine = new Engine(1);
  // the numbers change on their own timers, exactly on time, however slowly frames come
  let timers: number[] = [];
  const showCount = (label: string) => {
    status.countdown = label;
    if (label) status.countdownSeen.push(label);
    $('dvCount').textContent = label;
  };
  const scheduleCount = () => {
    timers.forEach(clearTimeout);
    const now = performance.now();
    timers = [...cd.at.map((t, i) => [t, String(5 - i)] as const), [cd.go, 'Go'] as const, [cd.go + 800, ''] as const]
      .filter(([t]) => t >= now - 1).map(([t, l]) => window.setTimeout(() => showCount(l), Math.max(0, t - now)));
  };
  const endCount = () => { cd.go = Math.min(cd.go, performance.now()); timers.forEach(clearTimeout); timers = []; showCount(''); };
  const status: DriveStatus = {
    trackSeed, hash: run.hash, ticks, tick: 0, distance: 0, usedPct: 0, laps: 0, bestLap: null, stuck: false, noise: 0, cam, frames: 0,
    webgl: !!stage, finalProg: run.result.prog, countdown: '', countdownSeen: [], go: false, countdownMusic: cd.music,
    probe: stage ? () => stage.probe() : undefined,
    bloomAudit: stage ? (m?: boolean) => stage.bloomAudit(m) : undefined,
    seek: (sec) => { endCount(); playT = Math.max(0, Math.min(sec, ticks / HZ - 0.01)); guess = locate(track, rec.x[Math.floor(playT * HZ)], rec.y[Math.floor(playT * HZ)], track.startIdx, track.n); },
    setCam: (m) => setCam(m),
    auditAt: (sec) => {
      if (!stage) return { over: 0, max: 0 };
      endCount();
      playT = sec; guess = locate(track, rec.x[Math.floor(sec * HZ)], rec.y[Math.floor(sec * HZ)], track.startIdx, track.n >> 1);
      poseAt(playT);
      stage.drive.snapNow();
      stage.frame(0, 0, pose);
      return stage.bloomAudit();
    },
    camPos: () => (stage ? stage.camera.position.toArray() : []),
    spikes: () => ({ counts: Array.from(spikes.counts), mean: Array.from(spikes.integral, (x) => x / Math.max(spikes.elapsed, 1e-9)), seconds: spikes.elapsed, used: Array.from(net.inUsed) }),
    resetSpikes: () => spikes.reset(),
    beamCheck: () => ({
      hdg: pose.hdg,
      beams: stage ? stage.drive.beamDirs().map((v) => [v[0], v[2]]) : [],
      sim: Array.from({ length: EYE_COUNT }, (_, e) => { const d = eyeDirection(pose.hdg, e); return [d.dx, d.dy]; }),
    }),
  };
  window.__drive = status;
  scheduleCount();
  $('dvTrack').textContent = String(trackSeed);

  const setCam = (m: CamMode) => {
    cam = m; status.cam = m;
    document.querySelectorAll<HTMLButtonElement>('#driveOverlay [data-cam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === m)));
    stage?.drive.setMode(m, reduce());
  };
  document.querySelectorAll<HTMLButtonElement>('#driveOverlay [data-cam]').forEach((b) => { b.onclick = () => setCam(b.dataset.cam as CamMode); });
  setCam('chase');
  const onKey = (e: KeyboardEvent) => { const m = ({ '1': 'chase', '2': 'tv', '3': 'orbit' } as const)[e.key as '1']; if (m) setCam(m); };
  window.addEventListener('keydown', onKey);
  const leave = () => { cancelAnimationFrame(raf); raf = 0; window.removeEventListener('keydown', onKey); engine.stop(); endCount(); };
  $('dvBack').onclick = () => { leave(); hideArena(); hooks.back(); };
  $('dvNew').onclick = () => { leave(); void openDrive(saved, hooks, newSeed()); };

  const wheels = new Float64Array(4);
  const pose: DrivePose = { x: 0, y: 0, hdg: 0, v: 0, idx: track.startIdx, wheels, eyesUsed, noise: 0, stuck: false };
  let last = performance.now();
  const t0 = last;
  /** Fill `pose` for playback time pt; returns the tick and whether the run has ended. */
  function poseAt(pt: number): { k: number; ended: boolean } {
    const kf = Math.min(pt * HZ, ticks - 1), k = Math.floor(kf), k1 = Math.min(k + 1, ticks - 1), u = kf - k;
    pose.x = rec.x[k] + (rec.x[k1] - rec.x[k]) * u;
    pose.y = rec.y[k] + (rec.y[k1] - rec.y[k]) * u;
    let dh = rec.hdg[k1] - rec.hdg[k]; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
    pose.hdg = rec.hdg[k] + dh * u;
    pose.v = rec.v[k];
    const ended = pt * HZ >= ticks;
    for (let o = 0; o < 4; o++) wheels[o] = ended ? 0 : rec.act[k * nN + net.outStart + o];
    pose.noise = ended ? 0 : noiseAt(k);
    pose.stuck = !ended && stuckSince[k] >= 0;
    guess = locate(track, pose.x, pose.y, guess, 40);
    pose.idx = guess;
    return { k, ended };
  }
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    // a rAF timestamp can be earlier than the performance.now() taken before it: never step backwards
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.25));
    // held on the line until Go; the first frame after it plays the time since Go
    if (now >= cd.go) playT += Math.min(dt, (now - cd.go) / 1000);
    last = now;
    status.go = now >= cd.go;
    if (playT >= ticks / HZ + END_PAUSE_S) { playT = 0; guess = track.startIdx; } // loop the run
    const { k, ended } = poseAt(playT);
    if (!status.go) { // on the line, waiting for Go
      const i = track.startIdx;
      pose.x = track.px[i]; pose.y = track.py[i]; pose.hdg = track.th[i]; pose.v = 0; pose.idx = i; guess = i;
      wheels.fill(0);
    }
    if (stage) { stage.frame(dt, (now - t0) / 1000, pose); frames++; }
    // the motors: speed from the sim, squeal from one side's wheels outrunning the other's
    engine.set(ended ? 0 : pose.v / CONFIG.car.wheelSpeed, Math.abs((wheels[0] + wheels[2]) - (wheels[1] + wheels[3])) / 2);
    status.tick = k; status.frames = frames; status.stuck = pose.stuck; status.noise = pose.noise;
    status.distance = status.go ? rec.prog[k] : 0;
    status.usedPct = percentOfBudget(rec.used[k], pool);
    const done = lapAt.filter((t) => t <= k + 1);
    status.laps = done.length;
    const lapTimes = done.map((t, j) => t - (j ? done[j - 1] : 0));
    status.bestLap = lapTimes.length ? Math.min(...lapTimes) / HZ : null;
    if (now - lastUi > 100) {
      lastUi = now;
      $('dvTime').textContent = ended ? `${fmtT(ticks / HZ)} · done` : `${fmtT(k / HZ)} / ${fmtT(ticks / HZ)}`;
      $('dvDist').textContent = `${(rec.prog[k] / 1000).toFixed(2)} km · ${done.length} lap${done.length === 1 ? '' : 's'}`;
      $('dvLap').textContent = lapTimes.length ? fmtLap(Math.min(...lapTimes)) : `– (lap ${(track.len / 1000).toFixed(2)} km)`;
      const usedPct = ended || k > 0 ? percentOfBudget(rec.used[k], pool) : 0;
      $('dvEnergy').textContent = pose.noise > 0
        ? `${Math.round(usedPct)}% used · spent · ${Math.round(pose.noise * 100)}% static`
        : `${Math.round(usedPct)}% used · ${Math.round(100 * energyLeft(rec.used[k], pool))}% left`;
      $('dvEnergyFill').style.width = `${Math.min(100, usedPct)}%`;
      $('dvEnergyFill').parentElement?.classList.toggle('over', usedPct > 100);
      const st = $('dvStuck');
      st.hidden = !pose.stuck;
      if (pose.stuck) {
        let onWall = false;
        for (let j = Math.max(0, k - 20); j <= k; j++) onWall ||= rec.wall[j] === 1;
        st.textContent = `${onWall ? 'Stuck against the wall' : 'Not moving'} since ${fmtT(stuckSince[k] / HZ)}: it isn't making progress.`;
      }
      const sc = $('dvStatic');
      sc.hidden = !(pose.noise > 0);
      sc.textContent = `Static ${Math.round(pose.noise * 100)}%`;
    }
    // the input cells spike from this tick's real readings (rate coding); the panel is drawn every frame
    const vals = rec.act.subarray(k * nN, (k + 1) * nN);
    spikes.update(vals, net.inUsed, ended ? 0 : dt, now / 1000);
    panel.draw(vals, pose.noise, spikes, now / 1000, reduce());
  };
  raf = requestAnimationFrame(tick);
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
