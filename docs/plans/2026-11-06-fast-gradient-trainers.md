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

## Built so far (2026-11-06): profile and the engine step; the 3× goal is blocked
**Profile** (seed 1, the default brain, T 6M, Node: `--cpu-prof` inline over 1.5M, and a timed NodePool(4) run).
- Pooled, where the time goes: rollouts are 97–98% of it (935 rounds of 16 lanes × 400 ticks, 4.3–5.9 ms each);
  fitness checks 0.03–0.07 s (most check episodes end early by the stall rule); the trainer's own update under 0.1 s.
- Message passing is not the cost: 64 lanes a round (4× fewer round trips) saved 1% (backprop), 15% (actor-critic)
  and 12% (A_RP), and would change the algorithm, so it is not kept.
- Per car-tick, inline: evolution 1.22 µs, backprop 1.93, actor-critic 2.47, A_RP 1.81. Self time: the ray casts
  (`castRay`, 15–27%), the forward pass (`evalNet`, 4–18%), fmath's exp/cos/sin (12–18%: tanh, the fields, the
  heading), physics (7–9%), sensing (5–8%), GC (4–6%); on top of that per trainer: backprop's `act` with the
  teacher's own rays (`teacherWheels`, 16% together), actor-critic's Gaussian noise (`gauss`, 10%, four Box–Muller
  draws a tick), and the backward pass with a second exp per tanh neuron for its slope (5–10%).
- Workers run each tick about 1.45× slower than one thread does (4 workers on this 4-vCPU container), for evolution
  and the gradient trainers alike.
**Engine step (results bit for bit the same; every golden unchanged).** The backward pass takes each neuron's slope
from its output (`brain.ts slopeOf`: tanh 1 − y², sigmoid y(1 − y), ReLU and linear from the bounds, exactly f′(z)),
so the kernels no longer recompute the pre-activations or a second exp; a boundary cell's rays compute their
direction inline instead of an object per ray.

| T 6M, seed 1, Node, 4 workers (median of 2, alternating) | before | after | |
|---|---|---|---|
| backprop | 5.02 s | 4.27 s | 1.18× |
| actor-critic | 5.64 s | 4.93 s | 1.14× |
| A_RP | 4.13 s | 3.77 s | 1.10× |
| evolution, for reference | 2.8–3.1 s | 2.8 s | |

**Blocked: 3× (and step 3).** A gradient trainer can't spend T 3× faster while it drives cars with the same sim:
the shared per-tick work (rays, physics, the forward pass) is about 1.2 µs of every trainer's 1.8–2.5 µs, and it is
what bounds evolution too. With no gradient cost at all a gradient trainer would only match evolution, about 1.5×
faster than now. Going further needs a decision: a cheaper sense or physics model (changes every result and S1), a
shared-memory worker design (SharedArrayBuffer needs cross-origin isolation headers on the site), or fewer car-ticks
per update (changes what T buys). Step 3's learning changes need S1 runs of each change; not started.
Chrome times not measured (the engine change is the same code in both). S1 unchanged (bit-identical training).
Checked: types, purity, unit, determinism, bench (2478 ms, limit 4185), training.

## Built: step 3, more learning per car-tick (2026-11-06)
Coordinator 2026-11-06: no sim change and no cross-origin isolation for now; step 3 with one principled setting per
trainer, no sweeps. S1 (seeds 1–20, T 6M, `npx tsx scripts/sim/bench.ts --trainer <id> --spec default|sighted
--no-compare`; `--spec sighted` is new: 5 boundary cells and speed → 4 tanh), before (e14fe4f) → after:

| trainer · brain | final fitness, median | (a) 30 s unseen, median | (b) ≥ 80% lap | (c) end ≥ 2× gen 1 | (d) Minimal ≥ 50% lap |
|---|---|---|---|---|---|
| backprop · default | 30 → 152 | 97 m → 232 m | 0/20 → 0/20 | 17/20 → 19/20 | 0/20 → 0/20 |
| backprop · sighted | 2627 → 2765 | 1311 m → 1358 m | 0/20 → 0/20 | 20/20 → 20/20 | 0/20 → 0/20 |
| actor-critic · default | 24 → 42 | 82 m → 93 m | 0/20 → 0/20 | 15/20 → 17/20 | 0/20 → 0/20 |
| actor-critic · sighted | 2811 → 2838 | 1370 m → 1396 m | 0/20 → 0/20 | 18/20 → 20/20 | 0/20 → 0/20 |
| A_RP · default (not kept) | 1230 → 796 | 601 m → 408 m | 0/20 → 0/20 | 19/20 → 20/20 | 0/20 → 0/20 |
| A_RP · sighted (not kept) | 1388 → 621 | 681 m → 371 m | 0/20 → 0/20 | 20/20 → 18/20 | 0/20 → 0/20 |

(b) stays out of reach on 2–3 km laps, as for evolution since tracks v2. Phase time is unchanged (no sim change).
- **Backprop:** Adam (β1 0.9, β2 0.999, ε 1e-8, η 0.01) on each round's mean δ·x; the first moment averages about ten
  rounds, the larger effective batch. Kept. Strip: Δw = η·m̂/√v̂, m ← ⟨δ·x⟩.
- **Actor-critic:** GAE(γ 0.98, λ 0.9) advantages, normalised over the whole round exactly (lanes return Σ A·g, Σ g,
  Σ A, Σ A²); the actor steps with Adam (α 0.01); the critic keeps its own rate (β 1) toward the λ-return; the
  round's last tick, whose next state is unseen, is dropped. Entropy: the policy's is σ's, which isn't learned, so
  the decay is σ's schedule (0.3 → 0.05); a bonus would have no gradient. Kept. Strip: Δw = α·Â·∂log π/∂w.
- **A_RP:** per-lane baselines (each step × 2|r − b|, b the lane's reward rate over ~100 ticks) lowered S1 on both
  brains (above), so they are not kept; A_RP is as it was.
- Goldens: `phaseBackprop` and `phaseAc` change (the new update rules); every other golden is unchanged. No CPU brains
  come from these trainers. Determinism holds: inline = 4 workers in the determinism check.
- Checked: types, purity, unit, determinism, workbench (the strip), training.
