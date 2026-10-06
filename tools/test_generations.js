// Test script for Territory generations (src/territory.js with player.js, creatures.js and edu.js hooks).
// Run: node tools/test_generations.js
//   - dying with heirs left: the Succession card, then an heir at the nearest owned shelter with the Setback (growth -50%, meters 50, silk 0, shaken for a day, nearby heirloom webs shaken)
//   - dying with none left: the lineage ends (summary, the slot is freed, the Hall of Lines remembers it); "Found a New Line" starts fresh in the same slot
//   - a mother laying her egg sac at an egg site starts the Legacy scene: clutch size (pantry, condition, rank, lateness), trait slots, 15% mutation
//   - the winter fast-forward report, then the next generation: inherited traits (one level below the mother's), heirs, the Home Site, webs and Claim Points carried over
const H = require('./harness.js');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= e;

function territory(G, o) {
  o = o || {};
  G.newGame('territory', o.species || 'garden', { slot: o.slot || 1, name: o.name || 'Heirs' });
  const P = G.player; P.debugSetStage(o.stage == null ? 3 : o.stage); P.silk = 200; P.hp = P.maxHp; P.hunger = P.hydration = P.energy = 90;
  return G;
}
function tp(P, x, y) { P.inShelter = null; P.x = x; P.y = y; P.vx = P.vy = 0; }
function spin(G, type) { const P = G.player; P.silk = 300; G.webs.select(type); const n = G.webs.list.length; G.webs.spin(type); H.run(2.5); return G.webs.list.length > n ? G.webs.list[G.webs.list.length - 1] : null; }
function die(G, cause) { const P = G.player; P.invuln = 0; P.damage(99999, cause || 'wasp'); H.run(3.5); }

// ================================================================ succession
let G = territory(H.load({ tolerant: true }), { name: 'Succession' });
let T = G.territory, P = G.player, W = G.world;
const log = []; ['succession', 'player:died', 'player:respawned', 'lineage:ended'].forEach(e => G.on(e, d => log.push(e)));
P.upgrades.speed = 3; P.upgrades.camo = 1; P.applyUpgrades(false); P.growth = 300; H.run(2);
const retreat = spin(G, 'retreat'), heir = G.webs.list.find(w => w.type === 'retreat'); T.markHeirloom(heir);
const near1 = spin(G, 'sheet'); if (near1) { T.markHeirloom(near1); near1.integrity = 1; } heir.integrity = 1;
const heirloomWebs = T.heirloomWebs().slice(); heirloomWebs.forEach(w => { w.integrity = 1; });
const home = { x: T.home.x, y: T.home.y };
die(G, 'wasp');
ok(P.dead && G.state.scene === 'succession' && T.succession && T.succession.heirsLeft === 4 && T.succession.cause === P.deathCause, 'dying with heirs left opens the Succession card (4 heirs would remain, cause ' + P.deathCause + ')');
ok(T.lineage.heirs === 5 && T.currentGeneration().deaths.length === 1 && T.currentGeneration().deaths[0].cause === P.deathCause && T.currentGeneration().deaths[0].stage === 3, 'the heir is not spent until she steps forward; the death is on the record');
ok(!P.reviving && G.save.write(1, 'manual') === false && G.save.lastError === 'busy', 'Brood\'s sibling revive is off, and nothing is saved while the card is up');
const integ0 = heirloomWebs.map(w => w.integrity);
const growth0 = P.growth;
ok(T.completeSuccession() === true && G.state.scene === 'playing' && !P.dead && T.lineage.heirs === 4 && T.succession === null, 'completing the succession puts an heir in the field (4 heirs left)');
ok(near(P.growth, growth0 * 0.5, 2) && P.stage === 3 && P.upgrades.speed === 3 && P.upgrades.camo === 1, 'she keeps her stage and traits but loses half her growth (' + growth0.toFixed(0) + ' -> ' + P.growth.toFixed(0) + ')');
ok(P.hunger === 50 && P.hydration === 50 && P.energy === 50 && P.silk <= 3, 'meters restart at 50 and the silk is gone (' + [P.hunger, P.hydration, P.energy, Math.round(P.silk)].join('/') + ')');
ok(near(Math.hypot(P.x - home.x, P.y - home.y), 0, 1000) && P.shaken > 250 && P.invuln > 2, 'the heir appears at an owned shelter, shaken for a day and briefly protected (shaken ' + Math.round(P.shaken) + ' s, invuln ' + P.invuln.toFixed(1) + ' s)');
const loss = heirloomWebs.map((w, i) => integ0[i] - w.integrity);
ok(loss.some(l => l > 0.15) && heirloomWebs.every(w => w.integrity > 0 && !w.dying), 'heirloom webs near where she fell are shaken (-' + loss.map(l => l.toFixed(2)).join(', -') + ') but none is lost');
ok(G.creatures.siblings === 4 && (G.state.stats.successions || 0) === 1 && log.filter(x => x === 'succession').length === 1, 'the kin on screen match the heirs left and the succession is counted');
// shaken: 15% slower for one day
function topSpeed() { tp(P, T.home.x - 300, T.home.y - 300); P.vx = P.vy = 0; let v = 0; G.input.inject.keyDown('KeyD'); H.run(1.2, { onFrame: () => { P.hp = P.maxHp; } }); v = Math.hypot(P.vx, P.vy); G.input.inject.keyUp('KeyD'); H.run(0.2); return v; }
P.invuln = 99999; P.shaken = 200; const vs = topSpeed(); P.shaken = 0; const vn = topSpeed();
ok(vs > 0 && near(vs / vn, 0.85, 0.06), 'while shaken she is 15% slower (' + vs.toFixed(0) + ' vs ' + vn.toFixed(0) + ' px/s)');
P.shaken = 0.4; H.run(1); ok(P.shaken === 0, 'and recovers after a day');
// the next deaths use up the heirs one by one
let guard = 0; while (T.lineage.heirs > 0 && guard++ < 10) { P.invuln = 0; die(G, 'spider'); if (G.state.scene === 'succession') T.completeSuccession(); H.run(0.2); }
ok(T.lineage.heirs === 0 && G.state.scene === 'playing' && G.state.stats.successions === 5, 'the other four heirs step forward in turn (successions: ' + G.state.stats.successions + ')');

// ================================================================ the last one dies: the lineage ends
G.save.write(1, 'manual');
ok(G.save.slots()[0].empty === false, 'the lineage is saved in slot 1');
P.growth = 100; die(G, 'eaten');
ok(G.state.scene === 'lineageended' && !!T.ended && T.ended.generations === 1 && T.ended.deaths === 6 && T.ended.cause === 'eaten', 'with no heirs left the line ends (' + (T.ended && (T.ended.deaths + ' deaths')) + ')');
ok(log.indexOf('lineage:ended') >= 0 && T.ended.name === 'Succession' && T.ended.rankName === 'Claim' && typeof T.ended.longest.seconds === 'number', 'the summary has the name, rank and the longest-lived body');
const slot1 = G.save.slots()[0];
ok(slot1.empty && slot1.hall.length === 1 && slot1.hall[0].name === 'Succession' && G.save.read(1) === null, 'the slot is freed and the line goes to its Hall of Lines');
ok(G.save.write(1, 'manual') === false, 'a finished line cannot be saved again');
G.territory.foundNewLine(); H.run(1);
T = G.territory; P = G.player; W = G.world;
ok(G.state.scene === 'playing' && G.state.mode === 'territory' && G.state.slot === 1 && T.lineage.heirs === 5 && T.lineage.generations.length === 1 && T.cp === 0 && T.rank === 1 && T.ended === null, 'Found a New Line starts over in the same slot (5 heirs, generation 1, 0 CP)');
ok(W.dayCount === 0 && P.stage === 0 && T.heirloomWebs().length === 0 && G.webs.list.length === 0 && G.save.slots()[0].hall.length === 1, 'a new calendar and no webs, while the Hall remembers the old line');
ok(G.errors.length === 0, 'no errors');

// ================================================================ laying: the clutch
function mother(G, o) {
  o = o || {};
  const t = G.territory, p = G.player, w = G.world;
  p.debugSetStage(4); p.silk = 300; p.upgrades = Object.assign({ speed: 0, silk: 0, camo: 0, venom: 0, carapace: 0, vibration: 0, metabolism: 0 }, o.ups || { speed: 3, silk: 2, carapace: 1 }); p.applyUpgrades(false);
  p.hp = p.maxHp; p.hunger = p.hydration = p.energy = o.meters == null ? 90 : o.meters;
  w.dayCount = o.day == null ? 20 : o.day; w.time01 = 0.2; H.run(1);
  return t;
}
G = territory(H.load({ tolerant: true }), { stage: 4, name: 'Clutch' }); T = G.territory; P = G.player; W = G.world;
T.rng = () => 0.5;
mother(G, { day: 20 });
const prev = (pantry, o) => { T.pantry = []; for (let i = 0; i < pantry; i++) T.pantry.push({ id: 100 + i, kind: 'cricket', nutrition: 10, fresh: 1, day: 0 }); if (o && o.day != null) W.dayCount = o.day; if (o && o.meters != null) P.hunger = P.hydration = P.energy = o.meters; if (o && o.rank) { T.cp = o.rank === 3 ? 75 : 0; T.rank = o.rank; } H.run(0.1, { onFrame: () => { P.hp = P.maxHp; } }); return T.clutchPreview(); };
let cp = prev(0); ok(cp.raw === 4 && cp.total === 4 && cp.pantry === 0 && cp.condition === 1 && cp.mult === 1, 'a healthy mother with an empty pantry lays 4 (3 + condition): ' + JSON.stringify(cp));
cp = prev(7); ok(cp.pantry === 1 && cp.total === 5, '7 bundles in the pantry add 1 (every 5): ' + cp.total);
cp = prev(30); ok(cp.pantry === 3 && cp.total === 7, 'the pantry adds at most 3: ' + cp.total);
cp = prev(7, { meters: 50 }); ok(cp.condition === 0 && cp.total === 4, 'a hungry, thirsty or tired mother loses the condition point: ' + cp.total);
cp = prev(7, { meters: 90, day: 20 }); P.hp = P.maxHp * 0.5; cp = T.clutchPreview(); ok(cp.condition === 0, 'so does one who is badly hurt');
P.hp = P.maxHp;
cp = prev(7, { day: 26 }); ok(cp.mult === 1 && cp.total === 5, 'day 27 is the last day without a lateness penalty (day ' + cp.day + ')');
cp = prev(7, { day: 27 }); ok(cp.mult === 0.7 && cp.total === Math.round(5 * 0.7), 'from day 28 the clutch is 70% (' + cp.total + ')');
cp = prev(7, { day: 32 }); ok(cp.mult === 0.4 && cp.total === Math.round(5 * 0.4), 'from day 33 it is 40% (' + cp.total + ')');
cp = prev(0, { day: 35, meters: 10 }); ok(cp.total >= 1, 'a clutch is never smaller than 1 (' + cp.total + ')');
T.cp = 0; T.rank = 1; cp = prev(30, { day: 20, meters: 90 }); const rank1 = cp.total;
T.addCP(75, 'test'); cp = T.clutchPreview(); ok(T.rank === 3 && cp.rank === 1 && cp.total === rank1 + 1, 'a Domain adds one heir to every clutch (' + rank1 + ' -> ' + cp.total + ')');
T.addCP(225, 'test'); cp = T.clutchPreview(); ok(T.rank === 5 && cp.rank === 2 && cp.total === rank1 + 2, 'a Dominion adds two');

// ================================================================ laying: the Legacy scene
G = territory(H.load({ tolerant: true }), { stage: 4, name: 'Legacy' }); T = G.territory; P = G.player; W = G.world;
T.rng = () => 0.5;
const gens = []; ['territory:generation_end', 'territory:generation_begin', 'season:change', 'territory:claimed'].forEach(e => G.on(e, d => gens.push(e.replace('territory:', '') + (d && d.season ? ':' + d.season : ''))));
mother(G, { day: 22 });
H.run(1); const hollow = spin(G, 'retreat'); const hw = G.webs.list.find(w => w.type === 'retreat'); T.markHeirloom(hw); const lineW = (() => { tp(P, P.x + 130, P.y + 60); return spin(G, 'line'); })();
for (let i = 0; i < 7; i++) T.pantry.push({ id: 10 + i, kind: 'cricket', nutrition: 14, fresh: 1, day: 22 });
const homeId = T.home.shelterId, siteSh = W.shelters.find(s => s.id === homeId); tp(P, siteSh.x, siteSh.y); P.mate.found = P.mate.courted = true; P.hunger = P.hydration = P.energy = 90; H.run(0.5);
const preview = T.clutchPreview();
H.press('KeyE'); H.run(7);
const L = T.legacy;
ok(G.state.scene === 'legacy' && !!L && L.generation === 1 && gens.indexOf('generation_end') >= 0, 'laying the egg sac at an egg site opens the Legacy scene');
ok(L.clutch.total === preview.total && L.clutch.total === 5 && L.site.id === homeId && L.season === 'autumn', 'it carries the clutch (' + L.clutch.total + '), the site (' + L.site.id + ') and the season (' + L.season + ')');
ok(L.candidates.map(c => c.id + ':' + c.level + '>' + c.passes).join() === 'speed:3>2,silk:2>1,carapace:1>1', 'the mother\'s traits are offered one level lower, never below 1 (' + L.candidates.map(c => c.id + ':' + c.level + '>' + c.passes).join() + ')');
ok(L.slots === 1 && L.chosen.join() === 'speed' && L.mutation === null, 'a Claim has one trait slot, filled with her strongest trait; no mutation this time');
ok(T.legacyToggle('silk') === false && L.chosen.join() === 'speed', 'a second trait does not fit in one slot');
ok(T.legacyToggle('speed') === true && L.chosen.length === 0 && T.legacyToggle('silk') === true && L.chosen.join() === 'silk', 'she can swap it for another');
ok(T.legacyToggle('nope') === false && T.legacyToggle('venom') === false, 'unknown or unowned traits are refused');
ok(T.legacyToggle('silk') === true && T.legacyToggle('speed') === true && L.chosen.join() === 'speed', 'and back again');
ok(T.currentGeneration().status === 'laid' && T.currentGeneration().clutch === 5 && T.currentGeneration().laid.day === 23 && T.currentGeneration().stage === 4, 'the generation record notes the clutch and when she laid');
ok(G.save.slots()[0].kinds.autosave, 'the Legacy scene is checkpointed (autosave)');
// the winter fast-forward
const ageBefore = { hw: hw.integrity, spoilable: T.pantry.length };
const rep = T.runWinter();
ok(rep.days === 36 - 22 && rep.fromYear === 1 && rep.toYear === 2 && W.dayCount === 36 && T.calendar().season === 'spring' && T.calendar().year === 2, 'winter passes: ' + rep.days + ' days to Day 1 of Year 2 (' + T.calendar().label + ')');
ok(T.runWinter() === rep, 'the fast-forward runs only once');
ok(rep.cp === 10 && rep.kept + rep.spoiled === ageBefore.spoilable && rep.websDamaged + rep.websLost === 1, 'the report counts the pantry (' + rep.kept + ' kept, ' + rep.spoiled + ' spoiled) and the heirloom webs (' + rep.websDamaged + ' worn, ' + rep.websLost + ' lost)');
ok(hw.integrity < ageBefore.hw && hw.integrity > 0.4, 'the heirloom retreat weathered the winter (' + ageBefore.hw.toFixed(2) + ' -> ' + hw.integrity.toFixed(2) + ')');
ok(W.weather.type === 'clear' && W.resources.every(r => r.amount === r.max), 'the water has dripped back and the weather has settled');
// confirm: the new generation
const cpBefore = T.cp, pantryLeft = T.pantry.length;
ok(T.legacyConfirm() === true && G.state.scene === 'playing' && T.legacy === null, 'confirming starts the next generation');
ok(T.lineage.generations.length === 2 && T.currentGeneration().n === 2 && T.lineage.heirs === 5, 'generation 2 has five heirs waiting');
ok(P.stage === 0 && P.hatching === true && Math.hypot(P.x - T.home.x, P.y - T.home.y) < 200 && T.home.shelterId === homeId, 'the new hatchling emerges at the egg site she chose (here her own Home Site)');
ok(P.upgrades.speed === 2 && P.upgrades.silk === 0 && P.upgrades.carapace === 0 && P.upgrades.camo === 0, 'it inherits the chosen trait one level lower (speed 3 -> 2)');
ok(T.currentGeneration().traits.length === 1 && T.currentGeneration().traits[0].id === 'speed' && T.currentGeneration().traits[0].level === 2 && T.currentGeneration().mutation === null, 'and the record says so');
ok(near(T.cp - cpBefore, 10, 0.001) && W.dayCount === 36 && T.pantry.length === pantryLeft, 'surviving the winter earned 10 Claim Points; the pantry carries over (' + T.pantry.length + ')');
ok(G.webs.list.every(w => w.heirloom) && G.webs.list.indexOf(hw) >= 0 && G.webs.list.indexOf(lineW) < 0, 'ordinary webs are gone; heirloom webs remain (' + G.webs.list.map(w => w.type + (w.heirloom ? '*' : '') + ':' + w.integrity.toFixed(2)).join(',') + ', line ' + (lineW ? 'spun' : 'null') + ')');
ok(gens.indexOf('generation_begin') >= 0 && gens.filter(x => x === 'season:change:spring').length >= 1 && G.save.slots()[0].kinds.autosave, 'generation_begin and the spring season:change fired and a checkpoint was written (' + gens.join(',') + ')');
ok(G.edu.isUnlocked('t_heredity') && G.edu.isUnlocked('t_eggs_survivors'), 'the heredity and clutch facts are in the Codex');
ok((G.state.stats.eaten || 0) === 0 && G.creatures.siblings === 5, 'per-generation counters restart and five siblings are around');
H.run(8); ok(G.errors.length === 0, 'no errors');

// ================================================================ mutation and trait slots by rank
G = territory(H.load({ tolerant: true }), { stage: 4, name: 'Mutant' }); T = G.territory; P = G.player; W = G.world;
mother(G, { day: 20 }); T.rng = () => 0.01;
const oldOrb = spin(G, 'orb'); T.markHeirloom(oldOrb);
T.cp = 75; T.rank = 3; P.mate.found = P.mate.courted = true; const sh2 = W.shelters.find(s => s.id === 'sh14'); tp(P, sh2.x, sh2.y); H.run(0.5); H.press('KeyE'); H.run(7);
const L2 = T.legacy;
ok(G.state.scene === 'legacy' && L2.slots === 2 && L2.chosen.join() === 'speed,silk', 'a Domain has two trait slots (' + L2.chosen.join() + ')');
ok(L2.mutation !== null && !['speed', 'silk', 'carapace'].includes(L2.mutation), 'a low roll brings a mutation: a trait she never had (' + L2.mutation + ')');
const oldHome = { x: T.home.x, y: T.home.y }; T.legacyConfirm();
ok(Math.hypot(T.home.x - oldHome.x, T.home.y - oldHome.y) > 1200 && !oldOrb.heirloom && T.heirloomWebs().length === 0, 'laying at a far egg site moves the Claim; an heirloom web left outside it becomes an ordinary web');
ok(P.upgrades.speed === 2 && P.upgrades.silk === 1 && P.upgrades[L2.mutation] === 1, 'the hatchling has both inherited traits and the mutation at level 1');
ok(T.currentGeneration().mutation === L2.mutation, 'the mutation is recorded');
// a second generation lays too
const g2 = T.lineage.generations.length; P.debugSetStage(4); T.rng = () => 0.5; mother(G, { day: 24, ups: { speed: 2, silk: 1 } });
P.hunger = P.hydration = P.energy = 90; const sh3 = W.shelters.find(s => s.id === 'sh5') || W.shelters.find(s => s.eggSite && s.id !== 'sh14'); tp(P, sh3.x, sh3.y); P.mate = { found: true, courted: true, laid: false };
H.run(0.5); H.press('KeyE'); H.run(7);
ok(G.state.scene === 'legacy' && T.legacy.generation === 2, 'the next mother lays in her turn (generation ' + (T.legacy && T.legacy.generation) + ')');
T.legacyConfirm(); ok(T.lineage.generations.length === g2 + 1 && T.currentGeneration().n === 3 && T.home.shelterId === sh3.id, 'a different egg site becomes the new Home Site (' + T.home.shelterId + ') and the Claim moves with it');
ok(G.errors.length === 0, 'no errors');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
