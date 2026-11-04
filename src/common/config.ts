// Every tunable, one home. Numbers come from the plans (docs/plans/2026-10-30-solo-loop.md §3; brain v2:
// docs/plans/2026-11-04-brain-designer-v2.md and reference/brain-v2-mockup.html). Change them here only; tests and
// the bench read them from here.

/** Ticks in a run: training episodes and the drive are one minute. */
const RUN_TICKS = 1200;

export const CONFIG = {
  tick: {
    hz: 20, // brain ticks per second
    substeps: 2, // physics substeps per tick (dt 0.025 s)
  },

  /**
   * Energy (brain v2, 2026-11-04): one supply each tick, % per unit of firing rate (0..1). A cell spends its cost ×
   * its rate, a wire its cost × its source's rate; what is left is the tick's top speed, never below the floor. Costs
   * halved 2026-11-04 ("increase the max energy allowed for a brain by 2x").
   */
  energy: {
    sense: { boundary: 1.5, landmark: 1.5, hd: 1, grid: 1, speed: 1 },
    neuron: { linear: 0.75, relu: 1, sigmoid: 1.5, tanh: 1.5 },
    wheel: 0.75,
    wire: 0.075,
    speedFloor: 10, // %: every car can still move (sandbox has no energy limit; matches refuse > 100% flat out)
  },

  brain: {
    weightCap: 4,
    reluCap: 4,
    maxLayers: 8, // hidden layers (2026-11-04: up to 8 × 8)
    maxPerLayer: 8,
    newLayerNeurons: 2, // a new layer starts with two
  },

  /** The senses (brain v2 §2): how many cells each may have, and their fields. */
  senses: {
    boundary: { max: 7, rangeM: 20, widthDeg: 60 }, // a wall within 20 m in the field's direction
    landmark: { max: 5, rangeM: 40, widthDeg: 70 }, // the finish line within 40 m
    hd: { max: 8 },
    grid: { max: 6, smallM: 11, largeM: 26, phaseStep: 2.1 },
    speed: { max: 1 },
    fieldSpreadDeg: 150, // several field cells share this much of the front between them
  },

  car: {
    wheelSpeed: 60, // m/s at output +1
    accel: 14, // m/s², speeding up
    brake: 30, // m/s², slowing down
    trackWidth: 2.0, // m between left and right wheels: yaw rate = (vR − vL) / trackWidth
    grip: 32, // m/s² lateral: |yaw rate × v| is capped by this (S1 lever 2 "more grip"; plan proposal was 24)
    yawMax: 3.0, // rad/s: cap on spin rate at low speed (not in the plan's sketch; the grip cap is unbounded at v = 0)
    scrub: 10, // m/s² of drag per unit of front/rear mismatch on a side (mean of |FL−RL|, |FR−RR|)
    wall: 12.5, // m from centre to wall
    wallCar: 11.5, // m: the car's centre is clamped here
    wallSpeedKeep: 0.6, // v × this on a wall hit
    wallHeadingEase: 0.5, // fraction of heading error to the tangent removed on a wall hit
    padHalfWidth: 4.2, // m: boost pad |offset| below this
    padBoost: 10, // m/s
    padCap: 72, // m/s
  },

  track: {
    spacing: 2, // m between centreline samples
    kMin: 8,
    kMax: 14,
    angleJitter: 0.3, // ± fraction of the even angle step
    radiusMin: 170,
    radiusMax: 260,
    radiusScaleMin: 0.55, // per point R × U(min, 1)
    lengthMin: 1100,
    lengthMax: 1900,
    minRadius: 25, // m, on curvature smoothed over curvWindow
    curvWindow: 10, // m
    farAlong: 60, // m: parts further apart than this along the track …
    farApart: 31, // m: … must be at least this far apart in space
    straightLen: 150, // m: needs one straight this long (start at its middle)
    straightCurv: 1 / 300, // 1/m: smoothed |curvature| below this counts as straight
    padLen: 30, // m
    padCountMin: 2,
    padCountMax: 3,
    padApart: 300, // m along the track between pads
    gateEvery: 300, // m: cosmetic gates
    maxAttempts: 200, // failures before the generator throws
    gridCell: 16, // m: spatial grid cell for wall segments
  },

  train: {
    // Experience budget: simulated car-ticks per training phase, the same for every trainer. Fixed in S1 by the plan's
    // rule (largest 0.5M multiple that fits 7 s in Chrome /bench, clamped 1.5M–6M): headless Chrome on the 4-core build
    // container fits 9.5M → 6M. To confirm on the reference desktop (see docs/plans/2026-10-30-sandbox-loop.md, S1 results).
    T: 6_000_000,
    population: 64,
    trainTracks: 2,
    episodeTicks: RUN_TICKS, // a training episode is one minute (review call 2026-10-31)
    /** Sandbox: Train asks how many generations (2026-11-04); a phase's budget is that many of evolution's worst case. */
    generations: [10, 25, 50, 100, 250, 500, 1000],
    defaultGenerations: 100,
    elites: 4,
    tournament: 3,
    pMutate: 0.2,
    sigmaStart: 0.4,
    sigmaEnd: 0.08,
    pReset: 0.01,
    resetSd: 1,
    initSd: 0.5,
    wallPenalty: 0.5, // fitness per wall tick
    stallTicks: 60, // 3 s …
    stallMetres: 5, // … with max progress growing less than this ends the episode
    backLimit: -20, // m: progress below this ends the episode
    /** Gradient trainers (train/gradTrainer.ts): lanes of cars sharing the weights, one update per round. */
    grad: {
      lanes: 16, // cars driving at once (split over the workers; the result never depends on how)
      roundTicks: 400, // ticks every lane drives per update (20 s), so one update sees lanes × this samples
      evalEvery: 150_000, // car-ticks of training between fitness checks (each: the weights on both training tracks, 60 s)
      initSd: 0.1, // fresh start: w ~ N(0, this): small, so no tanh starts saturated (all-zero weights have no gradient)
    },
    backprop: {
      lr: 0.6, // η in Δw = η · δ · x (per sample, averaged over a round); constant (a falling η measured worse)
      betaStart: 0.5, // DAgger mixing: the chance an episode is driven by the teacher, at the start …
      betaUntil: 0.25, // … falling linearly to 0 by this fraction of T (then the brain always drives)
    },
  },

  /** The scripted pure-pursuit teacher that backprop copies (sim/teacher.ts). */
  teacher: {
    lookMin: 10, // m: pure-pursuit look-ahead at rest …
    lookPerSpeed: 0.4, // … plus this × speed (m per m/s) …
    lookMax: 30, // … up to this
    vMin: 40, // m/s: steering is computed for at least this speed (so it steers firmly from rest or off a wall)
    steerGain: 3, // × the pure-pursuit yaw rate (the grip caps the yaw anyway)
    gripUse: 0.85, // fraction of the lateral grip a corner may use
    brakeUse: 0.8, // fraction of the braking rate it plans with
    speedLook: 10, // m: extra look-ahead for corners beyond the braking distance
  },

  race: {
    ticks: 600, // 30 s: the first half of a 1-minute run, the S1 criterion's look at the unseen track (milestone 2's match phase is revisited when planned)
  },

  drive: {
    ticks: RUN_TICKS, // the drive view runs one minute
  },

  pool: {
    maxWorkers: 4, // min(cores − 1, this)
  },
} as const;

/** A hidden layer's function (2026-11-04: Linear, ReLU, Sigmoid, Tanh; no step). The wheels are fixed to tanh. */
export type Act = keyof typeof CONFIG.energy.neuron;
export const ACTS: readonly Act[] = ['linear', 'relu', 'sigmoid', 'tanh'];
export const DT = 1 / (CONFIG.tick.hz * CONFIG.tick.substeps);
