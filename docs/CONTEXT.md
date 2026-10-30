# Context: why things are the way they are

Rulings from the principal, verbatim where quoted. Newest last.

## 2026-10-30
- The player builds a network in layers (inputs, hidden, outputs) and chooses the connections; "the user creates a
  neural network, and watches it train".
- Evolution finds the weights; training is shown live, simulated very fast.
- Match: 5 players, humans and/or computer. "the users would get a 1 minute first build phase, followed by a 10 second
  train phase, then a 30 second compete phase. Round 2 you get a 30 second upgrade phase, then 10s retrain, 30s
  compete. we do 5 rounds per game". Same game mode all match.
- "weights are definitely separate per game." Weights carry over between rounds.
- Energy: a maximum per tick (20 ticks/s), growing every round. "when over budget, we add noise to every signal
  proportionally to how far over budget the went, until the full system is noise."
- First mode: racing, in 3-D ("I think it'll be cooler"). Look: "low-poly ISH but high res very stylised …
  quasi-trackmania turbo". The look mock-up (`reference/look-mockup.html`): "this is FIRE. it's exactly what I was
  going for with the style."
- "The cars will be ghosts with respect to each other, so they can pass through each other freely. this way training
  will be fairer."
- Name: "the app is just going to be called \"Synapse\"", at synapse.mouftools.com, hosted on Vercel.
- First milestone: solo vs 4 bots; multiplayer after. Desktop first.
- "I see this as a tool that I can use to teach my degree content back to myself and my peers." Several learning
  algorithms; the trainer is part of each player's build. An untimed Lab, early. Trainer order after evolution:
  backprop (copy a teacher), actor-critic, A_RP.
- "make sure that you work on the \"main\" branch and commit there the whole way through. let's mock up the builder
  menu before we continue."
- On the first builder mock-up (race-HUD styled): "this isn't what I wanted. It's way too \"racing game\". The game isn't
  a racing game as a base, it's a sandbox game. the racing part is one aspect. make it more simple, more plain, more
  sandbox." → the builder is a plain workbench; racing styling stays in the racing arena.
- "I want the inputs and outputs to be fixed at all times, but whether or not they are used is the user's decision"
  → every pin is always on the board; an input costs energy only while wired.
- "maybe we have 6 directions for the \"eyes\" in a circle, with the exception of the two back angled ones. we keep the
  backwards one, and the five front-sideways ones." → eyes: left, front-left, front, front-right, right, back.
- "simplify and gameify the GUI just slightly" → energy as a battery, arrow icons on pins, small feedback.
- "let's make the output neurons be each of the four wheel's speeds, from -1 to +1." → the car is driven skid-steer.
- "change the mobile UI to landscape for more space." → phones use the builder in landscape; portrait asks to rotate.
- "change the energy per tick to just say \"xx% of energy budget\" and have a meter which increases and can go up to
  100%."
- "let's also add another input which is \"energy remaining\"" → "Energy left": 1 − last tick's use / budget.
- "add a mostly translucent image of the car onto the builder diagram, then position the different input neurons
  relative to the car, so the wheel ones are on top of each of the wheels, and the energy one is in the middle of the car."
- "the car should only be the position of the input layer. can you find a way to make that work? I see the input as
  projecting to a flat line of neurons in the hidden layer" → board reads left to right: car (inputs) → hidden lines →
  wheel outputs in their own line.
