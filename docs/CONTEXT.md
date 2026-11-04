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
- On the car-as-input-layer builder: "looks excellent."
- Milestone 1 is the sandbox loop (build → train → drive, no timers); the timed match comes after. "build the plan end
  to end".

## 2026-10-31
- After playing milestone 1: "the light beams should point to the direction of the eye cells. the eye cells spike
  faster when they're close to their wall, and less when far away. the energy remaining cell spikes slower as energy
  drains."
- "show the weights on each connection using colour, from red being -1 to green being +1, with black in the middle
  at 0. change thickness and brightness of connections with magnitude."

- On energy: "the energy budget is a total that's assigned. the % use is use over the total 1 minute period"
  → energy is a pool for a 1-minute period (anchor: the old per-tick budget × 1200 ticks); % of energy budget =
  used so far / the pool; Energy left drains; noise once the pool is spent.

## Calls made in review (2026-10-30; the principal can overturn any of them)
- The skip surcharge counts only hidden layers that contain neurons: an empty hidden line is free to cross, so a
  brain wired car → wheels pays no phantom +50%. The one empty line stays on the board as the place to add neurons.
- The bench time check takes the best of 3 runs (limit still 1.3 × baseline): a check that fails on noise trains
  people to ignore it.
- (2026-10-31) Rate coding uses one rule for every input, not only the eyes and Energy left: a cell fires at
  14 Hz × |reading| (speed by its value, road ahead by magnitude, bias steadily at the top rate). With
  prefers-reduced-motion the cells glow as bright as their reading instead of flashing.
- (2026-10-31) Training episodes run the full 1-minute period with the full pool (measured: best on every
  criterion; see the table in docs/plans/2026-10-30-sandbox-loop.md, "Energy as a pool").

## 2026-11-04
- "domain is set up. you can access the site at synapse.mouftools.com"
- "let's work on a development branch for now." → work happens on `development`; `main` (live) moves on the
  principal's word.
- After playing milestone 1: "it's great, but has some simple issues."
  1. "it doesn't make the user engage with the actual neural computation enough. that should be much more at the
     forefront."
  2. "the neuron connection is finnicky to do. make it easier, and default to a neuron in one layer connecting to all
     neurons in the previous layer."
  3. "in the active brain thing, show the firing rates of each cell in the whole brain, rather than just the inputs"
  4. "rotate the car 90 degrees in the workshop."
  5. "show the mean brain in real time during training."
  6. "create a title screen with \"sandbox mode\" and \"match mode\""
  7. "match mode should work via a room code. I can give you access to supabase if you need it for realtime natches."
- Brain designer v2 (asked to plan, not build): "change the actual way that the brain designer works. all neurons will
  use the same function (tanh, step, sigmoid, etc.) all neurons need a firing rate, shown with yellow flashes like the
  input ones. add \"head direction cell\", \"grid cell\" and \"place cell\" move the car to the output side, and use 3D
  models of symbols to represent the inputs. These symbols might be animated. … don't just build this, please plan it
  out so that it feels logical, and show me mockups once we agree."
- "place cells recognise landmarks such as walls, a finish line or trees. this acts to replace the current directional
  eye input neurons." · "head direction 1 - it will use a cosine wave to represent the angle that it's looking at. grid
  2, one for each scale. place 2, one for walls, one for finish line. can add more. adding more will automatically make
  them choose appropriate phases." · always-running workbench brain: yes · symbols: plain matte low-poly.
- "if we were looking at a rat brain rather than a racecar, what would the major input cells be, with regards to
  movement?" · "let's also change the energy system so that the more energy that is used, the slower the car travels.
  going over 100% won't be allowed. This way, a 50% energy usage car becomes the mean car, a goal. instead of being 50%
  energy usage it becomes 50% thinking and 50% speed. it's a ratio." · "let's find a way to change the energy usage thing
  so that instead of being \"energy usage\" it's something like an energy allocation, where on one side is speed and on
  the other side is brain power."
- Round 2 answers: real cell names ("Use the real names"); extras: "Whisker cells"; firing cost "Fixed by design";
  "we will remove the road ahead, energy left and bias neuron types. the neurons become a circle with their symbol
  inside them, and that neuron is placed on the field when it's being used."
- "make the entire thing more easy to interact with via a touchscreen." · "all neurons in a given LAYER will have the same
  processing." (supersedes one function for the whole brain) · wheels: "No, wheels fixed" (tanh) · training: "show
  between 5-20 random instances of the brain when training, depending on the device being used." → "show cars on track,
  with one of their brains at random. show the car moving at an accelerating rate, so that it slowly approaches the speed
  of the computer's training."
- "build in the other training methods. show on screen the delta rule being used, at all times." · "remove whisker
  cells. they don't intuitively have a different purpose to boundary vector cells. remove the tree cells too." ·
  "change the representation of grid cells so that they show 7 button shapes (or spheres or whatever they are) in a
  flat hexagonal grid + centre." · "make the buttons smaller, I don't want overlap at all."
- "give each layer a slightly differently coloured background, alternating." · "remove the excess copy on the page, so
  that it's way more simple. only have text that's absolutely necessary. that means remove things like \"the car . the
  wheels are neurons\""
- "move delta rule to the top across the top, make the neurons smaller per unit space on the screen, make the laptop
  version look like the phone app just scaled up." → one phone-landscape layout (860 × 400) scaled to fit every screen.
- "remove the dotted background from the input neuron selection, and line them all up alongside each other in a column
  of 5 elements. show only the formula for the delta rule, no calculation directly happening. don't show the neuron
  selected in that area either. centre the delta rule, and directly call it \"Learning Rule : [equation]\""
- "don't show the neurons firing until they're inside the active brain. if the brain is in build mode, don't activate
  any of them" → supersedes the always-running workbench brain: build mode is still; firing shows only while training
  or driving.
- "when clicking on a given cell, show a graph of its activation pattern … please put that into the box on the right
  hand side. remove the \"tuning\" bit. the graph will be enough." · "the finish line place cell is a cell which
  activates when the specific landmark is within range. show distances on the graphs, and use circular maps to show
  distance around the car on graphs."
- "don't offer step as a function. offer linear as well as ReLU." · "make the heatmap blue to green to yellow to red,
  cold to hot." → built in the current workbench: Linear (z kept to −1..1, step's old cost) / ReLU / Sigmoid / Tanh;
  an old save's step neurons load as Linear with a one-time note.
- "don't allow removal of connections. only allow inspection of cells, adding ore removing of cells, and change of layer
  processing type." → wiring is fixed: every layer fully connected to the next; taps only inspect.
- "when there are multiple layers, fit them more nicely so that the space is always used evenly." → inputs, each hidden
  layer and the wheels sit in evenly spaced columns.
- "the default brain should start with just a single head direction cell and a single boundary vector cell. it should
  have one hidden layer with three neurons, and that's it."
- "the grid cell model should be flat against the screen, not angled."
- "each neuron should always sit in the middle of its region horizontally. currently the inputs justify to the left edge
  for some reason." · "add a + button on the boundary between layers so that it is clearer that layers can be added. do
  it at the mid-bottom on the edges between layers." → equal regions per column, everything centred; a "+" at the foot
  of each boundary inserts a hidden layer there (replaces the separate "+ Layer" button; up to 3).
- "the container on the right should say \"tap a neuron to inspect it\""
- "make sure that the tap neuron text is justified to the middle horizontally and vertically, and is split across two
  lines." · "use only one font across the entire site, Arial. you can use bold or standard type."
- "add a tiny single line of description about each neuron underneath it, above the remove button. remove button goes
  at the bottom. and is swapped to a bin icon, white on a red button." · "the bin button is in the bottom right only, in
  the corner, and is round. make the buttons on the site into squares rather than squircles."
- "show axis titles on the charts, and show the x and y axis at their 0 values"
- "rename each neuron to just say \"boundary vector cell\" rather than \"boundary cell\" and rename the flag cell to
  \"landmark cell\" rather than boundary vector cell. keep head direction and grid."
- "add a minus sign at the top to match the + sign at the bottom of each layer, and of each set of neurons. don't show
  positive and negative weights until after training." → a "−" above each layer's neurons removes one; a "−" at the top
  of each hidden column removes that layer (shown while there is more than one); wires are plain grey until the brain
  is trained, and any edit returns them to grey.
- "add a button to reset the brain somewhere, and make it come up with a confirmation prompt before it actually runs.
  make the buttons to choose response curve (sigmoid, tanh, etc.) change so that they fit properly."
- "make matches against opponents have a limit of 100 participants. only load the nearest ones with physical car, and
  show the map in the corner."
- "on the actual training page, change it so that there's the \"info panel\" on the left hand side, and nothing on the
  right. the info panel's top half will be the graph of fitness per generation, and the bottom half will be the map
  with all of the cars on it."
- "make more interesting map shapes, including a figure eight. the figure eight will have to have a higher part and a
  lower part, so that the cars don't cheat. find a way to make that work, without actually simulating the 3rd
  dimension." → plan `docs/plans/2026-11-04-tracks-training-matches.md`.
- Descriptions, verbatim: "\"boundary vector cell\" : fires faster when approaching a wall" · "\"landmark cell\" : fires
  faster when the finish line is in view" · "\"head direction cell\" : fires faster when facing a given angle" ·
  "\"grid cell\" : fires on a hexagonal grid" · "\"speed cell\" fires faster at higher speeds"
- "let's change the system so that the neurons being used will indeed affect the speed. the speed is higher when less
  neurons fire per tick."
- "make the minus symbol in its bubble be styled the same way as the plus one below it, including colours. same goes
  for the plus symbols on the edges. add minus symbols to remove a layer, in the middle of each section but vertically
  aligned to the plus symbols. use the same spacing between the neurons as between the plus and minus buttons."
- "use square corners rather than squircles across the whole site."
- "the panel on the side should be less wide - it should take up only at maximum a fifth of the whole page. it
  shouldn't look like an overlay and instead should be a section of its own, with the camera shown on the right taking
  up the rest of the screen. the training accelerating thing didn't really look how I wanted to, so let's revert it.
  show some random agents from each generation." · "I like all of the track shapes. show me the title screen now
  please."
- "there's a really weird zooming in effect that shows when I look at the artifact." → the brain mock-up page was 8 px
  taller than its window (body margin); a frame sized to its content grew, the page re-scaled, and so on. Fixed.
- "give the site a privacy policy and terms of service. link to those on the synapse website. don't give them .html
  links, they should just have normal looking slugs (eg synapse.mouftools.com/privacy) and so on. keep them simple, add
  cookie policy and make sure that we comply with UK GDPR, adding a cookie banner at the bottom when first accessing the
  site." · "I've got the following env vars set up in vercel: SUPABASE_PROJECT_URL, SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY" · contact for the policies: "alexander@enkefalos.co.uk" → `docs/plans/2026-11-04-legal-pages.md`.
- "change the site so that the match button is replaced with \"Multiplayer\". Add a \"VS Computer\" button as well.
  that will show 10 players competing." · "into match mode, please add a countdown timer for the matches before they
  start."
- Music (one track supplied): "chop it up into bits so that we can play it at the correct times. We need music playing
  at all times, and it needs to transition very smoothly. we can repeat sections. Use the high energy parts for the
  racing segments and the low energy parts for the building segments." · "add sound effects for \"5, 4, 3, 2, 1, go\"."
  · "add sound effects for the car driving too, which will play appropriately for how fast the car is driving." →
  `docs/plans/2026-11-04-sound.md`.
- "please let me know when it's ready on the dev branch. I've connected a preview deployment so that I can see."
- "sandbox mode will have unlimited budget and allows choices on how long to train for. the user will get a popup when
  they click train that asks them to choose how many generations for. the options are 10, 25, 50, 100, 250, 500, 1000.
  default is 100 generations." · "\"vs CPU\" is what we will show instead of vs computer. Multiplayer will be
  highlighted in blue, vs CPU in yellow, sandbox will look more boring."
- Music rights: asked "Do you have the artist's permission (or a licence) to use it in Synapse?" → "Yes, I have
  permission". · "music sounds really good to me, across the board. please implement it all." → builder.
- "here's some more music, named appropriately." (sandbox music: "Airport Lounge", Kevin MacLeod; winner music) ·
  winner music rights: "I have a licence for it" · when it plays: "When you win a race (Recommended)".
- "in the brain builder, remove the \"All neurons here work alike.\" like entirely. keep some space between the
  processing rule and the energy per neuron line. allow up to 10 layers of neurons to be added in, and move them so
  that elements on the page don't overlap. remove the plus sign if the limit is hit, rather than showing a warning
  that it isn't possible to add more."
- "create a favicon and app icon using the grid cell icon. make sure it's compatible with being turned into a web app.
  it should be called \"Synapse\"" → `docs/plans/2026-11-04-icons.md`.
- "is the builder opus 5.5? it should be." → checked: every builder response served by that model.
- "increase the max energy allowed for a brain by 2x, and remove the max energy allowed in sandbox mode. default to
  each new layer having two neurons instead of three. max 8 neurons and max 8 layers, for a total 64 neurons in the
  hidden layers. remove the drive button."
- "when clicking on the processing function button (tanh / ReLU, etc) we should show the number of neurons in that layer
  on a slider, so that it can be easily changed."
- "show the amount of energy each neuron uses when click on it directly. show the total energy used by the layer when
  looking at the processing function. energy used should be shown as \"at maximum firing rate, uses xx% energy\""
- "please build all the changes and push to development when ready." → `docs/plans/2026-11-04-build-order.md`.
- Bias: asked how to fix brains that can't hold "drive forward" without the bias cell → "Built-in thresholds
  (Recommended)" · "the neurons can have a bias internally as well, that's totally fine by me."
