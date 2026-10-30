// Every tunable, one home. Numbers come from docs/plans/2026-10-30-solo-loop.md §3 and the approved workbench
// (reference/builder-mockup.html: pins, costs, upkeep). Change them here only; tests and the bench read them from here.

export const CONFIG = {
  tick: {
    hz: 20, // brain ticks per second
    substeps: 2, // physics substeps per tick (dt 0.025 s)
  },

  /** Energy budget per tick, by round (the sandbox trains at round 1). */
  budget: [10, 14, 20, 26, 32],

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

  /** Neuron upkeep per tick by transfer function (hidden neurons; wheel outputs have no transfer function). */
  upkeep: { step: 0.2, relu: 0.25, sigmoid: 0.5, tanh: 0.5 },

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
    episodeTicks: 400, // 20 s
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
  },

  race: {
    ticks: 600, // 30 s on the unseen track
  },

  pool: {
    maxWorkers: 4, // min(cores − 1, this)
  },
} as const;

export type Act = keyof typeof CONFIG.upkeep;
export const ACTS: readonly Act[] = ['step', 'relu', 'sigmoid', 'tanh'];
export const DT = 1 / (CONFIG.tick.hz * CONFIG.tick.substeps);
