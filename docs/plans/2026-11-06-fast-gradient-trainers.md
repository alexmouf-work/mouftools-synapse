# Much faster Backprop, Actor-critic and A_RP (2026-11-06)

Principal: "find a way to enormously accelerate the training methods besides evolution."

**Today.** S1, T = 6M, Node with 4 workers: median phase time is evolution 3.9 s, backprop 7.2 s, actor-critic 7.7 s,
A_RP 6.1 s. All three gradient trainers run on the shared frame (train/gradTrainer.ts): 16 lanes of cars drive the
current weights for 400-tick rounds, then the lanes' summed terms become one update. In a 20 s match round on T = 12M,
a slow trainer is cut off by the hard stop and races a less-trained brain. Each of them also learns less per
car-tick than evolution.

**Goal.** Measured, not assumed:
1. **Wall time:** each gradient trainer spends T at least **3× faster** than now (aim: at or below evolution's
   time), in Node and in Chrome.
2. **Learning:** better S1 results for the same T. That means distance on an unseen track, and laps, on the default
   brain and on the "sighted" brain (5 boundary cells + speed) the trainers plan already uses.
3. **Rules that stay:** deterministic (same seed → same hash; 1 vs 4 workers identical), the T accounting (a trainer
   reaches the sim only through the metered env), and no Float32 or Math.random in src/common.

**Step 1: profile.** Before changing anything, find where the time goes for each of the three. Look at:
- the per-tick forward and backward passes and the field gradients (fieldGrads)
- allocation in the hot loops
- how rounds are spread over the workers: are all workers busy, or does one round wait on another?
- the fitness checks' share of T and of the time
- message passing per round: weights out, terms back
Write the profile into this plan.

**Step 2: speed up the engine** (whatever the profile supports). For example:
- keep all workers busy with more lanes per round, split evenly
- hold preallocated typed arrays per lane, so nothing is allocated per tick
- fuse the forward and backward passes; skip the gradient on ticks with no learning signal
- compute field gradients only for fields that can move
- make fewer and smaller round trips: send Δw, not w, and run several rounds per message where the algorithm allows
- check fitness less often, keeping its share of T
- use WebAssembly SIMD only if plain TypeScript can't get close, and say so first

**Step 3: get more learning out of each tick** (whatever the profile and S1 support). For example:
- **Backprop:** a better teacher signal; a larger batch of lanes with a higher learning rate and Adam or momentum
  (deterministic, fixed order)
- **Actor-critic:** n-step returns or GAE, normalised advantages, entropy that decays, a separate critic learning
  rate
- **A_RP:** reward baselines per lane, and noise annealed by temperature as now
State each change and its effect on S1. Keep the trainers recognisably the methods they're named after; the Learning
Rule strip's equations should stay true, so update them if the rule changes.

**Report.** A table of before and after (phase time in Node and Chrome; S1 (a)–(d) on the default and sighted
brains), plus the goldens that change and why. Regenerate any CPU brains a trainer produces (if any).
Checks (affected only): types, purity, unit (contract tests per trainer), determinism, training, bench.
