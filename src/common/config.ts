// Every tunable, one home. Numbers come from docs/plans/2026-10-30-solo-loop.md §3 and the approved workbench
// (reference/builder-mockup.html: pins, costs, upkeep). Change them here only; tests and the bench read them from here.

/** The energy period (principal, 2026-10-31): the budget is a total for one minute of driving. */
const PERIOD_TICKS = 1200;

export const CONFIG = {
  tick: {
    hz: 20, // brain ticks per second
    substeps: 2, // physics substeps per tick (dt 0.025 s)
  },

  /**
   * Energy anchor per tick, by round (the sandbox uses round 1). The budget is a pool: a run of N ticks gets
   * anchor × N (energy.poolFor), so the 1-minute period gets anchor × 1200 and shorter runs a prorated share.
   */
  budget: [10, 14, 20, 26, 32],

  energy: {
    periodTicks: PERIOD_TICKS, // the period the pool covers and % of energy budget is measured over
  },

  /** Energy cost per tick. Inputs are charged only while wired (ruling 2026-10-30). */
  cost: {
    eye: 0.6,
    road: 0.6,
    speed: 0.3,
    energy: 0.3, // "Energy left" input (workbench mock-up)
    bias: 0,
    fire: 0.1, // per wire per tick: fire × |sender output × weight| × (1 + skip × (span − 1))
    skip: 0.5, // surcharge per extra layer a wire spans
    // Workbench estimate ("est."): before a brain has run, each wire is costed at an assumed mean |sender output × w|
    // of this much, so a span-1 wire shows fire × 0.5 = 0.05 per tick (the approved mock-up's figure).
    estimateActivity: 0.5,
  },

  /**
   * Neuron upkeep per tick by transfer function (hidden neurons; wheel outputs have no transfer function). Linear
   * takes step's old cost, the cheapest (principal 2026-11-04: "don't offer step as a function. offer linear as well
   * as ReLU."); step stays only so old saves can be read and migrated.
   */
  upkeep: { linear: 0.2, relu: 0.25, sigmoid: 0.5, tanh: 0.5, step: 0.2 },

  brain: {
    weightCap: 4,
    reluCap: 4,
    maxLayers: 3,
    maxPerLayer: 10,
  },

  sensors: {
    eyeRange: 80, // m; eye input = 1 − d / range
    speedNorm: 60, // speed input = v / speedNorm
    roadAhead: 30, // m; road input = signed angle to the centreline this far ahead / π (+ = right)
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
    episodeTicks: PERIOD_TICKS, // a training episode is the whole 1-minute period, with the whole pool (review call 2026-10-31)
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
    ticks: PERIOD_TICKS, // the drive view runs exactly the energy period (review call 2026-10-31)
  },

  pool: {
    maxWorkers: 4, // min(cores − 1, this)
  },
} as const;

export type Act = keyof typeof CONFIG.upkeep;
/** Every transfer function the engine can run (validation; step only for old saves). */
export const ACTS: readonly Act[] = ['linear', 'relu', 'sigmoid', 'tanh', 'step'];
/** The ones the workbench offers. */
export const OFFERED_ACTS: readonly Act[] = ['linear', 'relu', 'sigmoid', 'tanh'];
export const DT = 1 / (CONFIG.tick.hz * CONFIG.tick.substeps);
