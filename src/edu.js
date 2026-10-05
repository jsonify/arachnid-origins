/* ============================================================================
 * Arachnid Origins  --  edu.js   (module `edu`, priority 50)
 * Education content + objectives: facts, stage lore, anatomy, tips, science info,
 * food web. Pure data/logic; all drawing of this content lives in ui.js.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util;

  // ------------------------------------------------------------------ helpers
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const P = () => Game.player || null;
  const KINDS = () => (Game.creatures && Game.creatures.KINDS) || null;
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const titleize = (id) => String(id).replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
  const tokens = (id) => String(id || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // does a creature kind id look like one of these names?
  function kindIs(kind, pats) {
    const id = String(kind || '').toLowerCase(), tk = tokens(kind);
    for (let i = 0; i < pats.length; i++) {
      const p = pats[i];
      if (id === p) return true;
      for (let j = 0; j < tk.length; j++) if (tk[j] === p || (p.length >= 5 && tk[j].indexOf(p) >= 0)) return true;
      if (p.length >= 6 && id.indexOf(p) >= 0) return true;
    }
    return false;
  }
  const seen = (...pats) => (d) => !!d && kindIs(d.kind, pats);

  // ---------------------------------------------------------------- categories
  const CATEGORIES = [
    { id: 'anatomy',    name: 'Anatomy',    color: '#6fc9c0' },
    { id: 'behavior',   name: 'Behavior',   color: '#e8a860' },
    { id: 'ecosystem',  name: 'Ecosystem',  color: '#8fd35f' },
    { id: 'lifecycle',  name: 'Life Cycle', color: '#d99bd6' },
    { id: 'silk',       name: 'Silk & Webs', color: '#cfd6f2' },
    { id: 'adaptation', name: 'Adaptation', color: '#f0cf62' },
  ];

  // ---------------------------------------------------------------------- facts
  // F(id, category, title, text, hint, unlockOn)
  //  unlockOn: { event, match?: object|function, count?: n, at?: seconds (event 'edu:time') }
  const FACTS = [];
  function F(id, category, title, text, hint, unlockOn) { FACTS.push({ id, category, title, text, hint, unlockOn }); }

  // ---- anatomy
  F('two_body_parts', 'anatomy', 'Two Body Segments',
    'Spiders have two main body sections: the cephalothorax (or prosoma) at the front and the abdomen (opisthosoma) behind, joined by a narrow waist called the pedicel. Insects have three sections: head, thorax and abdomen.',
    'Survive your first few seconds.', { event: 'edu:time', at: 4 });
  F('eight_legs', 'anatomy', 'Eight Legs, Not Six',
    'All spiders have eight legs, each with seven segments, attached to the cephalothorax. Insects have six legs, and spiders never have wings or antennae. Instead of antennae, spiders feel the world with sensory hairs on their legs and pedipalps.',
    'Explore the world on foot.', { event: 'edu:moved' });
  F('many_eyes', 'anatomy', 'A Crown of Eyes',
    'Most spiders have eight simple eyes arranged in two or three rows, though some species have six, four, two or none at all. Many web builders see little more than light and shadow and rely on touch and vibration instead.',
    'Keep playing for a little while.', { event: 'edu:time', at: 45 });
  F('spinnerets', 'anatomy', 'Spinnerets: Silk Factories',
    'Silk leaves the body through spinnerets, finger-like organs at the tip of the abdomen. Most spiders have six, in three pairs, and each is dotted with tiny spigots linked to different silk glands. One spider can make several kinds of silk, each with its own job.',
    'Spin several webs.', { event: 'web:spun', count: 4 });
  F('book_lungs', 'anatomy', 'Book Lungs',
    'Many spiders breathe with book lungs: pockets on the underside of the abdomen holding stacked, leaf-like folds of tissue, like the pages of a book, that pass oxygen to the blood. Many spiders also have tracheae (thin air tubes), and some tiny species rely on them entirely.',
    'Take a rest (R).', { event: 'player:rest', match: { on: true } });
  F('fangs_venom', 'anatomy', 'Chelicerae and Fangs',
    "A spider's fangs are the tips of its chelicerae, the paired mouthparts in front of the face. Almost all spiders have venom glands and use venom to quickly subdue prey. Only a small number of species have venom that is dangerous to people.",
    'Catch your first meal.', { event: 'player:ate' });
  F('liquid_diet', 'anatomy', 'A Liquid Lunch',
    'Spiders cannot chew solid food. They inject or pour digestive enzymes into their prey, then suck up the dissolved tissue through a tiny mouth, a process called external digestion. What is left is often a dry husk.',
    'Eat three meals.', { event: 'player:ate', count: 3 });
  F('pedipalps', 'anatomy', 'Pedipalps',
    'The two short, leg-like appendages beside the mouth are pedipalps. Spiders use them to feel, taste and handle food. In adult males the tips are modified to transfer sperm to a female.',
    'Reach adulthood.', { event: 'stage:change', match: { stage: 4 } });
  F('hydraulic_legs', 'anatomy', 'Hydraulic Legs',
    "Spiders straighten their legs mostly with hydraulic pressure: muscles in the cephalothorax squeeze hemolymph (spider blood) into the legs and push them outward. Flexor muscles pull the joints closed, which is why a dead spider's legs curl inward.",
    'Sprint across the ground (Shift).', { event: 'edu:sprint' });
  F('open_circulation', 'anatomy', 'Blue Blood',
    "Spiders have an open circulatory system: a tube-like heart along the back of the abdomen pumps hemolymph into body cavities that bathe the organs. It carries oxygen with hemocyanin, a copper-based protein that can tint it bluish.",
    'Get hurt.', { event: 'player:damaged' });
  F('slit_sensilla', 'anatomy', 'Slit Sense Organs',
    "Tiny slits in the cuticle of a spider's legs, called slit sensilla, detect minute strains in the exoskeleton. They let a spider feel the vibrations of an insect struggling in its web, even though it may not see it at all.",
    'Catch prey in a web.', { event: 'web:trapped' });
  F('trichobothria', 'anatomy', 'Hairs That Hear',
    'Long, fine hairs called trichobothria sit in tiny sockets on a spider\'s legs. They bend in the slightest air current, so a spider can detect the wingbeats of a nearby insect or the rush of an approaching predator, even in the dark.',
    'Grow into a spiderling.', { event: 'stage:change', match: { stage: 1 } });
  F('exoskeleton', 'anatomy', 'A Skeleton on the Outside',
    'A spider\'s exoskeleton is made of chitin and proteins. It protects the body and slows water loss, but it cannot stretch, so a spider has to shed it, again and again, in order to grow.',
    'Keep surviving.', { event: 'edu:time', at: 150 });

  // ---- behavior
  F('dragline_safety', 'behavior', 'The Safety Line',
    'Most spiders trail a silk dragline wherever they walk, anchoring it at intervals. If the spider slips or must flee, it can dangle from the thread and climb back up. Draglines also carry chemical clues that other spiders can follow.',
    'Spin several draglines.', { event: 'web:spun', match: { type: 'line' }, count: 3 });
  F('freeze_hide', 'behavior', 'Frozen in Place',
    'When threatened, many spiders freeze, drop on a thread or slip into a crevice. Staying still and out of sight is often a better defense than running, because many predators track movement.',
    'Stay hidden for a moment.', { event: 'edu:hidden' });
  F('night_hunters', 'behavior', 'The Night Shift',
    'Many spiders are most active after dark, when fewer birds and wasps are hunting by sight and the cooler, damper air costs them less water. Their senses of touch and vibration work just as well in the dark.',
    'Be awake when night falls.', { event: 'day:phase', match: { phase: 'night' } });
  F('jumping_vision', 'behavior', 'Jumpers with Sharp Eyes',
    'Jumping spiders stalk prey like tiny cats and pounce, launching themselves with a sudden surge of hydraulic pressure while trailing a safety line. Their large front eyes resolve fine detail, and they can judge distance well enough to hit a small target in mid-air.',
    'Spot a jumping spider.', { event: 'creature:seen', match: seen('jumping', 'jumper', 'salticid') });
  F('wolf_hunters', 'behavior', 'Hunters Without Webs',
    'Wolf spiders do not build webs to catch prey. They chase it down using sight and vibration. A female carries her egg sac attached to her spinnerets, and after hatching, the spiderlings ride on her back for a time.',
    'Spot a wolf spider.', { event: 'creature:seen', match: seen('wolf', 'lycosid') });
  F('patience', 'behavior', 'Patience Pays',
    'Web builders can wait for days between meals. Spiders have low metabolic rates for their size, and many can survive weeks, and some even months, without food. They still need water, though.',
    'Get hungry.', { event: 'edu:hungry' });
  F('courtship', 'behavior', 'Courtship Signals',
    'Males of many species court with vibrations, drumming or dances so that the female recognizes a mate rather than a meal. Females are often larger than males, so a clear signal matters.',
    'Court a mate.', { event: 'courtship:done' });
  F('brood_sacrifice', 'behavior', 'Sacrifice for the Brood',
    'In this game a sibling gives its life to revive you, but real spiderlings do not do that for one another: many species compete, and some eat their own siblings. Self-sacrifice does exist, though, and it comes from mothers. A Stegodyphus velvet spider mother feeds her young, then lets them eat her body, a last meal known as matriphagy.',
    'Be revived by a sibling.', { event: 'player:revived' });
  F('pheromones', 'behavior', 'Following Chemical Trails',
    'Female spiders leave pheromones on their silk and the ground. Males detect them with chemoreceptors on their legs and pedipalps, a scent-by-touch way of finding a mate.',
    'Find a mate.', { event: 'mate:found' });

  // ---- ecosystem
  F('pest_control', 'ecosystem', 'Pest Controllers',
    'Spiders are among the most important predators of insects. Scientists estimate that spiders worldwide eat hundreds of millions of tonnes of prey each year, helping to keep insect populations in check.',
    'Eat six meals.', { event: 'player:ate', count: 6 });
  F('leaf_litter_life', 'ecosystem', 'Life in the Leaf Litter',
    'Leaf litter is a bustling habitat. Fungi and tiny animals break dead leaves down and return nutrients to the soil, and that crowd of small creatures feeds spiders, beetles and centipedes in turn.',
    'Explore the leaf litter.', { event: 'edu:time', at: 90 });
  F('bark_refuge', 'ecosystem', 'Bark: A Hidden World',
    'Tree bark has crevices where insects, spiders and their egg sacs hide from predators and weather. Ridges break up an animal\'s outline, and lichens and mosses create even more tiny habitats.',
    'Enter the Old Oak Bark.', { event: 'zone:enter', match: { zone: 'bark' } });
  F('garden_buzz', 'ecosystem', 'A Garden Full of Flowers',
    'Flowers offer nectar and pollen, which draw pollinators such as bees, flies and moths, and the predators that hunt them. Crab spiders sit camouflaged on petals and ambush visitors.',
    'Enter the Flower Garden.', { event: 'zone:enter', match: { zone: 'garden' } });
  F('springtails', 'ecosystem', 'Springtails: Tiny Recyclers',
    'Springtails are close relatives of insects, but not true insects. A spring-like organ folded under the abdomen, the furcula, flicks them into the air to escape. They feed on fungi and decaying plant matter in soil and litter.',
    'Spot a springtail.', { event: 'creature:seen', match: seen('springtail', 'collembola') });
  F('mites', 'ecosystem', 'Mites: Eight-Legged Cousins',
    'Mites are arachnids, relatives of spiders, and most are microscopic. Many recycle dead plant material in soil, while others feed on plants or animals.',
    'Spot a mite.', { event: 'creature:seen', match: seen('mite') });
  F('aphids_ants', 'ecosystem', 'Farmers and Their Herds',
    'Aphids suck plant sap and release sugary honeydew. Some ants protect aphids from predators and collect the honeydew, rather like herders tending livestock.',
    'Spot an aphid.', { event: 'creature:seen', match: seen('aphid') });
  F('ant_colony', 'ecosystem', 'Ants: A Superorganism',
    'Ant colonies divide labor among workers, soldiers and queens and coordinate with chemical signals called pheromones. A lone spider rarely wins against a defending colony, and some ants spray formic acid.',
    'Spot an ant.', { event: 'creature:seen', match: seen('ant') });
  F('spider_wasps', 'ecosystem', 'Spiders Have Enemies Too',
    'Spider wasps hunt spiders: a female stings one to paralyze it, drags it to a burrow, and lays an egg on it so her larva has fresh food. Many other wasps also hunt insects and spiders.',
    'Spot a wasp.', { event: 'creature:seen', match: seen('wasp') });
  F('bird_predators', 'ecosystem', 'Birds: Sharp-Eyed Hunters',
    'Birds such as wrens and tits eat huge numbers of insects and spiders, finding them by sight and movement. Staying still under cover, or hidden in a silk retreat, makes a spider much harder to find.',
    'Spot a bird.', { event: 'creature:seen', match: seen('bird', 'wren', 'sparrow', 'tit') });
  F('mantis_ambush', 'ecosystem', 'Ambush Predators',
    'Praying mantises sit motionless and snatch prey with spiked forelegs in a fraction of a second. They eat flies and moths and, given the chance, spiders.',
    'Spot a praying mantis.', { event: 'creature:seen', match: seen('mantis') });
  F('centipedes', 'ecosystem', 'Centipedes: Fast Venomous Hunters',
    'Centipedes have one pair of legs per body segment and venom-injecting claws (forcipules) just behind the head. Many hunt at night in damp leaf litter and eat spiders and insects.',
    'Spot a centipede.', { event: 'creature:seen', match: seen('centipede') });
  F('pillbugs', 'ecosystem', 'Not an Insect',
    'Pillbugs (woodlice) are crustaceans, relatives of crabs and shrimp. They breathe with gill-like structures and need damp places, where they eat decaying plant matter. Some species can roll into a ball.',
    'Spot a pillbug.', { event: 'creature:seen', match: seen('pillbug', 'woodlouse', 'woodlice', 'isopod') });
  F('energy_pyramid', 'ecosystem', 'The Ten Percent Rule',
    'Only a fraction of the energy in each level of a food chain reaches the next, often roughly one tenth. That is why a habitat holds many more small prey animals than predators.',
    'Eat ten meals.', { event: 'player:ate', count: 10 });
  F('dew_drinking', 'ecosystem', 'Drinking Dew',
    'Spiders need water as well as food. Many drink from dew drops and rain droplets, and some will drink from moisture on their own webs.',
    'Drink from a dew drop (E).', { event: 'player:drank' });
  F('rain_small_bodies', 'ecosystem', 'Rain on a Tiny Scale',
    'To a spider, a raindrop is a heavy blow, and the surface tension of water can trap very small animals. Leaf shelters, bark crevices and silk retreats offer cover from a downpour.',
    'Experience rain.', { event: 'weather:change', match: (d) => d && (d.weather === 'rain' || d.weather === 'drizzle') });
  F('decomposers', 'ecosystem', 'Nature\'s Recyclers',
    'Dead plants and animals do not pile up forever. Fungi, bacteria, mites, springtails and pillbugs break them down, and the nutrients flow back to plants, which feed the next round of herbivores, and in turn the spiders.',
    'Keep surviving.', { event: 'edu:time', at: 240 });

  // ---- life cycle
  F('egg_sacs', 'lifecycle', 'Born in Silk',
    'Female spiders wrap their eggs in silk to make an egg sac that protects them from predators, parasites and weather. Depending on the species, a sac holds anything from a handful of eggs to hundreds.',
    'Just hatched? Wait a moment.', { event: 'edu:time', at: 15 });
  F('inside_the_sac', 'lifecycle', 'Before You Emerge',
    'Spiderlings usually hatch and go through their first molt inside the egg sac, living on yolk reserves until they chew or push their way out. Once outside, they have to find food and water for themselves.',
    'Stay alive for a minute.', { event: 'edu:time', at: 60 });
  F('ecdysis', 'lifecycle', 'Molting (Ecdysis)',
    'To grow, a spider sheds its rigid exoskeleton. It stops eating, splits the old cuticle along the sides of the cephalothorax and pulls itself free, often hanging from silk. Young spiders may molt many times before they are adults.',
    'Grow enough to molt.', { event: 'molt:start' });
  F('soft_after_molt', 'lifecycle', 'Soft and Vulnerable',
    'Right after a molt the new exoskeleton is soft and pale while it hardens, and the spider cannot move or defend itself well. Many spiders hide in a silk retreat during this time.',
    'Finish a molt.', { event: 'molt:end' });
  F('ballooning', 'lifecycle', 'Ballooning: Flying on Silk',
    "Young spiders of many species climb to a high point, release silk threads and are lifted away by air currents. Recent research suggests the Earth's electric field helps them take off. Ballooning spiders have been found high in the air and far out at sea.",
    'Become a spiderling.', { event: 'stage:change', match: { stage: 1 } });
  F('leg_regrowth', 'lifecycle', 'Regrowing Lost Legs',
    'A young spider that loses a leg to a predator or an accident can regrow it over its next molts. The new leg starts small and reaches full size after more molts. Adults that no longer molt cannot regrow lost legs.',
    'Become a juvenile.', { event: 'stage:change', match: { stage: 2 } });
  F('lifespan', 'lifecycle', 'How Long Do Spiders Live?',
    'Many small spiders live about a year, and large web builders may live two years or more. Some female tarantulas live for 20 years or longer.',
    'Become a sub-adult.', { event: 'stage:change', match: { stage: 3 } });
  F('bigger_females', 'lifecycle', 'Big Sisters',
    'In many spider species the females are noticeably larger than the males. A larger body can carry more eggs, while males often mature sooner and at a smaller size.',
    'Become a sub-adult.', { event: 'stage:change', match: { stage: 3 } });
  F('final_molt', 'lifecycle', 'The Final Molt',
    'Most spiders stop molting once they mature. Males usually mature slightly before females, and females of some groups, such as many tarantulas, keep molting for years after they reach adult size.',
    'Reach adulthood.', { event: 'stage:change', match: { stage: 4 } });
  F('next_generation', 'lifecycle', 'The Next Generation',
    'After mating, a female lays her eggs in a silk egg sac in a hidden spot. Some species carry the sac, some guard it, and some leave it hidden. A few even feed their spiderlings. The cycle then begins again.',
    'Lay your egg sac.', { event: 'game:victory' });

  // ---- silk
  F('silk_is_protein', 'silk', 'Silk: Liquid to Solid',
    'Silk is made of proteins called spidroins, stored as a liquid in the silk glands. As it is drawn through the spinnerets the proteins line up and solidify into a fibre. Weight for weight, some spider silks are stronger than steel and tougher than many man-made fibres.',
    'Spin your first web (Space).', { event: 'web:spun' });
  F('silk_types', 'silk', 'A Toolbox of Silks',
    'An orb weaver can make up to seven kinds of silk: dragline, frame, radial, sticky capture spiral, wrapping, egg-case and attachment silk. Each type comes from its own gland, with its own strength and stretch.',
    'Build a sheet web.', { event: 'web:spun', match: { type: 'sheet' } });
  F('sheet_webs', 'silk', 'Sheet Webs and Trip Lines',
    'Sheet and funnel webs are mostly not sticky. Insects blunder into the tangle of threads above the sheet and fall onto it, and the spider rushes out from beneath to bite. Some sheet webs look like little hammocks.',
    'Build two sheet webs.', { event: 'web:spun', match: { type: 'sheet' }, count: 2 });
  F('silk_retreat', 'silk', 'Silk Shelters',
    'Many spiders build silken retreats, such as tubes, tents and sealed chambers, to rest, to molt and to guard egg sacs. A retreat hides the spider from predators and shields it from wind and rain.',
    'Spin a silk retreat.', { event: 'web:spun', match: { type: 'retreat' } });
  F('orb_web', 'silk', 'Engineering an Orb',
    'An orb web has non-sticky radial threads for structure and a sticky spiral for catching prey. The spider walks on the non-sticky threads. Many orb weavers rebuild their webs every day.',
    'Spin an orb web.', { event: 'web:spun', match: { type: 'orb' } });
  F('vibration_network', 'silk', 'A Web Is an Ear',
    "A web acts as an extension of the spider's senses: threads carry vibrations straight to its legs. Some spiders pluck threads and listen to the echoes to judge a web's tension and where prey is struggling.",
    'Catch two creatures in webs.', { event: 'web:trapped', count: 2 });
  F('glue_droplets', 'silk', 'Glue on a String',
    "The capture spiral of an orb web is dotted with tiny glue droplets that take up moisture from the air to stay tacky. The thread also stretches, absorbing the impact of a flying insect so it is not bounced out.",
    'Catch several creatures in webs.', { event: 'web:trapped', count: 4 });
  F('web_recycling', 'silk', 'Eat Your Web',
    'Orb weavers often eat their old web before building a new one, recycling much of the silk protein. Some species can rebuild a whole orb in under an hour.',
    'Lose a web to the elements or a big creature.', { event: 'web:destroyed' });
  F('dew_webs', 'silk', 'Diamond Webs',
    'At dawn, dew beads along web strands and makes them visible. Dew on a web can also be a handy drink for the spider.',
    'See the sun come up.', { event: 'day:phase', match: { phase: 'dawn' } });
  F('silk_cost', 'silk', 'Silk Costs Energy',
    'Making silk takes protein and energy, so spiders spin economically. A spider will often reuse or eat old silk, and a spider that is short of food may spin less.',
    'Run low on silk.', { event: 'edu:lowsilk' });

  // ---- the Widow Matriarch and the spiders she unlocks
  F('cobweb_tangle', 'behavior', 'Cobweb Architects',
    'Black widows are cobweb spiders (family Theridiidae). Instead of a neat orb they weave an untidy three-dimensional tangle of strong silk, with sticky "gumfoot" threads running down to the ground. When a beetle or cricket brushes one, the glue lets go and the springy line hoists the prey off its feet, where the spider can wrap it.',
    'Spot the Widow Matriarch.', { event: 'creature:seen', match: seen('widow', 'latrodectus') });
  F('widow_hourglass', 'adaptation', 'The Warning Hourglass',
    'A female black widow has a red hourglass on the underside of her abdomen. She often hangs belly-up in her web, so the mark is on display: a warning colour that tells birds and wasps she is not a good meal. Bright red on black is one of nature\'s oldest "do not eat" signals.',
    'Make the Widow Matriarch rear up.', { event: 'boss:start' });
  F('widow_venom', 'adaptation', 'Latrotoxin',
    'The venom of widow spiders (Latrodectus) contains latrotoxin, a neurotoxin that makes nerve endings dump their chemical messengers all at once. It is deadly to insects, and painful, cramping and sometimes dangerous to people, although the spiders are shy, bite mainly when pressed against skin, and bites are rarely fatal today.',
    'Defeat the Widow Matriarch.', { event: 'boss:defeated' });

  // ---- adaptation
  F('camouflage', 'adaptation', 'Masters of Disguise',
    'Many spiders blend in with bark, leaves or flowers. Some crab spiders can slowly shift between white and yellow to match a flower, and some spiders mimic ants or even bird droppings.',
    'Choose Camouflage when molting.', { event: 'molt:choose', match: { id: 'camo' } });
  F('venom_chem', 'adaptation', 'A Chemical Cocktail',
    'Spider venom is a mixture of peptides, salts and enzymes. Different species have venoms tuned to their usual prey. Many are very effective on insects but relatively harmless to people.',
    'Choose Potent Venom when molting.', { event: 'molt:choose', match: { id: 'venom' } });
  F('cuticle_hardening', 'adaptation', 'Hardening the Cuticle',
    'After a molt, chemical cross-links harden (sclerotize) the new cuticle. A thicker, tougher cuticle is better armor, but it is heavier and has to be shed and rebuilt at the next molt.',
    'Choose Tough Cuticle when molting.', { event: 'molt:choose', match: { id: 'carapace' } });
  F('vibration_sense', 'adaptation', 'Feeling the Dark',
    'Spiders that hunt in darkness rely on vibration and touch. Some can locate prey by the tremors that travel through leaves, twigs and soil, and hairs on the legs pick up air movement from a flying insect.',
    'Choose Vibration Sense when molting.', { event: 'molt:choose', match: { id: 'vibration' } });
  F('efficient_engines', 'adaptation', 'Efficient Engines',
    'Spiders have low metabolic rates, especially at rest, which lets them go a long time between meals. Cool temperatures slow their metabolism even more.',
    'Choose Efficient Metabolism when molting.', { event: 'molt:choose', match: { id: 'metabolism' } });
  F('built_for_speed', 'adaptation', 'Built for Speed',
    'Fast spiders such as wolf spiders have long legs and strong muscles, and some can cover many times their body length in a second. Spiders tire quickly, though, because their book lungs and circulation cannot supply oxygen for long sprints.',
    'Choose Swift Legs when molting.', { event: 'molt:choose', match: { id: 'speed' } });
  F('growing_glands', 'adaptation', 'Growing Silk Glands',
    "A spider's silk glands grow along with its body. As spiderlings mature they can make thicker, longer and more varied silk.",
    'Choose Silk Glands when molting.', { event: 'molt:choose', match: { id: 'silk' } });

  // ------------------------------------------------------------------ stage lore
  const STAGE_LORE = [
    { title: 'Hatchling', text: 'You have burst from the silk egg sac into the leaf litter, a speck smaller than a grain of rice. Find a drop of dew, nibble on tiny prey and stay out of sight.',
      scienceText: 'Newly emerged spiderlings are only a millimetre or two long. They live off leftover yolk for a short time, then must feed. With so little body mass they lose water fast, so dew and damp shelter matter.' },
    { title: 'Spiderling', text: 'Your first molt is behind you. Your spinnerets are working and you can trail a dragline, a safety line that lets you explore without fear of falling.',
      scienceText: 'Spiderlings spin dragline silk from the major ampullate glands. Many species use silk to disperse: climbing up, releasing threads and ballooning away on the wind. Spiderlings of different species have different habits, and many first catch very small prey.' },
    { title: 'Juvenile', text: 'You are strong enough to build sheet webs and silk retreats. Webs let you catch prey far larger than you could ever take on in a fair fight, and a retreat is a safe place to rest.',
      scienceText: 'Juveniles molt every few weeks while food is plentiful. Each molt makes the spider larger and its silk glands bigger, so webs get stronger. Silk retreats shelter the spider from predators and weather and are also where many species molt.' },
    { title: 'Sub-adult', text: 'You are nearly full size. Your orb web is a masterpiece of spokes and sticky spiral, and the flower garden is full of flying insects waiting to fly into it.',
      scienceText: 'Orb weavers can build a web in under an hour using non-sticky radial threads and a sticky capture spiral. Sub-adults are one molt from maturity, and their reproductive organs are developing. Web building at this stage supports the body for the demands of egg production.' },
    { title: 'Adult', text: 'You have reached your final form. One last journey remains: find a mate, court with care, and lay your egg sac in a hidden place so the story can begin again.',
      scienceText: 'Most spiders stop molting after they mature. Males often wander in search of females, following silk-borne pheromones. After mating the female lays eggs and wraps them in a silk sac, which she hides, guards or carries, depending on the species.' },
  ];

  // --------------------------------------------------------------------- anatomy
  // x,y are 0..1 positions in the 300x300 diagram that ui.js draws (head at top).
  const ANATOMY = {
    parts: [
      { id: 'eyes', name: 'Eyes', x: 0.50, y: 0.285,
        text: 'Most spiders have eight eyes in two or three rows. Web builders have poor eyesight and read the world through vibration. Hunters like jumping and wolf spiders have large, forward-facing eyes with excellent vision.' },
      { id: 'chelicerae', name: 'Chelicerae and Fangs', x: 0.50, y: 0.19,
        text: 'Paired mouthparts ending in fangs, which inject venom from glands in the head region. Most spiders use venom to subdue prey in seconds. Their mouths are tiny, so food must be liquefied first.' },
      { id: 'pedipalps', name: 'Pedipalps', x: 0.69, y: 0.215,
        text: 'Short, leg-like feelers beside the mouth. Spiders use them to taste, touch and handle prey. In adult males they are modified into organs for transferring sperm.' },
      { id: 'cephalothorax', name: 'Cephalothorax (Prosoma)', x: 0.50, y: 0.40,
        text: 'The front body section joins head and chest. It carries the eyes, mouthparts and all eight legs, and holds the brain, the venom glands and a sucking stomach that pumps liquid food.' },
      { id: 'legs', name: 'Legs', x: 0.855, y: 0.275,
        text: 'Eight legs, each with seven segments. Leg muscles flex the joints and blood pressure extends them, like tiny hydraulic pistons. Fine hairs on the legs sense touch, taste and air movement.' },
      { id: 'slit', name: 'Slit Sense Organs', x: 0.755, y: 0.385,
        text: 'Near the leg joints are slit-shaped strain sensors in the cuticle. They detect tiny vibrations, which is how a spider feels prey struggling in a web or footsteps in the leaf litter.' },
      { id: 'tarsus', name: 'Claws and Scopulae', x: 0.93, y: 0.50,
        text: 'Leg tips have two or three tiny claws for gripping silk. Many hunting spiders also have dense pads of fine hairs (scopulae) that let them climb smooth surfaces.' },
      { id: 'heart', name: 'Heart (Dorsal Vessel)', x: 0.50, y: 0.58,
        text: 'A tube-like heart runs along the top of the abdomen. It pumps hemolymph through an open circulatory system. The blue-green tint comes from copper-based hemocyanin.' },
      { id: 'abdomen', name: 'Abdomen (Opisthosoma)', x: 0.50, y: 0.70,
        text: 'The rear body section holds the digestive organs, heart, reproductive organs, silk glands and breathing organs. It can swell after a big meal and is covered in a flexible cuticle.' },
      { id: 'lungs', name: 'Book Lungs (underside)', x: 0.38, y: 0.64,
        text: 'On the underside of the abdomen are slit-like openings to book lungs, stacks of thin plates through which oxygen enters the blood. Many spiders also breathe through air tubes called tracheae.' },
      { id: 'glands', name: 'Silk Glands', x: 0.60, y: 0.76,
        text: 'Inside the abdomen are up to seven kinds of silk gland. Each makes a different protein silk for draglines, capture threads, wrapping, egg sacs and more. The silk is liquid inside the body and hardens as it is drawn out.' },
      { id: 'spinnerets', name: 'Spinnerets', x: 0.50, y: 0.915,
        text: 'At the tip of the abdomen are usually six finger-like spinnerets covered in spigots. The spider uses them to draw, combine and shape silk into threads, sheets and egg sacs.' },
    ],
  };

  // ------------------------------------------------------------------ death notes
  const DEATH = {
    starved:    { title: 'Starved', flavor: 'Your reserves ran dry. In the micro world a meal is never guaranteed, and hunting is always a gamble.',
                  science: 'Adult spiders can survive weeks without food because they have low metabolic rates, but a hatchling has tiny reserves and needs small prey and water soon after emerging.' },
    dehydrated: { title: 'Dehydrated', flavor: 'The world was too dry and you never found enough water. A tiny body loses moisture fast.',
                  science: 'Small animals have a lot of surface area for their volume, so they dry out quickly. Spiders drink from dew and raindrops, and shelter in damp, shaded places during the heat of the day.' },
    eaten:      { title: 'Eaten', flavor: 'Something bigger and hungrier noticed you first. Everyone in the food web is somebody\'s lunch.',
                  science: 'Spiders are both predators and prey. Birds, wasps, centipedes, mantises, frogs and other spiders all eat them. Hiding, freezing, camouflage and escaping on a silk thread are all defences.' },
    exhausted:  { title: 'Exhausted', flavor: 'You pushed beyond your limits and your legs gave out.',
                  science: 'Spiders are built for short bursts of speed rather than endurance: their circulation delivers oxygen slowly, so they tire quickly and need time to recover.' },
    drowned:    { title: 'Drowned', flavor: 'The water took you. To a creature this small, a puddle is a lake.',
                  science: 'Water has surface tension strong enough to trap tiny animals. Some spiders, such as the diving bell spider, carry a bubble of air underwater, and others can skate on the surface, but most cannot.' },
    exposure:   { title: 'Exposed to the Elements', flavor: 'Rain and wind battered you with nowhere to hide.',
                  science: 'Rain, wind and cold are serious dangers for small spiders. That is why they shelter under leaves, in bark crevices, or in silk retreats when the weather turns.' },
    fell:       { title: 'Fell', flavor: 'The ground rushed up too fast.',
                  science: 'Very small animals survive falls well because air resistance slows them down, but nothing is guaranteed. Spiders dangle on a dragline to catch themselves when they slip.' },
    widow:      { title: 'Claimed by the Matriarch', flavor: 'She felt you long before you reached her, and she was ready.',
                  science: 'A widow lives at the centre of her tangle of silk and reads every tremor that travels along the threads, so an intruder rarely surprises her. Add a fast lunge, sticky silk and a powerful neurotoxin and she is a formidable hunter for her size.' },
    default:    { title: 'Your journey ends', flavor: 'The micro world is full of dangers, and this time it won.',
                  science: 'Only a small fraction of spiderlings survive to adulthood. That is why a single egg sac can hold so many eggs: most of the babies will not make it, and nature plans for that.' },
  };

  // -------------------------------------------------- fallback creature info (food web)
  const FALLBACK_KINDS = {
    springtail:  { name: 'Springtail', role: 'prey', diet: ['fungi', 'detritus'] },
    mite:        { name: 'Mite', role: 'prey', diet: ['fungi', 'detritus'] },
    aphid:       { name: 'Aphid', role: 'prey', diet: ['plant sap'] },
    midge:       { name: 'Midge', role: 'prey', diet: ['nectar', 'detritus'] },
    fruitfly:    { name: 'Fruit Fly', role: 'prey', diet: ['fungi', 'nectar'] },
    pillbug:     { name: 'Pillbug', role: 'prey', diet: ['detritus', 'fungi'] },
    caterpillar: { name: 'Caterpillar', role: 'prey', diet: ['plant leaves'] },
    moth:        { name: 'Moth', role: 'prey', diet: ['nectar'] },
    cricket:     { name: 'Cricket', role: 'prey', diet: ['plant leaves', 'detritus'] },
    grasshopper: { name: 'Grasshopper', role: 'prey', diet: ['plant leaves'] },
    beetle:      { name: 'Beetle', role: 'prey', diet: ['detritus', 'fungi'] },
    ant:         { name: 'Ant', role: 'neutral', diet: ['aphid', 'springtail', 'nectar'] },
    centipede:   { name: 'Centipede', role: 'predator', diet: ['springtail', 'mite', 'cricket', 'midge'] },
    groundbeetle:{ name: 'Ground Beetle', role: 'predator', diet: ['springtail', 'mite', 'pillbug', 'caterpillar'] },
    wasp:        { name: 'Wasp', role: 'predator', diet: ['caterpillar', 'fruitfly', 'aphid', 'nectar'] },
    mantis:      { name: 'Praying Mantis', role: 'predator', diet: ['fruitfly', 'moth', 'cricket', 'midge'] },
    bird:        { name: 'Bird', role: 'predator', diet: ['caterpillar', 'grasshopper', 'beetle', 'cricket', 'moth'] },
    wolfspider:  { name: 'Wolf Spider', role: 'spider', diet: ['cricket', 'ant', 'springtail', 'beetle'] },
    jumpingspider:{ name: 'Jumping Spider', role: 'spider', diet: ['midge', 'fruitfly', 'aphid', 'springtail'] },
  };

  // ------------------------------------------------------------------- objectives
  // reward totals are ~40-45% of each stage's growthNeeded (eating covers the rest)
  const rainy = () => { const w = Game.world && Game.world.weather; return !!(w && (w.type === 'rain' || w.type === 'drizzle') && (w.intensity == null || w.intensity > 0.15)); };
  const OBJECTIVES = [
    [ // hatchling
      { id: 'h_drink',   text: 'Drink from a dew drop (stand beside it, press E)', goal: 1, reward: 5,  ev: 'player:drank' },
      { id: 'h_eat',     text: 'Bite and eat 3 small creatures (J or click)',       goal: 3, reward: 8,  ev: 'player:ate' },
      { id: 'h_shelter', text: 'Hide in a shelter',                                 goal: 1, reward: 6,  ev: 'edu:shelter' },
      { id: 'h_night',   text: 'Survive until nightfall',                           goal: 1, reward: 10, ev: 'day:phase', match: { phase: 'night' } },
    ],
    [ // spiderling
      { id: 's_line',    text: 'Spin a dragline (press Space)',                     goal: 1, reward: 10, ev: 'web:spun', match: { type: 'line' } },
      { id: 's_trap',    text: 'Catch a creature in your web',                      goal: 1, reward: 22, ev: 'web:trapped' },
      { id: 's_eat',     text: 'Eat 5 creatures',                                   goal: 5, reward: 14, ev: 'player:ate' },
      { id: 's_bark',    text: 'Cross into the Old Oak Bark',                       goal: 1, reward: 18, ev: 'zone:enter', match: { zone: 'bark' }, visited: 'bark' },
    ],
    [ // juvenile
      { id: 'j_sheet',   text: 'Build a sheet web',                                 goal: 1, reward: 25, ev: 'web:spun', match: { type: 'sheet' } },
      { id: 'j_retreat', text: 'Spin a silk retreat',                               goal: 1, reward: 22, ev: 'web:spun', match: { type: 'retreat' } },
      { id: 'j_escape',  text: 'Survive a predator attack',                         goal: 1, reward: 30, ev: 'edu:escaped' },
      { id: 'j_explore', text: 'Explore the Old Oak Bark',                          goal: 60, reward: 35, track: 'exploreBark', unit: 'cells' },
    ],
    [ // sub-adult
      { id: 'a_orb',     text: 'Build an orb web',                                  goal: 1, reward: 35, ev: 'web:spun', match: { type: 'orb' } },
      { id: 'a_flyer',   text: 'Catch a flying insect in a web',                    goal: 1, reward: 55, ev: 'web:trapped', match: (d) => !!(d && d.creature && d.creature.flying) },
      { id: 'a_widow',   text: 'Defeat the Widow Matriarch in her lair (Old Oak Bark)', goal: 1, reward: 60, ev: 'boss:defeated', skip: () => !!(Game.unlocks && Game.unlocks.has('widow')) },
      { id: 'a_garden',  text: 'Visit the Flower Garden',                           goal: 1, reward: 40, ev: 'zone:enter', match: { zone: 'garden' }, visited: 'garden' },
      { id: 'a_rain',    text: 'Endure a rainstorm',                                goal: 20, reward: 50, track: 'rain', unit: 's' },
    ],
    [ // adult
      { id: 'x_mate',    text: 'Find a mate (follow the glowing trail)',            goal: 1, reward: 0,  ev: 'mate:found' },
      { id: 'x_court',   text: 'Court your mate (press E nearby; keep fed)',        goal: 1, reward: 0,  ev: 'courtship:done' },
      { id: 'x_lay',     text: 'Lay your egg sac in a hidden shelter',              goal: 1, reward: 0,  ev: 'game:victory' },
    ],
  ];

  // ------------------------------------------------------------------- match util
  function matches(m, d) {
    if (!m) return true;
    if (typeof m === 'function') return !!safe(() => m(d || {}), false);
    d = d || {};
    for (const k in m) {
      const want = m[k], got = d[k];
      if (Array.isArray(want)) { if (want.indexOf(got) < 0) return false; }
      else if (got !== want) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------- module
  const WIRED = ['stage:change', 'molt:start', 'molt:choose', 'molt:end', 'player:damaged', 'player:died', 'player:ate', 'player:drank',
    'player:rest', 'creature:seen', 'creature:killed', 'creature:attack', 'web:spun', 'web:trapped', 'web:destroyed', 'zone:enter',
    'day:phase', 'weather:change', 'mate:found', 'courtship:done', 'game:victory', 'player:revived', 'boss:start', 'boss:defeated', 'species:unlocked'];

  const edu = {
    priority: 50,
    CATEGORIES, FACTS, STAGE_LORE, ANATOMY, DEATH, OBJECTIVE_DEFS: OBJECTIVES,
    unlocked: new Set(),          // persisted
    seenKinds: new Set(),         // persisted bestiary discoveries
    recent: [],                   // fact ids unlocked in this run (newest last)
    objectives: [],
    stage: 0,
    stats: {},                    // per-run counters
    stageTimes: [],               // seconds spent in each stage (this run)
    visited: {},                  // zones entered this run
    flags: {},
    _queue: [], _counts: {}, _factCounts: {}, _wired: false, _timeFacts: [],

    // ------------------------------------------------------------ lifecycle
    init() {
      const saved = Game.store.get('facts', []);
      edu.unlocked = new Set(Array.isArray(saved) ? saved : []);
      const sk = Game.store.get('seenKinds', []);
      edu.seenKinds = new Set(Array.isArray(sk) ? sk : []);
      edu._timeFacts = FACTS.filter(f => f.unlockOn && f.unlockOn.event === 'edu:time');
      if (edu._wired) return;
      edu._wired = true;
      WIRED.forEach(evt => Game.on(evt, (d) => edu.onEvent(evt, d)));
      Game.on('creature:seen', (d) => {
        if (d && d.kind && !edu.seenKinds.has(d.kind)) { edu.seenKinds.add(d.kind); Game.store.set('seenKinds', Array.from(edu.seenKinds)); }
      });
    },

    reset() {
      edu.recent = []; edu.objectives = []; edu.stats = { ate: 0, spun: 0, trapped: 0, molts: 0, kills: 0, drank: 0, damage: 0, objectives: 0, dist: 0 };
      edu.stageTimes = []; edu.visited = {}; edu._counts = {}; edu._factCounts = {};
      edu.flags = { moved: false, drank: false, ate: false, spun: false, sheet: false, orb: false, retreat: false, hidden: false, sprinted: false, sheltered: false, rested: false };
      edu._acc = { sprint: 0, hidden: 0, rain: 0, poll: 0, exploreT: 0 };
      edu._lastX = null; edu._lastY = null; edu._wasSheltered = false; edu._attackAt = -1; edu._stageStartT = 0;
      edu._hungryDone = false; edu._lowSilkDone = false; edu._exploreCells = 0;
      edu.stage = safe(() => (P() && P().stage) || 0, 0);
      edu.buildStage(edu.stage);
    },

    // ----------------------------------------------------------- facts API
    unlock(id) {
      if (edu.unlocked.has(id)) return false;
      const f = edu.fact(id); if (!f) return false;
      edu.unlocked.add(id);
      edu.recent.push(id);
      Game.store.set('facts', Array.from(edu.unlocked));
      Game.emit('fact:unlock', { id, title: f.title });
      Game.emit('sfx', { name: 'unlock', vol: 0.8 });
      return true;
    },
    fact(id) { for (let i = 0; i < FACTS.length; i++) if (FACTS[i].id === id) return FACTS[i]; return null; },
    isUnlocked(id) { return edu.unlocked.has(id); },
    factsByCategory(cat) { return cat ? FACTS.filter(f => f.category === cat) : FACTS.slice(); },
    counts(cat) {
      const list = edu.factsByCategory(cat); let n = 0;
      list.forEach(f => { if (edu.unlocked.has(f.id)) n++; });
      return { unlocked: n, total: list.length };
    },
    hasSeen(kind) { return edu.seenKinds.has(kind) || !!safe(() => Game.creatures.visibleKinds.has(kind), false); },
    resetProgress() { edu.unlocked = new Set(); edu.seenKinds = new Set(); Game.store.set('facts', []); Game.store.set('seenKinds', []); },

    // -------------------------------------------------------------- events
    onEvent(evt, d) {
      d = d || {};
      const s = edu.stats;
      switch (evt) {
        case 'player:ate': s.ate++; edu.flags.ate = true; break;
        case 'player:drank': s.drank++; edu.flags.drank = true; break;
        case 'web:spun':
          s.spun++; edu.flags.spun = true;
          if (d.type === 'sheet') edu.flags.sheet = true; else if (d.type === 'orb') edu.flags.orb = true; else if (d.type === 'retreat') edu.flags.retreat = true;
          break;
        case 'web:trapped': s.trapped++; break;
        case 'creature:killed': s.kills++; break;
        case 'player:damaged': s.damage += d.amount || 0; break;
        case 'player:rest': if (d.on) edu.flags.rested = true; break;
        case 'zone:enter': if (d.zone) edu.visited[d.zone] = true; break;
        case 'creature:attack': edu._attackAt = Game.time.t; break;
        case 'stage:change': edu.onStageChange(d); break;
        case 'molt:end': s.molts++; break;
        default: break;
      }
      edu.fire(evt, d);
    },

    // dispatch a (real or pseudo) event to facts + objectives
    fire(evt, d) {
      d = d || {};
      for (let i = 0; i < FACTS.length; i++) {
        const f = FACTS[i], u = f.unlockOn;
        if (!u || u.event !== evt || edu.unlocked.has(f.id)) continue;
        if (!matches(u.match, d)) continue;
        const n = (edu._factCounts[f.id] = (edu._factCounts[f.id] || 0) + 1);
        if (n >= (u.count || 1)) edu.unlock(f.id);
      }
      for (let i = 0; i < edu.objectives.length; i++) {
        const o = edu.objectives[i];
        if (o.done || o.ev !== evt || !matches(o.match, d)) continue;
        edu.progress(o, (o.progress || 0) + 1);
      }
    },

    onStageChange(d) {
      const t = Game.time.t, st = (d && typeof d.stage === 'number') ? d.stage : safe(() => P().stage, edu.stage);
      // record time spent in the previous stage
      edu.stageTimes[edu.stage] = (edu.stageTimes[edu.stage] || 0) + Math.max(0, t - edu._stageStartT);
      edu._stageStartT = t;
      edu.stage = st;
      edu.buildStage(st);
    },

    // ---------------------------------------------------------- objectives
    buildStage(st) {
      const defs = OBJECTIVES[Math.min(st, OBJECTIVES.length - 1)] || [];
      edu.objectives = [];
      edu._queue = defs.filter(d => !(d.skip && d.skip())).map(d => Object.assign({}, d));   // `skip`: objectives that no longer apply (a spider already unlocked)
      edu._exploreCells = 0;
      edu.refill();
    },
    refill() {
      while (edu.objectives.length < 3 && edu._queue.length) {
        const d = edu._queue.shift();
        const o = { id: d.id, text: d.text, progress: 0, goal: d.goal, done: false, reward: { growth: d.reward || 0 }, ev: d.ev, match: d.match, track: d.track, unit: d.unit, bornAt: Game.time.t, doneAt: 0 };
        edu.objectives.push(o);
        Game.emit('objective:new', { id: o.id });
        // already satisfied? (e.g. a zone entered during an earlier stage)
        if (d.visited && edu.visited[d.visited]) edu.progress(o, o.goal);
      }
    },
    progress(o, value) {
      if (o.done) return;
      o.progress = Math.min(o.goal, Math.max(o.progress, value));
      if (o.progress >= o.goal) edu.complete(o);
    },
    complete(o) {
      if (o.done) return;
      o.done = true; o.progress = o.goal; o.doneAt = Game.time.t;
      edu.stats.objectives++;
      Game.emit('objective:complete', { id: o.id });
      Game.emit('sfx', { name: 'levelup', vol: 0.55 });
      const g = o.reward && o.reward.growth;
      if (g > 0 && Game.player && Game.player.addGrowth) { try { Game.player.addGrowth(g); } catch (e) { Game.reportError('edu.addGrowth', e); } }
    },

    // ------------------------------------------------------------- update
    update(dt) {
      const p = P(); if (!p) return;
      const t = Game.time.t, a = edu._acc;
      // stage change that wasn't announced by event
      if (typeof p.stage === 'number' && p.stage !== edu.stage) edu.onStageChange({ stage: p.stage });
      // timed facts
      for (let i = 0; i < edu._timeFacts.length; i++) {
        const f = edu._timeFacts[i];
        if (!edu.unlocked.has(f.id) && t >= f.unlockOn.at) edu.unlock(f.id);
      }
      // remove finished objectives after a short celebration, then refill
      for (let i = edu.objectives.length - 1; i >= 0; i--) {
        const o = edu.objectives[i];
        if (o.done && t - o.doneAt > 4) edu.objectives.splice(i, 1);
      }
      edu.refill();
      if (p.dead) return;
      // movement
      if (edu._lastX != null) {
        const d = Math.hypot(p.x - edu._lastX, p.y - edu._lastY);
        if (d < 80) edu.stats.dist += d;
      }
      edu._lastX = p.x; edu._lastY = p.y;
      if (!edu.flags.moved && edu.stats.dist > 150) { edu.flags.moved = true; edu.fire('edu:moved'); }
      // sprint
      if (p.stateLabel === 'sprinting') { a.sprint += dt; if (!edu.flags.sprinted && a.sprint > 1) { edu.flags.sprinted = true; edu.fire('edu:sprint'); } }
      // hidden
      if (p.hidden && !p.resting) { a.hidden += dt; } else if (!p.hidden) a.hidden = 0;
      if (!edu.flags.hidden && (a.hidden > 1.5 || (p.hidden && p.resting))) { edu.flags.hidden = true; edu.fire('edu:hidden'); }
      // shelter entry
      const sh = !!safe(() => Game.world && Game.world.shelterAt && Game.world.shelterAt(p.x, p.y), false) || !!safe(() => Game.webs && Game.webs.isSheltered && Game.webs.isSheltered(p.x, p.y), false);
      if (sh && !edu._wasSheltered) { edu.flags.sheltered = true; edu.fire('edu:shelter'); }
      edu._wasSheltered = sh;
      // low meters
      if (!edu._hungryDone && p.hunger < 40) { edu._hungryDone = true; edu.fire('edu:hungry'); }
      if (!edu._lowSilkDone && p.stage >= 1 && p.silk < 10 && p.maxSilk > 20) { edu._lowSilkDone = true; edu.fire('edu:lowsilk'); }
      // escaped a predator: survived 8 s after an attack
      if (edu._attackAt >= 0 && t - edu._attackAt >= 8) { edu._attackAt = -1; edu.fire('edu:escaped'); }
      // polled objectives (rain, exploring)
      a.poll += dt;
      const raining = rainy();
      for (let i = 0; i < edu.objectives.length; i++) {
        const o = edu.objectives[i]; if (o.done || !o.track) continue;
        if (o.track === 'rain') { if (raining) { o.progress = Math.min(o.goal, o.progress + dt); if (o.progress >= o.goal) edu.complete(o); } }
        else if (o.track === 'exploreBark' && a.poll > 0.5) { edu.progress(o, edu.exploredIn('bark')); }
      }
      if (a.poll > 0.5) a.poll = 0;
    },

    // number of explored minimap cells inside a zone (falls back to 0 if no fog grid)
    exploredIn(zoneId) {
      const w = Game.world; if (!w || !w.explored) return edu.visited[zoneId] ? 0 : 0;
      const z = C.ZONES.find(zz => zz.id === zoneId); if (!z) return 0;
      const cell = (typeof w.exploredCell === 'number' && w.exploredCell) || 64;
      const gw = Math.ceil(C.WORLD_W / cell), gh = Math.ceil(C.WORLD_H / cell);
      const ex = w.explored; let n = 0;
      const c0 = Math.floor(z.x0 / cell), c1 = Math.min(gw - 1, Math.floor((z.x1 - 1) / cell));
      const twoD = ex.length && typeof ex[0] === 'object';
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = c0; cx <= c1; cx++) { if (twoD ? (ex[cy] && ex[cy][cx]) : ex[cy * gw + cx]) n++; }
      }
      edu._exploreCells = n; return n;
    },

    // ----------------------------------------------------------------- tip()
    tip() {
      const p = P(); if (!p || p.dead) return '';
      const f = edu.flags, t = Game.time.t, st = p.stage || 0;
      const w = (Game.world && Game.world.weather) || null;
      const danger = (Game.state && Game.state.danger) || 0;
      if (p.molting || p.moltTimer > 0) return 'Freshly molted: your shell is soft. Stay hidden until it hardens.';
      if (danger > 0.55) return 'Danger close! Sprint away (Shift) or slip into cover; predators lose you when you hide.';
      const cr = Game.creatures;
      if (cr && cr.alarms && cr.alarms.length) return 'Your siblings spotted a predator nearby! If it is off-screen a red arrow points to it. Move away or hide.';
      if (t < 12 && !f.moved) return 'Move with W A S D or the arrow keys. Hold Z to zoom out and see the bigger picture.';
      if (p.hydration < 45 && !f.drank) return 'Thirsty? Walk up to a glistening dew drop and press E to drink.';
      if (p.hydration < 30) return 'You are very thirsty. Find dew drops and press E to drink.';
      if (p.hunger < 45 && !f.ate) return 'Hungry? Press J (or click) to bite small creatures such as springtails and mites.';
      if (p.hunger < 30) return 'You are starving. Catch small prey: bite with J or left click.';
      if (p.energy < 28) return 'Out of energy. Press R to rest; resting hidden in a shelter recovers 3 times faster' + (cr && cr.count && cr.count('kin') ? ', and siblings huddle in close to help.' : '.');
      if (p.hp < p.maxHp * 0.35) return 'You are badly hurt. Hide and rest to heal while your food and water are high.';
      if (w && (w.type === 'rain' || w.type === 'drizzle') && Game.world && Game.world.exposure && Game.world.exposure(p.x, p.y) > 0.6 && st < 3) return 'Rain hurts small spiders in the open. Shelter under a leaf, in bark, or in a silk retreat.';
      if (st >= 1 && !f.spun) return 'Press Space to spin silk. Use 1-4 to choose a web type. A dragline is a quick safety line.';
      if (st >= 2 && !f.sheet && p.silk >= 25) return 'Sheet webs (key 2) entangle prey walking across them. Sit beside one and wait.';
      if (st >= 2 && !f.retreat && p.silk >= 30) return 'Silk Retreat (key 4): a safe tent for resting and for the soft time after a molt.';
      if (st >= 3 && !f.orb && p.silk >= 45) return 'Orb webs (key 3) catch flying insects. Build one where the air is busy, near flowers.';
      if (st === 4 && Game.state && !(p.mate && p.mate.found)) return 'Adulthood: follow the glowing trail to find a mate. Eat first; courtship needs strength.';
      if (st === 4 && p.mate && p.mate.found && !p.mate.courted) return 'Press E next to the mate to court. You need hunger above 35%.';
      if (st === 4 && p.mate && p.mate.courted && !p.mate.laid) return 'Find a hidden egg site (a hollow or shelter) and press E to lay your egg sac.';
      if (Game.world && Game.world.isNight && Game.world.isNight() && t > 20) { return 'Night: darker, and some predators are more active. Vibration Sense shows nearby creatures.'; }
      if (t < 120 && cr && cr.siblings > 0 && Game.state.mode !== 'survival') return 'Your siblings will give their lives to bring you back if you fall: one sibling, one revive. They drift away as you grow.';
      if (t < 90 && !f.hidden) return 'Predators track movement. Press R while hidden to rest and recover.';
      if (t < 150) return 'Press B to open your Codex, and F for Science Mode.';
      return '';
    },

    // ---------------------------------------------------------- science mode
    scienceInfo(e) {
      const lines = [];
      if (!e) return lines;
      const mm = (r) => (Math.round(r * 2 / 5 * 10) / 10) + ' mm';
      const p = P();
      // player
      if (e === p || (e.stage !== undefined && e.hunger !== undefined)) {
        const st = C.STAGES[e.stage] || C.STAGES[0];
        lines.push('You: ' + st.name + ' ' + (e.species && e.species.id !== C.SPECIES[0].id ? e.species.name : 'spider'));
        lines.push('Body length: about ' + mm(e.radius || st.radius) + ' (to scale)');
        lines.push('Speed x' + (e.speedMul != null ? e.speedMul.toFixed(2) : '1.00') + ' - bite x' + (e.biteMul != null ? e.biteMul.toFixed(2) : '1.00'));
        lines.push('Stealth ' + Math.round((e.stealth != null ? e.stealth : 1) * 100) + '% detectable - senses within ' + Math.round(e.senseRadius || 0) + ' px');
        lines.push(e.hidden ? 'Hidden: predators must be very close to find you.' : 'Visible: predators can spot you from afar.');
        lines.push('A spider\'s exoskeleton must be shed to grow, and each molt carries risk.');
        return lines;
      }
      // creature
      if (e.kind) {
        const K = KINDS(), k = (K && K[e.kind]) || FALLBACK_KINDS[e.kind] || null;
        const name = (k && k.name) || titleize(e.kind);
        lines.push(name + (k && k.latin ? ' (' + k.latin + ')' : ''));
        lines.push('Role: ' + (e.role || (k && k.role) || 'creature') + ' - body length about ' + mm(e.radius || (k && k.radius) || 6));
        if (e.maxHp != null) lines.push('Health ' + Math.max(0, Math.round(e.hp)) + ' / ' + Math.round(e.maxHp) + ' - state: ' + (e.state || 'idle'));
        const eatable = safe(() => Game.creatures.canEat(p.radius, e), null);
        if (eatable !== null && (e.role === 'prey' || e.role === 'neutral')) lines.push(eatable ? 'Edible: small enough to bite.' : 'Too big to bite. Trap it in a web first.');
        if (k && k.danger) lines.push('Danger: about ' + k.danger + ' damage per second if it catches you.');
        if (k && k.diet && k.diet.length) lines.push('Eats: ' + k.diet.map(titleize).join(', '));
        if (k && k.nocturnal != null) lines.push((k.nocturnal ? 'Most active at night' : 'Most active by day') + (e.flying || (k && k.flying) ? ', flies' : ''));
        if (k && k.fact) lines.push(k.fact);
        return lines;
      }
      // web
      if (e.type && C.WEB_TYPES[e.type] && (e.integrity !== undefined)) {
        const wt = C.WEB_TYPES[e.type];
        lines.push(wt.name + ' - strength ' + Math.round(e.integrity * 100) + '%');
        lines.push('Holding ' + ((e.trapped && e.trapped.length) || 0) + ' creature(s) - age ' + Math.round(e.age || 0) + ' s');
        const blurb = {
          line: 'A dragline is the strong, non-sticky silk spiders use as a safety line and to lay trails.',
          sheet: 'Sheet webs catch walking prey: threads above knock insects down onto the sheet.',
          orb: 'Orb webs: strong radial threads and a sticky spiral. Vibrations tell the spider where prey is.',
          retreat: 'A silk retreat hides a spider from predators and shelters it from wind and rain.',
        }[e.type];
        if (blurb) lines.push(blurb);
        lines.push('Silk is a protein made as a liquid and drawn into a solid thread by the spinnerets.');
        return lines;
      }
      // resource
      if (e.type === 'dew' || e.type === 'nectar') {
        lines.push(e.type === 'dew' ? 'Dew drop' : 'Nectar');
        if (e.amount != null) lines.push('Remaining: ' + Math.round(e.amount) + ' / ' + Math.round(e.max || e.amount));
        lines.push(e.type === 'dew' ? 'Dew forms when surfaces cool below the air\'s dew point. Spiders drink it.' : 'Flower nectar is sugar water made to attract pollinators. It gives a spider a small energy boost.');
        return lines;
      }
      // shelter
      if (e.safety !== undefined) {
        lines.push('Shelter (' + (e.type || 'crevice') + ') - safety ' + Math.round(e.safety * 100) + '%');
        if (e.eggSite) lines.push('A good hidden site to lay an egg sac.');
        lines.push('Hiding places lower the chance a predator notices a still spider.');
        return lines;
      }
      return lines;
    },

    // ------------------------------------------------------------ food web
    // nodes: {id, name, level, role, type:'creature'|'resource'|'player', kind}
    // edges: {from: eatenId, to: eaterId}
    foodWeb() {
      const K = KINDS();
      const src = {};
      if (K) Object.keys(K).forEach(id => { const k = K[id]; src[id] = { name: k.name || titleize(id), role: k.role || 'prey', diet: Array.isArray(k.diet) ? k.diet : [], eats: Array.isArray(k.eats) ? k.eats : [] }; });
      else Object.keys(FALLBACK_KINDS).forEach(id => { src[id] = FALLBACK_KINDS[id]; });
      const nodes = [], edges = [], byId = {}, seen = {};
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const idByNorm = {}; Object.keys(src).forEach(id => { idByNorm[norm(id)] = id; });
      const resolve = (d) => { const n = norm(d); return idByNorm[n] || (idByNorm[n.replace(/s$/, '')]) || null; };
      // free-text diet entries collapse into a few producer / decomposer resources so the web stays readable
      const RES = [
        ['fungi', 'Fungi and Mould', /fung|yeast|lichen|mould|mold/],
        ['decay', 'Decaying Plant Matter', /decay|detritus|rotting|plant matter|dead plant|leaf litter/],
        ['nectar', 'Nectar and Honeydew', /nectar|honeydew|pollen/],
        ['plant', 'Plants and Plant Sap', /sap|phloem|leaves|leaf|plants|grass|cabbage|seed|foliage/],
      ];
      const category = (d) => { const t = String(d).toLowerCase(); for (let i = 0; i < RES.length; i++) if (RES[i][2].test(t)) return RES[i]; return null; };
      const link = (from, to) => { const key = from + '>' + to; if (seen[key] || from === to) return; seen[key] = 1; edges.push({ from, to }); };
      const resNode = (id, name) => { if (!byId[id]) { const n = { id, name, role: 'resource', type: 'resource', level: 0 }; nodes.push(n); byId[id] = n; } return id; };
      Object.keys(src).forEach(id => { const n = { id, name: src[id].name, role: src[id].role, type: 'creature', kind: id, level: 1 }; nodes.push(n); byId[id] = n; });
      Object.keys(src).forEach(id => {
        const eats = (src[id].eats || []).filter(e => src[e] && e !== id);
        eats.forEach(e => link(e, id));
        (src[id].diet || []).forEach(d => {
          const k = resolve(d);
          if (k) { if (!eats.length) link(k, id); return; }
          const c = category(d);
          if (c) link(resNode('res:' + c[0], c[1]), id);
          else if (!K) link(resNode('res:' + norm(d), titleize(d)), id);
        });
      });
      // the player: eats small prey, is eaten by predators
      const pn = { id: 'player', name: 'You (spider)', role: 'player', type: 'player', level: 2 };
      nodes.push(pn); byId.player = pn;
      Object.keys(src).forEach(id => { if (src[id].role === 'prey') edges.push({ from: id, to: 'player' }); });
      // trophic levels by relaxation (cycles are cut by the pass limit)
      for (let pass = 0; pass < 6; pass++) {
        edges.forEach(e => { const a = byId[e.from], b = byId[e.to]; if (b.level < a.level + 1 && b.type !== 'resource') b.level = Math.min(5, a.level + 1); });
      }
      // predators that eat the player
      Object.keys(src).forEach(id => { if (src[id].role === 'predator') edges.push({ from: 'player', to: id, risk: true }); });
      return { nodes, edges };
    },
  };

  Game.register('edu', edu);
})();
