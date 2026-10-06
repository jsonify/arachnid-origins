/* ============================================================================
 * Arachnid Origins  --  creatures.js   (module `creatures`, priority 40)
 * Ecosystem AI: prey, predators, birds, ants, spiders, kin, mate. Procedural art.
 *
 * Public API (see ARCHITECTURE.md section D) plus:
 *   creatures.drawKindIcon(ctx, kindId, x, y, size, opts)   -- bestiary portraits
 *       size  = box side in screen px (the sprite is fitted + centred in it)
 *       opts  = { angle=-0.5 (rad, 0 = facing right), silhouette=false, silColor,
 *                 t (anim time), shadow=true, flying (draw wings spread), alpha=1 }
 *   creatures.kindList()      -> KINDS in bestiary order (array)
 *   creatures.kill(c, by)     -> kills a creature (feeds the player when by==='player')
 *   creatures.count(kindId?)  -> alive count
 *   creatures.corpses         -> fading corpses (visual only)
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || typeof Game.register !== 'function') return;
  const U = Game.util, C = Game.C;
  const TAU = Math.PI * 2, PI = Math.PI;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt, atan2 = Math.atan2;
  const min = Math.min, max = Math.max, floor = Math.floor, hypot = Math.hypot, rnd = Math.random;
  const clamp = U.clamp, lerp = U.lerp;

  // ======================================================================== KINDS
  const KINDS = {};
  const KIND_LIST = [];
  function def(o) {
    o.idx = KIND_LIST.length; o.bit = 1 << o.idx;
    if (o.flying == null) o.flying = false;
    if (o.nocturnal == null) o.nocturnal = false;
    if (!o.activity) o.activity = o.nocturnal ? 'night' : 'any';
    if (o.danger == null) o.danger = 0;
    if (o.armor == null) o.armor = 0;
    if (o.leash == null) o.leash = 320;
    if (o.chase == null) o.chase = o.speed * 1.5;
    if (o.flee == null) o.flee = o.speed * 2;
    if (!o.eats) o.eats = [];
    if (o.trap === undefined) o.trap = { time: 20, breaks: 0 };
    if (o.ext == null) o.ext = 1.4;
    if (o.bodyR == null && o.ext > 2.3) o.bodyR = min(2.4, o.ext * 0.8);
    if (o.shadow == null) o.shadow = [1.1, 0.7];
    o.maxHp = o.hp; o.eatMask = 0;
    KINDS[o.id] = o; KIND_LIST.push(o);
    return o;
  }

  // ---------------------------------------------------------------- prey
  def({
    id: 'springtail', name: 'Springtail', latin: 'Orchesella cincta (Collembola)', role: 'prey', tier: 0,
    sizeText: '1-3 mm', radius: 2.6, hp: 1.6, speed: 22, flee: 120, detection: 70, leash: 260,
    nocturnal: false, activity: 'any', fleeStyle: 'hop', graze: true, rainShelter: true, ext: 1.7, shadow: [1.5, 0.6],
    diet: ['fungal hyphae', 'decaying leaves', 'pollen'], habitat: ['litter', 'bark'],
    value: { hunger: 9, growth: 6 }, danger: 0, color: '#cfc9b0', color2: '#6e7a8a',
    trap: { time: 40, breaks: 0 },
    fact: 'Springtails are not true insects. They belong to Collembola, an ancient hexapod group whose mouthparts are tucked inside the head. A spring-loaded, forked tail (the furcula), held under the abdomen by a tiny catch, snaps down to fling the animal many body-lengths through the air in a fraction of a second. They are among the most abundant animals in leaf litter, recycling fungi and rotting leaves.',
    description: 'A tiny, soft-bodied grazer of the leaf litter. When startled it flicks its tail and vanishes in a hop. Easy first meal for a hatchling.',
  });
  def({
    id: 'mite', name: 'Oribatid Mite', latin: 'Platynothrus peltifer (Oribatida)', role: 'prey', tier: 0,
    sizeText: '0.5-1 mm', radius: 2.2, hp: 3, armor: 0.25, speed: 12, flee: 28, detection: 38, leash: 220,
    activity: 'any', graze: true, rainShelter: true, ext: 1.45, shadow: [1.1, 1.0],
    diet: ['fungi', 'decaying plant matter', 'lichen'], habitat: ['litter', 'bark'],
    value: { hunger: 7, growth: 5 }, danger: 0, color: '#7a4425', color2: '#b9733a',
    trap: { time: 45, breaks: 0 },
    fact: 'Oribatid mites are arachnids - cousins of spiders with four pairs of legs as adults. These slow "beetle mites" wear a hardened, glossy cuticle and are key decomposers: a single handful of forest soil can hold hundreds of them. They move slowly and rely on armor rather than speed.',
    description: 'A slow, armored, shiny little dome. Hard to crack at first but it cannot run away from you.',
  });
  def({
    id: 'aphid', name: 'Green Peach Aphid', latin: 'Myzus persicae', role: 'prey', tier: 0,
    sizeText: '1.5-2.5 mm', radius: 3, hp: 2, speed: 7, flee: 20, detection: 40, leash: 120,
    activity: 'any', graze: true, rainShelter: false, ext: 1.4, shadow: [1.1, 0.9], clustered: true,
    diet: ['plant sap (phloem)'], habitat: ['garden', 'bark'],
    value: { hunger: 10, growth: 7 }, danger: 0, color: '#8fcf4a', color2: '#5f9f2d',
    trap: { time: 40, breaks: 0 },
    fact: 'Aphids pierce plant veins with needle-like mouthparts and drink phloem sap. They excrete the surplus sugar as honeydew, which ants collect - ants guard and even "farm" aphids. In summer females give birth to live clones without mating (parthenogenesis), so colonies explode; winged forms appear when plants get crowded.',
    description: 'Soft green sap-suckers that cluster along stems, slow and defenseless - but ants stand guard over them.',
  });
  def({
    id: 'midge', name: 'Non-biting Midge', latin: 'Chironomidae', role: 'prey', tier: 0,
    sizeText: '2-5 mm', radius: 3, hp: 1, speed: 38, flee: 80, detection: 60, leash: 240,
    flying: true, activity: 'crepuscular', rainShelter: true, windSensitive: true, ext: 1.9, shadow: [1.0, 0.55],
    diet: ['nectar', 'adults rarely feed'], habitat: ['litter', 'garden'],
    value: { hunger: 8, growth: 6 }, danger: 0, color: '#c8d29a', color2: '#7f8a52',
    trap: { time: 40, breaks: 0 },
    fact: 'Midges are flies (order Diptera): they have just one pair of working wings, the second pair shrunk to tiny balancing organs. At dusk males form dancing swarms; their feathery antennae pick up the whine of a female\'s wingbeat. Their larvae live in water or damp soil, and the adults do not bite.',
    description: 'A hovering dancer of the dusk. Swarms drift slowly and are easy to snatch from the air - or from a web.',
  });
  def({
    id: 'fruitfly', name: 'Fruit Fly', latin: 'Drosophila melanogaster', role: 'prey', tier: 0,
    sizeText: '2-3 mm', radius: 3.4, hp: 1.6, speed: 46, flee: 105, detection: 95, leash: 260,
    flying: true, activity: 'day', rainShelter: true, windSensitive: true, ext: 1.8, shadow: [1.0, 0.6],
    diet: ['yeast on fermenting fruit', 'nectar'], habitat: ['garden', 'litter'],
    value: { hunger: 10, growth: 7 }, danger: 0, color: '#c79a52', color2: '#3a2a1a',
    trap: { time: 40, breaks: 0 },
    fact: 'Fruit flies are drawn to the smell of fermenting fruit. Like all true flies, they have only two wings; the hind pair became halteres, vibrating "gyroscopes" that tell the fly how it is rotating. Their red compound eyes hold about 800 lenses each, and Drosophila has been a star of genetics for over a century.',
    description: 'A quick, red-eyed flyer buzzing around the blossoms. Fast to react, but spins easily into a web.',
  });
  def({
    id: 'ant', name: 'Carpenter Ant', latin: 'Camponotus modoc', role: 'prey', tier: 1, defends: true,
    sizeText: '8-14 mm', radius: 5.5, hp: 7, armor: 0.2, speed: 48, flee: 90, detection: 80, leash: 420,
    activity: 'any', rainShelter: false, ext: 1.6, shadow: [1.3, 0.8],
    eats: ['aphid', 'springtail', 'mite'], huntRange: 90,
    attack: { reach: 3, windup: 0.18, cooldown: 0.9, dmg: 2.6, lunge: 2.2 },
    diet: ['honeydew', 'aphid', 'springtail', 'other small insects'], habitat: ['bark', 'garden', 'litter'],
    value: { hunger: 18, growth: 13 }, danger: 2.8, color: '#26201c', color2: '#6a2f1d',
    trap: { time: 16, breaks: 0 },
    fact: 'Ants are social insects: sterile female workers forage, tend aphids for honeydew and defend the colony. Carpenter ants excavate galleries in dead wood to nest but do not eat it. A threatened worker bites, sprays formic acid and releases alarm pheromone - so one bitten ant often means a dozen angry ones.',
    description: 'Columns of workers patrol the bark. Bite one and its sisters rush to defend it. Tasty, but costly.',
  });
  def({
    id: 'pillbug', name: 'Pill Bug', latin: 'Armadillidium vulgare', role: 'prey', tier: 1,
    sizeText: '10-18 mm', radius: 7, hp: 8, armor: 0.35, speed: 18, flee: 38, detection: 60, leash: 300,
    nocturnal: true, activity: 'night', fleeStyle: 'curl', graze: true, rainShelter: true, ext: 1.55, shadow: [1.2, 0.95],
    diet: ['decaying leaves', 'fungi', 'rotting wood'], habitat: ['litter', 'bark'],
    value: { hunger: 20, growth: 15 }, danger: 0, color: '#6c7380', color2: '#a6adb8',
    trap: { time: 18, breaks: 0 },
    fact: 'Pill bugs ("roly-polies") are not insects - they are land-living crustaceans, relatives of crabs and shrimp, with seven pairs of legs. They breathe with gill-like structures and need damp places. When threatened they roll into an armored ball, a trick called conglobation.',
    description: 'A grey armored crustacean that curls into a ball when scared. Wait for it to unroll.',
  });
  def({
    id: 'moth', name: 'Owlet Moth', latin: 'Noctuidae', role: 'prey', tier: 2,
    sizeText: '25-40 mm wingspan', radius: 9, hp: 6, speed: 52, flee: 95, detection: 130, leash: 520,
    flying: true, nocturnal: true, activity: 'night', rainShelter: true, windSensitive: true, ext: 2.1, shadow: [1.5, 0.8],
    diet: ['flower nectar'], habitat: ['garden', 'bark'],
    value: { hunger: 24, growth: 19 }, danger: 0, color: '#8a7a64', color2: '#4a3d30',
    trap: { time: 9, breaks: 0.05 },
    fact: 'Moths and butterflies (Lepidoptera) are "scale-winged": their wings are tiled with microscopic colored scales that rub off as dust. Many owlet moths have ears on the thorax tuned to bat sonar and dive or loop when they hear it. By day they rest, wings folded flat, camouflaged against bark.',
    description: 'A dusty night flyer that sleeps camouflaged on bark by day. A rich meal for a bigger spider.',
  });
  def({
    id: 'cricket', name: 'Field Cricket', latin: 'Gryllus sp.', role: 'prey', tier: 2,
    sizeText: '15-25 mm', radius: 10, hp: 10, speed: 40, flee: 150, detection: 140, leash: 460,
    nocturnal: true, activity: 'night', fleeStyle: 'hop', ext: 1.9, shadow: [1.4, 0.8],
    diet: ['plants', 'fungi', 'dead insects'], habitat: ['litter', 'garden'],
    value: { hunger: 28, growth: 22 }, danger: 0, color: '#2f2218', color2: '#7a5530',
    trap: { time: 10, breaks: 0.08 },
    fact: 'Male crickets sing by scraping a hardened ridge on one forewing across a row of tiny teeth (a file) on the other - stridulation. Crickets "hear" with eardrum-like tympana on their front legs, and the chirp rate speeds up as the night warms. Their huge hind legs are built for explosive jumps.',
    description: 'A glossy night-time jumper with long antennae. Its leaps are fast and unpredictable.',
  });
  def({
    id: 'caterpillar', name: 'Cabbage White Caterpillar', latin: 'Pieris rapae', role: 'prey', tier: 2,
    sizeText: '20-25 mm', radius: 8, hp: 12, speed: 9, flee: 22, detection: 55, leash: 160,
    activity: 'day', graze: true, ext: 2.4, shadow: [2.2, 0.7],
    diet: ['cabbage-family leaves'], habitat: ['garden', 'bark'],
    value: { hunger: 32, growth: 25 }, danger: 0, color: '#79b24a', color2: '#f0d84a',
    trap: { time: 25, breaks: 0 },
    fact: 'A caterpillar is the larval stage of a butterfly or moth: a living eating machine that grows hundreds of times heavier before it pupates, shedding its skin several times (molting - just like a spider). Wasps hunt caterpillars, chewing them into a protein paste to feed their own larvae.',
    description: 'A slow, plump leaf-eater. It cannot outrun anything, which is why wasps love it.',
  });
  def({
    id: 'grasshopper', name: 'Grasshopper', latin: 'Melanoplus sp.', role: 'prey', tier: 3,
    sizeText: '20-35 mm', radius: 13, hp: 16, speed: 34, flee: 190, detection: 160, leash: 560,
    activity: 'day', fleeStyle: 'hop', flying: false, canFly: true, ext: 2.0, shadow: [1.6, 0.85],
    diet: ['grasses', 'leaves'], habitat: ['garden'],
    value: { hunger: 38, growth: 32 }, danger: 0, color: '#7f9a3a', color2: '#c2a35a',
    trap: { time: 6, breaks: 0.12 },
    fact: 'Short-horned grasshoppers (Acrididae) leap using elastic energy stored in the hind-leg muscle and cuticle, then released like a catapult. Their ears are on the abdomen, not the head, and they chew with strong sideways-moving jaws. Short antennae tell them apart from crickets and katydids.',
    description: 'A big green jumper of the garden - powerful hind legs, jumpy nerves, big reward for a well-sprung web.',
  });
  def({
    id: 'beetle', name: 'Seven-spot Ladybird', latin: 'Coccinella septempunctata', role: 'prey', tier: 2,
    sizeText: '7-8 mm', radius: 6.5, hp: 13, armor: 0.5, speed: 30, flee: 52, detection: 80, leash: 360,
    flying: false, canFly: true, activity: 'day', eats: ['aphid'], huntRange: 70, ext: 1.4, shadow: [1.2, 1.0],
    diet: ['aphid'], habitat: ['garden', 'bark'],
    value: { hunger: 34, growth: 28 }, danger: 0, color: '#d3241a', color2: '#16100e',
    trap: { time: 14, breaks: 0 },
    fact: 'Beetles (Coleoptera) wear armor: the front wings are hardened into shell-like elytra that shield the folded flight wings beneath. The ladybird\'s red-and-black pattern is aposematic - a warning that it tastes bitter and toxic. A single ladybird can eat hundreds of aphids a week.',
    description: 'A domed, armored aphid-hunter. Its shell shrugs off weak bites - you need real venom to get through.',
  });
  // ---------------------------------------------------------------- predators
  def({
    id: 'centipede', name: 'Stone Centipede', latin: 'Lithobius forficatus', role: 'predator', tier: 1,
    sizeText: '18-30 mm', radius: 11, hp: 20, armor: 0.1, speed: 55, chase: 150, flee: 130, detection: 175, maxPrey: 2.6, leash: 520,
    nocturnal: true, activity: 'night', ext: 3.0, shadow: [2.8, 0.7],
    eats: ['springtail', 'mite', 'cricket', 'pillbug', 'ant', 'kin'], huntRange: 120,
    attack: { reach: 9, windup: 0.32, cooldown: 0.95, dmg: 9, lunge: 2.4 },
    diet: ['springtail', 'mite', 'cricket', 'pillbug', 'small spiders', 'earthworms'], habitat: ['bark', 'litter'],
    value: { hunger: 40, growth: 30 }, danger: 7.2, color: '#8a3b22', color2: '#c98a3a',
    trap: { time: 3, breaks: 0.2 },
    fact: 'Centipedes are myriapods, not insects: each body segment carries one pair of legs (stone centipedes have 15 pairs - the number is always odd). The first pair of legs is modified into venom-injecting fangs called forcipules. They hunt at night, sensing vibrations with their long antennae, and run down prey faster than a spiderling can flee.',
    description: 'A fast, many-legged night hunter. Its fangs are fast and its senses are sharp. Hide, or put silk between you.',
  });
  def({
    id: 'wasp', name: 'Western Yellowjacket', latin: 'Vespula pensylvanica', role: 'predator', tier: 2,
    sizeText: '10-15 mm', radius: 9, hp: 14, speed: 78, chase: 170, flee: 150, detection: 210, maxPrey: 3.2, leash: 700,
    flying: true, activity: 'day', rainShelter: true, ext: 2.2, shadow: [1.5, 0.9],
    eats: ['fruitfly', 'midge', 'caterpillar', 'aphid', 'kin'], huntRange: 220,
    attack: { reach: 8, windup: 0.4, cooldown: 1.1, dmg: 8, lunge: 2.6 },
    diet: ['caterpillar', 'fruit fly', 'midge', 'nectar', 'spiders'], habitat: ['garden', 'bark'],
    value: { hunger: 36, growth: 28 }, danger: 5.3, color: '#f1c21b', color2: '#15110d',
    trap: { time: 4, breaks: 0.18 },
    fact: 'Yellowjackets are social wasps. Adults sip nectar, but they hunt flies, caterpillars and spiders, chewing prey into a protein ball to feed the larvae in the nest. The smooth stinger can be used again and again, unlike a honeybee\'s barbed one. Their bright yellow-and-black stripes warn of their sting.',
    description: 'A fast, striped hunter that patrols the flowers by day. It curls its abdomen just before it stings.',
  });
  def({
    id: 'bird', name: 'Song Sparrow', latin: 'Melospiza melodia', role: 'predator', tier: 2,
    sizeText: '15 cm', radius: 26, hp: 60, speed: 85, flee: 220, detection: 400, maxPrey: 99, leash: 99999,
    flying: true, activity: 'day', ext: 2.6, shadow: [2.2, 1.3], noCollide: true,
    eats: ['ant', 'aphid', 'caterpillar', 'cricket', 'grasshopper', 'moth', 'beetle', 'pillbug', 'springtail', 'mite', 'kin'], huntRange: 520,
    attack: { reach: 36, windup: 3.0, cooldown: 2.0, dmg: 34, lunge: 1 },
    diet: ['caterpillar', 'grasshopper', 'cricket', 'beetle', 'spiders', 'seeds'], habitat: ['litter', 'bark', 'garden'],
    value: { hunger: 0, growth: 0 }, danger: 12, color: '#7a5a3c', color2: '#2f2318',
    trap: null,
    fact: 'Songbirds forage by sight and sound, snapping up insects and spiders - and they feed their nestlings almost entirely on arthropods, hundreds a day. Birds are among the most important predators of spiders. The only defence: stay under cover, because a bird will not dive into leaves and stems.',
    description: 'A looming shadow drifts across open ground, then the bird strikes. Get under leaf, bark or petal before it lands.',
  });
  def({
    id: 'mantis', name: 'Chinese Mantis', latin: 'Tenodera sinensis', role: 'predator', tier: 3,
    sizeText: '70-100 mm', radius: 14, hp: 34, speed: 24, chase: 60, flee: 80, detection: 150, maxPrey: 2.2, leash: 120,
    activity: 'day', ext: 2.4, shadow: [2.3, 0.8], ambusher: true,
    eats: ['fruitfly', 'midge', 'moth', 'cricket', 'grasshopper', 'beetle', 'kin'], huntRange: 85,
    attack: { reach: 40, windup: 0.4, cooldown: 2.0, dmg: 18, lunge: 1 },
    diet: ['flies', 'moths', 'crickets', 'grasshoppers', 'spiders'], habitat: ['garden'],
    value: { hunger: 0, growth: 0 }, danger: 7.5, color: '#7aa23c', color2: '#c9b86a',
    trap: { time: 3, breaks: 0.25 },
    fact: 'Mantises are sit-and-wait ambush predators. Their spiked raptorial forelegs snap shut in well under a tenth of a second, aimed with forward-facing eyes - mantises are among the few insects with true 3-D vision. Larger mantises will happily eat spiders. They sway like a leaf in the breeze to stay hidden.',
    description: 'A patient, camouflaged ambusher. It barely moves until you wander within reach - then the arms flash out.',
  });
  def({
    id: 'rove', name: 'Devil\'s Coach Horse', latin: 'Ocypus olens', role: 'predator', tier: 0, edibleWhenSmall: true,
    sizeText: '20-28 mm', radius: 6, hp: 9, speed: 42, chase: 86, flee: 90, detection: 100, maxPrey: 1.15, leash: 380,
    nocturnal: true, activity: 'night', ext: 2.0, shadow: [1.6, 0.7],
    eats: ['springtail', 'mite', 'aphid', 'kin'], huntRange: 90,
    attack: { reach: 6, windup: 0.4, cooldown: 1.3, dmg: 4, lunge: 2.2 },
    diet: ['springtail', 'mite', 'woodlice', 'small invertebrates'], habitat: ['litter', 'bark'],
    value: { hunger: 22, growth: 16 }, danger: 2.4, color: '#17130f', color2: '#4a4036',
    trap: { time: 4, breaks: 0 },
    fact: 'Rove beetles (Staphylinidae) are one of the largest animal families on Earth. Their wing covers are stubby, leaving a long flexible abdomen exposed. When alarmed, a devil\'s coach horse curls its abdomen up like a scorpion and gapes its jaws - a bluff, as it has no sting.',
    description: 'A black night prowler of the leaf litter. It rears up before it lunges - a warning you can learn to read.',
  });
  def({
    id: 'ground', name: 'Ground Beetle', latin: 'Pterostichus melanarius', role: 'predator', tier: 1, edibleWhenSmall: true,
    sizeText: '14-18 mm', radius: 8, hp: 14, armor: 0.3, speed: 46, chase: 98, flee: 100, detection: 120, maxPrey: 1.15, leash: 420,
    nocturnal: true, activity: 'night', ext: 1.8, shadow: [1.5, 0.9],
    eats: ['caterpillar', 'springtail', 'mite', 'pillbug', 'kin'], huntRange: 110,
    attack: { reach: 7, windup: 0.36, cooldown: 1.2, dmg: 5, lunge: 2.1 },
    diet: ['caterpillar', 'springtail', 'mite', 'slugs'], habitat: ['litter', 'bark'],
    value: { hunger: 30, growth: 22 }, danger: 3.2, color: '#1b2230', color2: '#4d6a8a',
    trap: { time: 5, breaks: 0 },
    fact: 'Ground beetles (Carabidae) are long-legged runners that patrol the soil surface at night, hunting slugs, caterpillars and other small prey - valuable pest controllers. Many have lost the ability to fly. Their strongly grooved wing covers are often glossy with a metallic sheen, and some species squirt irritating chemicals.',
    description: 'A sleek, long-legged night runner with a metallic sheen and strong jaws.',
  });
  // ---------------------------------------------------------------- spiders
  def({
    id: 'wolf', name: 'Wolf Spider', latin: 'Pardosa sp. (Lycosidae)', role: 'predator', tier: 2, spider: true,
    sizeText: '10-20 mm', radius: 15, hp: 30, armor: 0.05, speed: 62, chase: 150, flee: 150, detection: 210, maxPrey: 1.4, leash: 560,
    nocturnal: true, activity: 'night', ext: 2.4, shadow: [2.2, 1.2],
    eats: ['cricket', 'ant', 'pillbug', 'springtail', 'mite', 'kin'], huntRange: 200,
    attack: { reach: 10, windup: 0.3, cooldown: 1.0, dmg: 13, lunge: 2.2 },
    diet: ['cricket', 'ant', 'pillbug', 'springtail', 'spiderlings'], habitat: ['litter', 'bark'],
    value: { hunger: 0, growth: 0 }, danger: 9.6, color: '#5b4632', color2: '#c9b48a',
    trap: { time: 2, breaks: 0.15 },
    fact: 'Wolf spiders do not catch prey in webs: they run it down using superb eyesight (eight eyes, two of them big and forward-facing) and a powerful sprint. A mother carries her egg sac on her spinnerets, then carries the newly hatched spiderlings on her back for about a week - a rare case of spider parental care.',
    description: 'A fast, sharp-eyed rival hunter. Webs will not stop her for long, but cover and silk can buy you time.',
  });
  def({
    id: 'jumper', name: 'Jumping Spider', latin: 'Phidippus audax (Salticidae)', role: 'predator', tier: 1, spider: true, edibleWhenSmall: true,
    sizeText: '6-13 mm', radius: 7, hp: 14, armor: 0.05, speed: 40, chase: 105, flee: 130, detection: 190, maxPrey: 1.7, leash: 380,
    activity: 'day', ext: 1.6, shadow: [1.3, 0.9],
    eats: ['fruitfly', 'midge', 'aphid', 'springtail', 'mite', 'kin'], huntRange: 150,
    attack: { reach: 42, windup: 0.32, cooldown: 1.3, dmg: 6, lunge: 4.2 },
    diet: ['fruit fly', 'midge', 'aphid', 'small spiders'], habitat: ['bark', 'garden', 'litter'],
    value: { hunger: 26, growth: 20 }, danger: 3.7, color: '#14110f', color2: '#e9e2d0',
    trap: { time: 3, breaks: 0.05 },
    fact: 'Jumping spiders (Salticidae) have the sharpest vision of any animal their size: two huge forward eyes resolve fine detail, and six more eyes watch for motion. They stalk like cats and leap many body-lengths, powered by sudden blood pressure in the legs, trailing a safety dragline of silk behind them.',
    description: 'A curious, stalking competitor. It turns to watch you, creeps closer - then leaps.',
  });
  def({
    id: 'kin', name: 'Spiderling Sibling', latin: 'Araneus diadematus (spiderling)', role: 'spider', tier: 0, spider: true,
    sizeText: '1-2 mm', radius: 3.6, hp: 4, speed: 70, flee: 110, detection: 140, leash: 99999,
    activity: 'any', ext: 1.7, shadow: [1.2, 0.9], trap: null, noRespawn: true,
    diet: ['springtail', 'mite', 'midge'], habitat: ['litter'],
    value: { hunger: 0, growth: 0 }, danger: 0, color: '#c88a3a', color2: '#5a3a1a',
    fact: 'A spider egg sac can hold hundreds of eggs. The young molt once inside the sac, then emerge and cluster together for a few days before dispersing - often by "ballooning": releasing a strand of silk that catches the air and carries them away, sometimes for hundreds of kilometers. Clustering helps tiny spiderlings hold on to moisture, and many eyes make a better lookout: when one senses danger the whole cluster reacts. Spiders are not insects: they have two body segments, eight legs, and no antennae.',
    description: 'Your brothers and sisters. They stay close, warn you when a predator is near (an arrow points the way) and huddle in while you rest, so you recover faster and burn less food and water. In Brood mode, if you would die, a sibling gives its life to bring you back: one sibling, one revive (Survival mode has no revives). They drift away as you grow.',
  });
  def({
    id: 'mate', name: 'Suitor', latin: 'Araneus diadematus (adult male)', role: 'spider', tier: 4, spider: true,
    sizeText: '8-10 mm', radius: 17, hp: 9999, speed: 38, flee: 120, detection: 260, leash: 99999,
    activity: 'any', ext: 2.4, shadow: [2.0, 1.2], trap: null, unique: true,
    diet: ['small flying insects'], habitat: ['garden', 'bark', 'litter'],
    value: { hunger: 0, growth: 0 }, danger: 0, color: '#8a4a22', color2: '#e8d8a8',
    fact: 'Adult male spiders are smaller than females and carry enlarged, boxing-glove-shaped pedipalps for transferring sperm. A male tracks a female by the pheromones on her silk and courts her with careful leg-waving or by plucking her web in a special rhythm, so that she recognizes a suitor rather than dinner.',
    description: 'A fellow adult, glowing with pheromone. Approach with care, and make sure you are well fed.',
  });
  // ---------------------------------------------------------------- boss
  // The Widow Matriarch guards her lair in the Old Oak Bark. She is a creature like any other (drawn, bitten and killed here) but
  // her brain is boss.js: `ai: 'boss'` hands her thinking to Game.boss.think, and damage to her goes through Game.boss.onHurt.
  // Beating her unlocks the Black Widow as a playable spider. `attack` holds her base numbers for boss.js.
  def({
    id: 'widow', name: 'Widow Matriarch', latin: 'Latrodectus mactans (adult female)', role: 'predator', tier: 4, spider: true, boss: true, noRespawn: true,
    sizeText: '8-13 mm body, legs span about 4 cm', radius: 30, hp: 340, armor: 0.12, speed: 62, chase: 130, flee: 130, detection: 420, maxPrey: 99, leash: 99999,
    activity: 'any', ext: 3.2, bodyR: 1.5, shadow: [2.4, 1.4], trap: null,
    attack: { reach: 12, windup: 0.55, cooldown: 1.2, dmg: 16, lunge: 2.4 },
    diet: ['flies', 'beetles', 'crickets', 'other spiders'], habitat: ['bark'],
    value: { hunger: 0, growth: 0 }, danger: 14, color: '#17131a', color2: '#d4141c',
    fact: 'Black widows (Latrodectus) are shy, nocturnal spiders that build a tangle of strong, sticky silk in dark, sheltered spots and hang upside down in it, which shows the red hourglass on the underside of the abdomen: a warning to predators. Their venom holds latrotoxin, a neurotoxin that is far more dangerous to people than most spider venom, though the spiders bite mainly when pressed and bites are rarely deadly. Females are much larger than males; they sometimes eat a mate after mating, which is how the group got its name, though it happens less often than legend says.',
    description: 'The queen of the Old Oak Bark: a huge, glossy-black hunter who rules a lair of tangled silk. She lunges, spits sticky silk and slams the ground, and each move shows first. Dodge, then bite her while she recovers. Beat her to unlock the Black Widow.',
  });

  // resolve the diet/eats masks once all kinds exist
  KIND_LIST.forEach(k => { let m = 0; for (let i = 0; i < k.eats.length; i++) { const t = KINDS[k.eats[i]]; if (t) m |= t.bit; } k.eatMask = m; k.isFlyer = !!(k.flying || k.canFly); });

  // ============================================================== SPRITE HELPERS
  // All sprites are drawn in "unit space": +x is forward, 1 unit == creature.radius.
  // F is the shared (reused) pose/context object filled by the wrapper before each sprite call.
  const F = {
    t: 0, ph: 0, mv: 0, seed: 0.5, tele: 0, stuck: 0, dead: 0, hop: 0, air: false, alt: 0,
    detail: false, sil: false, flash: 0, st: '', open: 0, bend: 0, lx: -0.55, ly: -0.8, px: 0.1, curl: 0, atk: 0,
  };

  function fe(ctx, fill, cx, cy, rx, ry, rot) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  }
  function se(ctx, stroke, lw, cx, cy, rx, ry, rot) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); ctx.strokeStyle = stroke; ctx.lineWidth = max(lw, F.px); ctx.stroke();
  }
  function ln(ctx, stroke, lw, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = stroke; ctx.lineWidth = max(lw, F.px); ctx.lineCap = 'round'; ctx.stroke();
  }
  // smooth closed blob through points [x0,y0,x1,y1,...]; optional mirror across the x axis (y -> -y)
  function blobPath(ctx, p, mirror) {
    const n = p.length / 2;
    const px = (i) => p[((i % n) + n) % n * 2], py = (i) => (mirror ? -1 : 1) * p[((i % n) + n) % n * 2 + 1];
    ctx.moveTo((px(n - 1) + px(0)) / 2, (py(n - 1) + py(0)) / 2);
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
    ctx.closePath();
  }
  function blob(ctx, fill, p, mirror) { ctx.beginPath(); blobPath(ctx, p, mirror); ctx.fillStyle = fill; ctx.fill(); }
  function blobS(ctx, stroke, lw, p, mirror) { ctx.beginPath(); blobPath(ctx, p, mirror); ctx.strokeStyle = stroke; ctx.lineWidth = max(lw, F.px); ctx.lineJoin = 'round'; ctx.stroke(); }
  // flat polygon
  function poly(ctx, fill, p) {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  // shaded ellipse: base fill with a light-aware sheen; (hi, lo) are the lit / shadow colors
  function shade(ctx, cx, cy, rx, ry, rot, base, hi, lo) {
    if (F.detail) {
      const m = max(rx, ry);
      const g = ctx.createRadialGradient(cx + F.lx * rx * 0.5, cy + F.ly * ry * 0.5, m * 0.04, cx, cy, m * 1.08);
      g.addColorStop(0, hi); g.addColorStop(0.5, base); g.addColorStop(1, lo);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = lo; ctx.lineWidth = max(0.07, F.px * 0.8); ctx.stroke();
      ctx.fillStyle = hi; ctx.globalAlpha *= 0.55;
      ctx.beginPath(); ctx.ellipse(cx + F.lx * rx * 0.38, cy + F.ly * ry * 0.38, rx * 0.46, ry * 0.32, rot || 0, 0, TAU); ctx.fill();
      ctx.globalAlpha /= 0.55;
    }
  }
  // glossy specular dot
  function gloss(ctx, cx, cy, rx, ry, a) {
    ctx.globalAlpha *= a; fe(ctx, '#ffffff', cx + F.lx * rx * 0.5, cy + F.ly * ry * 0.5, rx * 0.34, ry * 0.2, atan2(F.ly, F.lx)); ctx.globalAlpha /= a;
  }
  // two-bone leg path (adds to the current path, no stroke). side>0 / <0 selects bend direction.
  function legPath(ctx, hx, hy, fx, fy, a, b, bend) {
    let dx = fx - hx, dy = fy - hy, d = hypot(dx, dy);
    const mx = a + b - 0.002;
    if (d > mx) { fx = hx + dx * mx / d; fy = hy + dy * mx / d; dx = fx - hx; dy = fy - hy; d = mx; }
    if (d < 0.01) d = 0.01;
    let cs = (a * a + d * d - b * b) / (2 * a * d); cs = cs > 1 ? 1 : (cs < -1 ? -1 : cs);
    const ang = atan2(dy, dx) + bend * Math.acos(cs);
    ctx.moveTo(hx, hy); ctx.lineTo(hx + cos(ang) * a, hy + sin(ang) * a); ctx.lineTo(fx, fy);
  }
  // N pairs of jointed legs with a walking/flailing/dead pose.
  //   hx,hy: hip positions (per pair, hy>0)   rx,ry: rest foot position   A,B: bone lengths per pair
  //   fwd: bitmask of pairs whose knee bends forward   gait: stride amplitude
  function legsN(ctx, n, hx, hy, rx, ry, A, B, stride, fwd, dark, light, lw, tetra) {
    ctx.beginPath();
    const mv = F.mv, st = F.stuck, dd = F.dead;
    for (let i = 0; i < n; i++) {
      for (let s = -1; s <= 1; s += 2) {
        const pat = tetra ? ((i + (s > 0 ? 1 : 0)) & 1) : ((i + (s > 0 ? 1 : 0)) & 1);
        const th = F.ph + (pat ? PI : 0);
        let fx = rx[i], fy = ry[i] * s;
        if (st > 0.01) { const q = F.t * 24 + i * 1.9 + s * 1.3; fx += sin(q) * (stride * 0.8 + 0.25) * st; fy += cos(q * 0.9) * 0.35 * st * s; }
        if (mv > 0.01) { fx += sin(th) * stride * mv; fy *= 1 - 0.12 * max(0, cos(th)) * mv; }
        if (dd > 0) { fy *= 1 - 0.5 * dd; fx *= 1 - 0.3 * dd; }
        legPath(ctx, hx[i], hy[i] * s, fx, fy, A[i], B[i], ((fwd >> i) & 1) ? -s : s);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = dark; ctx.lineWidth = max(lw * (light ? 1.5 : 1), F.px * 1.1); ctx.stroke();
    if (light) { ctx.strokeStyle = light; ctx.lineWidth = max(lw * 0.7, F.px * 0.5); ctx.stroke(); }
  }
  // antenna (quadratic) appended to current path; sw = sideways sway
  function antPath(ctx, x, y, ang, len, bend, sw) {
    const ex = x + cos(ang) * len - sin(ang) * sw, ey = y + sin(ang) * len + cos(ang) * sw;
    ctx.moveTo(x, y); ctx.quadraticCurveTo(x + cos(ang + bend) * len * 0.62, y + sin(ang + bend) * len * 0.62, ex, ey);
  }
  // translucent insect wing (ellipse from base toward angle ang)
  function wing(ctx, x, y, ang, len, wid, fill, vein, alpha) {
    const cx = x + cos(ang) * len * 0.5, cy = y + sin(ang) * len * 0.5;
    if (F.sil) alpha = 1;
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(cx, cy, len * 0.5, wid, ang, 0, TAU); ctx.fill();
    ctx.globalAlpha /= alpha;
    if (vein && F.detail) {
      ctx.globalAlpha *= alpha * 0.9; ctx.strokeStyle = vein; ctx.lineWidth = max(0.03, F.px * 0.7);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + cos(ang) * len * 0.95, y + sin(ang) * len * 0.95); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, len * 0.5, wid, ang, 0, TAU); ctx.stroke();
      ctx.globalAlpha /= alpha * 0.9;
    }
  }
  const hashf = (a, b) => { const s = sin(a * 127.1 + b * 311.7) * 43758.5453; return s - floor(s); };
  const rgbaCache = {};
  function withA(hex, a) { const key = hex + a; return rgbaCache[key] || (rgbaCache[key] = U.rgba(hex, a)); }
  const mixCache = {};
  function mixc(c1, c2, t) { t = floor(t * 16) / 16; const k = c1 + c2 + t; return mixCache[k] || (mixCache[k] = U.mixColor(c1, c2, t)); }

  // ====================================================================== SPRITES (prey)
  const SPR = {};
  const L3 = (hx, hy, rx, ry, A, B) => ({ hx, hy, rx, ry, A, B });

  // ---- springtail ---------------------------------------------------------
  const SPRINGTAIL_LEGS = L3([0.85, 0.5, 0.15], [0.26, 0.3, 0.3], [1.3, 0.7, -0.1], [0.95, 1.1, 1.05], [0.5, 0.5, 0.5], [0.58, 0.58, 0.58]);
  SPR.springtail = function (ctx) {
    const dark = F.seed < 0.4;
    const body = dark ? '#8a94a6' : '#d9d3bb', band = dark ? '#394357' : '#69778c', hi = '#fbf7e8', lo = dark ? '#2a3140' : '#847d66';
    const L = SPRINGTAIL_LEGS;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.2, 1, '#6c6a5c', null, 0.07);
    if (F.hop > 0.02) { // furcula flicked out behind
      const e = F.hop;
      ctx.strokeStyle = '#f2efe0'; ctx.lineWidth = max(0.08, F.px); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-1.35, 0); ctx.lineTo(-1.35 - 1.5 * e, 0.1); ctx.moveTo(-1.35 - 1.5 * e, 0.1); ctx.lineTo(-1.35 - 2.0 * e, 0.28); ctx.moveTo(-1.35 - 1.5 * e, 0.1); ctx.lineTo(-1.35 - 2.0 * e, -0.14); ctx.stroke();
    }
    // abdomen segments rear -> front
    shade(ctx, -1.5, 0, 0.3, 0.28, 0, band, hi, lo);
    shade(ctx, -1.2, 0, 0.45, 0.4, 0, body, hi, lo);
    shade(ctx, -0.8, 0, 0.5, 0.47, 0, band, hi, lo);
    shade(ctx, -0.35, 0, 0.55, 0.51, 0, body, hi, lo);
    shade(ctx, 0.15, 0, 0.55, 0.5, 0, band, hi, lo);
    shade(ctx, 0.65, 0, 0.5, 0.45, 0, body, hi, lo);
    shade(ctx, 1.15, 0, 0.42, 0.38, 0, body, hi, lo);
    fe(ctx, '#1b1a1c', 1.3, 0.2, 0.09, 0.09); fe(ctx, '#1b1a1c', 1.3, -0.2, 0.09, 0.09);
    ctx.beginPath(); const sw = sin(F.t * 5) * 0.12 + F.mv * sin(F.ph) * 0.2;
    antPath(ctx, 1.5, 0.14, 0.35, 1.5, -0.35, sw); antPath(ctx, 1.5, -0.14, -0.35, 1.5, 0.35, -sw);
    ctx.strokeStyle = '#7a7566'; ctx.lineWidth = max(0.06, F.px); ctx.lineCap = 'round'; ctx.stroke();
  };

  // ---- oribatid mite --------------------------------------------------------
  const MITE_LEGS = L3([0.65, 0.35, 0.0, -0.4], [0.45, 0.5, 0.5, 0.45], [1.3, 0.95, 0.15, -0.75], [1.05, 1.3, 1.35, 1.15], [0.55, 0.58, 0.58, 0.55], [0.62, 0.66, 0.66, 0.62]);
  SPR.mite = function (ctx) {
    const L = MITE_LEGS;
    legsN(ctx, 4, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.16, 0b0011, '#4a2412', '#8a5a34', 0.1, true);
    fe(ctx, '#a6683a', 1.0, 0, 0.36, 0.3);
    shade(ctx, -0.05, 0, 1.0, 0.95, 0, '#7a4425', '#e3a672', '#34190b');
    // notogaster ridges
    ctx.strokeStyle = 'rgba(40,18,6,0.4)'; ctx.lineWidth = max(0.05, F.px * 0.7); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0.35, -0.7); ctx.quadraticCurveTo(0.7, 0, 0.35, 0.7); ctx.moveTo(-0.25, -0.82); ctx.quadraticCurveTo(0.1, 0, -0.25, 0.82); ctx.stroke();
    ctx.strokeStyle = '#6d4a2c'; ctx.lineWidth = max(0.05, F.px * 0.7);
    ctx.beginPath(); ctx.moveTo(0.8, 0.28); ctx.lineTo(1.5, 0.55); ctx.moveTo(0.8, -0.28); ctx.lineTo(1.5, -0.55); ctx.stroke();
    gloss(ctx, -0.05, 0, 1.0, 0.95, 0.9);
  };

  // ---- aphid ----------------------------------------------------------------
  const APHID_LEGS = L3([0.7, 0.35, 0.0], [0.3, 0.35, 0.35], [1.1, 0.5, -0.45], [1.05, 1.3, 1.2], [0.6, 0.65, 0.65], [0.75, 0.8, 0.8]);
  SPR.aphid = function (ctx) {
    const g = F.seed < 0.2 ? '#d9a04a' : '#8fcf4a', gd = F.seed < 0.2 ? '#a8702a' : '#4e8a22', gh = '#e3ffb0';
    const L = APHID_LEGS;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.14, 1, '#4b6f2a', null, 0.07);
    ctx.strokeStyle = '#6d9c40'; ctx.lineWidth = max(0.07, F.px); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.85, 0.3); ctx.lineTo(-1.45, 0.42); ctx.moveTo(-0.85, -0.3); ctx.lineTo(-1.45, -0.42); ctx.stroke();  // cornicles
    shade(ctx, -0.35, 0, 1.0, 0.76, 0, g, gh, gd);
    shade(ctx, 0.6, 0, 0.5, 0.46, 0, g, gh, gd);
    shade(ctx, 1.05, 0, 0.38, 0.34, 0, g, gh, gd);
    ctx.strokeStyle = 'rgba(40,90,20,0.45)'; ctx.lineWidth = max(0.06, F.px * 0.8);
    ctx.beginPath(); ctx.moveTo(0.4, 0); ctx.lineTo(-1.1, 0); ctx.stroke();
    fe(ctx, '#7a1c1c', 1.2, 0.2, 0.1, 0.1); fe(ctx, '#7a1c1c', 1.2, -0.2, 0.1, 0.1);
    ctx.beginPath(); const sw = sin(F.t * 3 + F.seed * 6) * 0.15;
    antPath(ctx, 1.35, 0.12, 0.3, 1.5, -0.3, sw); antPath(ctx, 1.35, -0.12, -0.3, 1.5, 0.3, -sw);
    ctx.strokeStyle = '#5a7a32'; ctx.lineWidth = max(0.06, F.px); ctx.stroke();
    if (F.seed > 0.82) { // winged morph
      wing(ctx, 0.5, 0.2, 2.6, 1.9, 0.38, '#e8f4ff', '#9db', 0.5); wing(ctx, 0.5, -0.2, -2.6, 1.9, 0.38, '#e8f4ff', '#9db', 0.5);
    }
  };

  // ---- midge ----------------------------------------------------------------
  SPR.midge = function (ctx) {
    const t = F.t, fl = sin(t * 60 + F.seed * 9);
    // legs hang forward/out
    ctx.strokeStyle = '#5d6240'; ctx.lineWidth = max(0.06, F.px); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      const k = sin(t * 4 + s) * 0.12;
      ctx.moveTo(0.5, 0.2 * s); ctx.lineTo(1.2, 0.9 * s + k); ctx.lineTo(1.8, 1.25 * s);
      ctx.moveTo(0.35, 0.2 * s); ctx.lineTo(0.5, 1.15 * s + k); ctx.lineTo(0.9, 1.7 * s);
      ctx.moveTo(0.2, 0.2 * s); ctx.lineTo(-0.5, 1.0 * s + k); ctx.lineTo(-1.1, 1.5 * s);
    }
    ctx.stroke();
    // wings: blur of two flutter positions
    const wa = 0.45 + 0.28 * fl;
    wing(ctx, 0.3, 0.2, PI - wa - 0.2 + 0, 2.3, 0.4, '#f4f8ff', '#9aa', 0.34); wing(ctx, 0.3, -0.2, -(PI - wa - 0.2), 2.3, 0.4, '#f4f8ff', '#9aa', 0.34);
    wing(ctx, 0.3, 0.2, PI - 0.9 + 0.28 * fl, 2.2, 0.36, '#f4f8ff', null, 0.18); wing(ctx, 0.3, -0.2, -(PI - 0.9 + 0.28 * fl), 2.2, 0.36, '#f4f8ff', null, 0.18);
    // slender abdomen
    const cb = '#b8c488', cd = '#5f6b38';
    for (let i = 5; i >= 0; i--) { const x = -0.2 - i * 0.28, r = 0.24 - i * 0.012; shade(ctx, x, sin(t * 6 + i * 0.7) * 0.03, 0.3, r, 0, i & 1 ? cd : cb, '#eef5c8', cd); }
    shade(ctx, 0.4, 0, 0.55, 0.45, 0, '#a9b878', '#f0f7cc', '#4f5b2c');
    shade(ctx, 0.98, 0, 0.3, 0.28, 0, '#8c9a5c', '#e6efb8', '#3d4720');
    fe(ctx, '#171a0e', 1.08, 0.19, 0.1, 0.1); fe(ctx, '#171a0e', 1.08, -0.19, 0.1, 0.1);
    // plumose antennae
    ctx.strokeStyle = '#6b7442'; ctx.lineWidth = max(0.04, F.px * 0.7);
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) { ctx.moveTo(1.2, 0.1 * s); ctx.lineTo(1.9, 0.5 * s); for (let k = 0; k < 5; k++) { const a = 1.2 + 0.7 * (k / 4), b = 0.1 + 0.4 * (k / 4); ctx.moveTo(a, b * s); ctx.lineTo(a + 0.3, (b + 0.34) * s); ctx.moveTo(a, b * s); ctx.lineTo(a - 0.05, (b + 0.36) * s); } }
    ctx.stroke();
  };

  // ---- fruit fly ------------------------------------------------------------
  const FF_LEGS = L3([0.7, 0.35, 0.05], [0.35, 0.4, 0.4], [1.3, 0.55, -0.7], [1.1, 1.35, 1.15], [0.6, 0.65, 0.7], [0.75, 0.8, 0.85]);
  SPR.fruitfly = function (ctx) {
    const t = F.t, fl = sin(t * 70 + F.seed * 9), L = FF_LEGS;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.22, 1, '#4a3820', null, 0.07);
    const wa = 0.38 + 0.25 * fl;
    wing(ctx, 0.1, 0.35, PI * 0.5 + 0.55 + wa, 2.5, 0.52, '#f2f6ff', '#8a96a8', 0.4); wing(ctx, 0.1, -0.35, -(PI * 0.5 + 0.55 + wa), 2.5, 0.52, '#f2f6ff', '#8a96a8', 0.4);
    wing(ctx, 0.1, 0.35, PI * 0.5 + 0.9 - 0.2 * fl, 2.4, 0.46, '#f2f6ff', null, 0.15); wing(ctx, 0.1, -0.35, -(PI * 0.5 + 0.9 - 0.2 * fl), 2.4, 0.46, '#f2f6ff', null, 0.15);
    shade(ctx, -0.85, 0, 1.05, 0.64, 0, '#c9a35c', '#f2d79a', '#6d5226');
    ctx.fillStyle = '#2a1f14';
    for (let i = 0; i < 4; i++) { const x = -0.45 - i * 0.38; ctx.beginPath(); ctx.ellipse(x, 0, 0.13, 0.6 * (1 - i * 0.12), 0, 0, TAU); ctx.fill(); }
    shade(ctx, 0.3, 0, 0.72, 0.62, 0, '#caa05a', '#f4dc9e', '#6f5428');
    ctx.strokeStyle = 'rgba(40,28,14,0.5)'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(0.8, 0.15); ctx.lineTo(-0.1, 0.15); ctx.moveTo(0.8, -0.15); ctx.lineTo(-0.1, -0.15); ctx.stroke();
    shade(ctx, 0.98, 0, 0.42, 0.45, 0, '#b88e4c', '#efd398', '#5e4720');
    shade(ctx, 1.02, 0.42, 0.34, 0.4, 0, '#c4252a', '#ff8f7c', '#5a0a10');
    shade(ctx, 1.02, -0.42, 0.34, 0.4, 0, '#c4252a', '#ff8f7c', '#5a0a10');
    ctx.strokeStyle = '#4a3820'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(1.35, 0.1); ctx.lineTo(1.7, 0.2); ctx.moveTo(1.35, -0.1); ctx.lineTo(1.7, -0.2); ctx.stroke();
  };

  // ---- carpenter ant ---------------------------------------------------------
  const ANT_LEGS = L3([0.95, 0.55, 0.15], [0.2, 0.22, 0.22], [1.55, 0.85, -0.65], [1.0, 1.25, 1.15], [0.62, 0.7, 0.78], [0.8, 0.88, 0.95]);
  SPR.ant = function (ctx) {
    const L = ANT_LEGS, tl = F.tele;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.3, 1, '#14100d', '#4a3a30', 0.1);
    // gaster (curls forward when spraying)
    const gx = -0.8 + tl * 0.22;
    shade(ctx, gx, 0, 0.98 - tl * 0.12, 0.68, 0, '#2a221e', '#7a665a', '#0c0908');
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = max(0.05, F.px * 0.8); ctx.beginPath();
    for (let i = 0; i < 3; i++) { const x = gx - 0.55 + i * 0.32; ctx.moveTo(x, -0.58); ctx.quadraticCurveTo(x + 0.15, 0, x, 0.58); } ctx.stroke();
    fe(ctx, '#2a1f1a', -0.03, 0, 0.26, 0.24);
    shade(ctx, 0.5, 0, 0.75, 0.36, 0, '#3a2a22', '#8a6a56', '#150f0c');
    shade(ctx, 1.0, 0, 0.44, 0.4, 0, '#2d221c', '#7a604e', '#100b09');
    shade(ctx, 1.38, 0, 0.56, 0.48, 0, '#241b17', '#6e5648', '#0b0807');
    fe(ctx, '#0a0807', 1.5, 0.3, 0.1, 0.1);  fe(ctx, '#0a0807', 1.5, -0.3, 0.1, 0.1);
    gloss(ctx, 1.38, 0, 0.56, 0.48, 0.5);
    // mandibles
    const op = 0.22 + F.open * 0.3 + tl * 0.45;
    ctx.fillStyle = '#4a342a';
    for (let s = -1; s <= 1; s += 2) { ctx.beginPath(); ctx.moveTo(1.88, 0.14 * s); ctx.quadraticCurveTo(2.35, (0.2 + op) * s, 2.28, (0.06 + op * 0.2) * s); ctx.quadraticCurveTo(2.1, 0.18 * s, 1.88, 0.02 * s); ctx.fill(); }
    // elbowed antennae
    ctx.strokeStyle = '#3a2c24'; ctx.lineWidth = max(0.07, F.px); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    const sw = sin(F.t * 7 + F.seed * 5) * 0.12 + sin(F.ph) * 0.1 * F.mv;
    for (let s = -1; s <= 1; s += 2) { ctx.moveTo(1.85, 0.2 * s); ctx.lineTo(2.35, 0.34 * s + sw * s); ctx.lineTo(2.55 + sw, (0.95 + sw) * s); ctx.lineTo(2.35 + sw, 1.35 * s); }
    ctx.stroke();
  };

  // ---- pill bug --------------------------------------------------------------
  SPR.pillbug = function (ctx) {
    const base = '#6c7380', hi = '#cfd6e0', lo = '#2e333c', rim = '#9aa3b0';
    const cu = F.curl;
    if (cu > 0.5) { // rolled ball
      ctx.save(); ctx.rotate(F.t * 0.0);
      shade(ctx, 0, 0, 0.98, 0.98, 0, base, hi, lo);
      ctx.strokeStyle = 'rgba(20,24,30,0.5)'; ctx.lineWidth = max(0.06, F.px); ctx.lineCap = 'round';
      for (let i = -3; i <= 3; i++) { const x = i * 0.27; const h = sqrt(max(0, 0.96 - x * x)); ctx.beginPath(); ctx.moveTo(x, -h); ctx.quadraticCurveTo(x + 0.18, 0, x, h); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.arc(0, 0, 0.94, PI * 1.05, PI * 1.55); ctx.stroke();
      ctx.restore();
      gloss(ctx, 0, 0, 0.98, 0.98, 0.7);
      return;
    }
    const sq = 1 - cu * 0.2;
    // legs fringe
    ctx.strokeStyle = '#4c5260'; ctx.lineWidth = max(0.07, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i < 7; i++) for (let s = -1; s <= 1; s += 2) {
      const x = 0.85 - i * 0.33, th = F.ph + (((i + (s > 0 ? 1 : 0)) & 1) ? PI : 0), w = 0.55 * sqrt(max(0.1, 1 - (x / 1.5) * (x / 1.5)));
      const o = sin(th) * 0.16 * F.mv + sin(F.t * 18 + i + s) * 0.12 * F.stuck;
      ctx.moveTo(x, w * s * 0.7); ctx.lineTo(x + 0.12 + o, (w + 0.38) * s * sq);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-1.35, 0.15); ctx.lineTo(-1.8, 0.28); ctx.moveTo(-1.35, -0.15); ctx.lineTo(-1.8, -0.28); ctx.stroke();
    // tergite plates tail -> head
    for (let i = 7; i >= 0; i--) {
      const x = 0.95 - i * 0.3 - (i === 7 ? 0.1 : 0), w = (0.92 * sqrt(max(0.05, 1 - (x / 1.62) * (x / 1.62)))) * sq;
      const sh = i % 2 ? '#667080' : '#6f7886';
      shade(ctx, x, 0, 0.5, w, 0, sh, hi, lo);
      ctx.strokeStyle = rim; ctx.globalAlpha *= 0.45; ctx.lineWidth = max(0.05, F.px * 0.8); ctx.beginPath(); ctx.ellipse(x, 0, 0.5, w, 0, PI * 1.25, PI * 1.75); ctx.stroke(); ctx.globalAlpha /= 0.45;
    }
    ctx.strokeStyle = 'rgba(15,18,24,0.42)'; ctx.beginPath(); ctx.moveTo(1.1, 0); ctx.lineTo(-1.5, 0); ctx.stroke();
    shade(ctx, 1.42, 0, 0.3, 0.46 * sq, 0, '#3e444e', '#98a2b0', '#171a1f');
    fe(ctx, '#101214', 1.52, 0.3 * sq, 0.07, 0.07); fe(ctx, '#101214', 1.52, -0.3 * sq, 0.07, 0.07);
    ctx.strokeStyle = '#575e6b'; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); const sw = sin(F.t * 4 + F.seed * 7) * 0.12;
    antPath(ctx, 1.65, 0.2, 0.35, 0.9, -0.3, sw); antPath(ctx, 1.65, -0.2, -0.35, 0.9, 0.3, -sw); ctx.stroke();
  };

  // ---- owlet moth ------------------------------------------------------------
  const MOTH_FW = [0.55, 0.28, 0.35, 0.9, -0.1, 1.75, -0.7, 2.0, -1.25, 1.45, -1.35, 0.7, -1.0, 0.3];
  const MOTH_HW = [-0.4, 0.4, -0.7, 1.15, -1.3, 1.6, -1.8, 1.2, -1.75, 0.55, -1.2, 0.3];
  SPR.moth = function (ctx) {
    const base = F.seed < 0.5 ? '#8d7c66' : '#7b7466', dk = '#3d3228', lt = '#bfb29a';
    if (F.air) {
      const fl = 0.45 + 0.55 * abs(cos(F.t * (F.detail ? 2.4 : 17) + F.seed * 6));
      ctx.save(); ctx.scale(1, 1);
      for (let s = -1; s <= 1; s += 2) {
        ctx.save(); ctx.scale(1, fl * s);
        blob(ctx, '#b3a58c', MOTH_HW, false);
        blob(ctx, base, MOTH_FW, false);
        // pattern
        ctx.strokeStyle = dk; ctx.lineWidth = max(0.05, F.px); ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(0.1, 0.5); ctx.lineTo(-0.1, 0.9); ctx.lineTo(-0.35, 0.85); ctx.lineTo(-0.5, 1.4); ctx.lineTo(-0.8, 1.3); ctx.lineTo(-1.0, 1.7); ctx.stroke();
        fe(ctx, lt, -0.2, 0.95, 0.18, 0.13, 0.4); se(ctx, dk, 0.05, -0.2, 0.95, 0.18, 0.13, 0.4);
        fe(ctx, dk, -0.5, 1.08, 0.1, 0.16, 0.6);
        blobS(ctx, 'rgba(40,30,22,0.6)', 0.05, MOTH_FW, false);
        ctx.restore();
      }
      ctx.restore();
    } else { // resting: wings folded roof-like, bark camouflage
      poly(ctx, base, [0.6, 0.0, 0.5, 0.42, -0.6, 0.88, -2.0, 0.78, -2.15, 0, -2.0, -0.78, -0.6, -0.88, 0.5, -0.42]);
      ctx.strokeStyle = dk; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.lineTo(-2.1, 0);
      ctx.moveTo(-0.3, 0.75); ctx.lineTo(-0.5, 0.5); ctx.lineTo(-0.8, 0.7); ctx.lineTo(-1.05, 0.4); ctx.lineTo(-1.4, 0.65); ctx.lineTo(-1.7, 0.35);
      ctx.moveTo(-0.3, -0.75); ctx.lineTo(-0.5, -0.5); ctx.lineTo(-0.8, -0.7); ctx.lineTo(-1.05, -0.4); ctx.lineTo(-1.4, -0.65); ctx.lineTo(-1.7, -0.35); ctx.stroke();
      fe(ctx, lt, -0.2, 0.5, 0.16, 0.1, 0.3); fe(ctx, lt, -0.2, -0.5, 0.16, 0.1, -0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(-0.9, 0.2, 0.9, 0.12, 0, 0, TAU); ctx.fill();
    }
    shade(ctx, 0.5, 0, 0.62, 0.5, 0, '#a08f77', '#e8dcc6', '#4d3f30');
    shade(ctx, -0.4, 0, 0.85, 0.32, 0, '#8b7a64', '#d0c2a8', '#42362a');
    shade(ctx, 1.1, 0, 0.3, 0.3, 0, '#6e5f4c', '#c0b098', '#30271d');
    fe(ctx, '#15110d', 1.25, 0.2, 0.09, 0.09); fe(ctx, '#15110d', 1.25, -0.2, 0.09, 0.09);
    ctx.strokeStyle = '#5a4b3a'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); const sw = sin(F.t * 5 + F.seed * 4) * 0.15;
    antPath(ctx, 1.35, 0.12, 0.45, 1.5, -0.35, sw); antPath(ctx, 1.35, -0.12, -0.45, 1.5, 0.35, -sw); ctx.stroke();
  };

  // ---- field cricket ----------------------------------------------------------
  SPR.cricket = function (ctx) {
    const t = F.t, hop = F.hop;
    const dk = '#2a1e15', md = '#4a3320', lt = '#8a6a3c';
    // long antennae
    ctx.strokeStyle = '#4d3a26'; ctx.lineWidth = max(0.06, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    const sw = sin(t * 3 + F.seed * 6) * 0.4 + sin(F.ph) * 0.2 * F.mv;
    antPath(ctx, 1.65, 0.2, 0.55, 3.2, -0.5, sw); antPath(ctx, 1.65, -0.2, -0.55, 3.2, 0.5, -sw); ctx.stroke();
    // cerci + ovipositor
    ctx.beginPath(); ctx.moveTo(-1.6, 0.14); ctx.lineTo(-2.5, 0.35 + sin(t * 4) * 0.04); ctx.moveTo(-1.6, -0.14); ctx.lineTo(-2.5, -0.35 - sin(t * 4) * 0.04); ctx.stroke();
    if (F.seed > 0.5) { ctx.strokeStyle = '#6b5030'; ctx.lineWidth = max(0.09, F.px); ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.lineTo(-2.7, 0); ctx.stroke(); }
    // legs: front + mid walking, hind big jump legs
    const L = [[0.95, 0.3, 1.5, 1.2], [0.55, 0.32, 0.45, 1.5]];
    ctx.strokeStyle = dk; ctx.lineWidth = max(0.11, F.px); ctx.lineJoin = 'round'; ctx.beginPath();
    for (let i = 0; i < 2; i++) for (let s = -1; s <= 1; s += 2) {
      const th = F.ph + (((i + (s > 0 ? 1 : 0)) & 1) ? PI : 0);
      let fx = L[i][2] + sin(th) * 0.28 * F.mv, fy = L[i][3] * s * (1 - 0.1 * max(0, cos(th)) * F.mv);
      if (F.stuck > 0.01) { const q = t * 24 + i * 2 + s; fx += sin(q) * 0.45 * F.stuck; fy += cos(q) * 0.3 * F.stuck * s; }
      legPath(ctx, L[i][0], L[i][1] * s, fx, fy, 0.7, 0.85, i === 0 ? -s : s);
    }
    ctx.stroke();
    for (let s = -1; s <= 1; s += 2) { // hind legs: folded Z, or stretched back in a hop
      const e = clamp(hop, 0, 1) + (F.stuck > 0.01 ? 0.5 * sin(t * 22 + s) * F.stuck : 0);
      const hx = 0.0, hy = 0.5 * s, kx = lerp(-1.1, -1.7, e), ky = lerp(1.1, 0.5, e) * s, fx = lerp(0.2, -2.7, e), fy = lerp(1.5, 0.35, e) * s;
      ctx.strokeStyle = md; ctx.lineWidth = max(0.3, F.px * 2); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();   // femur
      ctx.strokeStyle = lt; ctx.lineWidth = max(0.12, F.px); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.strokeStyle = dk; ctx.lineWidth = max(0.1, F.px); ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();   // tibia
      ctx.strokeStyle = '#6a4a28'; ctx.lineWidth = max(0.04, F.px * 0.6); ctx.beginPath(); for (let k = 1; k < 5; k++) { const q = k / 5, x = lerp(kx, fx, q), y = lerp(ky, fy, q); ctx.moveTo(x, y); ctx.lineTo(x - 0.05, y + 0.18 * s); } ctx.stroke();
    }
    // body: wings over abdomen, pronotum, head
    shade(ctx, -0.55, 0, 1.15, 0.68, 0, md, '#a07a48', dk);
    ctx.strokeStyle = 'rgba(15,10,6,0.5)'; ctx.lineWidth = max(0.05, F.px * 0.8); ctx.beginPath(); ctx.moveTo(0.4, 0); ctx.lineTo(-1.6, 0);
    for (let i = 0; i < 5; i++) { const x = 0.1 - i * 0.35; ctx.moveTo(x, 0); ctx.lineTo(x - 0.2, 0.55); ctx.moveTo(x, 0); ctx.lineTo(x - 0.2, -0.55); } ctx.stroke();
    shade(ctx, 0.55, 0, 0.62, 0.64, 0, dk, '#7a5a38', '#0e0905');
    shade(ctx, 1.3, 0, 0.62, 0.56, 0, '#1f160e', '#725232', '#080503');
    fe(ctx, '#0a0705', 1.45, 0.38, 0.14, 0.14); fe(ctx, '#0a0705', 1.45, -0.38, 0.14, 0.14);
    gloss(ctx, 1.3, 0, 0.62, 0.56, 0.7); gloss(ctx, 0.55, 0, 0.62, 0.64, 0.5);
  };

  // ---- caterpillar -------------------------------------------------------------
  SPR.caterpillar = function (ctx) {
    const N = 11, t = F.t, g = '#79b24a', gh = '#c7ee8e', gd = '#3f6f24';
    const wave = F.ph * 0.8;
    // legs: 3 thoracic (dark) + prolegs
    ctx.lineCap = 'round';
    for (let i = N - 1; i >= 0; i--) {
      const x = 1.65 - i * 0.44, ph = wave - i * 0.55, yo = sin(ph) * 0.13 * F.mv + sin(t * 22 + i) * 0.1 * F.stuck;
      const rr = 0.74 + cos(ph) * 0.05 * F.mv;
      if (i >= 1 && i <= 3) { ctx.strokeStyle = '#2c3a1c'; ctx.lineWidth = max(0.08, F.px); ctx.beginPath(); ctx.moveTo(x, yo + 0.4); ctx.lineTo(x + 0.12, yo + 0.95); ctx.moveTo(x, yo - 0.4); ctx.lineTo(x + 0.12, yo - 0.95); ctx.stroke(); }
      else if (i >= 5 && i <= 8) { fe(ctx, '#5c8a38', x - 0.04, yo + 0.7 + max(0, sin(ph)) * 0.05, 0.2, 0.17); fe(ctx, '#5c8a38', x - 0.04, yo - 0.7 - max(0, sin(ph)) * 0.05, 0.2, 0.17); }
      else if (i === 10) { fe(ctx, '#5c8a38', x - 0.2, yo + 0.5, 0.2, 0.17); fe(ctx, '#5c8a38', x - 0.2, yo - 0.5, 0.2, 0.17); }
      shade(ctx, x, yo, 0.46, rr, 0, g, gh, gd);
      fe(ctx, '#f0d84a', x + 0.02, yo + rr * 0.62, 0.07, 0.07); fe(ctx, '#f0d84a', x + 0.02, yo - rr * 0.62, 0.07, 0.07);
    }
    // dorsal yellow stripe
    ctx.strokeStyle = 'rgba(245,225,70,0.8)'; ctx.lineWidth = max(0.12, F.px * 1.3); ctx.beginPath();
    for (let i = 0; i < N; i++) { const x = 1.65 - i * 0.44, yo = sin(wave - i * 0.55) * 0.13 * F.mv; if (i === 0) ctx.moveTo(x, yo); else ctx.lineTo(x, yo); } ctx.stroke();
    if (F.detail) { ctx.strokeStyle = 'rgba(220,255,170,0.5)'; ctx.lineWidth = 0.03; ctx.beginPath(); for (let i = 0; i < 40; i++) { const x = 1.5 - (i / 40) * 4.6, s = (i & 1) ? 1 : -1; ctx.moveTo(x, s * 0.7); ctx.lineTo(x + 0.04, s * 0.84); } ctx.stroke(); }
    // head capsule
    const hy = sin(wave + 0.5) * 0.04 * F.mv;
    shade(ctx, 2.15, hy, 0.5, 0.52, 0, '#5f9a3a', '#b8e47c', '#2d5418');
    fe(ctx, '#0b1206', 2.35, 0.26 + hy, 0.07, 0.07); fe(ctx, '#0b1206', 2.35, -0.26 + hy, 0.07, 0.07);
    ctx.strokeStyle = '#2a3d16'; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); ctx.moveTo(2.52, hy); ctx.lineTo(2.62, hy); ctx.stroke();
  };

  // ---- grasshopper ---------------------------------------------------------------
  SPR.grasshopper = function (ctx) {
    const t = F.t, hop = clamp(F.hop, 0, 1), col = '#7f9a3a', dk = '#364a14', lt = '#cdb26a';
    // hindwing (when airborne)
    if (F.air) {
      const fl = 0.5 + 0.5 * sin(t * 40);
      for (let s = -1; s <= 1; s += 2) { ctx.save(); ctx.scale(1, s); wing(ctx, -0.2, 0.4, 1.9 - 0.4 * fl, 2.8, 0.9 * (0.6 + 0.4 * fl), '#f0d6a0', '#a07a40', 0.55); ctx.restore(); }
    }
    // middle/front legs
    ctx.strokeStyle = '#4f6a1e'; ctx.lineWidth = max(0.1, F.px); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    const L = [[1.35, 0.3, 2.0, 1.0], [0.75, 0.35, 0.95, 1.35]];
    for (let i = 0; i < 2; i++) for (let s = -1; s <= 1; s += 2) {
      const th = F.ph + (((i + (s > 0 ? 1 : 0)) & 1) ? PI : 0);
      let fx = L[i][2] + sin(th) * 0.28 * F.mv, fy = L[i][3] * s;
      if (F.stuck > 0.01) { const q = t * 22 + i * 2 + s; fx += sin(q) * 0.5 * F.stuck; fy += cos(q) * 0.3 * F.stuck * s; }
      legPath(ctx, L[i][0], L[i][1] * s, fx, fy, 0.85, 1.0, i === 0 ? -s : s);
    }
    ctx.stroke();
    // big hind legs
    for (let s = -1; s <= 1; s += 2) {
      const e = hop + (F.stuck > 0.01 ? 0.45 * sin(t * 20 + s) * F.stuck : 0);
      const kx = lerp(-1.9, -2.4, e), ky = lerp(0.95, 0.4, e) * s, fx = lerp(-0.3, -3.8, e), fy = lerp(1.5, 0.3, e) * s;
      poly(ctx, '#6a8630', [0.0, 0.45 * s, -0.4, 0.75 * s, kx, ky + 0.12 * s, kx - 0.05, ky - 0.12 * s, -0.1, 0.35 * s]);
      ctx.strokeStyle = dk; ctx.lineWidth = max(0.04, F.px * 0.6); ctx.beginPath(); ctx.moveTo(0, 0.45 * s); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.strokeStyle = '#a69a4a'; ctx.lineWidth = max(0.1, F.px); ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.strokeStyle = dk; ctx.lineWidth = max(0.04, F.px * 0.6); ctx.beginPath(); for (let k = 1; k < 6; k++) { const q = k / 6, x = lerp(kx, fx, q), y = lerp(ky, fy, q); ctx.moveTo(x, y); ctx.lineTo(x - 0.04, y + 0.17 * s); } ctx.stroke();
    }
    // abdomen + folded wings
    shade(ctx, -1.0, 0, 1.55, 0.55, 0, col, '#c8de78', dk);
    shade(ctx, -0.75, 0, 1.75, 0.4, 0, '#8f8a4a', '#d9d08a', '#4a4620');
    ctx.fillStyle = 'rgba(40,30,10,0.4)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(-0.6 - i * 0.32, (i & 1 ? 1 : -1) * 0.18, 0.1, 0.07, 0, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = lt; ctx.lineWidth = max(0.08, F.px); ctx.globalAlpha *= 0.8; ctx.beginPath(); ctx.moveTo(1.0, 0.5); ctx.lineTo(-2.3, 0.48); ctx.stroke(); ctx.globalAlpha /= 0.8;
    shade(ctx, 0.75, 0, 0.8, 0.58, 0, '#6e8a2e', '#bdd870', '#2d3e0e');
    ctx.strokeStyle = 'rgba(30,45,10,0.55)'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(0.5, 0.5); ctx.quadraticCurveTo(0.9, 0, 0.5, -0.5); ctx.stroke();
    shade(ctx, 1.65, 0, 0.62, 0.55, 0, '#7a9638', '#c6dc7c', '#304210');
    shade(ctx, 1.7, 0.4, 0.3, 0.26, 0.3, '#2b2a14', '#8a8a3a', '#0a0a04');
    shade(ctx, 1.7, -0.4, 0.3, 0.26, -0.3, '#2b2a14', '#8a8a3a', '#0a0a04');
    gloss(ctx, 1.7, 0.4, 0.3, 0.26, 0.8); gloss(ctx, 1.7, -0.4, 0.3, 0.26, 0.8);
    ctx.strokeStyle = '#4f5a1e'; ctx.lineWidth = max(0.07, F.px); ctx.beginPath(); const sw = sin(t * 4 + F.seed * 5) * 0.12;
    antPath(ctx, 2.05, 0.15, 0.35, 1.2, -0.3, sw); antPath(ctx, 2.05, -0.15, -0.35, 1.2, 0.3, -sw); ctx.stroke();
  };

  // ---- seven-spot ladybird -----------------------------------------------------------
  const LB_LEGS = L3([0.7, 0.2, -0.35], [0.4, 0.5, 0.5], [1.05, 0.4, -0.95], [1.15, 1.35, 1.2], [0.55, 0.58, 0.6], [0.6, 0.62, 0.65]);
  const LB_SPOTS = [0.3, 0.52, 0.5, -0.05, 0.62, 0.5, -0.5, 0.3, 0.38];
  SPR.beetle = function (ctx) {
    const L = LB_LEGS;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.2, 1, '#14100e', '#3a3230', 0.1);
    const open = F.air ? 0.55 + 0.1 * sin(F.t * 40) : 0;
    if (F.air) { for (let s = -1; s <= 1; s += 2) { ctx.save(); ctx.scale(1, s); wing(ctx, 0.2, 0.3, 1.9, 2.2, 0.55, '#e6e0d0', '#8a7a60', 0.55); ctx.restore(); } }
    // elytra halves
    for (let s = -1; s <= 1; s += 2) {
      ctx.save(); ctx.translate(0.5, 0.0); ctx.rotate(open * s); ctx.translate(-0.5, 0);
      ctx.scale(1, s);
      ctx.beginPath(); ctx.moveTo(0.55, 0.02); ctx.bezierCurveTo(0.7, 0.55, 0.05, 0.98, -0.75, 0.82); ctx.bezierCurveTo(-1.2, 0.5, -1.15, 0.2, -1.1, 0.02); ctx.closePath();
      if (F.detail) { const g = ctx.createRadialGradient(0.1, 0.35 * F.ly * -s * 0 + 0.3, 0.05, -0.2, 0.3, 1.2); g.addColorStop(0, '#ff7b5c'); g.addColorStop(0.5, '#d9291b'); g.addColorStop(1, '#7a0c08'); ctx.fillStyle = g; } else ctx.fillStyle = '#d9291b';
      ctx.fill(); ctx.strokeStyle = '#5a0a06'; ctx.lineWidth = max(0.06, F.px); ctx.stroke();
      ctx.fillStyle = '#15100f';
      for (let i = 0; i < 9; i += 3) { ctx.beginPath(); ctx.ellipse(LB_SPOTS[i] - 0.15, LB_SPOTS[i + 1] * 0.82, LB_SPOTS[i + 2] * 0.3, LB_SPOTS[i + 2] * 0.28, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.beginPath(); ctx.ellipse(-0.1, 0.55, 0.35, 0.12, -0.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (!F.air) { ctx.strokeStyle = '#3d0805'; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); ctx.moveTo(0.52, 0); ctx.lineTo(-1.1, 0); ctx.stroke(); }
    fe(ctx, '#15100f', 0.48, 0, 0.17, 0.2);
    // pronotum + head
    shade(ctx, 0.95, 0, 0.48, 0.72, 0, '#1a1413', '#5a4c46', '#070504');
    fe(ctx, '#f2ede0', 1.05, 0.55, 0.2, 0.15, -0.9); fe(ctx, '#f2ede0', 1.05, -0.55, 0.2, 0.15, 0.9);
    shade(ctx, 1.42, 0, 0.3, 0.4, 0, '#1a1413', '#5a4c46', '#070504');
    fe(ctx, '#f2ede0', 1.6, 0.26, 0.09, 0.09); fe(ctx, '#f2ede0', 1.6, -0.26, 0.09, 0.09);
    ctx.strokeStyle = '#201a18'; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); ctx.moveTo(1.6, 0.1); ctx.lineTo(1.95, 0.3); ctx.moveTo(1.6, -0.1); ctx.lineTo(1.95, -0.3); ctx.stroke();
  };

  // ================================================================ SPRITES (predators, spiders)
  function symPts(h) { const o = []; for (let i = 0; i < h.length; i += 2) o.push(h[i], h[i + 1]); for (let i = h.length - 2; i >= 0; i -= 2) o.push(h[i], -h[i + 1]); return o; }

  // ---- stone centipede -------------------------------------------------------------
  SPR.centipede = function (ctx) {
    const N = 15, t = F.t, w = F.ph * 0.5, mv = F.mv, lift = F.tele;
    const col = '#8a3b22', colL = '#b3552c', legc = '#c9893a', legd = '#6a3a14';
    // legs first
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = 0.55 - i * 0.25, y = sin(w - i * 0.55) * 0.17 * mv + F.bend * i * i * 0.004 + sin(t * 25 + i) * 0.05 * F.stuck;
      const len = 0.75 + i * 0.035 + (i === N - 1 ? 0.9 : 0), sw = sin(w - i * 0.55 + 1.2) * 0.5 * mv + sin(t * 30 + i * 1.3) * 0.5 * F.stuck;
      for (let s = -1; s <= 1; s += 2) {
        ctx.moveTo(x, y + 0.28 * s);
        ctx.lineTo(x - 0.12 + sw * 0.3, y + (0.28 + len * 0.62) * s);
        ctx.lineTo(x - 0.45 + sw * 0.5 - (i === N - 1 ? 0.8 : 0), y + (0.28 + len) * s);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = legd; ctx.lineWidth = max(0.11, F.px * 1.2); ctx.stroke();
    ctx.strokeStyle = legc; ctx.lineWidth = max(0.06, F.px * 0.6); ctx.stroke();
    // body plates tail -> head
    for (let i = N - 1; i >= 0; i--) {
      const x = 0.55 - i * 0.25, y = sin(w - i * 0.55) * 0.17 * mv + F.bend * i * i * 0.004 + sin(t * 25 + i) * 0.05 * F.stuck;
      const wd = 0.52 - i * 0.012;
      shade(ctx, x, y, 0.2 + (i & 1 ? 0.04 : 0), wd, 0, i & 1 ? colL : col, '#e89a5c', '#4a1c0e');
    }
    // antennae (beaded)
    const hy = sin(w + 0.5) * 0.08 * mv;
    ctx.strokeStyle = '#9a5a2a'; ctx.lineWidth = max(0.07, F.px); ctx.setLineDash([0.13, 0.05]); ctx.beginPath();
    const sw = sin(t * 3.5 + F.seed * 5) * 0.3 + sin(w) * 0.2 * mv;
    antPath(ctx, 1.25, 0.2 + hy, 0.5, 2.3, -0.45, sw); antPath(ctx, 1.25, -0.2 + hy, -0.5, 2.3, 0.45, -sw); ctx.stroke(); ctx.setLineDash([]);
    // head shield + forcipules
    const fo = 0.2 + lift * 0.4 + F.open * 0.2;
    ctx.fillStyle = '#e8b050'; ctx.strokeStyle = '#7a4a10'; ctx.lineWidth = max(0.05, F.px);
    for (let s = -1; s <= 1; s += 2) { ctx.beginPath(); ctx.moveTo(1.4, 0.12 * s + hy); ctx.quadraticCurveTo(1.95, (0.22 + fo) * s + hy, 1.8, (0.02 + fo * 0.3) * s + hy); ctx.quadraticCurveTo(1.62, 0.2 * s + hy, 1.4, 0.04 * s + hy); ctx.fill(); }
    shade(ctx, 1.0, hy, 0.55, 0.5, 0, '#a2472a', '#f0a266', '#4a1a0c');
    fe(ctx, '#140a05', 1.25, 0.3 + hy, 0.07, 0.07); fe(ctx, '#140a05', 1.25, -0.3 + hy, 0.07, 0.07);
    gloss(ctx, 1.0, hy, 0.55, 0.5, 0.6);
  };

  // ---- yellowjacket wasp ----------------------------------------------------------------
  const WASP_BANDS = [-0.45, -0.95, -1.45, -1.95];
  SPR.wasp = function (ctx) {
    const t = F.t, fl = sin(t * 80 + F.seed * 8), tl = F.tele;
    const yel = '#f3c61c', blk = '#16110c';
    // dangling legs
    ctx.strokeStyle = '#24190d'; ctx.lineWidth = max(0.07, F.px); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      const k = sin(t * 5 + s) * 0.15 + tl * 0.35;
      ctx.moveTo(0.9, 0.2 * s); ctx.lineTo(1.5 + k, 0.7 * s); ctx.lineTo(1.9 + k, 0.55 * s);
      ctx.moveTo(0.55, 0.25 * s); ctx.lineTo(0.9, 0.95 * s + k * 0.3); ctx.lineTo(0.6, 1.4 * s);
      ctx.moveTo(0.25, 0.25 * s); ctx.lineTo(-0.3, 0.9 * s); ctx.lineTo(-0.9, 1.2 * s + k * 0.3);
    }
    ctx.stroke();
    // wings
    const wa = 0.3 + 0.2 * fl;
    wing(ctx, 0.4, 0.3, PI - 0.4 - wa + 0.2, 3.0, 0.5, '#d7d2c0', '#6b6350', 0.36); wing(ctx, 0.4, -0.3, -(PI - 0.4 - wa + 0.2), 3.0, 0.5, '#d7d2c0', '#6b6350', 0.36);
    wing(ctx, 0.4, 0.3, PI - 0.9 + 0.25 * fl, 2.5, 0.4, '#d7d2c0', null, 0.22); wing(ctx, 0.4, -0.3, -(PI - 0.9 + 0.25 * fl), 2.5, 0.4, '#d7d2c0', null, 0.22);
    // abdomen (curls forward when stinging)
    ctx.save(); ctx.translate(-0.2, 0); ctx.rotate(sin(t * 3) * 0.04 + tl * 0.0);
    const ab = [-0.1, 0.18, -0.4, 0.55, -1.0, 0.68, -1.7, 0.58, -2.3, 0.28, -2.55, 0.06];
    const abp = symPts(ab);
    blob(ctx, yel, abp);
    // bands
    ctx.save(); ctx.beginPath(); blobPath(ctx, abp); ctx.clip();
    ctx.fillStyle = blk;
    for (let i = 0; i < WASP_BANDS.length; i++) { const x = WASP_BANDS[i] - 0.2; ctx.beginPath(); ctx.ellipse(x, 0, 0.17, 0.8, 0, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(-2.6, 0, 0.35, 0.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(-1.0 + F.lx * 0.2, F.ly * 0.4, 0.9, 0.14, 0, 0, TAU); ctx.fill();
    ctx.restore();
    blobS(ctx, '#3a2c08', 0.06, abp);
    // stinger
    ctx.strokeStyle = tl > 0.1 ? '#c8c0b0' : '#4a3a20'; ctx.lineWidth = max(0.08, F.px); ctx.beginPath(); ctx.moveTo(-2.5, 0); ctx.lineTo(-2.5 - 0.35 - tl * 0.6, 0); ctx.stroke();
    ctx.restore();
    // waist, thorax, head
    fe(ctx, '#1a130c', -0.15, 0, 0.22, 0.14);
    shade(ctx, 0.5, 0, 0.72, 0.62, 0, '#17120d', '#6a5a40', '#050403');
    ctx.fillStyle = yel; ctx.beginPath(); ctx.ellipse(0.55, 0.38, 0.1, 0.24, 0.3, 0, TAU); ctx.ellipse(0.55, -0.38, 0.1, 0.24, -0.3, 0, TAU); ctx.fill();
    fe(ctx, yel, -0.05, 0.22, 0.1, 0.1); fe(ctx, yel, -0.05, -0.22, 0.1, 0.1);
    shade(ctx, 1.35, 0, 0.55, 0.56, 0, '#f0c21a', '#fff08a', '#8a6a08');
    ctx.fillStyle = blk; ctx.beginPath(); ctx.ellipse(1.5, 0.38, 0.26, 0.33, 0.2, 0, TAU); ctx.ellipse(1.5, -0.38, 0.26, 0.33, -0.2, 0, TAU); ctx.fill();
    gloss(ctx, 1.5, 0.38, 0.26, 0.33, 0.8); gloss(ctx, 1.5, -0.38, 0.26, 0.33, 0.8);
    ctx.fillStyle = '#2a1c08'; ctx.beginPath(); ctx.moveTo(1.82, 0.08); ctx.lineTo(2.05, 0.18); ctx.lineTo(1.9, -0.02); ctx.lineTo(2.05, -0.18); ctx.lineTo(1.82, -0.08); ctx.fill();
    ctx.strokeStyle = blk; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); const sw = sin(t * 7) * 0.1;
    antPath(ctx, 1.75, 0.16, 0.45, 1.5, -0.4, sw); antPath(ctx, 1.75, -0.16, -0.45, 1.5, 0.4, -sw); ctx.stroke();
  };

  // ---- song sparrow (top-down, wings spread) ---------------------------------------------
  const BIRD_WING = [0.5, 0.55, 0.55, 1.2, 0.3, 1.9, -0.05, 2.5, -0.55, 2.95, -1.0, 2.8, -1.2, 2.3, -1.3, 1.6, -1.2, 0.9, -0.9, 0.55];
  SPR.bird = function (ctx) {
    const t = F.t, fl = F.air ? (0.55 + 0.45 * cos(t * 13 + F.seed * 5)) : 0.38;
    const br = '#8a6a48', dk = '#3a2a1c', lt = '#c4a47a', wg = '#6d5238';
    // tail
    poly(ctx, '#5a4430', [-1.1, 0.35, -2.5, 0.65, -2.9, 0.2, -2.95, -0.2, -2.5, -0.65, -1.1, -0.35]);
    ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); for (let i = -2; i <= 2; i++) { ctx.moveTo(-1.1, i * 0.12); ctx.lineTo(-2.9, i * 0.26); } ctx.stroke();
    // wings
    for (let s = -1; s <= 1; s += 2) {
      ctx.save(); ctx.scale(1, fl * s);
      blob(ctx, wg, BIRD_WING, false);
      blob(ctx, br, [0.5, 0.55, 0.55, 1.2, 0.3, 1.6, -0.2, 1.7, -0.7, 1.5, -0.9, 0.7], false);
      ctx.strokeStyle = dk; ctx.lineWidth = max(0.05, F.px); ctx.lineCap = 'round'; ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = 0.15 + k * 0.1; ctx.moveTo(-0.35 - k * 0.1, 1.5 + k * 0.1); ctx.lineTo(-0.9 - k * 0.2, 2.9 - k * 0.12 + a * 0.2); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,28,16,0.5)'; ctx.beginPath(); ctx.moveTo(0.5, 0.6); ctx.lineTo(0.2, 1.9); ctx.lineTo(-0.2, 2.6); ctx.stroke();
      ctx.restore();
    }
    // talons forward when diving
    if (F.atk > 0.2) { ctx.strokeStyle = '#7a6040'; ctx.lineWidth = max(0.1, F.px); ctx.lineCap = 'round'; ctx.beginPath(); for (let s = -1; s <= 1; s += 2) { ctx.moveTo(1.2, 0.3 * s); ctx.lineTo(2.1, 0.45 * s); ctx.moveTo(2.1, 0.45 * s); ctx.lineTo(2.45, 0.7 * s); ctx.moveTo(2.1, 0.45 * s); ctx.lineTo(2.5, 0.4 * s); ctx.moveTo(2.1, 0.45 * s); ctx.lineTo(2.4, 0.15 * s); } ctx.stroke(); }
    shade(ctx, 0, 0, 1.3, 0.78, 0, br, '#d6b88a', '#3d2c1b');
    ctx.strokeStyle = dk; ctx.lineWidth = max(0.06, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i < 9; i++) { const x = 0.7 - i * 0.18, y = (i & 1) ? 0.3 : -0.3; ctx.moveTo(x, y * 0.4 + 0.0); ctx.lineTo(x - 0.1, y); ctx.moveTo(x, -y * 0.4); ctx.lineTo(x - 0.1, -y); }
    ctx.stroke();
    shade(ctx, 1.4, 0, 0.58, 0.52, 0, '#7e5f3f', '#d0b080', '#33241a');
    ctx.fillStyle = dk; ctx.beginPath(); ctx.ellipse(1.5, 0.3, 0.2, 0.09, -0.3, 0, TAU); ctx.ellipse(1.5, -0.3, 0.2, 0.09, 0.3, 0, TAU); ctx.fill();
    fe(ctx, '#0a0705', 1.52, 0.33, 0.09, 0.09); fe(ctx, '#0a0705', 1.52, -0.33, 0.09, 0.09);
    poly(ctx, '#b09a6a', [1.9, 0.17, 2.4, 0.03, 2.4, -0.03, 1.9, -0.17]);
    ln(ctx, '#4a3a22', 0.04, 1.9, 0, 2.4, 0);
  };

  // ---- Chinese mantis --------------------------------------------------------------------
  const MANTIS_WINGS = symPts([-0.4, 0.25, -1.0, 0.42, -2.0, 0.42, -3.0, 0.3, -3.4, 0.06]);
  const MANTIS_ABD = symPts([-0.4, 0.3, -1.2, 0.38, -2.3, 0.36, -3.1, 0.22, -3.35, 0.08]);
  SPR.mantis = function (ctx) {
    const t = F.t, tl = F.tele, atk = F.atk, sway = sin(t * 1.6 + F.seed * 6) * 0.04;
    const gr = '#7aa23c', gl = '#c8e07a', gd = '#34501a', pale = '#e0e8a0';
    ctx.rotate(sway);
    // walking legs (2 pairs, slender)
    const hx = [0.1, -0.7], hy = [0.2, 0.22], rx = [0.3, -1.6], ry = [1.7, 1.8], A = [0.9, 1.0], B = [1.2, 1.3];
    legsN(ctx, 2, hx, hy, rx, ry, A, B, 0.28, 0b01, '#4a6a22', '#9bc04c', 0.1);
    // abdomen + wings
    shade(ctx, -2.0, 0, 1.55, 0.4, 0, '#6e9632', gl, gd);
    blob(ctx, '#86ae44', MANTIS_WINGS);
    ctx.strokeStyle = pale; ctx.lineWidth = max(0.08, F.px); ctx.beginPath(); ctx.moveTo(-0.3, 0.3); ctx.lineTo(-3.2, 0.1); ctx.moveTo(-0.3, -0.3); ctx.lineTo(-3.2, -0.1); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,70,20,0.5)'; ctx.lineWidth = max(0.04, F.px * 0.7); ctx.beginPath(); ctx.moveTo(-0.4, 0); ctx.lineTo(-3.3, 0); for (let i = 1; i < 6; i++) { ctx.moveTo(-0.4 - i * 0.5, 0); ctx.lineTo(-0.7 - i * 0.5, 0.35); ctx.moveTo(-0.4 - i * 0.5, 0); ctx.lineTo(-0.7 - i * 0.5, -0.35); } ctx.stroke();
    // thorax (long prothorax)
    shade(ctx, 0.15, 0, 0.7, 0.34, 0, '#78a038', gl, gd);
    shade(ctx, 1.1, 0, 0.75, 0.22, 0, '#82aa40', gl, gd);
    // raptorial forelegs
    const ex = 1.0 + atk * 1.6 + tl * 0.5;
    for (let s = -1; s <= 1; s += 2) {
      const ey = (0.62 - atk * 0.3) * s;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = gd; ctx.lineWidth = max(0.28, F.px * 2); ctx.beginPath(); ctx.moveTo(1.3, 0.2 * s); ctx.lineTo(1.3 + 0.9 + atk * 1.3, ey + 0.2 * s * 0.0); ctx.stroke();    // femur
      ctx.strokeStyle = '#a7cc58'; ctx.lineWidth = max(0.15, F.px); ctx.beginPath(); ctx.moveTo(1.3, 0.2 * s); ctx.lineTo(1.3 + 0.9 + atk * 1.3, ey); ctx.stroke();
      ctx.strokeStyle = gd; ctx.lineWidth = max(0.12, F.px); ctx.beginPath(); ctx.moveTo(2.2 + atk * 1.3, ey); ctx.lineTo(ex + 0.7 - atk * 0.4, (0.15 + atk * 0.1 + (1 - tl) * 0.25) * s); ctx.stroke(); // tibia/claw
      ctx.strokeStyle = '#e8e0a0'; ctx.lineWidth = max(0.04, F.px * 0.6); ctx.beginPath(); for (let k = 0; k < 5; k++) { const q = k / 5; ctx.moveTo(lerp(1.4, 2.2, q) + atk * 1.3 * q, lerp(0.22, ey, q) * (s > 0 ? 1 : 1) + (s > 0 ? 0 : 0)); ctx.lineTo(lerp(1.4, 2.2, q) + atk * 1.3 * q + 0.05, lerp(0.22, ey, q) - 0.17 * s); } ctx.stroke();
    }
    // head
    const hp = [1.85, 0.12, 2.0, 0.42, 2.0, 0.55, 1.6, 0.6, 1.4, 0.35];
    blob(ctx, '#88b044', symPts(hp));
    shade(ctx, 1.85, 0.42, 0.26, 0.3, 0, '#2c3a14', '#a8c070', '#0a0f04'); shade(ctx, 1.85, -0.42, 0.26, 0.3, 0, '#2c3a14', '#a8c070', '#0a0f04');
    gloss(ctx, 1.85, 0.42, 0.26, 0.3, 0.8); gloss(ctx, 1.85, -0.42, 0.26, 0.3, 0.8);
    ctx.strokeStyle = '#4f7020'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); const sw = sin(t * 2.5 + F.seed * 5) * 0.2;
    antPath(ctx, 2.0, 0.12, 0.35, 1.7, -0.35, sw); antPath(ctx, 2.0, -0.12, -0.35, 1.7, 0.35, -sw); ctx.stroke();
  };

  // ---- devil's coach horse (rove beetle) ---------------------------------------------------
  const ROVE_LEGS = L3([0.8, 0.45, 0.0], [0.28, 0.3, 0.32], [1.4, 0.8, -0.35], [1.0, 1.35, 1.2], [0.6, 0.62, 0.68], [0.75, 0.8, 0.85]);
  SPR.rove = function (ctx) {
    const L = ROVE_LEGS, tl = F.tele, t = F.t;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.26, 1, '#0c0907', '#3a3028', 0.1);
    // abdomen segments (curls up toward the viewer when threatened: foreshortens)
    const ab = 1 - tl * 0.45;
    for (let i = 6; i >= 0; i--) {
      const x = (-0.15 - i * 0.3) * ab, r = (0.5 - i * 0.04) * (1 + tl * 0.15);
      shade(ctx, x, sin(t * 4 + i) * 0.02 * F.mv, 0.34, r, 0, '#17120e', '#5a4e44', '#050403');
    }
    if (tl > 0.1) fe(ctx, '#7a6a58', (-2.0) * ab - 0.1, 0, 0.2, 0.3);
    // short elytra
    shade(ctx, 0.28, 0.0, 0.55, 0.7, 0, '#1d1814', '#6a5c50', '#070504');
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(0.8, 0); ctx.lineTo(-0.25, 0); ctx.stroke();
    shade(ctx, 0.92, 0, 0.5, 0.58, 0, '#1b1612', '#625548', '#060403');
    shade(ctx, 1.5, 0, 0.55, 0.62, 0, '#201a15', '#6a5c4e', '#070504');
    gloss(ctx, 1.5, 0, 0.55, 0.62, 0.6);
    fe(ctx, '#050403', 1.75, 0.4, 0.08, 0.08); fe(ctx, '#050403', 1.75, -0.4, 0.08, 0.08);
    const op = 0.3 + tl * 0.5 + F.open * 0.3;
    ctx.fillStyle = '#0c0907'; ctx.strokeStyle = '#4a3c30'; ctx.lineWidth = max(0.04, F.px * 0.7);
    for (let s = -1; s <= 1; s += 2) { ctx.beginPath(); ctx.moveTo(1.9, 0.22 * s); ctx.quadraticCurveTo(2.5, (0.3 + op) * s, 2.3, (0.05 + op * 0.15) * s); ctx.quadraticCurveTo(2.15, 0.2 * s, 1.9, 0.05 * s); ctx.fill(); ctx.stroke(); }
    ctx.strokeStyle = '#2a221c'; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); const sw = sin(t * 5 + F.seed * 4) * 0.12;
    antPath(ctx, 1.8, 0.2, 0.45, 1.5, -0.3, sw); antPath(ctx, 1.8, -0.2, -0.45, 1.5, 0.3, -sw); ctx.stroke();
  };

  // ---- ground beetle -----------------------------------------------------------------------
  const GB_LEGS = L3([0.95, 0.45, -0.1], [0.4, 0.5, 0.5], [1.55, 0.7, -0.9], [1.3, 1.7, 1.5], [0.8, 0.9, 0.95], [1.0, 1.1, 1.15]);
  SPR.ground = function (ctx) {
    const L = GB_LEGS, t = F.t;
    legsN(ctx, 3, L.hx, L.hy, L.rx, L.ry, L.A, L.B, 0.3, 1, '#1a100c', '#5a3a2a', 0.11);
    // elytra with grooves
    shade(ctx, -0.45, 0, 1.3, 0.9, 0, '#1b2230', '#6d8cb0', '#06080c');
    ctx.strokeStyle = 'rgba(100,140,190,0.4)'; ctx.lineWidth = max(0.04, F.px * 0.7); ctx.beginPath();
    for (let i = -3; i <= 3; i++) { const y = i * 0.22; ctx.moveTo(0.7, y * 0.7); ctx.lineTo(-0.5, y); ctx.lineTo(-1.5, y * 0.55); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(0.7, 0); ctx.lineTo(-1.6, 0); ctx.stroke();
    gloss(ctx, -0.4, 0, 1.3, 0.9, 0.9);
    shade(ctx, 0.95, 0, 0.55, 0.66, 0, '#1d2634', '#7090b4', '#06080c');
    shade(ctx, 1.55, 0, 0.45, 0.5, 0, '#1a2230', '#6a88aa', '#05070a');
    fe(ctx, '#050608', 1.7, 0.36, 0.08, 0.08); fe(ctx, '#050608', 1.7, -0.36, 0.08, 0.08);
    const op = 0.2 + F.tele * 0.5 + F.open * 0.3;
    ctx.fillStyle = '#1a100c';
    for (let s = -1; s <= 1; s += 2) { ctx.beginPath(); ctx.moveTo(1.85, 0.2 * s); ctx.quadraticCurveTo(2.35, (0.28 + op) * s, 2.2, (0.04 + op * 0.2) * s); ctx.quadraticCurveTo(2.05, 0.15 * s, 1.85, 0.04 * s); ctx.fill(); }
    ctx.strokeStyle = '#3a2418'; ctx.lineWidth = max(0.06, F.px); ctx.setLineDash([0.16, 0.04]); ctx.beginPath(); const sw = sin(t * 5 + F.seed * 4) * 0.14;
    antPath(ctx, 1.85, 0.2, 0.4, 1.9, -0.3, sw); antPath(ctx, 1.85, -0.2, -0.4, 1.9, 0.3, -sw); ctx.stroke(); ctx.setLineDash([]);
  };

  // ---- spiders ---------------------------------------------------------------------------------
  const SP_HX = [0.95, 0.72, 0.5, 0.28], SP_HY = [0.3, 0.36, 0.36, 0.3];
  // Four jointed leg pairs: each foot rests on a fixed splay angle and every knee bows outward (the more sideways of the two
  // possible knees), so the legs fan out from the cephalothorax like the player's spider instead of hooking in toward the head.
  // The splay is wide enough that neighbouring femurs diverge (~25 deg apart) and the two middle pairs swing a little less,
  // so they never fold into one another mid-stride. `reach` scales the leg length (body radii); `xo[k]` nudges pair k's feet fore/aft.
  const SPL_ANG = [20, 42, 138, 160].map(d => d * PI / 180), SPL_REACH = [2.5, 2.3, 2.3, 2.7], SPL_STRIDE = [0.85, 0.6, 0.6, 0.85];
  const SPL_REST = 0.86, SPL_BEND = 1.02;   // resting foot distance / bone length vs. reach
  const SPL_W = [[1.55, 1.1], [1.15, 0.8], [0.72, 0.45]];   // femur / tibia / tip stroke width (dark, light) in units of lw
  const SLH = new Float64Array(16), SLK = new Float64Array(16), SLM = new Float64Array(16), SLF = new Float64Array(16), SLB = new Float64Array(4);   // per leg: hip, knee, mid-tibia, foot (x,y); per pair: bone length
  function spiderLegs(ctx, reach, xo, stride, dark, light, lw) {
    const mv = F.mv, st = F.stuck, dd = F.dead;
    for (let k = 0; k < 4; k++) {
      const ca = cos(SPL_ANG[k]), sa = sin(SPL_ANG[k]), len = SPL_REACH[k] * reach, bone = len * 0.5 * SPL_BEND, sw = stride * SPL_STRIDE[k];
      SLB[k] = bone;
      for (let s = -1; s <= 1; s += 2) {
        const i = (k * 2 + (s > 0 ? 1 : 0)) * 2, hx = SP_HX[k], hy = SP_HY[k] * s;
        const th = F.ph + (((k + (s > 0 ? 1 : 0)) & 1) ? PI : 0), lift = mv > 0.01 ? max(0, cos(th)) * mv : 0;
        let fx = hx + ca * len * SPL_REST + xo[k], fy = hy + sa * len * SPL_REST * s;
        if (st > 0.01) { const q = F.t * 24 + k * 1.9 + s * 1.3; fx += sin(q) * (sw * 0.8 + 0.25) * st; fy += cos(q * 0.9) * 0.35 * st * s; }
        if (mv > 0.01) { fx += sin(th) * sw * mv; fy = hy + (fy - hy) * (1 - 0.1 * lift); }
        if (dd > 0) { fy *= 1 - 0.5 * dd; fx *= 1 - 0.3 * dd; }
        let dx = fx - hx, dy = fy - hy, d = hypot(dx, dy) || 0.001;
        const dmax = bone * 2 * 0.985 * (1 - 0.07 * lift), dmin = len * (0.55 - 0.3 * dd);   // never over-reach, and never fold into a needle
        if (d > dmax || d < dmin) { const q = (d > dmax ? dmax : dmin) / d; fx = hx + dx * q; fy = hy + dy * q; dx *= q; dy *= q; d *= q; }
        const bx = hx + dx * 0.5, by = hy + dy * 0.5, h = sqrt(max(0, bone * bone - d * d * 0.25)), ux = dx / d, uy = dy / d;
        const k1x = bx - uy * h, k1y = by + ux * h, k2x = bx + uy * h, k2y = by - ux * h;
        // the outermost knee wins; judged by sideways reach alone (not the current foot line) so a knee never flips sides mid-stride
        const first = k1y * s >= k2y * s;
        let kx = first ? k1x : k2x, ky = first ? k1y : k2y;
        if (lift > 0) { const ex = kx - bx, ey = ky - by, el = hypot(ex, ey) || 1; kx += ex / el * lift * 0.22; ky += ey / el * lift * 0.22; }
        SLH[i] = hx; SLH[i + 1] = hy; SLK[i] = kx; SLK[i + 1] = ky; SLF[i] = fx; SLF[i + 1] = fy;
        SLM[i] = kx + (fx - kx) * 0.68; SLM[i + 1] = ky + (fy - ky) * 0.68;
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      if (pass && !light) break;
      ctx.strokeStyle = pass ? light : dark;
      for (let sg = 0; sg < 3; sg++) {
        ctx.beginPath();
        for (let i = 0; i < 16; i += 2) {
          if (sg === 0) { ctx.moveTo(SLH[i], SLH[i + 1]); ctx.lineTo(SLK[i], SLK[i + 1]); }
          else if (sg === 1) { ctx.moveTo(SLK[i], SLK[i + 1]); ctx.lineTo(SLM[i], SLM[i + 1]); }
          else { ctx.moveTo(SLM[i], SLM[i + 1]); ctx.lineTo(SLF[i], SLF[i + 1]); }
        }
        ctx.lineWidth = max(lw * SPL_W[sg][light ? pass : 0] * (light ? 1 : 0.8), F.px * (pass ? 0.5 : 1.1));
        ctx.stroke();
      }
    }
  }
  function spiderEyes(ctx, x0, big) {
    const e = (x, y, r) => { fe(ctx, '#07090b', x, y, r, r); ctx.globalAlpha *= 0.8; fe(ctx, '#9ab', x - r * 0.3, y - r * 0.35, r * 0.28, r * 0.28); ctx.globalAlpha /= 0.8; };
    e(x0 + 0.5, 0.09, 0.075); e(x0 + 0.5, -0.09, 0.075); e(x0 + 0.46, 0.27, 0.07); e(x0 + 0.46, -0.27, 0.07);
    e(x0 + 0.2, 0.19, big); e(x0 + 0.2, -0.19, big); e(x0 - 0.02, 0.42, 0.11); e(x0 - 0.02, -0.42, 0.11);
  }
  const WOLF_XO = [0, 0, 0, 0];
  SPR.wolf = function (ctx) {
    WOLF_XO[0] = F.tele * 0.5;   // front legs reach out as she winds up
    spiderLegs(ctx, 1.05, WOLF_XO, 0.45, '#2b1f15', '#8a6a46', 0.15);
    // palps + chelicerae
    ctx.strokeStyle = '#4a3828'; ctx.lineWidth = max(0.12, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(1.4, 0.2); ctx.lineTo(1.95, 0.36 + sin(F.t * 6) * 0.03); ctx.moveTo(1.4, -0.2); ctx.lineTo(1.95, -0.36 - sin(F.t * 6) * 0.03); ctx.stroke();
    // opisthosoma
    shade(ctx, -0.95, 0, 1.15, 0.84, 0, '#5b4632', '#a98a62', '#2a1e12');
    ctx.fillStyle = 'rgba(214,190,140,0.65)'; ctx.beginPath(); ctx.moveTo(-0.1, 0); ctx.quadraticCurveTo(-0.6, 0.3, -1.3, 0.12); ctx.lineTo(-1.8, 0); ctx.lineTo(-1.3, -0.12); ctx.quadraticCurveTo(-0.6, -0.3, -0.1, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,10,0.65)'; ctx.lineWidth = max(0.06, F.px); ctx.beginPath(); for (let i = 0; i < 4; i++) { const x = -0.7 - i * 0.28; ctx.moveTo(x, 0.04); ctx.lineTo(x - 0.22, 0.4 - i * 0.04); ctx.moveTo(x, -0.04); ctx.lineTo(x - 0.22, -0.4 + i * 0.04); } ctx.stroke();
    if (F.seed > 0.66) { // spiderlings riding on her back
      ctx.fillStyle = 'rgba(214,170,100,0.95)'; ctx.strokeStyle = 'rgba(60,40,20,0.7)'; ctx.lineWidth = 0.03;
      for (let i = 0; i < 16; i++) { const a = hashf(i, 2) * TAU, r = sqrt(hashf(i, 5)) * 0.62; ctx.beginPath(); ctx.arc(-0.95 + cos(a) * r * 1.0, sin(a) * r * 0.75, 0.1, 0, TAU); ctx.fill(); ctx.stroke(); }
    } else if (F.seed > 0.4) { // egg sac on the spinnerets
      shade(ctx, -2.3, 0, 0.5, 0.48, 0, '#d8d4c4', '#ffffff', '#8a8672');
    }
    if (F.detail) { ctx.strokeStyle = 'rgba(210,180,130,0.5)'; ctx.lineWidth = 0.03; ctx.beginPath(); for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU, x = -0.95 + cos(a) * 1.15, y = sin(a) * 0.84; ctx.moveTo(x, y); ctx.lineTo(x + cos(a) * 0.08, y + sin(a) * 0.08); } ctx.stroke(); }
    // prosoma with pale median band
    shade(ctx, 0.62, 0, 0.88, 0.66, 0, '#4a3624', '#9a7a52', '#1f150b');
    ctx.fillStyle = 'rgba(214,190,140,0.75)'; ctx.beginPath(); ctx.ellipse(0.6, 0, 0.6, 0.12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(214,190,140,0.4)'; ctx.beginPath(); ctx.ellipse(0.55, 0.45, 0.45, 0.07, 0.15, 0, TAU); ctx.ellipse(0.55, -0.45, 0.45, 0.07, -0.15, 0, TAU); ctx.fill();
    // chelicerae
    fe(ctx, '#3a2a1c', 1.5, 0.15, 0.22, 0.14); fe(ctx, '#3a2a1c', 1.5, -0.15, 0.22, 0.14);
    spiderEyes(ctx, 1.0, 0.16);
  };

  const JUMP_PRO = symPts([1.6, 0.22, 1.55, 0.6, 1.2, 0.85, 0.55, 0.92, -0.1, 0.78, -0.35, 0.4]);
  const JMP_XO = [0, 0, 0, 0];
  SPR.jumper = function (ctx) {
    const hop = clamp(F.hop, 0, 1), tl = F.tele;
    JMP_XO[0] = hop * 0.9; JMP_XO[3] = -hop * 1.0;   // front legs throw forward, rear legs push off
    spiderLegs(ctx, 0.72 * (1 - tl * 0.18), JMP_XO, 0.32, '#14100d', '#7a6a50', 0.15);
    ctx.strokeStyle = '#2a2018'; ctx.lineWidth = max(0.12, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(1.5, 0.35); ctx.lineTo(1.9, 0.5); ctx.moveTo(1.5, -0.35); ctx.lineTo(1.9, -0.5); ctx.stroke();
    fe(ctx, '#f3efe6', 1.95, 0.52, 0.1, 0.1); fe(ctx, '#f3efe6', 1.95, -0.52, 0.1, 0.1);
    shade(ctx, -0.7, 0, 0.95, 0.74, 0, '#17120f', '#6a5a4a', '#050403');
    fe(ctx, '#f4f0e6', -0.5, 0, 0.26, 0.2); fe(ctx, '#f4f0e6', -1.05, 0.3, 0.12, 0.11); fe(ctx, '#f4f0e6', -1.05, -0.3, 0.12, 0.11);
    ctx.strokeStyle = 'rgba(240,235,220,0.55)'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(-0.1, 0.5); ctx.quadraticCurveTo(-0.7, 0.6, -1.4, 0.2); ctx.moveTo(-0.1, -0.5); ctx.quadraticCurveTo(-0.7, -0.6, -1.4, -0.2); ctx.stroke();
    blob(ctx, '#1a1512', JUMP_PRO);
    blobS(ctx, '#000', 0.05, JUMP_PRO);
    ctx.fillStyle = 'rgba(235,225,205,0.55)'; ctx.beginPath(); ctx.ellipse(0.0, 0.62, 0.35, 0.12, 0.3, 0, TAU); ctx.ellipse(0.0, -0.62, 0.35, 0.12, -0.3, 0, TAU); ctx.fill();
    // chelicerae (iridescent)
    for (let s = -1; s <= 1; s += 2) { shade(ctx, 1.78, 0.2 * s, 0.3, 0.16, 0, '#2fbf9a', '#a8ffe8', '#0a4a46'); }
    // eyes: two huge front eyes
    const eye = (x, y, r) => { fe(ctx, '#06090a', x, y, r, r); fe(ctx, '#2a4a40', x - r * 0.25, y - r * 0.2, r * 0.55, r * 0.55); fe(ctx, '#ffffff', x - r * 0.35, y - r * 0.4, r * 0.24, r * 0.24); };
    eye(1.42, 0.3, 0.3); eye(1.42, -0.3, 0.3); eye(1.2, 0.74, 0.18); eye(1.2, -0.74, 0.18); eye(0.72, 0.68, 0.1); eye(0.72, -0.68, 0.1);
    fe(ctx, '#06090a', 0.95, 0.5, 0.05, 0.05); fe(ctx, '#06090a', 0.95, -0.5, 0.05, 0.05);
  };

  // orb-weaver style spider (kin spiderling / adult male)
  const OW_XO = [0, 0, 0, 0];
  function orbWeaver(ctx, male, cA, cB, cL, cD) {
    spiderLegs(ctx, male ? 1 : 0.95, OW_XO, 0.4, cD, cL, male ? 0.11 : 0.13);
    // palps
    ctx.strokeStyle = cL; ctx.lineWidth = max(0.12, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(1.35, 0.2); ctx.lineTo(1.95, 0.3 + sin(F.t * 5) * 0.04); ctx.moveTo(1.35, -0.2); ctx.lineTo(1.95, -0.3 - sin(F.t * 5) * 0.04); ctx.stroke();
    if (male) { shade(ctx, 2.0, 0.3, 0.2, 0.17, 0, '#f1e1b0', '#fffbe8', '#8a6a34'); shade(ctx, 2.0, -0.3, 0.2, 0.17, 0, '#f1e1b0', '#fffbe8', '#8a6a34'); }
    // abdomen
    shade(ctx, -0.85, 0, 1.05, 0.8, 0, cA, '#ffe7b0', cD);
    ctx.fillStyle = 'rgba(255,245,215,0.85)';
    const cx = [-0.55, -0.85, -1.15, -0.85, -0.85, -1.25], cy = [0, 0, 0, 0.3, -0.3, 0.1];
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(cx[i], cy[i], 0.11, 0.09, 0, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = 'rgba(70,40,15,0.55)'; ctx.lineWidth = max(0.05, F.px); ctx.beginPath(); ctx.moveTo(-0.2, 0.4); ctx.quadraticCurveTo(-0.7, 0.62, -1.3, 0.3); ctx.moveTo(-0.2, -0.4); ctx.quadraticCurveTo(-0.7, -0.62, -1.3, -0.3); ctx.stroke();
    // cephalothorax
    shade(ctx, 0.6, 0, 0.85, 0.62, 0, cB, '#e8b074', cD);
    ctx.fillStyle = 'rgba(60,30,10,0.4)'; ctx.beginPath(); ctx.ellipse(0.55, 0, 0.3, 0.14, 0, 0, TAU); ctx.fill();
    fe(ctx, cD, 1.4, 0.12, 0.2, 0.12); fe(ctx, cD, 1.4, -0.12, 0.2, 0.12);
    spiderEyes(ctx, 0.95, 0.1);
  }
  SPR.kin = function (ctx) { orbWeaver(ctx, false, '#d79a45', '#b87a35', '#e8b45a', '#5a3a1a'); };
  SPR.mate = function (ctx) { orbWeaver(ctx, true, '#a8703a', '#8a4a22', '#d8a860', '#3a2008'); };

  // Widow Matriarch: glossy black, globular abdomen, red spot above the spinnerets. When she rears up to strike (F.tele) her front legs lift
  // and she shows the red hourglass on her underside, the warning every move of hers starts with.
  const WID_XO = [0, 0, 0, 0];
  SPR.widow = function (ctx) {
    const tl = F.tele, show = clamp(max(tl * 1.5, F.dead * 0.8), 0, 1);
    WID_XO[0] = tl * 0.7; WID_XO[1] = tl * 0.3; WID_XO[3] = -tl * 0.25;
    spiderLegs(ctx, 1.12 + tl * 0.05, WID_XO, 0.4, '#0a0608', '#3b2d36', 0.14);
    // palps + fangs
    ctx.strokeStyle = '#1c141a'; ctx.lineWidth = max(0.12, F.px); ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(1.4, 0.2); ctx.lineTo(1.95 + F.open * 0.15, 0.32 + sin(F.t * 5) * 0.03); ctx.moveTo(1.4, -0.2); ctx.lineTo(1.95 + F.open * 0.15, -0.32 - sin(F.t * 5) * 0.03); ctx.stroke();
    // globular abdomen
    shade(ctx, -1.2, 0, 1.2, 1.12, 0, '#15111b', '#5d596c', '#030204');
    fe(ctx, '#d4141c', -2.1, 0, 0.2, 0.15);
    fe(ctx, 'rgba(255,120,96,0.45)', -2.14, -0.04, 0.09, 0.05);
    if (show > 0.02) {   // the hourglass: two triangles meeting at the waist
      ctx.globalAlpha *= show; ctx.fillStyle = '#e5171f';
      ctx.beginPath(); ctx.moveTo(-0.55, -0.4); ctx.lineTo(-0.55, 0.4); ctx.lineTo(-1.2, 0.05); ctx.lineTo(-1.85, 0.4); ctx.lineTo(-1.85, -0.4); ctx.lineTo(-1.2, -0.05); ctx.closePath(); ctx.fill();
      ctx.globalAlpha /= show;
    }
    gloss(ctx, -1.2, 0, 1.2, 1.12, 0.8);
    if (F.detail) { ctx.strokeStyle = 'rgba(120,112,140,0.35)'; ctx.lineWidth = 0.03; ctx.beginPath(); for (let i = 0; i < 30; i++) { const a = (i / 30) * TAU, x = -1.2 + cos(a) * 1.2, y = sin(a) * 1.12; ctx.moveTo(x, y); ctx.lineTo(x + cos(a) * 0.07, y + sin(a) * 0.07); } ctx.stroke(); }
    // cephalothorax
    shade(ctx, 0.62, 0, 0.86, 0.66, 0, '#1b1621', '#68627a', '#050408');
    gloss(ctx, 0.62, 0, 0.86, 0.66, 0.6);
    fe(ctx, '#251c29', 1.5, 0.15, 0.22, 0.14); fe(ctx, '#251c29', 1.5, -0.15, 0.22, 0.14);
    ctx.strokeStyle = '#7a1f1c'; ctx.lineWidth = max(0.07, F.px); ctx.beginPath(); ctx.moveTo(1.66, 0.14); ctx.lineTo(1.9 + F.open * 0.2, 0.2 + F.open * 0.1); ctx.moveTo(1.66, -0.14); ctx.lineTo(1.9 + F.open * 0.2, -0.2 - F.open * 0.1); ctx.stroke();
    spiderEyes(ctx, 1.0, 0.1);
  };

  // ================================================================== DRAWING
  // measured sprite extents (radial extent `ext` and x-centre `cx`, unit space) used to fit icons
  const ICON = {"springtail":[0.55,2.52],"mite":[0.24,1.68],"aphid":[0.66,2.26],"midge":[0.15,2.45],"fruitfly":[-0.11,2.65],"ant":[0.47,2.55],"pillbug":[0.35,2.28],"moth":[0.44,2.44],"cricket":[0.94,4.02],"caterpillar":[-0.28,2.99],"grasshopper":[0.32,2.99],"beetle":[0.4,1.99],"centipede":[-0.4,4.67],"wasp":[0.01,3.27],"bird":[-0.27,3.03],"mantis":[0.06,3.71],"rove":[0.44,2.92],"ground":[0.95,2.9],"wolf":[0.55,3.04],"jumper":[0.48,2.35],"kin":[0.58,2.77],"mate":[0.62,2.87],"widow":[0.55,3.3]};
  KIND_LIST.forEach(k => { const m = ICON[k.id]; k.cx = m ? m[0] : 0; k.ext = m ? m[1] : 2; if (k.bodyR == null) k.bodyR = 1.6; });
  const LIGHT_X = -0.55, LIGHT_Y = -0.83;

  function setLight(ang) {
    const c = cos(ang), s = sin(ang);
    F.lx = LIGHT_X * c + LIGHT_Y * s; F.ly = -LIGHT_X * s + LIGHT_Y * c;
  }
  function silkWrap(ctx, seed, strength) {
    ctx.strokeStyle = 'rgba(250,252,255,' + (0.55 * strength) + ')'; ctx.lineWidth = max(0.05, F.px * 0.9); ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = hashf(seed * 10, i) * PI, a2 = a + PI * (0.7 + hashf(i, seed * 3) * 0.5), r = 0.9 + hashf(i, 9) * 0.5;
      ctx.moveTo(cos(a) * r, sin(a) * r * 0.8); ctx.lineTo(cos(a2) * r, sin(a2) * r * 0.8);
    }
    ctx.stroke();
  }
  function drawBang(ctx, x, y, size, col, a) { // "!" alert mark centered at x,y (screen-aligned)
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20,10,5,0.55)'; ctx.beginPath(); ctx.arc(0, 0, size * 0.78, 0, TAU); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(-size * 0.2, -size * 0.55); ctx.lineTo(size * 0.2, -size * 0.55); ctx.lineTo(size * 0.12, size * 0.12); ctx.lineTo(-size * 0.12, size * 0.12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, size * 0.4, size * 0.15, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Shared sprite renderer. Draws kind k at (x,y), heading ang, with unit-scale sc.
  function renderSprite(ctx, k, x, y, ang, sc) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(sc, sc);
    setLight(ang);
    const fn = SPR[k.id];
    if (fn) fn(ctx);
    ctx.restore();
  }

  function drawCreature(ctx, c, T, zoom, sci) {
    const k = c.k, r = c.radius;
    let alpha = c.alpha; if (c.hideA > 0) alpha *= 1 - 0.62 * c.hideA;
    if (alpha < 0.02) return;
    const fl = c.flying;
    const lift = fl ? c.alt : 0;
    // ---------------- shadow
    ctx.save();
    ctx.translate(c.x + r * 0.16 + lift * 0.55, c.y + r * 0.26 + lift * 0.8);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.2 * alpha * (fl ? 0.8 : 1)) + ')';
    ctx.beginPath(); ctx.ellipse(0, 0, k.shadow[0] * r * (c.state === 'curl' ? 0.6 : 1), k.shadow[1] * r * (c.state === 'curl' ? 0.8 : 1), 0, 0, TAU); ctx.fill();
    ctx.restore();
    // ---------------- sprite
    let jx = 0, jy = 0, ang = c.angle;
    if (c.state === 'stuck') { const s = c.struggle * (0.5 + 0.5 * sin(T * 30 + c.seed * 9)); jx = sin(T * 41 + c.seed * 5) * r * 0.1 * s; jy = cos(T * 37) * r * 0.1 * s; ang += sin(T * 23 + c.seed * 3) * 0.28 * s; }
    if (c.windT > 0 && c.state === 'windup') { jx += (rnd() - 0.5) * r * 0.05; jy += (rnd() - 0.5) * r * 0.05; }
    F.t = T + c.seed * 10; F.ph = c.ph; F.mv = c.mv; F.seed = c.seed; F.tele = c.tele; F.stuck = c.state === 'stuck' ? max(0.35, c.struggle) : 0;
    F.dead = 0; F.hop = c.hop; F.air = fl; F.curl = c.state === 'curl' ? 1 : 0; F.atk = c.atk; F.open = c.open; F.bend = c.bend;
    F.detail = false; F.sil = false; F.px = 1 / (r * zoom);
    ctx.globalAlpha = alpha;
    if (c.state === 'idle' && c.k.id !== 'pillbug') { F.mv = 0; }
    renderSprite(ctx, k, c.x + jx, c.y + jy - lift, ang, r);
    // ---------------- overlays
    if (c.state === 'stuck') {
      ctx.save(); ctx.translate(c.x, c.y - lift); ctx.rotate(c.angle); ctx.scale(r, r); F.px = 1 / (r * zoom); ctx.globalAlpha = alpha; silkWrap(ctx, c.seed, 1); ctx.restore();
    }
    if (c.flash > 0) {
      ctx.globalAlpha = alpha * min(1, c.flash * 4) * 0.55; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, r * k.bodyR * 0.8, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (c.tele > 0.05 && k.role === 'predator') {
      ctx.strokeStyle = 'rgba(255,60,40,' + (0.55 * c.tele) + ')'; ctx.lineWidth = 1.6 / zoom;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, r * (1.5 + (1 - c.tele) * 0.9), 0, TAU); ctx.stroke();
    }
    if (c.alertT > 0) {
      const sz = max(r * 0.9, 9 / zoom), pop = min(1, (0.9 - c.alertT + 0.25) * 6), bob = sin(T * 12) * sz * 0.1;
      drawBang(ctx, c.x, c.y - lift - r * k.bodyR * 0.9 - sz * 1.1 + bob, sz * clamp(pop, 0.2, 1), c.alertCol || '#ffcf3a', min(1, c.alertT * 3));
    }
    if (c.venomT > 0) {   // poisoned: a faint violet pulse
      ctx.fillStyle = 'rgba(176,96,236,' + (0.16 + 0.1 * sin(T * 9 + c.seed * 6)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, r * k.bodyR * 0.95, 0, TAU); ctx.fill();
    }
    if (c.hitT > 0 && c.hp < c.maxHp && k.id !== 'bird' && !k.boss) {
      const w = clamp(r * 2.4, 10, 40), h = 2.4 / zoom, bx = c.x - w / 2, by = c.y - lift - r * k.bodyR - 4 / zoom;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx - 0.5 / zoom, by - 0.5 / zoom, w + 1 / zoom, h + 1 / zoom);
      ctx.fillStyle = c.hp / c.maxHp > 0.4 ? '#9be36a' : '#e8503a'; ctx.fillRect(bx, by, w * clamp(c.hp / c.maxHp, 0, 1), h);
    }
    if (sci && !c.noSci) {
      const hostile = k.role === 'predator' || (k.defends && c.state === 'defend');
      const rad = k.detection * (k.role === 'predator' ? 1 : 0.85);
      ctx.strokeStyle = hostile ? 'rgba(255,90,70,0.3)' : 'rgba(255,214,120,0.2)'; ctx.lineWidth = 1 / zoom; ctx.setLineDash([6 / zoom, 6 / zoom]);
      ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawCorpse(ctx, c, T, zoom) {
    const k = c.k, f = c.fade, r = c.radius * (1 - 0.18 * f);
    const alpha = (1 - f) * 0.9; if (alpha < 0.02) return;
    F.t = T; F.ph = c.ph; F.mv = 0; F.seed = c.seed; F.tele = 0; F.stuck = 0; F.dead = min(1, f * 4); F.hop = 0; F.air = false; F.curl = 0; F.atk = 0; F.open = 0.4; F.bend = 0;
    F.detail = false; F.sil = false; F.px = 1 / (r * zoom);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.16 * alpha) + ')'; ctx.beginPath(); ctx.ellipse(c.x + r * 0.15, c.y + r * 0.25, k.shadow[0] * r, k.shadow[1] * r, c.angle, 0, TAU); ctx.fill();
    ctx.globalAlpha = alpha;
    renderSprite(ctx, k, c.x, c.y, c.angle, r);
    ctx.globalAlpha = 1;
    if (f < 0.4) { // little poof
      const q = f / 0.4; ctx.strokeStyle = 'rgba(255,240,200,' + (0.5 * (1 - q)) + ')'; ctx.lineWidth = 1.2 / zoom; ctx.beginPath(); ctx.arc(c.x, c.y, r * (1.2 + q * 2.2), 0, TAU); ctx.stroke();
    }
  }

  // ---- mate pheromone aura (drawn under the sprite) ---------------------------------------------
  function drawMateAura(ctx, c, T, zoom) {
    const R = 150 + sin(T * 1.7) * 14, a = 0.55 * c.alpha;
    const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, R);
    g.addColorStop(0, 'rgba(255,150,220,' + (0.34 * a) + ')'); g.addColorStop(0.35, 'rgba(255,120,210,' + (0.16 * a) + ')'); g.addColorStop(1, 'rgba(255,100,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.4 / zoom;
    for (let i = 0; i < 3; i++) {
      const q = ((T * 0.35 + i / 3) % 1);
      ctx.strokeStyle = 'rgba(255,170,235,' + (0.5 * (1 - q) * a) + ')';
      ctx.beginPath(); ctx.arc(c.x, c.y, 20 + q * 120, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,200,240,0.8)';
    for (let i = 0; i < 9; i++) {
      const q = ((T * 0.18 + i * 0.113) % 1), an = i * 2.4 + T * 0.4, rr = 12 + q * 70;
      ctx.globalAlpha = (1 - q) * 0.7 * a; ctx.beginPath(); ctx.arc(c.x + cos(an) * rr, c.y + sin(an) * rr - q * 20, (1.1 + (i % 3) * 0.5) / zoom * 1.4, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- bird shadow + danger marker (ground layer) -------------------------------------------------
  function drawBirdShadow(ctx, c, T, zoom) {
    const a = c.shadowA; if (a < 0.01) return;
    const s = c.shadowS, r = c.radius * s, fl = 0.6 + 0.4 * abs(cos(T * 9 + c.seed * 3));
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.46 * a) + ')';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.3, r * 0.78, 0, 0, TAU); ctx.fill();            // body
    ctx.beginPath(); ctx.ellipse(-r * 0.3, 0, r * 0.9 * 1.05, r * 2.7 * fl, 0, 0, TAU); ctx.fill();    // wings
    ctx.beginPath(); ctx.moveTo(-r * 1.1, r * 0.4); ctx.lineTo(-r * 2.9, r * 0.6); ctx.lineTo(-r * 2.9, -r * 0.6); ctx.lineTo(-r * 1.1, -r * 0.4); ctx.fill(); // tail
    ctx.beginPath(); ctx.arc(r * 1.4, 0, r * 0.5, 0, TAU); ctx.fill();
    ctx.restore();
    if (c.lockT > 0) { // strike zone marker
      const q = clamp(c.lockT, 0, 1);
      ctx.strokeStyle = 'rgba(255,60,40,' + (0.4 + 0.4 * sin(T * 22)) + ')'; ctx.lineWidth = 2 / zoom;
      ctx.beginPath(); ctx.arc(c.lockX, c.lockY, c.strikeR * (1.25 - 0.25 * q), 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,40,30,' + (0.1 + 0.1 * q) + ')'; ctx.beginPath(); ctx.arc(c.lockX, c.lockY, c.strikeR * (1.25 - 0.25 * q), 0, TAU); ctx.fill();
    }
  }
  function drawBirdSprite(ctx, c, T, zoom) {
    if (c.skyA < 0.02) return;
    const k = c.k, s = c.skyS, r = c.radius * s;
    // soft ground shadow beneath, offset by altitude
    F.t = T + c.seed * 10; F.ph = 0; F.mv = 0; F.seed = c.seed; F.tele = 0; F.stuck = 0; F.dead = 0; F.hop = 0; F.air = true; F.curl = 0; F.atk = c.atk; F.open = 0; F.bend = 0;
    F.detail = false; F.sil = false; F.px = 1 / (r * zoom);
    ctx.globalAlpha = c.skyA;
    renderSprite(ctx, k, c.x, c.y - c.alt, c.angle, r);
    ctx.globalAlpha = 1;
  }

  // ---- public: bestiary portrait ----------------------------------------------------------------------
  let silCv = null, silCtx = null;
  function iconPose(k, o, sc) {
    const t = o.t != null ? o.t : Game.time.real;
    F.t = t; F.ph = t * 7; F.mv = o.still ? 0 : (k.flying ? 0.15 : 0.5); F.seed = (k.idx * 0.1618 + 0.07) % 1; F.tele = o.tele || 0; F.stuck = 0; F.dead = 0; F.hop = 0;
    F.air = o.flying != null ? o.flying : !!k.flying; F.curl = o.curl ? 1 : 0; F.atk = 0; F.open = 0.15 + 0.1 * sin(t * 2); F.bend = 0; F.detail = true; F.sil = !!o.silhouette; F.px = 0.6 / sc;
    if (k.id === 'wolf') F.seed = 0.8;  // show the mother with her spiderlings
    if (k.id === 'moth') F.seed = 0.3;
    if (k.id === 'widow') F.tele = 0.8;  // rearing up, so the portrait shows her red hourglass
  }
  function drawKindIcon(ctx, kindId, x, y, size, opts) {
    const k = KINDS[kindId]; if (!k || !ctx) return;
    const o = opts || {}, ang = o.angle != null ? o.angle : -0.55;
    const sc = (size * 0.5 * 0.94) / k.ext, cxo = k.cx * sc;
    const ox = -cos(ang) * cxo, oy = -sin(ang) * cxo;   // keep long creatures centred
    if (o.silhouette) {
      const cv = silhouetteCanvas(ceil2(size));
      if (cv) {
        const w = cv.width, s2 = w / size;
        silCtx.setTransform(1, 0, 0, 1, 0, 0); silCtx.clearRect(0, 0, w, w); silCtx.globalCompositeOperation = 'source-over'; silCtx.globalAlpha = 1;
        iconPose(k, o, sc * s2);
        renderSprite(silCtx, k, w / 2 + ox * s2, w / 2 + oy * s2, ang, sc * s2);
        silCtx.globalCompositeOperation = 'source-in'; silCtx.fillStyle = o.silColor || '#0d0b09'; silCtx.fillRect(0, 0, w, w); silCtx.globalCompositeOperation = 'source-over';
        ctx.save(); if (o.alpha != null) ctx.globalAlpha = o.alpha; ctx.drawImage(cv, 0, 0, w, w, x - size / 2, y - size / 2, size, size); ctx.restore();
        return;
      }
    }
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.shadow !== false) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x + size * 0.04, y + size * 0.08, size * 0.36, size * 0.3, 0, 0, TAU); ctx.fill(); }
    iconPose(k, o, sc);
    if (o.silhouette) ctx.globalAlpha *= 0.6;
    renderSprite(ctx, k, x + ox, y + oy, ang, sc);
    ctx.restore();
  }
  function ceil2(v) { return Math.max(32, Math.ceil(v * 2 / 16) * 16); }
  function silhouetteCanvas(px) {
    try {
      if (!silCv || silCv.width < px) { silCv = U.makeCanvas(px, px); if (silCv) silCtx = silCv.getContext('2d'); }
      if (!silCv || !silCtx) return null;
      return silCv;
    } catch (e) { return null; }
  }

  // ====================================================================== SIM STATE
  const MAXC = 150;
  const list = [];          // living creatures (public)
  const corpses = [];       // fading bodies (visual only)
  const pool = [];          // recycled creature objects
  let nextId = 1;
  const visibleKinds = new Set();
  const ZONE_IDS = ['litter', 'bark', 'garden'];
  const S = {
    P: null, px: 0, py: 0, cx: 0, cy: 0, stage: 0, playing: false, title: false,
    phase: 'day', night: false, rain: 0, windX: 0, windY: 0, wind: 0, fog: 0, frame: 0, T: 0, w: null,
    hunterMask: null, dangerRaw: 0, sfxT: {}, birdT: 30, birdAlive: null, mateFound: false, seenT: 0, popT: 0, shareT: 0, pityT: 0, cursor: 0,
    share: [0, 0, 0], target: new Float32Array(32), count: new Int32Array(32), R: 800, rin: 300, matePending: false,
    alarms: [], huddle: 0,   // sibling lookout warnings {id,kind,x,y,life} / siblings currently huddled with the player
  };
  // which kinds hunt each kind (for flee decisions)
  const HUNTERS = new Int32Array(32);
  KIND_LIST.forEach(a => { KIND_LIST.forEach(b => { if (a.eatMask & b.bit) HUNTERS[b.idx] |= a.bit; }); });
  const BIRD_BIT = KINDS.bird.bit, KIN_BIT = KINDS.kin.bit;
  const NOBIRD = ~BIRD_BIT;
  const HOP = { springtail: [0.18, 0.3], cricket: [0.26, 0.36], grasshopper: [0.34, 0.5] };
  KIND_LIST.forEach(k => { const h = HOP[k.id]; k.hopDash = h ? h[0] : 0; k.hopPause = h ? h[1] : 0; if (k.id === 'springtail') k.flee = 190; if (k.id === 'cricket') k.flee = 250; if (k.id === 'grasshopper') k.flee = 300; k.turn = k.turn || (k.id === 'mantis' ? 3.5 : k.id === 'centipede' ? 6 : 9); k.giveUp = k.giveUp || ({ wolf: 6, centipede: 5.5, wasp: 6, jumper: 4, rove: 5, ground: 5, ant: 7 }[k.id] || 6); });

  // population table: density per 1M px^2 of each zone [litter, bark, garden], stage multipliers, caps, group sizes
  const POP = {
    springtail: { d: [30, 14, 0], s: [1, 1, 0.7, 0.45, 0.3], cap: 44, g: [1, 3] },
    mite:       { d: [22, 14, 0], s: [1, 1, 0.7, 0.4, 0.25], cap: 32, g: [1, 2] },
    aphid:      { d: [0, 5, 40], s: [1, 1, 0.9, 0.7, 0.5], cap: 30, g: [3, 6] },
    midge:      { d: [14, 4, 16], s: [1, 1, 0.8, 0.6, 0.4], cap: 26, g: [3, 6] },
    fruitfly:   { d: [4, 2, 16], s: [0.8, 1, 1, 0.8, 0.6], cap: 18, g: [1, 3] },
    ant:        { d: [4, 22, 12], s: [0.25, 0.8, 1, 1, 1], cap: 24, g: [3, 6] },
    pillbug:    { d: [10, 7, 0], s: [0.5, 1, 1, 0.8, 0.6], cap: 14, g: [1, 2] },
    moth:       { d: [0, 5, 10], s: [0, 0.4, 1, 1, 1], cap: 10, g: [1, 1] },
    cricket:    { d: [5, 0, 6], s: [0.1, 0.5, 1, 1, 1], cap: 10, g: [1, 1] },
    caterpillar:{ d: [0, 3, 9], s: [0, 0.4, 1, 1, 1], cap: 10, g: [1, 1] },
    grasshopper:{ d: [0, 0, 8], s: [0, 0.1, 0.7, 1, 1], cap: 8, g: [1, 1] },
    beetle:     { d: [0, 5, 10], s: [0.1, 0.7, 1, 1, 1], cap: 10, g: [1, 1] },
    centipede:  { d: [1.5, 7, 0], s: [0, 0.3, 0.8, 1, 1], cap: 6, g: [1, 1] },
    wasp:       { d: [0, 1.5, 7], s: [0, 0.3, 0.8, 1, 1], cap: 6, g: [1, 1] },
    mantis:     { d: [0, 0, 2.5], s: [0, 0, 0.5, 1, 1], cap: 3, g: [1, 1] },
    rove:       { d: [5, 1, 0], s: [0.5, 1, 0.7, 0.2, 0.1], cap: 5, g: [1, 1] },
    ground:     { d: [3, 4, 0], s: [0, 0.7, 1, 0.3, 0.1], cap: 5, g: [1, 1] },
    wolf:       { d: [2, 3, 0], s: [0, 0.2, 0.8, 1, 0.4], cap: 4, g: [1, 1] },
    jumper:     { d: [1, 3, 3], s: [0, 0.6, 1, 0.7, 0.3], cap: 4, g: [1, 1] },
  };
  KIND_LIST.forEach(k => { k.pop = POP[k.id] || null; });
  const POP_KINDS = KIND_LIST.filter(k => k.pop);
  const STAGE_R = [760, 900, 1050, 1250, 1500];

  // ----------------------------------------------------------------------- helpers
  function zoneIdx(x) { return x < C.ZONES[0].x1 ? 0 : (x < C.ZONES[1].x1 ? 1 : 2); }
  function expo(x, y) { const w = S.w; if (w && w.exposure) { const e = w.exposure(x, y); return e == null ? 1 : e; } return 1; }
  function emitSfx(name, x, y, vol, cool) {
    const t = S.sfxT, now = S.T;
    if (cool) { if (t[name] && now - t[name] < cool) return; t[name] = now; }
    Game.emit('sfx', { name, x, y, vol: vol == null ? 1 : vol });
  }
  let lastBiteSfx = -9;
  function playerAlive() { const P = S.P; return P && !P.dead; }
  function pRad() { return S.P ? (S.P.radius || 5) : 5; }
  // where a hatchling starts: the fixed hatch point, or in Territory the Home Site. The hatchling-safe rules below are measured from it.
  function hatchPt() { const T = Game.territory; if (T && T.active && T.spawnPoint) { const p = T.spawnPoint(); if (p) return p; } return C.SPAWN; }
  const territoryOn = () => { const T = Game.territory; return !!(T && T.active); };

  // ----------------------------------------------------------------- spatial hash
  const CELL = 96, GW = Math.ceil(C.WORLD_W / CELL), GH = Math.ceil(C.WORLD_H / CELL), NC = GW * GH;
  const cellStart = new Int32Array(NC + 2), cellFill = new Int32Array(NC + 2);
  const hashArr = new Array(MAXC + 64).fill(null);
  function buildHash() {
    cellStart.fill(0);
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      let gx = (c.x / CELL) | 0, gy = (c.y / CELL) | 0;
      gx = gx < 0 ? 0 : (gx >= GW ? GW - 1 : gx); gy = gy < 0 ? 0 : (gy >= GH ? GH - 1 : gy);
      c.cell = gy * GW + gx; cellStart[c.cell + 1]++;
    }
    for (let i = 0; i < NC; i++) { cellStart[i + 1] += cellStart[i]; cellFill[i] = cellStart[i]; }
    for (let i = 0; i < n; i++) { const c = list[i]; if (cellFill[c.cell] < hashArr.length) hashArr[cellFill[c.cell]++] = c; }
  }
  // nearest living creature whose kind bit is in `mask`; flyOk: may return airborne ones; skipStuck: ignore trapped ones
  function findNearest(x, y, r, mask, self, flyOk, skipStuck) {
    let gx0 = ((x - r) / CELL) | 0, gx1 = ((x + r) / CELL) | 0, gy0 = ((y - r) / CELL) | 0, gy1 = ((y + r) / CELL) | 0;
    if (gx0 < 0) gx0 = 0; if (gy0 < 0) gy0 = 0; if (gx1 >= GW) gx1 = GW - 1; if (gy1 >= GH) gy1 = GH - 1;
    let best = null, bd = r * r;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const ci = gy * GW + gx;
        for (let j = cellStart[ci], e = cellStart[ci + 1]; j < e; j++) {
          const o = hashArr[j];
          if (o === self || o.dead || !(o.bit & mask) || o.state === 'dead') continue;
          if (o.hidden && o.state !== 'stuck') continue;
          if (o.flying && !flyOk) continue;
          if (skipStuck && o.state === 'stuck') continue;
          const dx = o.x - x, dy = o.y - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = o; }
        }
      }
    }
    return best;
  }
  function countMaskNear(x, y, r, mask, self) {
    let n = 0;
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o !== self && !o.dead && (o.bit & mask)) { const dx = o.x - x, dy = o.y - y; if (dx * dx + dy * dy < r * r) n++; } }
    return n;
  }

  // -------------------------------------------------------------- creature objects
  function blank() {
    return {
      id: 0, kind: '', k: null, ki: 0, bit: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, radius: 1, hp: 1, maxHp: 1,
      state: 'wander', role: 'prey', flying: false, zone: 'litter', dead: false, fade: 0,
      t: 0, t2: 0, wa: 0, tx: 0, ty: 0, hx: 0, hy: 0, target: null, targetId: 0, tIsP: false, threat: null, threatId: 0, threatP: false,
      senseT: 0, alertT: 0, alertCol: null, windT: 0, tele: 0, atk: 0, cool: 0, cool2: 0, fedT: 0, hop: 0, dashT: 0, ph: 0, mv: 0, bend: 0, open: 0,
      seed: 0, age: 0, alpha: 1, hideA: 0, hidden: false, stuckWeb: null, struggle: 0, stuckT: 0, flash: 0, hitT: 0, alt: 0, altT: 0, wasFlying: false,
      li: -1, cell: 0, blocked: 0, accDt: 0, upd: 0, idleWhy: '', chaseT: 0, lsx: 0, lsy: 0, hitDone: false, curlT: 0,
      ax: 0, ay: 0, bx: 0, by: 0, trailDir: 1, trailWait: 0, avx: 0, avy: 0, avT: 0, grp: 0, noSci: false, awareT: 0, voiceT: 0, struggleSfx: 0,
      lockX: 0, lockY: 0, lockT: 0, strikeR: 0, shadowA: 0, shadowS: 1, skyA: 0, skyS: 1, phaseT: 0, hitRes: 0, dist: 0, ang2: 0, gatherT: 0, gx: 0, gy: 0,
      disperse: false, found: false, courted: false, spawnStage: 0, eatT: 0, rainWait: 0, flapT: 0, dx: 0, dy: 0, sac: 0, sacT: 0,
      venomT: 0, venomDps: 0, noTurn: false, rival: 0,
    };
  }
  function create(k, x, y, o) {
    if (list.length >= MAXC + 30) return null;
    const c = pool.pop() || blank();
    const seed = rnd();
    c.id = nextId++; c.kind = k.id; c.k = k; c.ki = k.idx; c.bit = k.bit;
    c.x = x; c.y = y; c.vx = 0; c.vy = 0; c.angle = o && o.angle != null ? o.angle : rnd() * TAU;
    c.seed = seed; c.radius = k.radius * (k.unique ? 1 : (0.92 + rnd() * 0.18));
    c.hp = c.maxHp = k.hp; c.role = k.role; c.flying = !!k.flying; c.zone = ZONE_IDS[zoneIdx(x)];
    c.state = 'wander'; c.dead = false; c.fade = 0;
    c.t = rnd() * 2; c.t2 = 0; c.wa = c.angle; c.tx = x; c.ty = y; c.hx = x; c.hy = y;
    c.target = null; c.targetId = 0; c.tIsP = false; c.threat = null; c.threatId = 0; c.threatP = false;
    c.senseT = rnd() * 0.3; c.alertT = 0; c.alertCol = null; c.windT = 0; c.tele = 0; c.atk = 0; c.cool = 0; c.cool2 = 0; c.fedT = rnd() * 4;
    c.hop = 0; c.dashT = 0; c.ph = rnd() * TAU; c.mv = 0; c.bend = 0; c.open = 0; c.age = 0; c.alpha = (o && o.instant) ? 1 : 0;
    c.hideA = 0; c.hidden = false; c.stuckWeb = null; c.struggle = 0; c.stuckT = 0; c.flash = 0; c.hitT = 0;
    c.alt = c.flying ? 10 + rnd() * 8 : 0; c.altT = c.alt; c.wasFlying = false;
    c.blocked = 0; c.accDt = 0; c.upd = -1; c.idleWhy = ''; c.chaseT = 0; c.hitDone = false; c.curlT = 0;
    c.trailDir = 1; c.trailWait = 0; c.avx = 0; c.avy = 0; c.avT = 0; c.grp = 0; c.noSci = false; c.awareT = 0; c.voiceT = rnd() * 2; c.struggleSfx = 0;
    c.lockT = 0; c.shadowA = 0; c.shadowS = 1; c.skyA = 0; c.skyS = 1; c.phaseT = 0; c.gatherT = 0; c.disperse = false; c.found = false; c.courted = false; c.sac = 0; c.sacT = 0;
    c.spawnStage = S.stage; c.eatT = 0; c.rainWait = 0; c.flapT = 0; c.dx = 0; c.dy = 0; c.ax = x; c.ay = y; c.bx = x; c.by = y;
    c.venomT = 0; c.venomDps = 0; c.noTurn = false; c.rival = 0;
    if (o) {
      if (o.state) c.state = o.state;
      if (o.hx != null) { c.hx = o.hx; c.hy = o.hy; }
    }
    c.li = list.length; list.push(c);
    Game.emit('creature:spawned', { creature: c });
    return c;
  }
  function recycle(c) { c.target = null; c.threat = null; c.stuckWeb = null; if (pool.length < 200) pool.push(c); }
  let needCompact = false;
  function compact() {
    if (!needCompact) return;
    let w = 0;
    for (let i = 0; i < list.length; i++) { const c = list[i]; if (!c.dead) { list[w] = c; c.li = w; w++; } }
    list.length = w; needCompact = false;
  }
  // silently remove (despawn out of view)
  function removeQuiet(c) {
    if (c.dead) return;
    c.dead = true; c.state = 'dead'; needCompact = true; releaseWeb(c, false, true); c.eatT = 0;
    if (c === S.birdAlive) S.birdAlive = null;
    recycleLater.push(c);
  }
  const recycleLater = [];

  // ----------------------------------------------------------------- damage & death
  function canEat(pr, c) {
    if (!c || c.dead) return false;
    const k = c.k, stuck = c.state === 'stuck';
    if (k.role === 'prey' || k.role === 'neutral') return c.radius <= pr * (stuck ? 2.2 : 1.35);
    if (k.edibleWhenSmall) return c.radius <= pr * (stuck ? 1.4 : 0.8);
    return false;
  }
  // webs.js owns web.trapped / web integrity; we only drop our reference and restore flight
  function releaseWeb(c, broke, silent) {
    if (!c.stuckWeb) return;
    c.stuckWeb = null;
    if (!silent) c.flying = c.wasFlying;
  }
  function kill(c, by, src) {
    if (!c || c.dead || c.k.unique || (c.sac && by !== 'sacrifice')) return false;
    const k = c.k, P = S.P;
    const edible = by === 'player' && P && canEat(pRad(), c);
    c.dead = true; c.hp = 0; needCompact = true;
    releaseWeb(c, false, true);
    c.state = 'dead'; c.fade = 0; c.flying = false; c.vx = c.vy = 0; c.tele = 0; c.alertT = 0;
    if (c === S.birdAlive) S.birdAlive = null;
    if (k.id !== 'bird') corpses.push(c); else recycleLater.push(c);
    if (edible && P && P.feed && (k.value.hunger > 0 || k.value.growth > 0)) {
      const d = max(0, P.stage - k.tier);
      const gm = d <= 0 ? 1 : max(0.35, 1 - 0.2 * d), hm = d <= 0 ? 1 : max(0.55, 1 - 0.1 * d);
      try { P.feed(k.value.hunger * hm, k.value.growth * gm, k.id); } catch (e) { Game.reportError('creatures.feed', e); }
    }
    Game.emit('creature:killed', { creature: c, by: by || 'other' });
    return true;
  }
  function hurt(c, dmg, by, src) {
    if (c.dead || dmg <= 0) return false;
    if (c.k.unique || c.sac) return false;
    if (c.k.boss && Game.boss && Game.boss.onHurt) { dmg = Game.boss.onHurt(c, dmg, by); if (!(dmg > 0)) return false; }   // the boss may shrug a hit off (shielded) or take extra (stunned)
    c.hp -= dmg; c.flash = 0.25; c.hitT = 3.5;
    if (c.hp <= 0) return kill(c, by, src);
    if (c.state === 'idle') { c.state = 'wander'; c.t = 0.2; c.idleWhy = ''; }
    if (c.state === 'curl') c.curlT = max(c.curlT, 1.2);
    return false;
  }
  // free from a web (struggled loose)
  function breakFree(c) {
    releaseWeb(c, true, false);
    c.state = 'flee'; c.t = 1.8; c.struggle = 0; c.alertT = 0.5; c.dashT = 0; c.t2 = 0;
    c.tx = c.x + (rnd() - 0.5) * 200; c.ty = c.y + (rnd() - 0.5) * 200; c.threatP = false;
    const a = rnd() * TAU; c.vx = cos(a) * c.k.speed * 1.2; c.vy = sin(a) * c.k.speed * 1.2;
  }
  function trap(c, web) {
    if (!c || c.dead || c.state === 'stuck') return false;
    const k = c.k; if (!k.trap) return false;
    if (k.id === 'bird' || c.role === 'spider') return false;
    c.state = 'stuck'; c.stuckWeb = web || null; c.stuckT = k.trap.time * (0.8 + rnd() * 0.4);
    c.struggle = 0.55; c.vx = c.vy = 0; c.tele = 0; c.atk = 0; c.windT = 0; c.target = null; c.wasFlying = c.flying; c.flying = false; c.alt = 0; c.altT = 0;
    c.idleWhy = '';
    return true;
  }

  // ================================================================= AI: movement helpers
  KIND_LIST.forEach(k => { k.catchAir = (k.id === 'wasp' || k.id === 'mantis' || k.id === 'jumper' || k.id === 'bird'); k.altBase = { midge: 9, fruitfly: 11, moth: 14, wasp: 20, grasshopper: 8, beetle: 7, bird: 0 }[k.id] || 8; });

  function steer(c, ang, spd, dt, acc) {
    const a = acc * dt > 1 ? 1 : acc * dt;
    c.vx += (cos(ang) * spd - c.vx) * a; c.vy += (sin(ang) * spd - c.vy) * a;
  }
  function brake(c, dt, acc) { const a = min(1, acc * dt); c.vx -= c.vx * a; c.vy -= c.vy * a; }
  function faceTo(c, x, y, rate, dt) { c.angle = U.turnToward(c.angle, atan2(y - c.y, x - c.x), rate * dt); }

  function obstacle(c) {
    const w = S.w; if (!w || !w.resolve) return;
    if (((S.frame + c.id) & 1) !== 0) return;
    const p = w.resolve(c.x, c.y, min(c.radius, 9) * 0.85); if (!p) return;
    const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
    if (d2 > 0.04) {
      c.x = p.x; c.y = p.y;
      if (d2 > 0.5) {
        c.blocked = 0.5; const n = sqrt(d2), nx = dx / n, ny = dy / n, vn = c.vx * nx + c.vy * ny;
        if (vn < 0) { c.vx -= vn * nx; c.vy -= vn * ny; }
      }
    }
  }
  function integrate(c, dt) {
    const k = c.k;
    const sp2 = c.vx * c.vx + c.vy * c.vy, sp = sqrt(sp2);
    if (sp > 3 && !c.noTurn) {
      const old = c.angle;
      c.angle = U.turnToward(c.angle, atan2(c.vy, c.vx), k.turn * dt);
      if (k.id === 'centipede') { const dA = U.wrapAngle(c.angle - old); c.bend += (clamp(dA / dt * 0.08, -1.2, 1.2) - c.bend) * min(1, dt * 6); }
    } else if (k.id === 'centipede') c.bend -= c.bend * min(1, dt * 4);
    let wx = 0, wy = 0;
    if (c.flying && S.wind > 0.02) { wx = clamp(S.windX * 0.2, -22, 22); wy = clamp(S.windY * 0.2, -22, 22); }
    c.x += (c.vx + wx) * dt; c.y += (c.vy + wy) * dt;
    const m = min(c.radius, 12) + 4, W = C.WORLD_W, H = C.WORLD_H;
    if (c.x < m) { c.x = m; if (c.vx < 0) c.vx = -c.vx * 0.3; c.blocked = 0.4; } else if (c.x > W - m) { c.x = W - m; if (c.vx > 0) c.vx = -c.vx * 0.3; c.blocked = 0.4; }
    if (c.y < m) { c.y = m; if (c.vy < 0) c.vy = -c.vy * 0.3; c.blocked = 0.4; } else if (c.y > H - m) { c.y = H - m; if (c.vy > 0) c.vy = -c.vy * 0.3; c.blocked = 0.4; }
    if (!c.flying && !k.noCollide) obstacle(c);
    c.mv += (min(1, sp / (k.speed * 1.15 + 1)) - c.mv) * min(1, dt * 9);
    c.ph += min(sp, k.speed * 2.6) * dt / (c.radius * 0.55);
    if (c.ph > 1e4) c.ph -= 1e4;
    // altitude
    c.alt += (c.altT - c.alt) * min(1, dt * 5);
  }
  // meander with leash + habitat containment. Uses c.t (heading timer), c.wa (heading)
  function wander(c, dt, spd, acc) {
    const k = c.k;
    if (c.blocked > 0) { c.blocked -= dt; if (c.blocked > 0.2) { c.wa += PI * (0.6 + rnd() * 0.8); c.blocked = 0.18; c.t = 0.8; } }
    c.t -= dt;
    if (c.t <= 0) {
      c.t = 0.7 + rnd() * 1.6; c.wa += (rnd() - 0.5) * 1.9;
      const dx = c.hx - c.x, dy = c.hy - c.y, d2 = dx * dx + dy * dy;
      if (d2 > k.leash * k.leash) c.wa = atan2(dy, dx) + (rnd() - 0.5) * 0.8;
      else if (k.pop && k.pop.d[zoneIdx(c.x)] === 0) { c.wa = atan2(dy, dx); }
    }
    steer(c, c.wa, spd, dt, acc || 4);
  }
  // steer toward a point, with optional web avoidance
  function goToward(c, x, y, spd, dt, acc, avoid) {
    let dx = x - c.x, dy = y - c.y; const d = hypot(dx, dy) || 1; dx /= d; dy /= d;
    if (avoid) { webAvoid(c, dt); if (c.avx || c.avy) { dx += c.avx * 1.7; dy += c.avy * 1.7; } }
    steer(c, atan2(dy, dx), spd, dt, acc || 6);
    return d;
  }
  function notRetreat(w) { return w.type !== 'retreat'; }
  function webAvoid(c, dt) {
    c.avT -= dt;
    if (c.avT > 0) return;
    c.avT = 0.22 + rnd() * 0.12; c.avx = 0; c.avy = 0;
    const W = Game.webs;
    if (!W || !W.nearestWeb || !W.list || !W.list.length) return;
    const tp = c.k.trap;
    if (tp && tp.time <= 5 && c.radius <= 9 && rnd() < 0.3) return;     // small hunters sometimes blunder into silk
    let wb = null;
    try { wb = W.nearestWeb(c.x + c.vx * 0.25, c.y + c.vy * 0.25, c.radius + 44, notRetreat); } catch (e) { return; }
    if (!wb) return;
    let px, py;
    if (wb.x1 != null && wb.type === 'line') { const q = U.pointSeg(c.x, c.y, wb.x1, wb.y1, wb.x2, wb.y2); px = q.x; py = q.y; }
    else if (wb.x != null) { px = wb.x; py = wb.y; }
    else if (wb.x1 != null) { px = (wb.x1 + wb.x2) / 2; py = (wb.y1 + wb.y2) / 2; }
    else return;
    const dx = c.x - px, dy = c.y - py, d = hypot(dx, dy) || 1; c.avx = dx / d; c.avy = dy / d;
  }
  function activeNow(k) {
    const ph = S.phase;
    switch (k.activity) {
      case 'night': return ph === 'night' || ph === 'dusk';
      case 'day': return ph !== 'night';
      default: return true;
    }
  }
  function findCover(c) {
    const w = S.w; let bx = 0, by = 0, bd = 450 * 450, found = false;
    if (w && w.shelters && w.shelters.length) {
      const sh = w.shelters;
      for (let i = 0; i < sh.length; i++) { const s = sh[i], dx = s.x - c.x, dy = s.y - c.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bx = s.x; by = s.y; found = true; } }
    }
    if (!found && w && w.exposure) {
      let be = expo(c.x, c.y);
      for (let i = 0; i < 7; i++) { const a = rnd() * TAU, r = 50 + rnd() * 110, x = c.x + cos(a) * r, y = c.y + sin(a) * r, e = expo(x, y); if (e < be - 0.05) { be = e; bx = x; by = y; found = true; } }
    }
    c.tx = found ? bx : c.x; c.ty = found ? by : c.y;
    return found;
  }
  function setFlying(c, dt) {
    const k = c.k;
    if (k.canFly) c.flying = (c.state === 'flee' && c.dashT > 0 && !c.stuckWeb);
    else if (k.flying) c.flying = c.state !== 'idle' && c.state !== 'stuck';
    c.altT = c.flying ? (k.altBase + sin(S.T * 3 + c.seed * 9) * 2.2) : 0;
  }

  // ================================================================= AI: prey
  function sensePrey(c) {
    const k = c.k, P = S.P;
    c.zone = ZONE_IDS[zoneIdx(c.x)];
    // ---- schedule: sleep / rain shelter / wake
    const st = c.state;
    if (st === 'idle') {
      if (c.idleWhy === 'rain' && S.rain < 0.12) { c.idleWhy = 'wake'; c.t = rnd() * 4; }
      else if (c.idleWhy === 'phase' && activeNow(k)) { c.idleWhy = 'wake'; c.t = rnd() * 5; }
    } else if (st === 'wander' || st === 'graze') {
      if (k.rainShelter && S.rain > 0.3 && expo(c.x, c.y) > 0.55 && c.rainWait <= 0) {
        if (findCover(c)) { c.state = 'shelter'; c.t = 7; } else { c.rainWait = 6; }
      } else if (!activeNow(k) && rnd() < 0.5) { c.state = 'idle'; c.idleWhy = 'phase'; c.t = 0; }
    }
    // ---- threats
    if (c.state === 'idle' && c.idleWhy === 'rain') return;
    if (c.state === 'stuck' || c.state === 'shelter' && S.rain > 0.5) return;
    let fx = 0, fy = 0, fd = 1e9, found = false, isP = false;
    if (P && !P.dead && c.state !== 'curl') {
      const dx = c.x - P.x, dy = c.y - P.y, d = sqrt(dx * dx + dy * dy);
      if (c.radius < P.radius * 3.0) {
        let range = k.detection * (P.stealth || 1) * (S.fog > 0.3 ? 0.75 : 1) * (c.state === 'idle' ? 0.45 : 1);
        if (P.hidden) range = min(range, c.radius + P.radius * 2.2);
        if (d < range) { found = true; fx = P.x; fy = P.y; fd = d; isP = true; }
      }
    }
    const hm = HUNTERS[c.ki] & NOBIRD;
    if (hm && st !== 'curl') {
      const h = findNearest(c.x, c.y, k.detection * 0.9, hm, c, true, false);
      if (h && h.state !== 'idle' && !h.dead) {
        const dx = h.x - c.x, dy = h.y - c.y, d = sqrt(dx * dx + dy * dy);
        if (!(h.k.ambusher && h.state === 'ambush' && d > 55) && d < fd) { found = true; fx = h.x; fy = h.y; fd = d; isP = false; }
      }
    }
    if (found) {
      if (k.fleeStyle === 'curl' && fd < k.detection * 0.65) { c.state = 'curl'; c.curlT = 2.8 + rnd() * 1.5; c.vx = c.vy = 0; return; }
      if (c.state !== 'flee') { c.state = 'flee'; c.dashT = 0; c.t2 = 0.05 + rnd() * 0.15; c.ang2 = (rnd() - 0.5) * 1.1; if (isP && fd < 380) { c.alertT = 0.75; c.alertCol = '#ffd24a'; } }
      c.t = max(c.t, 0.9 + rnd() * 0.8); c.tx = fx; c.ty = fy; c.threatP = isP;
      if (c.flying || k.flying) c.altT = k.altBase + 4;
    }
  }
  function thinkPrey(c, dt) {
    const k = c.k;
    c.senseT -= dt;
    if (c.senseT <= 0) { c.senseT = 0.16 + rnd() * 0.12; sensePrey(c); }
    c.rainWait -= dt;
    const wantHide = (c.state === 'idle' && c.idleWhy === 'rain') ? 1 : 0;
    c.hideA += (wantHide - c.hideA) * min(1, dt * 3); c.hidden = c.hideA > 0.6;
    c.open = 0;
    switch (c.state) {
      case 'flee': {
        c.t -= dt;
        c.ang2 += (rnd() - 0.5) * dt * 7; c.ang2 = clamp(c.ang2, -0.8, 0.8);
        const away = atan2(c.y - c.ty, c.x - c.tx) + c.ang2;
        if (k.hopDash) {
          if (c.dashT > 0) { // mid-hop: committed ballistic motion
            c.dashT -= dt; const prog = 1 - max(0, c.dashT) / k.hopDash; c.hop = sin(prog * PI);
            const sp = k.flee * (0.55 + 0.9 * (1 - prog));
            c.vx = cos(c.dx) * sp; c.vy = sin(c.dx) * sp; c.angle = U.turnToward(c.angle, c.dx, 30 * dt);
            if (c.dashT <= 0) { c.hop = 0; c.t2 = k.hopPause * (0.7 + rnd() * 0.6); }
          } else {
            c.hop = 0; brake(c, dt, 14); c.t2 -= dt;
            if (c.t2 <= 0) { c.dashT = k.hopDash; c.dx = away; }
          }
        } else {
          steer(c, away, k.flee * (k.flying ? 1 : 0.95 + 0.1 * sin(S.T * 9 + c.seed * 7)), dt, k.flying ? 9 : 7);
        }
        if (c.t <= 0) { c.state = 'wander'; c.t = 0; c.hop = 0; c.dashT = 0; c.wa = away + PI * 0.5 * (rnd() - 0.5); }
        break;
      }
      case 'curl':
        c.curlT -= dt; brake(c, dt, 12);
        if (c.curlT <= 0) { c.state = 'wander'; c.t = 0.5; }
        break;
      case 'graze':
        c.t -= dt; brake(c, dt, 7); c.open = 0.5 + 0.5 * sin(S.T * 7 + c.seed * 9);
        if (k.flying && !k.canFly) { c.vx += (rnd() - 0.5) * 18 * dt * 10; c.vy += (rnd() - 0.5) * 18 * dt * 10; }
        if (c.t <= 0) { c.state = 'wander'; c.t = 0; }
        break;
      case 'idle':
        brake(c, dt, 8); c.t -= dt;
        if ((c.idleWhy === 'pause' || c.idleWhy === 'wake') && c.t <= 0) { c.state = 'wander'; c.idleWhy = ''; c.t = 0; }
        break;
      case 'shelter': {
        c.t -= dt;
        const d = goToward(c, c.tx, c.ty, k.speed * 1.15, dt, 5, false);
        if (d < 10 || expo(c.x, c.y) < 0.3 || c.t <= 0) { c.state = 'idle'; c.idleWhy = 'rain'; c.t = 0; }
        else if (c.blocked > 0) { c.blocked = 0; c.wa += 1; }
        break;
      }
      default: { // wander (and anything unknown)
        if (c.state !== 'wander') c.state = 'wander';
        const idleChance = k.flying ? 0 : 0.28;
        wander(c, dt, k.speed * (k.flying ? 0.95 : 0.7), k.flying ? 3 : 5);
        if (c.t > 0 && c.t < dt * 1.2 && c.state === 'wander') { // heading just refreshed: sometimes graze / pause
          const r = rnd();
          if (k.graze && r < 0.4) { c.state = 'graze'; c.t = 1.2 + rnd() * 3.5; }
          else if (r < 0.4 + idleChance) { c.state = 'idle'; c.idleWhy = 'pause'; c.t = 0.4 + rnd() * 1.4; }
        }
        if (k.flying) { c.wa += sin(S.T * 4 + c.seed * 11) * dt * 3; }
      }
    }
    setFlying(c, dt);
    integrate(c, dt);
  }

  // ========================================================== AI: hunters (predators, defending ants)
  function hostileToPlayer(c, P) {
    const k = c.k;
    if (k.defends) return P.radius <= c.radius * 3.2;
    return P.radius <= k.maxPrey * c.radius;
  }
  function targetValid(c) {
    if (c.tIsP) { const P = S.P; return !!(P && !P.dead); }
    const t = c.target; return !!(t && !t.dead && t.id === c.targetId && t.state !== 'stuck' && !t.hidden);
  }
  function stopHunt(c, giveUp) {
    c.state = c.k.ambusher ? 'ambush' : 'patrol'; c.target = null; c.tIsP = false; c.chaseT = 0;
    if (giveUp) c.cool2 = 2.5 + rnd() * 2;
    if (c.k.ambusher) c.t = 8 + rnd() * 20;
    c.tele = 0;
  }
  function fleeFrom(c, x, y, t) { c.state = 'flee'; c.t = t; c.tx = x; c.ty = y; c.ang2 = (rnd() - 0.5) * 0.8; c.target = null; c.tIsP = false; c.tele = 0; }
  function senseHunter(c) {
    const k = c.k, P = S.P, st = c.state;
    c.zone = ZONE_IDS[zoneIdx(c.x)];
    const act = activeNow(k) || c.rival === 1;   // a Territory rival is on a mission: it does not sleep the day away
    if (st === 'stuck' || st === 'flee') return;
    // idle: sleeping / sheltering
    if (st === 'idle') {
      if (c.idleWhy === 'rain' && S.rain < 0.15) { c.state = k.ambusher ? 'ambush' : 'patrol'; c.idleWhy = ''; }
      else if (c.idleWhy === 'phase' && act) { c.state = k.ambusher ? 'ambush' : 'patrol'; c.idleWhy = ''; }
      else if (P && !P.dead && hostileToPlayer(c, P) && c.idleWhy !== 'rain') { // woken by a very close player
        const d = hypot(P.x - c.x, P.y - c.y);
        if (d < max(c.radius + P.radius * 2.5 + 10, k.detection * 0.4 * (P.stealth || 1))) { c.state = 'patrol'; c.idleWhy = ''; c.alertT = 0.6; c.alertCol = '#ff5a3a'; }
      }
      if (c.state === 'idle') return;
    }
    if (st === 'patrol' || st === 'ambush') {
      if (k.rainShelter && c.rival !== 1 && S.rain > 0.45 && expo(c.x, c.y) > 0.5) { c.state = 'idle'; c.idleWhy = 'rain'; return; }
      if (!act && rnd() < 0.3 && !(P && !P.dead && hostileToPlayer(c, P) && hypot(P.x - c.x, P.y - c.y) < k.detection * 0.5)) { c.state = 'idle'; c.idleWhy = 'phase'; return; }
    }
    // hurt: break off
    if (c.hp < c.maxHp * 0.28 && !k.unique) { if (P && !P.dead) fleeFrom(c, P.x, P.y, 3.5); return; }
    // too small to fight the player? spiders and ants back off from a much bigger player
    let pClose = false;
    if (P && !P.dead) {
      const dx = P.x - c.x, dy = P.y - c.y, d = sqrt(dx * dx + dy * dy);
      const hostile = hostileToPlayer(c, P);
      if (!hostile) {
        if ((k.spider || k.defends || k.id === 'centipede') && d < k.detection * 0.55 && st !== 'flee' && P.radius > c.radius * 1.6) { fleeFrom(c, P.x, P.y, 2 + rnd()); c.alertT = 0.5; c.alertCol = '#ffd24a'; return; }
      } else if (c.cool2 <= 0 || c.awareT > 0) {
        let range = k.detection * (P.stealth || 1) * (act ? 1 : 0.35) * (S.fog > 0.3 ? 0.75 : 1);
        if (k.defends) range = (c.awareT > 0 ? 220 : k.detection) * (P.stealth || 1);
        if (st === 'hunt' || st === 'windup' || st === 'attack' || st === 'recover') range *= 1.5;
        if (P.hidden) range = min(range, c.radius + P.radius * 2.2 + (st === 'hunt' ? 14 : 0));
        if (d < range) pClose = true;
      }
      if (pClose && (st === 'patrol' || st === 'ambush' || st === 'search' || st === 'idle')) {
        if (!(k.ambusher && st === 'ambush' && d > k.detection)) { c.state = 'hunt'; c.target = P; c.tIsP = true; c.targetId = 0; c.chaseT = 0; c.alertT = 0.9; c.alertCol = '#ff5a3a'; c.awareT = max(c.awareT, 0); onAware(c, d); }
      }
    }
    // food chain: pick prey when not busy with the player
    if (!pClose && c.fedT <= 0 && k.eatMask && (st === 'patrol' || st === 'ambush') && (!k.defends || c.awareT <= 0)) {
      const p = findNearest(c.x, c.y, k.huntRange, k.eatMask, c, k.catchAir, true);
      if (p && p.state !== 'stuck') { c.state = 'hunt'; c.target = p; c.tIsP = false; c.targetId = p.id; c.chaseT = 0; }
    }
  }
  function onAware(c, d) {
    const k = c.k;
    if (d < 520) {
      if (k.id === 'ant') emitSfx('ant_hiss', c.x, c.y, 0.8, 0.7);
      else if (k.id === 'wasp') emitSfx('wasp_buzz', c.x, c.y, 0.9, 1.2);
      else emitSfx('danger', c.x, c.y, 0.6, 2.2);
    }
  }
  function recruitAnts(c) {
    const P = S.P; if (!P) return;
    let n = 0;
    for (let i = 0; i < list.length && n < 6; i++) {
      const o = list[i];
      if (o === c || o.dead || o.k.id !== 'ant' || o.state === 'stuck') continue;
      const dx = o.x - c.x, dy = o.y - c.y;
      if (dx * dx + dy * dy < 240 * 240 && P.radius <= o.radius * 3.2) { o.awareT = 8; n++; if (o.state === 'patrol' || o.state === 'idle') { o.state = 'hunt'; o.target = P; o.tIsP = true; o.targetId = 0; o.chaseT = 0; o.alertT = 0.7; o.alertCol = '#ff5a3a'; } }
    }
  }
  function applyHit(c, tgt) {
    const k = c.k, a = k.attack, P = S.P;
    if (c.tIsP) {
      if (!P || P.dead) return;
      const actual = P.damage ? P.damage(a.dmg, k.id) : 0;
      Game.emit('creature:attack', { creature: c, damage: actual || 0 });
      emitSfx('bite', c.x, c.y, 1);
      if (Game.camera && Game.camera.shake) Game.camera.shake(1.5 + min(6, a.dmg * 0.35));
      if (k.defends) { c.awareT = 8; recruitAnts(c); }
    } else if (tgt && !tgt.dead) {
      emitSfx('bite', c.x, c.y, 0.45, 0.2);
      tgt.hp -= a.dmg * 1.6; tgt.flash = 0.2; tgt.hitT = 2;
      if (tgt.hp <= 0) { kill(tgt, 'predator', c); c.fedT = 14 + rnd() * 12; c.target = null; }
      else if (tgt.state !== 'stuck') { tgt.state = 'flee'; tgt.t = 1.5; tgt.tx = c.x; tgt.ty = c.y; tgt.dashT = 0; }
    }
  }
  // Territory rival (summer invasion): a hunting spider that has moved into the Claim goes for the heirloom webs. territory.js decides which web
  // (rivalTarget) and what a raid does (rivalRaid); once the rival has been driven off (c.rival = 2) it walks away from the Home Site.
  function rivalPatrol(c, dt) {
    const T = Game.territory, k = c.k;
    if (!T || !T.active) { wander(c, dt, k.speed * 0.6, 4); return; }
    if (c.rival === 2) { const h = T.home, a = h ? atan2(c.y - h.y, c.x - h.x) : c.wa; steer(c, a + sin(S.T * 2 + c.seed * 9) * 0.25, k.chase * 0.8, dt, 5); return; }
    const w = T.rivalTarget ? T.rivalTarget(c) : null;
    if (w) {
      const tx = w.x != null ? w.x : (w.x1 + w.x2) / 2, ty = w.y != null ? w.y : (w.y1 + w.y2) / 2;
      const d = goToward(c, tx, ty, k.speed * 1.15, dt, 4, false);
      if (d < (w.r || 30) * 1.2 + c.radius + 8) { brake(c, dt, 5); if (T.rivalRaid) T.rivalRaid(c, w, dt); }   // at the web's edge it tears silk
    } else {
      wander(c, dt, k.speed * 0.6, 4);
      if (hypot(c.x - c.hx, c.y - c.hy) > 240) c.wa = atan2(c.hy - c.y, c.hx - c.x);
    }
  }
  function thinkHunter(c, dt) {
    const k = c.k, a = k.attack, P = S.P;
    c.senseT -= dt; c.cool -= dt; c.cool2 -= dt; c.awareT -= dt; c.fedT -= dt;
    if (c.senseT <= 0) { c.senseT = 0.14 + rnd() * 0.1; senseHunter(c); }
    const wantHide = (c.state === 'idle' && c.idleWhy === 'rain') ? 1 : 0;
    c.hideA += (wantHide - c.hideA) * min(1, dt * 3); c.hidden = c.hideA > 0.7;
    if (c.state !== 'windup') c.tele = max(0, c.tele - dt * 5);
    if (c.state !== 'attack') { c.atk = max(0, c.atk - dt * 4); if (c.state !== 'flee') c.hop = 0; }
    c.open = c.state === 'hunt' ? 0.5 : 0;
    switch (c.state) {
      case 'idle': brake(c, dt, 8); break;
      case 'ambush':
        brake(c, dt, 6); c.t -= dt;
        if (c.t <= 0) { // relocate to a new ambush site
          c.state = 'patrol'; c.t = 6 + rnd() * 4; const a2 = rnd() * TAU, r = 120 + rnd() * 220; c.tx = c.hx + cos(a2) * r; c.ty = c.hy + sin(a2) * r; c.wa = atan2(c.ty - c.y, c.tx - c.x);
        }
        break;
      case 'patrol': {
        if (c.rival) { rivalPatrol(c, dt); break; }
        if (k.ambusher) {
          c.t -= dt; const d = goToward(c, c.tx, c.ty, k.speed, dt, 3, true);
          if (d < 14 || c.t <= 0) { c.state = 'ambush'; c.t = 25 + rnd() * 30; c.hx = c.x; c.hy = c.y; }
        } else if (k.defends && c.grp > 0) { // ant trail between nest and forage site
          if (c.trailWait > 0) { c.trailWait -= dt; brake(c, dt, 6); }
          else {
            const tx = c.trailDir > 0 ? c.bx : c.ax, ty = c.trailDir > 0 ? c.by : c.ay;
            const dx = tx - c.x, dy = ty - c.y, d = hypot(dx, dy) || 1, weave = sin(S.T * 3 + c.seed * 20) * 0.25;
            steer(c, atan2(dy, dx) + weave, k.speed * 0.9, dt, 5);
            if (d < 16) { c.trailDir = -c.trailDir; c.trailWait = 0.5 + rnd() * 1.2; }
            if (c.blocked > 0) { c.blocked = 0; c.trailDir = -c.trailDir; }
          }
        } else if (k.defends && c.grp < 0) { // aphid tender
          c.t -= dt; wander(c, dt, k.speed * 0.45, 4);
          if (hypot(c.x - c.hx, c.y - c.hy) > 46) c.wa = atan2(c.hy - c.y, c.hx - c.x);
        } else {
          webAvoid(c, dt);
          wander(c, dt, k.speed * 0.6, 4);
          if (c.avx || c.avy) steer(c, atan2(c.avy + sin(c.wa) * 0.3, c.avx + cos(c.wa) * 0.3), k.speed * 0.7, dt, 6);
        }
        break;
      }
      case 'hunt': {
        if (!targetValid(c)) { stopHunt(c, false); break; }
        const t = c.tIsP ? P : c.target;
        const dx = t.x - c.x, dy = t.y - c.y, d = sqrt(dx * dx + dy * dy), trad = t.radius || 4;
        c.chaseT += dt;
        if (c.chaseT > k.giveUp * (c.tIsP ? 1 : 0.8) || d > k.detection * 2.6 + 80) { stopHunt(c, c.tIsP); break; }
        if (c.tIsP) {
          c.lsx = P.x; c.lsy = P.y;
          if (P.hidden && d > c.radius + P.radius * 3) { c.state = 'search'; c.t = 2.2; break; }
        }
        const trig = a.reach + c.radius + trad + (k.id === 'jumper' ? 4 : 5);
        if (d <= trig && c.cool <= 0) { c.state = 'windup'; c.t = a.windup; c.windT = a.windup; c.hitDone = false; if (k.id === 'wasp') emitSfx('wasp_buzz', c.x, c.y, 1, 0.8); else if (k.id === 'ant') emitSfx('ant_hiss', c.x, c.y, 0.7, 0.5); break; }
        let spd = k.chase;
        if (k.ambusher) spd = d > trig * 1.2 ? k.chase : 0;
        if (k.id === 'jumper' && d > 90) spd = k.chase * 0.55;           // stalking approach
        const lead = (c.tIsP ? 0.12 : 0.05);
        const gx = t.x + (t.vx || 0) * lead, gy = t.y + (t.vy || 0) * lead;
        if (spd > 0) goToward(c, gx, gy, spd * (k.flying ? 1 : (c.blocked > 0 ? 0.6 : 1)), dt, 6, c.tIsP || k.id !== 'wasp'); else { brake(c, dt, 8); faceTo(c, t.x, t.y, 6, dt); }
        // wasps / ants keep voice cues while chasing the player
        if (c.tIsP) { c.voiceT -= dt; if (c.voiceT <= 0) { c.voiceT = 1.3 + rnd(); if (d < 420) { if (k.id === 'wasp') emitSfx('wasp_buzz', c.x, c.y, 0.8); } } }
        if (c.blocked > 0) { c.blocked -= dt; if (c.blocked > 0.3) c.blocked = 0.25; }
        break;
      }
      case 'search': {
        c.t -= dt; const d = goToward(c, c.lsx, c.lsy, k.chase * 0.55, dt, 5, true);
        if (c.t <= 0 || d < 10) { c.state = k.ambusher ? 'ambush' : 'patrol'; c.cool2 = 1.5; c.target = null; c.tIsP = false; if (k.ambusher) c.t = 6; }
        break;
      }
      case 'windup': {
        c.t -= dt; c.tele = 1 - max(0, c.t) / a.windup;
        const t = c.tIsP ? P : c.target;
        if (t && !(t.dead)) faceTo(c, t.x, t.y, 14, dt);
        brake(c, dt, k.flying ? 5 : 11);
        if (c.t <= 0) {
          c.state = 'attack'; c.hitDone = false; c.tele = 1;
          const dur = k.id === 'jumper' ? 0.26 : (k.id === 'mantis' ? 0.14 : (k.id === 'wolf' ? 0.2 : 0.17));
          c.dashT = dur; c.windT = dur;
          if (t && !t.dead) {
            const dx = t.x - c.x, dy = t.y - c.y, d = hypot(dx, dy) || 1, ang = atan2(dy, dx);
            c.angle = ang;
            if (k.id !== 'mantis') { const sp = min(560, max(k.chase * a.lunge, (d + 6) / dur * 1.15)); c.vx = cos(ang) * sp; c.vy = sin(ang) * sp; }
          }
        }
        break;
      }
      case 'attack': {
        c.dashT -= dt; const prog = 1 - max(0, c.dashT) / max(0.01, c.windT);
        c.atk = k.id === 'mantis' ? 1 : prog; if (k.id === 'jumper') c.hop = sin(prog * PI);
        const t = c.tIsP ? P : c.target;
        if (!c.hitDone && t && !t.dead) {
          const d = hypot(t.x - c.x, t.y - c.y), trad = t.radius || 4;
          const contact = (k.id === 'mantis' ? a.reach : a.reach * 0.45) + c.radius + trad;
          if (d <= contact) { c.hitDone = true; applyHit(c, t); }
        }
        if (c.dashT <= 0) {
          c.state = 'recover'; c.t = a.cooldown * (c.hitDone ? 1 : 0.7); c.cool = 0; c.tele = 0; c.hop = 0;
          if (!c.hitDone && c.tIsP && k.id !== 'mantis') { brake(c, dt, 20); }
        }
        break;
      }
      case 'recover': {
        c.t -= dt; c.atk = max(0, c.atk - dt * 3);
        const t = c.tIsP ? P : c.target;
        if (t && !t.dead && (k.id === 'wasp' || k.id === 'jumper') && c.t > a.cooldown * 0.35) {
          steer(c, atan2(c.y - t.y, c.x - t.x) + sin(S.T * 6) * 0.5, k.chase * 0.75, dt, 6);      // hit-and-run
        } else if (k.id === 'ant' && t && !t.dead) {
          goToward(c, t.x, t.y, k.speed * 0.6, dt, 5, false);
        } else brake(c, dt, 5);
        if (c.t <= 0) { if (targetValid(c)) { c.state = 'hunt'; } else stopHunt(c, false); }
        break;
      }
      case 'flee': {
        c.t -= dt;
        c.ang2 += (rnd() - 0.5) * dt * 6; c.ang2 = clamp(c.ang2, -0.7, 0.7);
        steer(c, atan2(c.y - c.ty, c.x - c.tx) + c.ang2, k.flee, dt, 7);
        if (c.t <= 0) { c.state = k.ambusher ? 'ambush' : 'patrol'; c.cool2 = 3; }
        break;
      }
      default: c.state = k.ambusher ? 'ambush' : 'patrol';
    }
    // mantis sways a little while waiting; flyers hover
    setFlying(c, dt);
    if (k.flying && c.state === 'idle') { c.flying = false; c.altT = 0; }
    integrate(c, dt);
  }

  // ================================================================= AI: boss + venom
  // The boss's brain lives in boss.js (it sets c.vx / c.vy / c.angle and the pose fields c.tele / c.atk / c.open); here we only move the body.
  function thinkBoss(c, dt) {
    c.noTurn = true;   // boss.js decides where she faces (integrate() would turn her to face her velocity)
    const B = Game.boss;
    if (B && B.think) B.think(c, dt); else brake(c, dt, 8);
    integrate(c, dt);
  }
  // A Black Widow's bite leaves poison working: for VENOM_T seconds the prey takes damage over time and is slowed. Returns true if it died of it.
  const VENOM_T = 4;
  function venomTick(c, dt) {
    c.venomT -= dt;
    if (c.k.boss) { c.venomT = 0; c.venomDps = 0; return false; }
    c.hp -= c.venomDps * dt; c.hitT = max(c.hitT, 0.6);
    if (c.hp <= 0) { kill(c, 'player'); return true; }   // credited to the player, so the meal still feeds them
    const f = Math.exp(-2.2 * dt); c.vx *= f; c.vy *= f;
    if (c.venomT <= 0) c.venomDps = 0;
    return false;
  }

  // ================================================================= AI: stuck in a web
  function thinkStuck(c, dt) {
    const k = c.k;
    c.stuckT -= dt; brake(c, dt, 20);
    const strong = clamp(c.radius / 14, 0.2, 1);
    c.struggle = 0.35 + 0.45 * abs(sin(S.T * (5 + c.seed * 4))) + (c.stuckT < 3 ? 0.2 : 0);
    c.struggleSfx -= dt;
    if (c.struggleSfx <= 0) { c.struggleSfx = 0.8 + rnd() * 0.9; const dx = c.x - S.px, dy = c.y - S.py; if (dx * dx + dy * dy < 700 * 700) emitSfx('struggle', c.x, c.y, 0.4 + strong * 0.3); }
    // web gone? (destroyed / faded)
    c.t -= dt;
    if (c.t <= 0) {
      c.t = 0.5;
      const w = c.stuckWeb, W = Game.webs;
      if (w && (w.dead || w.dying || (typeof w.integrity === 'number' && w.integrity <= 0.001) || (W && W.list && W.list.indexOf && W.list.indexOf(w) < 0))) { breakFree(c); return; }
      if (!w) { breakFree(c); return; }
    }
    if (c.stuckT <= 0) { breakFree(c); return; }
    c.mv = 0.5; c.ph += dt * 30;
    c.alt += (0 - c.alt) * min(1, dt * 8);
  }

  // ================================================================= AI: kin spiderlings
  // Siblings earn their keep two ways:
  //  - LOOKOUTS: a sibling that notices a hunter (within LOOKOUT_R) which would go for the player raises an alarm - a sound,
  //    a bump in `danger` and an entry in `creatures.alarms` that the HUD turns into an arrow toward the last-seen spot.
  //    They see further than the player's own screen, so the warning arrives before the predator does.
  //  - HUDDLE: while the player rests the siblings tuck in close, facing outward. `creatures.huddle` counts the ones within
  //    reach (max HUDDLE_MAX) and player.js lets each one speed recovery and slow the drain on hunger and water.
  const LOOKOUT_R = 260, FLEE_R = 190, ALARM_LIFE = 4, ALARM_DANGER = 0.4, MAX_ALARMS = 4, HUDDLE_R = 60, HUDDLE_MAX = 3;
  // a sibling noticed hunter h: add or refresh its alarm. A new alarm also gets a sound, a "!" over the sibling and a `kin:alarm` event.
  function raiseAlarm(c, h) {
    const A = S.alarms;
    for (let i = 0; i < A.length; i++) if (A[i].id === h.id) { A[i].x = h.x; A[i].y = h.y; A[i].life = ALARM_LIFE; return; }
    if (A.length >= MAX_ALARMS) A.shift();
    A.push({ id: h.id, kind: h.kind, x: h.x, y: h.y, life: ALARM_LIFE });
    c.alertT = 1.1; c.alertCol = '#ff5a3a';
    emitSfx('danger', c.x, c.y, 0.5, 2.5);
    Game.emit('kin:alarm', { kind: h.kind, x: h.x, y: h.y });
  }
  function tickAlarms(dt) {
    const A = S.alarms;
    for (let i = A.length - 1; i >= 0; i--) { A[i].life -= dt; if (A[i].life <= 0) A.splice(i, 1); }
  }
  // how many siblings are close enough to huddle with the player (settled ones only: a fleeing sibling isn't keeping you warm)
  function huddleTick() {
    const P = S.P; let n = 0;
    if (P && !P.dead && S.playing) {
      const r = HUDDLE_R * (0.6 + P.radius / 14), r2 = r * r;
      for (let i = 0; i < list.length && n < HUDDLE_MAX; i++) {
        const c = list[i]; if (c.dead || c.kind !== 'kin' || c.disperse || c.sac || c.state === 'flee') continue;
        const dx = c.x - P.x, dy = c.y - P.y; if (dx * dx + dy * dy < r2) n++;
      }
    }
    S.huddle = n;
  }
  // ---- SACRIFICE: when a blow would kill the player, player.js asks for a sibling (claimSibling). That sibling runs in, settles on the
  //      player and glows (SAC_GIVE s), then gives its life: it vanishes in a burst of light, hunters nearby are startled off, and
  //      `kin:sacrifice` tells player.js to bring the spider back. One sibling per revive. While claimed (c.sac): 1 = running in,
  //      2 = giving. A claimed sibling is hidden from hunters and can't be hurt, so the revive always completes.
  const SAC_SPEED = 320, SAC_RUN_MAX = 2.2, SAC_GIVE = 0.8, SAC_STARTLE_R = 300;
  // siblings still with the player: alive, not drifting away, not already giving their life
  function siblingCount() {
    let n = 0;
    for (let i = 0; i < list.length; i++) { const c = list[i]; if (!c.dead && c.kind === 'kin' && !c.disperse && !c.sac) n++; }
    return n;
  }
  function claimSibling(x, y) {
    let best = null, bd = 1e18;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; if (c.dead || c.kind !== 'kin' || c.disperse || c.sac) continue;
      const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    best.sac = 1; best.sacT = 0; best.hidden = true; best.alertT = 0; best.gatherT = 0; best.target = null;
    return best;
  }
  // the burst of light startles hunters close by: they back off for a few seconds so the revived spider can get away
  function startle(x, y, r) {
    const r2 = r * r; let n = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; if (c.dead || c.k.ai !== 'hunter' || c.state === 'stuck') continue;
      const dx = c.x - x, dy = c.y - y; if (dx * dx + dy * dy > r2) continue;
      fleeFrom(c, x, y, 2.4 + rnd() * 1.2); c.alertT = 0.6; c.alertCol = '#ffd24a'; c.awareT = 0; c.cool2 = 4 + rnd() * 2; n++;
    }
    return n;
  }
  function sacrificeKin(c, dt) {
    const P = S.P;
    if (!P) { c.sac = 0; c.hidden = false; return; }   // no player to give to (scene changed): back to being a normal sibling
    c.sacT += dt; c.alertT = 0; c.state = 'wander'; c.hidden = true;
    // it hovers at its own spot beside the spider (so the glow shows on screen rather than under the spider's body)
    const gx = P.x + cos(c.seed * TAU) * P.radius * 1.3, gy = P.y + sin(c.seed * TAU) * P.radius * 1.3;
    const dx = gx - c.x, dy = gy - c.y, d = hypot(dx, dy);
    if (c.sac === 1) {
      if (d <= c.radius + 2 || c.sacT > SAC_RUN_MAX) {
        c.sac = 2; c.sacT = 0; startle(P.x, P.y, SAC_STARTLE_R);
        emitSfx('rest', c.x, c.y, 0.8);
      } else { steer(c, atan2(dy, dx), SAC_SPEED, dt, 14); integrate(c, dt); return; }
    }
    // giving: settle onto the player and glow brighter until the gift lands
    const e = min(1, dt * 7); c.x += dx * e; c.y += dy * e; c.vx = c.vy = 0; faceTo(c, P.x, P.y, 6, dt);
    if (c.sacT >= SAC_GIVE) {
      const x = P.x, y = P.y;
      addFx('revive', x, y, P.radius * 7, 1.2);
      c.sac = 3; removeQuiet(c);
      Game.emit('kin:sacrifice', { creature: c, x, y, left: siblingCount() });
    }
  }
  function drawSacGlow(ctx, c) {
    const g = c.sac === 2 ? 0.45 + 0.55 * clamp(c.sacT / SAC_GIVE, 0, 1) : 0.3 + min(0.15, c.sacT * 0.3), r = c.radius * (4 + g * 6);
    const grd = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    grd.addColorStop(0, 'rgba(255,240,190,' + (0.85 * g) + ')'); grd.addColorStop(0.4, 'rgba(255,205,110,' + (0.4 * g) + ')'); grd.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill(); ctx.restore();
  }
  function thinkKin(c, dt) {
    if (c.sac) { sacrificeKin(c, dt); return; }
    const k = c.k, P = S.P, alive = !!(P && !P.dead);
    c.senseT -= dt; c.gatherT -= dt;
    const pr = P ? P.radius : 5;
    c.radius += (pr * 0.72 - c.radius) * min(1, dt * 0.4);
    if (c.senseT <= 0) {
      c.senseT = 0.2 + rnd() * 0.1;
      const hm = HUNTERS[c.ki] & NOBIRD;
      const h = hm ? findNearest(c.x, c.y, LOOKOUT_R, hm, c, true, false) : null;
      if (h && h.state !== 'idle' && !(h.k.ambusher && h.state === 'ambush')) {
        if (alive && hostileToPlayer(h, P)) raiseAlarm(c, h);
        if (hypot(h.x - c.x, h.y - c.y) < FLEE_R) {   // close enough to bolt
          if (c.state !== 'flee') {
            c.alertT = 1.1; c.alertCol = '#ff5a3a';
            if (alive && hypot(P.x - c.x, P.y - c.y) < 380) emitSfx('danger', c.x, c.y, 0.45, 2.5);
          }
          c.state = 'flee'; c.t = 1.4; c.tx = h.x; c.ty = h.y;
        }
      }
    }
    if (c.state === 'flee') {
      c.t -= dt; steer(c, atan2(c.y - c.ty, c.x - c.tx) + sin(S.T * 8 + c.seed * 9) * 0.35, k.flee, dt, 8);
      if (c.t <= 0) c.state = 'wander';
    } else if (c.disperse) {
      steer(c, c.wa, k.speed * 0.6, dt, 3); c.state = 'wander';
      const dx = c.x - S.cx, dy = c.y - S.cy;
      if (dx * dx + dy * dy > 520 * 520 && !Game.camera.inView(c.x, c.y, 80)) removeQuiet(c);
    } else if (alive) {
      const huddle = !!P.resting, ang = c.seed * TAU;
      let gx, gy, hold = 0;
      if (huddle) { const dist = (10 + c.seed * 16) * (0.6 + pr / 14); gx = P.x + cos(ang) * dist; gy = P.y + sin(ang) * dist; hold = 3; }
      else if (c.gatherT > 0) { gx = c.gx + cos(c.ph * 0 + c.seed * TAU) * 14; gy = c.gy + sin(c.seed * TAU) * 14; hold = 6; }
      else { const a2 = ang + S.T * 0.15 * (c.seed > 0.5 ? 1 : -1), dist = (28 + c.seed * 70) * (0.6 + pr / 14); gx = P.x + cos(a2) * dist; gy = P.y + sin(a2) * dist; hold = 10; }
      const dx = gx - c.x, dy = gy - c.y, d = hypot(dx, dy);
      if (d > 900) { removeQuiet(c); return; }
      if (d > hold) steer(c, atan2(dy, dx) + sin(S.T * 2 + c.seed * 9) * 0.2, k.speed * clamp(d / 70, 0.25, 1.9), dt, 6);
      else if (huddle) { brake(c, dt, 6); faceTo(c, P.x + cos(ang) * 80, P.y + sin(ang) * 80, 3, dt); }   // tucked in, facing outward on watch
      else { brake(c, dt, 6); if (c.gatherT <= 0 && rnd() < dt * 0.4) c.angle += (rnd() - 0.5) * 1.6; }
    } else brake(c, dt, 5);
    integrate(c, dt);
  }

  // ================================================================= AI: the suitor
  const MATE_FEAR = KINDS.wolf.bit | KINDS.centipede.bit | KINDS.wasp.bit | KINDS.mantis.bit | KINDS.jumper.bit | KINDS.rove.bit | KINDS.ground.bit;
  function thinkMate(c, dt) {
    const k = c.k, P = S.P;
    c.senseT -= dt;
    c.radius += (17 - c.radius) * min(1, dt * 0.5);
    let near = false, d = 9999;
    if (P) { d = hypot(P.x - c.x, P.y - c.y); near = d < 380; }
    if (c.senseT <= 0) {
      c.senseT = 0.25;
      const h = findNearest(c.x, c.y, 260, MATE_FEAR, c, true, false);
      if (h && h.state !== 'idle' && !(h.k.ambusher && h.state === 'ambush')) { c.state = 'flee'; c.t = 2.2; c.tx = h.x; c.ty = h.y; if (c.alertT <= 0) { c.alertT = 0.8; c.alertCol = '#ff5a3a'; } }
      if (!c.found && P && d < 230 && Game.camera.inView(c.x, c.y, 0)) { c.found = true; Game.emit('mate:found'); }
    }
    c.alpha = 1;
    if (c.state === 'flee') {
      c.t -= dt; steer(c, atan2(c.y - c.ty, c.x - c.tx), k.flee, dt, 7);
      if (c.t <= 0) c.state = 'wander';
    } else if (c.courted || (near && d < 520)) {
      // display: face the suitor, wave legs, hold still
      brake(c, dt, 6); if (P) faceTo(c, P.x, P.y, 3, dt); c.state = 'wave'; c.open = 1;
      if (!c.courted && d > 120 && d < 520 && !(P && P.dead)) { /* coy: edge a little closer, then hold */ }
    } else {
      if (c.state === 'wave') { c.state = 'wander'; c.t = 0; }
      c.state = 'wander'; wander(c, dt, k.speed * 0.5, 3);
      if (hypot(c.x - c.hx, c.y - c.hy) > 280) c.wa = atan2(c.hy - c.y, c.hx - c.x);
    }
    integrate(c, dt);
    c.mv = max(c.mv, c.state === 'wave' ? 0.35 : 0);
    if (c.state === 'wave') c.ph += dt * 6;
  }

  // ================================================================= AI: the bird
  const fxList = [];   // small visual effects: dust puffs / strike rings {x,y,t,dur,r,kind}
  function addFx(kind, x, y, r, dur) { if (fxList.length > 30) fxList.shift(); fxList.push({ kind, x, y, r, t: 0, dur }); }

  function pickBirdPrey(c) {
    let best = null, bd = 1e18; const P = S.P;
    const n = list.length, start = (rnd() * n) | 0;
    for (let q = 0; q < n; q++) {
      const o = list[(start + q) % n];
      if (o.dead || o.role !== 'prey' || o.hidden || o.state === 'idle' && o.hideA > 0.3 || o.flying) continue;
      if (!(KINDS.bird.eatMask & o.bit)) continue;
      const dx = o.x - S.cx, dy = o.y - S.cy, d = dx * dx + dy * dy;
      if (d > 850 * 850) continue;
      if (expo(o.x, o.y) < 0.55) continue;
      if (d < bd || rnd() < 0.15) { bd = d; best = o; if (rnd() < 0.5) break; }
    }
    return best;
  }
  function spawnBird() {
    const P = S.P; if (!P || S.birdAlive) return null;
    const pExposed = !P.dead && !P.hidden && expo(P.x, P.y) > 0.55;
    let tgt = null, tgtP = false;
    if (pExposed && rnd() < 0.78) tgtP = true; else { tgt = pickBirdPrey(); if (!tgt) { if (pExposed) tgtP = true; else return null; } }
    const a = rnd() * TAU, dist = 780 + rnd() * 160;
    let sx = (tgtP ? P.x : tgt.x) + cos(a) * dist, sy = (tgtP ? P.y : tgt.y) + sin(a) * dist;
    sx = clamp(sx, 60, C.WORLD_W - 60); sy = clamp(sy, 60, C.WORLD_H - 60);
    const c = create(KINDS.bird, sx, sy, { instant: true });
    if (!c) return null;
    c.state = 'approach'; c.flying = true; c.noSci = true; c.tIsP = tgtP; c.target = tgt; c.targetId = tgt ? tgt.id : 0;
    c.radius = 26; c.shadowA = 0; c.shadowS = 2; c.skyA = 0; c.alt = 190; c.lockT = 0; c.phaseT = 0; c.strikeR = 34 + S.stage * 3; c.t = 0; c.t2 = 0;
    c.angle = atan2((tgtP ? P.y : tgt.y) - sy, (tgtP ? P.x : tgt.x) - sx);
    S.birdAlive = c;
    return c;
  }
  function birdStrike(c) {
    const P = S.P; let hit = 0;
    const lx = c.lockX, ly = c.lockY, R = c.strikeR;
    if (P && !P.dead && !P.hidden && expo(P.x, P.y) > 0.55 && hypot(P.x - lx, P.y - ly) < R + P.radius * 0.4) {
      const dmg = clamp(0.34 * (P.maxHp || 60), 14, 56);
      const actual = P.damage ? P.damage(dmg, 'bird') : 0;
      Game.emit('creature:attack', { creature: c, damage: actual || 0 }); hit = 1;
      if (Game.camera && Game.camera.shake) Game.camera.shake(9);
    }
    let kills = 0;
    for (let i = 0; i < list.length && kills < 4; i++) {
      const o = list[i];
      if (o.dead || o === c || !(o.role === 'prey' || o.role === 'spider') || o.hidden || o.k.unique) continue;
      if (hypot(o.x - lx, o.y - ly) < R + o.radius * 0.5 && expo(o.x, o.y) > 0.5) { if (kill(o, 'predator', c)) kills++; }
    }
    c.hitRes = hit;
    emitSfx('bird_screech', lx, ly, 1);
    addFx(hit || kills ? 'hit' : 'puff', lx, ly, R, 0.7);
  }
  function thinkBird(c, dt) {
    const P = S.P, k = c.k;
    c.age += 0; c.phaseT += dt; c.flying = true;
    const ground = (c.tIsP ? P : c.target);
    let tx, ty;
    if (c.state === 'approach' || c.state === 'lock') {
      if (c.tIsP) { if (!P || P.dead) { c.state = 'leave'; c.phaseT = 0; return; } tx = P.x; ty = P.y; }
      else if (c.target && !c.target.dead && c.target.id === c.targetId) { tx = c.target.x; ty = c.target.y; }
      else { const p = pickBirdPrey(); if (p) { c.target = p; c.targetId = p.id; tx = p.x; ty = p.y; } else { c.state = 'leave'; c.phaseT = 0; return; } }
    }
    switch (c.state) {
      case 'approach': {
        const dx = tx - c.x, dy = ty - c.y, d = hypot(dx, dy);
        c.shadowA = min(1, c.phaseT / 1.2);
        c.shadowS = 1.15 + clamp(d / 520, 0, 1) * 0.85;
        c.tele = clamp(1 - d / 500, 0, 1);
        // cover saves you: if the player went under cover the bird loses interest
        if (c.tIsP && (P.hidden || expo(P.x, P.y) < 0.4)) { c.t2 += dt; if (c.t2 > 1.6) { c.tIsP = false; c.target = pickBirdPrey(); c.targetId = c.target ? c.target.id : 0; c.t2 = 0; if (!c.target) { c.state = 'leave'; c.phaseT = 0; break; } } } else c.t2 = max(0, c.t2 - dt);
        const sp = 100 + (S.stage >= 3 ? 15 : 0);
        c.angle = U.turnToward(c.angle, atan2(dy, dx), 1.2 * dt);
        c.vx = cos(c.angle) * sp; c.vy = sin(c.angle) * sp;
        c.x += c.vx * dt; c.y += c.vy * dt;
        c.alt = 190; c.skyA = 0;
        if (c.phaseT > 0.4 && c.phaseT < 0.45) emitSfx('danger', c.x, c.y, 0.5, 6);
        if (d < 150 && c.phaseT > 2.2) { c.state = 'lock'; c.phaseT = 0; c.lockT = 0; c.lockX = tx + (c.tIsP ? P.vx * 0.2 : (c.target ? c.target.vx * 0.2 : 0)); c.lockY = ty + (c.tIsP ? P.vy * 0.2 : (c.target ? c.target.vy * 0.2 : 0)); emitSfx('danger', c.x, c.y, 0.8, 1.5); }
        else if (c.phaseT > 22) { c.state = 'leave'; c.phaseT = 0; }
        break;
      }
      case 'lock': {
        c.lockT = clamp(c.phaseT / 0.95, 0, 1);
        c.shadowA = 1; c.shadowS = 1.15 - 0.1 * c.lockT; c.tele = 1;
        const dx = c.lockX - c.x, dy = c.lockY - c.y;
        c.vx = dx * 3; c.vy = dy * 3; c.x += c.vx * dt; c.y += c.vy * dt; c.angle = U.turnToward(c.angle, atan2(dy, dx), 4 * dt);
        if (c.phaseT >= 0.95) { c.state = 'dive'; c.phaseT = 0; emitSfx('bird_screech', c.lockX, c.lockY, 1); }
        break;
      }
      case 'dive': {
        const q = clamp(c.phaseT / 0.38, 0, 1), e = q * q;
        c.x = lerp(c.x, c.lockX, min(1, dt * 14)); c.y = lerp(c.y, c.lockY, min(1, dt * 14));
        c.alt = lerp(160, 4, e); c.skyA = min(1, q * 5); c.skyS = lerp(2.0, 1.1, e); c.atk = e; c.shadowA = 1; c.shadowS = 1.1; c.tele = 1; c.lockT = 1;
        if (q >= 1) { birdStrike(c); c.state = 'leave'; c.phaseT = 0; c.atk = 0; }
        break;
      }
      case 'leave': {
        const away = P ? atan2(c.y - P.y, c.x - P.x) : c.angle;
        c.angle = U.turnToward(c.angle, away + 0.3, 2 * dt);
        const sp = 210; c.vx = cos(c.angle) * sp; c.vy = sin(c.angle) * sp; c.x += c.vx * dt; c.y += c.vy * dt;
        c.alt = min(260, c.alt + 280 * dt * (c.phaseT > 0.1 ? 1 : 0.2)); c.skyS = 1.1 + c.alt / 150;
        c.shadowA = max(0, c.shadowA - dt * 1.8); c.skyA = c.skyA > 0 ? max(0, 1 - c.phaseT / 1.6) : 0; c.tele = 0; c.lockT = max(0, c.lockT - dt * 3); c.atk = 0;
        if (c.phaseT > 2.0 || c.x < -50 || c.y < -50 || c.x > C.WORLD_W + 50 || c.y > C.WORLD_H + 50) removeQuiet(c);
        break;
      }
      default: c.state = 'leave'; c.phaseT = 0;
    }
    c.zone = ZONE_IDS[zoneIdx(c.x)];
  }
  function birdTick(dt) {
    const P = S.P;
    if (!P || P.dead || !S.playing) return;
    S.birdT -= dt;
    if (S.birdT > 0 || S.birdAlive) return;
    const zi = zoneIdx(P.x), stage = S.stage;
    // hatchling zone is nearly safe: no birds before the first molt. Litter only from stage 2.
    let ok = stage >= 1 && S.rain < 0.45 && S.phase !== 'night' && S.T > 90;
    if (zi === 0 && stage < 2) ok = false;
    { const hp = hatchPt(); if (zi === 0 && hypot(P.x - hp.x, P.y - hp.y) < 900) ok = false; }
    if (!ok) { S.birdT = 6 + rnd() * 6; return; }
    const base = zi === 2 ? 26 : (zi === 1 ? 48 : 75);
    const mul = S.phase === 'dusk' ? 1.5 : (S.phase === 'dawn' ? 1.1 : 1) * (stage >= 3 ? 0.85 : 1);
    const sm = territoryOn() && Game.territory.popMul ? (Game.territory.popMul('bird') || 1) : 1;   // Territory: more birds in autumn
    if (spawnBird()) S.birdT = (base + rnd() * base * 0.8) * mul / sm; else S.birdT = 8 + rnd() * 6;
  }

  // ================================================================= population management
  const SPOS = { x: 0, y: 0 };
  const spCache = {};
  function spawnHints(zone, kid) {
    const key = zone + '|' + kid;
    if (key in spCache) return spCache[key];
    let r = null;
    try { const w = S.w; if (w && w.spawnPoints) { const a = w.spawnPoints(zone, kid); if (a && a.length) r = a; } } catch (e) { r = null; }
    spCache[key] = r; return r;
  }
  // mode: 0 = ring outside the view, 1 = anywhere in the active disc (initial fill), 2 = just outside view (pity)
  function pickSpawnPos(k, mode) {
    const cx = S.cx, cy = S.cy, R = S.R;
    let rin = mode === 1 ? 70 : S.rin, rout = mode === 2 ? min(R, S.rin + 160) : R;
    const sh = S.share, pop = k.pop;
    for (let attempt = 0; attempt < 12; attempt++) {
      let x, y, got = false;
      if (attempt < 4 && S.w && S.w.spawnPoints) {
        // zone choice weighted by share * density
        let w0 = sh[0] * pop.d[0], w1 = sh[1] * pop.d[1], w2 = sh[2] * pop.d[2]; let r = rnd() * (w0 + w1 + w2 + 1e-6);
        const zi = r < w0 ? 0 : (r < w0 + w1 ? 1 : 2);
        const arr = spawnHints(ZONE_IDS[zi], k.id);
        if (arr) { const p = arr[(rnd() * arr.length) | 0]; x = p.x; y = p.y; got = true; const d = hypot(x - cx, y - cy); if (d < rin || d > rout) got = false; }
      }
      if (!got) { const a = rnd() * TAU, r = rin + sqrt(rnd()) * (rout - rin); x = cx + cos(a) * r; y = cy + sin(a) * r; }
      if (x < 40 || y < 40 || x > C.WORLD_W - 40 || y > C.WORLD_H - 40) continue;
      if (pop.d[zoneIdx(x)] <= 0) continue;
      if (Game.boss && Game.boss.inArena && Game.boss.inArena(x, y, 140)) continue;   // nothing wanders into the Matriarch's arena
      if (mode !== 1 && Game.camera.inView(x, y, 70)) continue;
      if (k.role === 'predator' && S.stage === 0) { const hp = hatchPt(); if (hypot(x - hp.x, y - hp.y) < 1100) continue; }
      if (S.P && mode !== 1 && hypot(x - S.P.x, y - S.P.y) < rin * 0.9) continue;
      if (mode === 1) { const hp = hatchPt(); if (hypot(x - hp.x, y - hp.y) < 50) continue; }
      if (!k.isFlyer && S.w && S.w.resolve) { const p = S.w.resolve(x, y, min(k.radius, 8)); if (p) { if (hypot(p.x - x, p.y - y) > 26) continue; x = p.x; y = p.y; } }
      SPOS.x = x; SPOS.y = y; return true;
    }
    return false;
  }
  function initAI(c) {
    const k = c.k;
    if (k.id === 'mantis') { c.state = 'ambush'; c.t = 8 + rnd() * 30; }
    else if (k.id === 'bird') c.state = 'approach';
    else if (k.ai === 'hunter') c.state = 'patrol';
    else c.state = 'wander';
    if (k.flying) { c.flying = true; c.altT = k.altBase; c.alt = k.altBase; }
  }
  KIND_LIST.forEach(k => { k.ai = k.boss ? 'boss' : (k.id === 'bird' ? 'bird' : (k.id === 'kin' ? 'kin' : (k.id === 'mate' ? 'mate' : ((k.role === 'predator' || k.defends) ? 'hunter' : 'prey')))); });
  function spawn(kindId, x, y, opts) {
    const k = KINDS[kindId]; if (!k) return null;
    const c = create(k, x, y, opts); if (!c) return null;
    initAI(c);
    if (opts) {
      if (opts.state) c.state = opts.state;
      if (opts.hp != null) { c.hp = opts.hp; c.maxHp = max(c.maxHp, opts.hp); }
      if (opts.radius != null) c.radius = opts.radius;
    }
    return c;
  }
  function spawnGroup(k, mode, want) {
    if (!pickSpawnPos(k, mode)) return 0;
    const x0 = SPOS.x, y0 = SPOS.y, inst = mode === 1;
    const g = k.pop.g; let n = g[0] + ((rnd() * (g[1] - g[0] + 1)) | 0);
    n = min(n, max(1, want | 0));
    let made = 0;
    if (k.id === 'ant') { // a foraging column along a trail
      const a = rnd() * TAU, len = 180 + rnd() * 240; let bx = x0 + cos(a) * len, by = y0 + sin(a) * len;
      bx = clamp(bx, 80, C.WORLD_W - 80); by = clamp(by, 80, C.WORLD_H - 80);
      for (let i = 0; i < n; i++) {
        const q = rnd(), x = lerp(x0, bx, q) + (rnd() - 0.5) * 14, y = lerp(y0, by, q) + (rnd() - 0.5) * 14;
        const c = spawn('ant', x, y, { instant: inst }); if (!c) break;
        c.grp = 1; c.ax = x0; c.ay = y0; c.bx = bx; c.by = by; c.trailDir = rnd() < 0.5 ? 1 : -1; c.hx = x0; c.hy = y0; c.angle = atan2(by - y0, bx - x0) + (c.trailDir > 0 ? 0 : PI); c.wa = c.angle; made++;
      }
    } else {
      const spread = k.id === 'aphid' ? 30 : (k.id === 'midge' ? 46 : 26);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, r = sqrt(rnd()) * spread;
        const c = spawn(k.id, x0 + cos(a) * r, y0 + sin(a) * r, { instant: inst }); if (!c) break;
        c.hx = x0; c.hy = y0; made++;
        if (k.id === 'aphid') c.radius *= (0.7 + rnd() * 0.5);
      }
      if (k.id === 'aphid' && rnd() < 0.5 && S.count[KINDS.ant.idx] < KINDS.ant.pop.cap) { // ants tend the aphids for honeydew
        for (let i = 0; i < 1 + ((rnd() * 2) | 0); i++) { const c = spawn('ant', x0 + (rnd() - 0.5) * 50, y0 + (rnd() - 0.5) * 50, { instant: inst }); if (c) { c.grp = -1; c.hx = x0; c.hy = y0; made++; } }
      }
    }
    return made;
  }
  function updateShares() {
    const R = S.R, cx = S.cx, cy = S.cy, z0 = C.ZONES[0].x1, z1 = C.ZONES[1].x1;
    let a0 = 0, a1 = 0, a2 = 0; const n = 24, dx = 2 * R / n;
    for (let i = 0; i < n; i++) {
      const x = cx - R + (i + 0.5) * dx; if (x < 0 || x > C.WORLD_W) continue;
      const h = sqrt(max(0, R * R - (x - cx) * (x - cx))), y0 = max(0, cy - h), y1 = min(C.WORLD_H, cy + h), area = (y1 - y0) * dx;
      if (area <= 0) continue;
      if (x < z0) a0 += area; else if (x < z1) a1 += area; else a2 += area;
    }
    S.share[0] = a0 / 1e6; S.share[1] = a1 / 1e6; S.share[2] = a2 / 1e6;
  }
  function computeTargets() {
    const stage = S.stage, ph = S.phase, sh = S.share;
    const early = S.T < 300 ? 1.25 : 1;
    const T = Game.territory, seasonal = (T && T.active && T.popMul) ? (k) => T.popMul(k) : null;
    for (let i = 0; i < POP_KINDS.length; i++) {
      const k = POP_KINDS[i], p = k.pop;
      let n = (p.d[0] * sh[0] + p.d[1] * sh[1] + p.d[2] * sh[2]) * p.s[stage];
      switch (k.activity) {
        case 'night': n *= ph === 'night' ? 1.5 : (ph === 'dusk' ? 1.2 : (ph === 'dawn' ? 0.6 : 0.4)); break;
        case 'day': n *= ph === 'night' ? 0.25 : (ph === 'dusk' ? 0.7 : 1.15); break;
        case 'crepuscular': n *= (ph === 'dusk' || ph === 'dawn') ? 1.6 : 1; break;
      }
      if (k.pop.s[0] > 0 && k.role === 'prey' && k.tier === 0) n *= early;
      if (S.rain > 0.5 && k.id === 'wasp') n *= 0.4;
      if (seasonal) n *= seasonal(k) || 0;   // Territory: prey follows the seasons (winter: little, and no flyers)
      S.target[k.idx] = min(p.cap, n);
    }
  }
  const EASY = [[0, ['springtail', 'mite', 'midge']], [1, ['springtail', 'mite', 'midge', 'aphid', 'fruitfly', 'pillbug']], [2, ['pillbug', 'cricket', 'springtail', 'caterpillar', 'beetle', 'moth']], [3, ['grasshopper', 'caterpillar', 'moth', 'cricket', 'beetle']], [4, ['grasshopper', 'caterpillar', 'moth', 'cricket']]];
  function pityTick() {
    const P = S.P; if (!P || P.dead) return;
    const pr = P.radius || 5;
    let n = 0;
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o.dead || o.role !== 'prey') continue; const dx = o.x - P.x, dy = o.y - P.y; if (dx * dx + dy * dy < 440 * 440 && o.radius <= pr * 1.2 && !o.k.defends) n++; }
    if (n >= 4 || list.length >= MAXC) return;
    const ids = EASY[min(4, S.stage)][1]; const zi = zoneIdx(P.x);
    for (let tries = 0; tries < 4; tries++) {
      const k = KINDS[ids[(rnd() * ids.length) | 0]];
      if (!k.pop || k.pop.d[zi] <= 0 || k.pop.s[S.stage] <= 0) continue;
      if (spawnGroup(k, 2, 3)) return;
    }
  }
  function populationTick(dt) {
    S.shareT -= dt;
    if (S.shareT <= 0) { S.shareT = 0.5; updateShares(); computeTargets(); }
    S.count.fill(0);
    for (let i = 0; i < list.length; i++) { const c = list[i]; if (!c.dead) S.count[c.ki]++; }
    const total = list.length;
    // ---- spawn (at most one group per tick)
    if (total < MAXC - 6) {
      let sum = 0;
      for (let i = 0; i < POP_KINDS.length; i++) { const k = POP_KINDS[i], d = S.target[k.idx] - S.count[k.idx]; if (d >= 0.6) sum += d; }
      if (sum > 0) {
        let r = rnd() * sum, pick = null, want = 1;
        for (let i = 0; i < POP_KINDS.length; i++) { const k = POP_KINDS[i], d = S.target[k.idx] - S.count[k.idx]; if (d >= 0.6) { r -= d; if (r <= 0) { pick = k; want = d; break; } } }
        if (pick) spawnGroup(pick, 0, ceil(want));
      }
    }
    // ---- despawn far / excess creatures (never in view)
    const R2 = S.R * 1.22, R2s = R2 * R2, near2 = (S.R * 0.7) * (S.R * 0.7);
    const nCheck = min(list.length, 22);
    for (let q = 0; q < nCheck; q++) {
      S.cursor = (S.cursor + 1) % max(1, list.length);
      const c = list[S.cursor]; if (!c || c.dead || c.k.noRespawn || c.k.unique || c.k.id === 'bird' || c.state === 'stuck' || c.rival) continue;
      const dx = c.x - S.cx, dy = c.y - S.cy, d2 = dx * dx + dy * dy;
      if (d2 > R2s && !Game.camera.inView(c.x, c.y, 160)) { removeQuiet(c); continue; }
      const tg = S.target[c.ki];
      if (c.k.pop && S.count[c.ki] > tg * 1.35 + 2 && d2 > near2 && !Game.camera.inView(c.x, c.y, 220)) { removeQuiet(c); S.count[c.ki]--; }
    }
  }
  function ceil(v) { return Math.ceil(v); }

  const KIN_START = 5;
  // how many siblings should be around: they drift away as a Brood spider grows; in Territory the lineage's heirs stay (up to KIN_START are shown)
  function kinWanted() {
    if (territoryOn() && Game.territory.lineage) return min(KIN_START, max(0, Game.territory.lineage.heirs | 0));
    return [5, 4, 3, 1, 0][min(4, S.stage)];
  }
  function spawnKin(n, cx, cy) {
    const hp = hatchPt(); cx = cx == null ? hp.x : cx; cy = cy == null ? hp.y : cy;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = 22 + rnd() * 50;
      let x = cx + cos(a) * r, y = cy + sin(a) * r;
      if (S.w && S.w.resolve) { const p = S.w.resolve(x, y, 3); if (p) { x = p.x; y = p.y; } }
      const c = spawn('kin', x, y, { instant: true }); if (c) { c.radius = 3.6; c.hx = x; c.hy = y; }
    }
  }
  // fill the world around (cx, cy). A new game starts at the hatch point with plenty of easy prey; o.stage / o.fresh=false rebuild a mid-game population
  // around a restored player (Territory load): no free springtails for a grown spider
  function populateInitial(cx, cy, o) {
    o = o || {};
    const sp = (cx == null) ? hatchPt() : { x: cx, y: cy }, stage = o.stage | 0, fresh = o.fresh !== false;
    S.cx = sp.x; S.cy = sp.y; S.stage = stage; S.px = sp.x; S.py = sp.y; S.R = STAGE_R[clamp(stage, 0, 4)]; S.rin = 300;
    S.share[0] = S.share[1] = S.share[2] = 0; updateShares(); computeTargets(); S.shareT = 0.5;
    S.count.fill(0);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < POP_KINDS.length; i++) {
        const k = POP_KINDS[i]; const want = Math.round(S.target[k.idx] * 0.9);
        let guard = 0;
        while (S.count[k.idx] < want && guard++ < 14 && list.length < MAXC - 10) { const m = spawnGroup(k, 1, want - S.count[k.idx]); S.count[k.idx] += m; }
      }
    }
    // guarantee plentiful easy prey around the hatch point, none of it threatening
    const ensure = (id, total, near) => {
      const k = KINDS[id]; let have = 0;
      for (let i = 0; i < list.length; i++) { const o = list[i]; if (o.kind === id && hypot(o.x - sp.x, o.y - sp.y) < 600) have++; }
      let guard = 0;
      while (have < total && guard++ < 60) {
        const a = rnd() * TAU, r = (have < near ? 90 + rnd() * 170 : 120 + rnd() * 480);
        let x = sp.x + cos(a) * r, y = sp.y + sin(a) * r;
        if (x < 40 || y < 40 || x > C.WORLD_W - 40 || y > C.WORLD_H - 40) continue;
        if (!k.isFlyer && S.w && S.w.resolve) { const p = S.w.resolve(x, y, 3); if (p) { if (hypot(p.x - x, p.y - y) > 20) continue; x = p.x; y = p.y; } }
        const c = spawn(id, x, y, { instant: true }); if (c) { c.hx = x; c.hy = y; have++; }
      }
    };
    if (fresh) { ensure('springtail', 16, 7); ensure('mite', 10, 4); ensure('midge', 8, 3); }
    if (o.kin !== false) spawnKin(kinWanted(), sp.x, sp.y);
  }

  // ================================================================= player-facing API
  function attackAt(x, y, r, dmg, by) {
    by = by || 'player';
    const res = { killed: [], hit: [] };
    const P = S.P || Game.player, pr = (P && P.radius) || 5;
    if (by === 'player') {
      let best = null, bd = 1e9, fb = null, fd = 1e9;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.dead || c.k.unique || c.role === 'spider' || c.k.id === 'bird') continue;
        const d = hypot(c.x - x, c.y - y) - c.radius;
        if (d > r) continue;
        if (canEat(pr, c)) { if (d < bd) { bd = d; best = c; } }
        else if (c.role === 'predator' || c.k.defends) { if (d < fd) { fd = d; fb = c; } }
      }
      const t = best || fb;
      if (t) strike(t, dmg, 'player', res);
    } else {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.dead || c.k.unique || (c.k.id === 'bird')) continue;
        if (hypot(c.x - x, c.y - y) - c.radius <= r) strike(c, dmg, by, res);
      }
    }
    if (res.hit.length && S.T - lastBiteSfx > 0.12) { lastBiteSfx = S.T; emitSfx('bite', x, y, 0.9); }
    return res;
  }
  function strike(c, dmg, by, res) {
    const k = c.k;
    let arm = k.armor; if (c.state === 'curl') arm = 0.85;
    const eff = max(dmg * 0.22, dmg * (1 - arm));
    const killed = hurt(c, eff, by, null);
    res.hit.push(c);
    if (killed) res.killed.push(c);
    else if (by === 'player') {
      const P = S.P;
      if (P && P.venomPower > 0 && !k.boss) {   // a Black Widow's bite: poison keeps working (up to 3 bites stack)
        const add = eff * P.venomPower / VENOM_T;
        c.venomT = VENOM_T; c.venomDps = min(c.venomDps + add, add * 3);
      }
      if (k.ai === 'hunter' && c.state !== 'stuck' && c.hp > c.maxHp * 0.28 && P && !P.dead && hostileToPlayer(c, P)) {
        c.state = 'hunt'; c.target = P; c.tIsP = true; c.targetId = 0; c.chaseT = 0; c.awareT = 8; c.alertT = 0.7; c.alertCol = '#ff5a3a';
        if (k.defends) recruitAnts(c);
      } else if (k.ai === 'prey' && c.state !== 'stuck' && c.state !== 'curl') {
        if (k.fleeStyle === 'curl') { c.state = 'curl'; c.curlT = 3.5; c.vx = c.vy = 0; }
        else if (P) { c.state = 'flee'; c.t = 1.8; c.tx = P.x; c.ty = P.y; c.dashT = 0; c.t2 = 0; c.threatP = true; c.alertT = 0.6; c.alertCol = '#ffd24a'; }
      }
    }
  }
  function nearest(x, y, filterFn, maxDist) {
    let best = null, bd = (maxDist == null ? 1e18 : maxDist * maxDist);
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; if (c.dead) continue;
      const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy;
      if (d < bd && (!filterFn || filterFn(c))) { bd = d; best = c; }
    }
    return best;
  }
  const scratch = [];
  function inRadius(x, y, r, filterFn) {
    scratch.length = 0;
    const r2 = r * r;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; if (c.dead) continue;
      const dx = c.x - x, dy = c.y - y;
      if (dx * dx + dy * dy <= r2 && (!filterFn || filterFn(c))) scratch.push(c);
    }
    return scratch;
  }
  function spawnMate() {
    const P = S.P || Game.player;
    if (creatures.mate && !creatures.mate.dead) { return creatures.mate; }
    const px = P ? P.x : C.SPAWN.x, py = P ? P.y : C.SPAWN.y;
    let best = null, bd = -1;
    for (let i = 0; i < 24; i++) {
      let x, y;
      const arr = (i < 10) ? spawnHints(ZONE_IDS[2], 'mate') : null;
      if (arr) { const p = arr[(rnd() * arr.length) | 0]; x = p.x; y = p.y; }
      else { x = C.ZONES[2].x0 + 250 + rnd() * (C.ZONES[2].x1 - C.ZONES[2].x0 - 500); y = 400 + rnd() * (C.WORLD_H - 800); }
      const d = hypot(x - px, y - py);
      if (d < 900) continue;
      const score = min(d, 2600) + rnd() * 400;
      if (score > bd) { bd = score; best = { x, y }; }
    }
    if (!best) best = { x: min(C.WORLD_W - 300, px + 1400), y: clamp(py, 400, C.WORLD_H - 400) };
    if (S.w && S.w.resolve) { const p = S.w.resolve(best.x, best.y, 14); if (p) { best.x = p.x; best.y = p.y; } }
    return placeMate(best.x, best.y, false, false);
  }
  function placeMate(x, y, found, courted) {
    const c = spawn('mate', x, y, { instant: true });
    if (c) { c.hx = x; c.hy = y; c.radius = 17; c.found = !!found; c.courted = !!courted; c.hp = c.maxHp = 9999; }
    creatures.mate = c || null;
    return c;
  }
  function clearAll() {
    for (let i = 0; i < list.length; i++) { const c = list[i]; c.stuckWeb = null; recycle(c); }
    list.length = 0;
    for (let i = 0; i < corpses.length; i++) recycle(corpses[i]);
    corpses.length = 0; recycleLater.length = 0; fxList.length = 0; needCompact = false;
  }

  // ================================================================= per-frame helpers
  function refreshEnv() {
    const w = Game.world; S.w = w || null;
    S.phase = (w && w.phase) || 'day';
    S.night = S.phase === 'night';
    const wt = w && w.weather;
    if (wt) {
      const inten = wt.intensity == null ? 0.5 : wt.intensity;
      S.rain = (wt.type === 'rain') ? max(0.35, inten) : (wt.type === 'drizzle' ? inten * 0.8 : 0);
      S.fog = wt.type === 'fog' ? inten : 0;
      S.windX = wt.windX || 0; S.windY = wt.windY || 0; S.wind = hypot(S.windX, S.windY) * 0.02 + (wt.type === 'wind' ? inten * 0.6 : 0);
    } else { S.rain = 0; S.fog = 0; S.windX = S.windY = S.wind = 0; }
  }
  function computeDanger(dt) {
    const P = S.P; let raw = 0;
    if (P && !P.dead && S.playing) {
      const mh = max(10, P.maxHp || 50);
      for (let i = 0; i < list.length; i++) {
        const c = list[i]; if (c.dead) continue;
        const k = c.k; let thr = 0;
        if (k.ai === 'bird') {
          const d = hypot(c.lockT > 0 ? c.lockX - P.x : c.x - P.x, c.lockT > 0 ? c.lockY - P.y : c.y - P.y);
          if (c.state === 'dive') thr = c.tIsP ? 1 : 0.2;
          else if (c.state === 'lock') thr = c.tIsP ? 0.85 : 0.2;
          else if (c.state === 'approach') thr = c.tIsP ? 0.25 + 0.5 * (1 - clamp(d / 520, 0, 1)) : (d < 160 ? 0.2 : 0);
        } else if (k.ai === 'hunter') {
          if (!hostileToPlayer(c, P) || c.state === 'idle' || c.state === 'flee' || c.state === 'stuck') continue;
          const d = hypot(c.x - P.x, c.y - P.y);
          if ((c.state === 'hunt' || c.state === 'windup' || c.state === 'attack' || c.state === 'recover') && c.tIsP) thr = 0.45 + 0.55 * clamp(1 - d / (k.detection * 1.5), 0, 1);
          else { const rr = k.detection * 1.1; if (d < rr) thr = 0.36 * (1 - d / rr) * (k.defends ? 0.35 : 1); }
          thr *= clamp(0.45 + (k.attack ? k.attack.dmg : 8) / mh * 2.2, 0.45, 1);
        } else if (k.ai === 'boss' && Game.boss && Game.boss.threat) thr = Game.boss.threat(c);
        if (thr > raw) raw = thr;
      }
      for (let i = 0; i < S.alarms.length; i++) raw = max(raw, ALARM_DANGER * clamp(S.alarms[i].life / 1.5, 0, 1));   // a sibling's warning keeps the heartbeat going a moment
    }
    const rate = raw > S.dangerRaw ? 5 : 0.9;
    S.dangerRaw += (raw - S.dangerRaw) * (1 - Math.exp(-rate * dt));
    if (S.dangerRaw < 0.002) S.dangerRaw = 0;
    Game.state.danger = clamp(S.dangerRaw, 0, 1);
  }
  function seenTick() {
    const cam = Game.camera;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; if (c.dead || visibleKinds.has(c.kind)) continue;
      if (c.hideA > 0.5) continue;
      if (c.k.ai === 'bird') { if (c.shadowA < 0.4) continue; }
      if (cam.inView(c.x, c.y, 0)) {
        visibleKinds.add(c.kind);
        try { Game.store.set('seenKinds', Array.from(visibleKinds)); } catch (e) { /* ignore */ }
        Game.emit('creature:seen', { kind: c.kind });
      }
    }
  }
  function updateCreature(c, dt) {
    c.age += dt;
    if (c.alpha < 1) c.alpha = min(1, c.alpha + dt * 2.2);
    c.alertT -= dt; c.flash -= dt; c.hitT -= dt;
    if (c.venomT > 0 && venomTick(c, dt)) return;
    if (c.state === 'stuck') { thinkStuck(c, dt); return; }
    switch (c.k.ai) {
      case 'boss': thinkBoss(c, dt); break;
      case 'hunter': thinkHunter(c, dt); break;
      case 'bird': thinkBird(c, dt); break;
      case 'kin': thinkKin(c, dt); break;
      case 'mate': thinkMate(c, dt); break;
      default: thinkPrey(c, dt);
    }
    if (c.vx !== c.vx || c.x !== c.x || c.y !== c.y) { c.x = c.hx || C.SPAWN.x; c.y = c.hy || C.SPAWN.y; c.vx = c.vy = 0; if (Game.reportError) Game.reportError('creatures.nan', new Error('NaN in ' + c.kind)); }
  }
  function updateKinCount(instant) {
    const wanted = kinWanted();
    let n = 0, far = null, fd = -1;
    for (let i = 0; i < list.length; i++) { const c = list[i]; if (c.dead || c.kind !== 'kin' || c.disperse || c.sac) continue; n++; const d = hypot(c.x - S.px, c.y - S.py) + rnd() * 30; if (d > fd) { fd = d; far = c; } }
    if (n > wanted && far) { far.disperse = true; far.wa = rnd() * TAU; }
    else if (n < wanted && territoryOn() && S.P && !S.P.dead) spawnKin(instant ? wanted - n : 1, S.P.x, S.P.y);   // Territory: an heir who is still alive is never far away
  }

  // ================================================================= module
  const creatures = {
    priority: 40, alwaysUpdate: true,
    list, KINDS, corpses, visibleKinds, mate: null,
    alarms: S.alarms,                       // sibling lookout warnings (HUD arrows)
    get huddle() { return S.huddle; },      // siblings huddled with the player right now (0..HUDDLE_MAX)
    get siblings() { return siblingCount(); },   // siblings still with the player = revives left (player.js)
    siblingsMax: KIN_START,                 // how many hatch with you
    claimSibling, startle,                  // claimSibling(x,y) -> the sibling that will give its life (or null); startle(x,y,r) scares hunters off
    kindList() { return KIND_LIST.slice(); },
    spawn, attackAt, nearest, inRadius, spawnMate, trap,
    release(c) { if (c && !c.dead && c.state === 'stuck') { releaseWeb(c, false, false); c.state = 'flee'; c.t = 1.5; c.struggle = 0; c.tx = c.x; c.ty = c.y; c.dashT = 0; c.t2 = 0; } },
    canEat, kill: (c, by) => kill(c, by || 'other'),
    count(id) { let n = 0; for (let i = 0; i < list.length; i++) if (!list[i].dead && (!id || list[i].kind === id)) n++; return n; },
    drawKindIcon,
    debug() { const o = {}; for (let i = 0; i < list.length; i++) o[list[i].kind] = (o[list[i].kind] || 0) + 1; return { total: list.length, byKind: o, targets: Array.from(S.target).slice(0, KIND_LIST.length), danger: Game.state.danger, R: S.R }; },
    _S: S,
    // test hook: draws spider kind `id` onto ctx in a pose {ph, mv, stuck, dead, tele, hop} and returns where each leg ended up: {hip, knee, foot: [[x,y] x8], bone: [4]} (unit space, leg i = pair*2 + (left ? 1 : 0))
    _legPose(id, o, ctx) {
      F.t = 1.2; F.ph = o.ph || 0; F.mv = o.mv || 0; F.stuck = o.stuck || 0; F.dead = o.dead || 0; F.tele = o.tele || 0; F.hop = o.hop || 0;
      F.seed = 0.5; F.detail = false; F.sil = false; F.px = 0.05; F.open = 0; F.air = false; F.curl = 0; F.atk = 0; F.bend = 0;
      ctx.save(); SPR[id](ctx); ctx.restore();
      const pts = (a) => { const r = []; for (let i = 0; i < 16; i += 2) r.push([a[i], a[i + 1]]); return r; };
      return { hip: pts(SLH), knee: pts(SLK), foot: pts(SLF), bone: Array.from(SLB) };
    },

    // ---- Territory: saving. Only what has to survive is saved: the mate, active rivals (the boss is boss.js's). Everything else is respawned from the
    // seed and the season on load, so the world keeps living while you are away and the save stays small.
    serialize() {
      const per = [], rd = (v) => Math.round(v * 10) / 10;
      const m = creatures.mate;
      if (m && !m.dead) per.push({ kind: 'mate', x: rd(m.x), y: rd(m.y), found: !!m.found, courted: !!m.courted });
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.dead || !c.rival) continue;
        per.push({ kind: 'rival', k: c.kind, x: rd(c.x), y: rd(c.y), hp: rd(c.hp), mode: c.rival, hx: rd(c.hx), hy: rd(c.hy) });
      }
      return { persistent: per, kin: kinWanted() };
    },
    // rebuild the population around the restored player, then put the persistent creatures back
    deserialize(d) {
      const P = Game.player;
      clearAll(); creatures.mate = null; S.alarms.length = 0; S.huddle = 0;
      for (const k in spCache) delete spCache[k];
      S.P = P || null; refreshEnv();
      if (P) populateInitial(P.x, P.y, { stage: P.stage | 0, fresh: false, kin: false });
      else populateInitial();
      const per = d && Array.isArray(d.persistent) ? d.persistent : [];
      for (let i = 0; i < per.length; i++) {
        const e = per[i]; if (!e || typeof e.x !== 'number' || typeof e.y !== 'number') continue;
        if (e.kind === 'mate') placeMate(e.x, e.y, e.found, e.courted);
        else if (e.kind === 'rival' && KINDS[e.k]) {
          const c = spawn(e.k, e.x, e.y, { instant: true, state: 'patrol' });
          if (c) { c.rival = e.mode === 2 ? 2 : 1; c.hx = typeof e.hx === 'number' ? e.hx : e.x; c.hy = typeof e.hy === 'number' ? e.hy : e.y; if (typeof e.hp === 'number') c.hp = clamp(e.hp, 1, c.maxHp); }
        }
      }
      updateKinCount(true);
      buildHash();
    },
    syncKin(instant) { updateKinCount(!!instant); },       // Territory: make the visible siblings match the lineage's heirs (an heir was spent or hatched)
    // quietly remove a creature (a rival that has been driven out of the Claim): no corpse, no kill credit
    remove(c) { if (c && !c.dead) removeQuiet(c); },
    init() {
      try { const seen = Game.store.get('seenKinds', []); if (Array.isArray(seen)) seen.forEach(s => { if (KINDS[s]) visibleKinds.add(s); }); } catch (e) { /* ignore */ }
      Game.addDrawer(Game.LAYER.CREATURES_LOW, ctx => drawLow(ctx));
      Game.addDrawer(Game.LAYER.CREATURES_HIGH, ctx => drawHigh(ctx));
      Game.addDrawer(72, ctx => drawSky(ctx));
      Game.on('web:destroyed', d => { if (!d) return; for (let i = 0; i < list.length; i++) { const c = list[i]; if (!c.dead && c.state === 'stuck' && c.stuckWeb === d.web) breakFree(c); } });
      Game.on('player:ate', d => { if (!d) return; for (let i = 0; i < list.length; i++) { const c = list[i]; if (!c.dead && c.kind === 'kin' && !c.disperse && hypot(c.x - d.x, c.y - d.y) < 700) { c.gatherT = 4; c.gx = d.x; c.gy = d.y; } } });
      Game.on('courtship:done', () => { if (creatures.mate) creatures.mate.courted = true; });
      Game.on('sfx', d => { if (d && d.name === 'bite') lastBiteSfx = S.T; });
    },
    reset() {
      clearAll();
      S.T = 0; S.frame = 0; S.birdT = 100; S.birdAlive = null; S.dangerRaw = 0; S.seenT = 0; S.popT = 0; S.pityT = 3; S.cursor = 0; S.kinT = 1;
      for (const k in spCache) delete spCache[k];
      for (const k in S.sfxT) delete S.sfxT[k];
      creatures.mate = null; S.mateFound = false; S.alarms.length = 0; S.huddle = 0;
      Game.state.danger = 0;
      S.P = Game.player || null;
      refreshEnv();
      populateInitial();
      buildHash();
    },
    update(dt) {
      const scene = Game.state.scene;
      S.playing = scene === 'playing'; S.title = scene === 'title';
      if (!S.playing && !S.title) return;
      S.frame++; S.T += dt;
      refreshEnv();
      const cam = Game.camera;
      if (S.playing) {
        S.P = Game.player || null;
        if (S.P && typeof S.P.x === 'number') { S.px = S.P.x; S.py = S.P.y; S.cx = S.P.x; S.cy = S.P.y; S.stage = S.P.stage | 0; } else { S.P = null; S.cx = cam.x; S.cy = cam.y; }
      } else { S.P = null; S.cx = cam.x; S.cy = cam.y; S.px = cam.x; S.py = cam.y; S.stage = 0; }
      S.R = STAGE_R[clamp(S.stage, 0, 4)];
      const vw = (cam.view.x1 - cam.view.x0) * 0.5, vh = (cam.view.y1 - cam.view.y0) * 0.5;
      S.rin = min(S.R - 140, Math.hypot(vw, vh) + 90);
      compact();
      for (let i = recycleLater.length - 1; i >= 0; i--) { const c = recycleLater[i]; c.eatT += dt; if (c.eatT > 2.5) { recycleLater[i] = recycleLater[recycleLater.length - 1]; recycleLater.pop(); recycle(c); } }
      buildHash();
      // ---- creatures
      const fr = S.frame;
      for (let i = 0; i < list.length; i++) {
        const c = list[i]; if (c.dead) continue;
        let step = dt;
        const dx = c.x - S.cx, dy = c.y - S.cy;
        if (dx * dx + dy * dy > 1000 * 1000 && c.k.ai !== 'bird' && c.k.ai !== 'mate') {
          c.accDt += dt; if (((fr + c.id) % 3) !== 0) continue;
          step = min(0.1, c.accDt); c.accDt = 0;
        } else c.accDt = 0;
        try { updateCreature(c, step); } catch (e) { Game.reportError('creatures.ai:' + c.kind, e); c.state = 'wander'; c.target = null; }
      }
      compact();
      // ---- corpses & fx
      for (let i = corpses.length - 1; i >= 0; i--) { const c = corpses[i]; c.fade += dt / 1.15; if (c.fade >= 1) { corpses[i] = corpses[corpses.length - 1]; corpses.pop(); c.eatT = 0; recycleLater.push(c); } }
      for (let i = fxList.length - 1; i >= 0; i--) { const f = fxList[i]; f.t += dt; if (f.t >= f.dur) { fxList[i] = fxList[fxList.length - 1]; fxList.pop(); } }
      // ---- ecosystem management
      S.popT -= dt; if (S.popT <= 0) { S.popT = 0.1; populationTick(0.1); }
      if (S.playing) {
        S.pityT -= dt; if (S.pityT <= 0) { S.pityT = 3; pityTick(); }
        S.kinT -= dt; if (S.kinT <= 0) { S.kinT = 1; updateKinCount(); }
        tickAlarms(dt); huddleTick();
        birdTick(dt);
      } else if (S.huddle) S.huddle = 0;
      computeDanger(dt);
      S.seenT -= dt; if (S.seenT <= 0) { S.seenT = 0.3; if (S.playing) seenTick(); }
    },
  };

  // ================================================================= drawers
  function drawLow(ctx) {
    const cam = Game.camera, v = cam.view, T = Game.time.real, zoom = cam.zoom, sci = !!Game.settings.science;
    for (let i = 0; i < corpses.length; i++) { const c = corpses[i]; if (cam.inView(c.x, c.y, c.radius * 3 + 10)) drawCorpse(ctx, c, T, zoom); }
    for (let i = 0; i < fxList.length; i++) drawFx(ctx, fxList[i], zoom);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.dead) continue;
      const k = c.k;
      if (k.ai === 'bird') { if (c.shadowA > 0.01) drawBirdShadow(ctx, c, T, zoom); continue; }
      if (c.flying) continue;
      const pad = c.radius * k.ext * 1.15 + 14;
      if (k.ai === 'mate') { if (cam.inView(c.x, c.y, 200)) drawMateAura(ctx, c, T, zoom); }
      if (c.x < v.x0 - pad || c.x > v.x1 + pad || c.y < v.y0 - pad || c.y > v.y1 + pad) continue;
      if (c.sac) continue;   // drawn by drawHigh, above the player
      drawCreature(ctx, c, T, zoom, sci);
    }
  }
  function drawHigh(ctx) {
    const cam = Game.camera, v = cam.view, T = Game.time.real, zoom = cam.zoom, sci = !!Game.settings.science;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.dead || c.k.ai === 'bird') continue;
      if (c.sac) { if (cam.inView(c.x, c.y, 80)) { drawSacGlow(ctx, c); drawCreature(ctx, c, T, zoom, sci); } continue; }
      if (!c.flying) continue;
      const pad = c.radius * c.k.ext * 1.15 + 14 + c.alt;
      if (c.x < v.x0 - pad || c.x > v.x1 + pad || c.y < v.y0 - pad || c.y > v.y1 + pad) continue;
      drawCreature(ctx, c, T, zoom, sci);
    }
  }
  function drawSky(ctx) {
    const cam = Game.camera, T = Game.time.real, zoom = cam.zoom;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.dead || c.k.ai !== 'bird' || c.skyA < 0.02) continue;
      if (!cam.inView(c.x, c.y - c.alt, 200)) continue;
      drawBirdSprite(ctx, c, T, zoom);
    }
  }
  function drawFx(ctx, f, zoom) {
    const q = f.t / f.dur;
    if (f.kind === 'puff') {
      ctx.fillStyle = 'rgba(190,170,130,' + (0.35 * (1 - q)) + ')';
      for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3, r = f.r * (0.2 + q * 0.9); ctx.beginPath(); ctx.arc(f.x + cos(a) * r, f.y + sin(a) * r, f.r * (0.28 - q * 0.12), 0, TAU); ctx.fill(); }
    } else if (f.kind === 'revive') {
      const e = 1 - (1 - q) * (1 - q);
      ctx.fillStyle = 'rgba(255,240,200,' + (0.4 * (1 - q)) + ')'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.12 + e * 0.5), 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,224,150,' + (0.75 * (1 - q)) + ')'; ctx.lineWidth = 2.5 / zoom; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.2 + e * 0.85), 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,236,170,' + (0.9 * (1 - q)) + ')';
      for (let i = 0; i < 9; i++) { const a = i * TAU / 9 + 0.4, rr = f.r * (0.15 + e * 0.8); ctx.beginPath(); ctx.arc(f.x + cos(a) * rr, f.y + sin(a) * rr - q * f.r * 0.5, f.r * 0.05 * (1 - q * 0.6), 0, TAU); ctx.fill(); }
    } else {
      ctx.strokeStyle = 'rgba(255,90,60,' + (0.6 * (1 - q)) + ')'; ctx.lineWidth = 2 / zoom; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + q * 0.7), 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(190,150,110,' + (0.3 * (1 - q)) + ')'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + q * 0.5), 0, TAU); ctx.fill();
    }
  }

  Game.register('creatures', creatures);
})();
