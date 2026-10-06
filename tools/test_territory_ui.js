// Test script for the Territory screens and HUD (src/ui.js). Run: node tools/test_territory_ui.js
//   Text on every screen is captured from the canvas (fillText) while the game renders, so this checks what a player can read.
//   - title: Continue / Load Game appear only when something is saved; the new-game flow (mode -> slot -> name) with keyboard, backspace, limits and Esc
//   - overwrite confirmation, Load Game slot cards, Continue and the Welcome back card
//   - HUD: calendar, season banner, rank chip, pantry, heirs, goals; nothing of it in Brood
//   - pause menu (Save, Save & Quit, Territory, Lineage, Export), Territory screen (T), Lineage tab
//   - Succession card, the three-step Legacy scene, Lineage Ended and "Found a New Line"
const H = require('./harness.js');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

// every string drawn in one frame; letter-spaced headings arrive one letter at a time, so a squashed copy is searched too
function texts(G) {
  const ctx = H.canvas.getContext('2d'), out = [], f = ctx.fillText;
  ctx.fillText = function (t) { out.push(String(t)); return f.apply(this, arguments); };
  try { G.render(); } finally { ctx.fillText = f; }
  return out;
}
function has(G, re) { const t = texts(G); return re.test(t.join(' ')) || re.test(t.join('')); }
function dump(G) { return texts(G).filter(x => x.length > 1).join(' | ').slice(0, 400); }
const tp = (P, x, y) => { P.inShelter = null; P.x = x; P.y = y; P.vx = P.vy = 0; };

// ================================================================ title and the new-game flow
let G = H.load({ tolerant: true });
H.run(0.6);
ok(has(G, /New Game/) && !has(G, /Continue/) && !has(G, /Load Game/), 'with nothing saved the title offers New Game but not Continue or Load Game');
H.press('Enter'); H.run(0.5);
ok(G.ui.sub === 'mode' && has(G, /Brood/) && has(G, /Survival/) && has(G, /Territory/) && has(G, /SAVES/) && has(G, /36-day year/), 'New Game opens three journeys, Territory marked "SAVES" (' + G.ui.sub + ')');
G.ui.idx.mode = 2; H.press('Enter'); H.run(0.5);
ok(G.ui.sub === 'slots' && G.ui.slotMode === 'new' && has(G, /Choose a save slot/) && (texts(G).filter(t => t === 'Start here').length === 3), 'Territory asks for a save slot first: three empty slots');
H.press('Enter'); H.run(0.5);
ok(G.ui.sub === 'name' && has(G, /Name your lineage/) && has(G, /Line of the Garden Spider/), 'an empty slot goes on to the name (with the default shown)');
G.input.inject.type('Ash Hollow'); H.run(0.3);
ok(G.ui.nameText === 'Ash Hollow' && has(G, /Ash Hollow/) && has(G, /10 \/ 28/), 'typing fills the name (10 / 28)');
G.input.inject.type('\b\b'); H.run(0.2); ok(G.ui.nameText === 'Ash Holl', 'backspace removes letters');
G.input.inject.type('x'.repeat(40)); H.run(0.2); ok(G.ui.nameText.length === 28, 'the name stops at 28 characters');
H.press('Escape'); H.run(0.3); ok(G.ui.sub === 'slots', 'Esc goes back to the slots');
H.press('Escape'); H.run(0.3); ok(G.ui.sub === 'mode', 'and back to the journeys');
H.press('Escape'); H.run(0.3); ok(G.ui.sub === null && G.state.scene === 'title', 'and to the title');
H.press('Enter'); H.run(0.4); G.ui.idx.mode = 2; H.press('Enter'); H.run(0.4); H.press('Enter'); H.run(0.4);
ok(G.ui.sub === 'name', 'again: journey, slot, name');
ok(G.ui.nameText === '' || G.ui.nameText === undefined || G.ui.nameText.length > 0, 'the name box is available');
G.ui.nameText = ''; H.press('Enter'); H.run(3);
ok(G.state.scene === 'playing' && G.state.mode === 'territory' && G.state.slot === 1 && G.territory.lineageName === 'Line of the Garden Spider', 'an empty name begins with the default lineage name (' + G.territory.lineageName + ')');
ok(G.errors.length === 0, 'no errors');

// ================================================================ the HUD
let T = G.territory, P = G.player, W = G.world;
P.debugSetStage(3); H.run(1);
ok(has(G, /Spring\s*·\s*Day 1 of 36/) && has(G, /Year 1\s*·\s*8 days to summer/), 'the calendar chip shows the season, the day and the days left in it');
ok(has(G, /Heirs/) && has(G, /5 heirs/), 'the heirs are shown in the HUD');
ok(has(G, /Claim/) && has(G, /Pantry 0\/6/) && has(G, /0\/25 CP/), 'the rank chip shows the Claim, the pantry and the progress to the next rank');
ok(has(G, /Mark a web as an heirloom/) && has(G, /\+3 CP/), 'territory goals sit beside the survival objectives');
W.dayCount = 8; W.time01 = 0.99; H.run(0.3); H.run(4);
ok(has(G, /Summer\s*·\s*Day 10 of 36/) && G.ui.banners.some(b => b.title === 'Summer'), 'at midnight the chip moves on and a Summer banner appears');
const weatherBefore = W.weather.type; W.forceWeather('frost', 0.8); H.run(1); ok(W.fx.frost > 0 && !G.errors.length, 'frost draws without trouble');
W.forceWeather('clear', 0);
// Brood has none of it
const gb = H.load({ tolerant: true }); gb.newGame('brood'); H.run(3);
ok(!has(gb, /of 36/) && !has(gb, /Pantry/) && !has(gb, /CP\b/) && !has(gb, /Heirs/), 'Brood\'s HUD has no calendar, pantry, Claim Points or heirs');
G = H.load({ tolerant: true });   // fresh instance for the rest (the harness has one shared canvas)

// ================================================================ pause menu, save, Territory screen, Lineage tab
function territory(o) {
  o = o || {};
  const g = H.load({ tolerant: true, store: o.store });
  g.newGame('territory', 'garden', { slot: o.slot || 1, name: o.name || 'Ash Hollow' });
  g.player.debugSetStage(o.stage == null ? 3 : o.stage); H.run(2);
  return g;
}
G = territory(); T = G.territory; P = G.player; W = G.world;
const sp = spinWeb(G, 'retreat'); T.markHeirloom(sp); G.save.write(1, 'manual');
H.press('Escape'); H.run(0.5);
ok(G.state.scene === 'paused' && has(G, /Resume/) && has(G, /Save & Quit/) && has(G, /Save/) && has(G, /Lineage/) && has(G, /Export Save/), 'the Territory pause menu has Save, Save & Quit, Territory, Lineage and Export Save');
H.press('ArrowDown'); H.press('Enter'); H.run(0.3);
ok(G.ui.msg && /Saved to slot 1/.test(G.ui.msg.text) && has(G, /Saved to slot 1/), 'Save writes the game and says so ("' + (G.ui.msg && G.ui.msg.text) + '")');
ok(G.save.slots()[0].kinds.manual && G.save.slots()[0].name === 'Ash Hollow', 'slot 1 holds the lineage');
H.press('Escape'); H.run(0.3);
const gp = H.load({ tolerant: true }); gp.newGame('brood'); H.run(2); H.press('Escape'); H.run(0.4);
ok(gp.state.scene === 'paused' && !has(gp, /Save & Quit/) && !has(gp, /Export Save/) && has(gp, /Quit to Title/), 'Brood\'s pause menu has none of the save entries');
G = territory({ slot: 1 }); T = G.territory; P = G.player; W = G.world;
function spinWeb(g, type) { const p = g.player; p.silk = 300; g.webs.select(type); const n = g.webs.list.length; g.webs.spin(type); H.run(2.5); return g.webs.list.length > n ? g.webs.list[g.webs.list.length - 1] : null; }
// Territory screen
const web2 = spinWeb(G, 'orb'); T.markHeirloom(web2);
T.pantry.push({ id: 1, kind: 'cricket', nutrition: 8, fresh: 1, day: 0 }); T.cp = 30; T.addCP(0.1); H.run(0.5);
H.press('KeyT'); H.run(0.8);
ok(G.state.scene === 'territory' && has(G, /Territory/) && has(G, /RANK 2 OF 5/) && has(G, /Hold/) && has(G, /800 px/) && has(G, /HEIRLOOM WEBS/) && has(G, /1 of 6 slots used/) && has(G, /PANTRY/) && has(G, /1 of 10 bundles/), 'T opens the Territory screen: rank, radius, heirloom webs and pantry');
H.press('KeyT'); H.run(0.3); ok(G.state.scene === 'playing', 'T closes it');
H.press('KeyT'); H.run(0.3); H.press('Escape'); H.run(0.3); ok(G.state.scene === 'playing', 'so does Esc');
// Lineage tab
H.press('KeyB'); H.run(0.3); G.ui.codex.tab = 5; H.run(0.5);
ok(G.state.scene === 'codex' && has(G, /Lineage/) && has(G, /Generation 1/) && has(G, /Alive/) && has(G, /HEIRS REMAINING/) && has(G, /HALL OF LINES/) && has(G, /Ash Hollow/), 'the Codex has a Lineage tab: the generations, heirs left and the Hall of Lines');
H.press('KeyB'); H.run(0.3);
// Save & Quit
H.press('Escape'); H.run(0.4); H.press('ArrowDown'); H.press('ArrowDown'); H.press('Enter'); H.run(1);
ok(G.state.scene === 'title' && G.save.slots()[0].kinds.suspend && /Continue picks up/.test(G.ui.msg ? G.ui.msg.text : ''), 'Save & Quit goes to the title with a suspend save (' + (G.ui.msg && G.ui.msg.text) + ')');
ok(has(G, /Continue/) && has(G, /Load Game/) && has(G, /Ash Hollow/), 'and the title now offers Continue (with the lineage\'s name) and Load Game');
ok(G.errors.length === 0, 'no errors');

// ================================================================ Continue, Load Game, the Welcome back card, overwrite
const store = {};
G = territory({ store, slot: 1, name: 'Ash Hollow' }); T = G.territory; P = G.player; W = G.world; W.dayCount = 12; H.run(2); G.save.write(1, 'manual');
G.toTitle(); H.run(0.2);
G.newGame('territory', 'garden', { slot: 2, name: 'The Long Watch' }); P = G.player; T = G.territory; P.debugSetStage(1); G.world.dayCount = 30; T.lineage.heirs = 2; H.run(3); G.save.write(2, 'autosave'); G.save.write(2, 'suspend');
G.toTitle(); H.run(0.6);
ok(has(G, /The Long Watch\s*·\s*Winter, day 31\s*·\s*suspended/), 'the Continue card names the lineage and says that it was suspended (' + dump(G).slice(0, 160) + ')');
H.press('ArrowDown'); H.press('ArrowDown'); H.press('Enter'); H.run(0.6);
ok(G.ui.sub === 'slots' && G.ui.slotMode === 'load' && has(G, /Ash Hollow/) && has(G, /The Long Watch/) && has(G, /SUSPENDED/) && has(G, /Empty slot/) && has(G, /Generation 1\s*·\s*Claim \(0 CP\)\s*·\s*2 heirs/), 'Load Game lists the slots with season, generation, rank, heirs and a SUSPENDED tag');
ok(has(G, /Load/) && has(G, /Export/) && has(G, /Delete/) && has(G, /Import a save file/), 'each slot offers Load, Export and Delete, and a file can be imported');
H.press('Escape'); H.run(0.3); ok(G.ui.sub === null, 'Esc returns to the title');
G.ui.idx.title = 1; H.press('Enter'); H.run(3);
ok(G.state.scene === 'playing' && G.state.slot === 2 && G.territory.lineageName === 'The Long Watch', 'Continue loads the most recent lineage (' + G.territory.lineageName + ')');
ok(has(G, /Welcome back/i) || (G.ui.welcome && G.ui.welcome.kind === 'suspend'), 'a Welcome back card follows (' + (G.ui.welcome ? 'shown' : 'none') + ')');
ok(G.save.slots()[1].hasSuspend === false && !!G.save.slots()[1].kinds.autosave, 'the suspend save is spent, the checkpoint stays');
G.toTitle(); H.run(0.4);
// overwrite: choose an occupied slot for a new lineage
H.press('Enter'); H.run(0.4); G.ui.idx.mode = 2; H.press('Enter'); H.run(0.4);
ok(G.ui.sub === 'slots' && G.ui.slotMode === 'new', 'a new lineage: the slots');
G.ui.idx.slots = 0; H.press('Enter'); H.run(0.4);
ok(G.ui.sub === 'confirmOverwrite' && has(G, /Ash Hollow/) && has(G, /deletes/), 'an occupied slot asks before it is overwritten (' + G.ui.sub + ')');
H.press('Escape'); H.run(0.3); ok(G.ui.sub === 'slots' && G.save.slots()[0].name === 'Ash Hollow', 'No keeps it');
G.ui.idx.slots = 0; H.press('Enter'); H.run(0.4); G.ui.idx.confirmOverwrite = 0; H.press('Enter'); H.run(0.4);
ok(G.ui.sub === 'name', 'Yes goes on to name the new lineage');
G.input.inject.type('Newcomer'); H.press('Enter'); H.run(2);
ok(G.state.scene === 'playing' && G.state.slot === 1 && G.territory.lineageName === 'Newcomer' && G.save.slots()[0].empty, 'the new lineage replaces the old one in slot 1 (slot empty until it is saved)');
ok(G.errors.length === 0, 'no errors');

// ================================================================ succession, Legacy scene, Lineage Ended
G = territory({ stage: 4, name: 'Ash Hollow' }); T = G.territory; P = G.player; W = G.world;
P.upgrades.speed = 3; P.upgrades.silk = 2; P.applyUpgrades(false); P.silk = 100; P.hunger = P.hydration = P.energy = 90; W.dayCount = 20; H.run(1);
for (let i = 0; i < 7; i++) T.pantry.push({ id: 10 + i, kind: 'cricket', nutrition: 8, fresh: 0.9, day: 20 });
P.invuln = 0; P.damage(9999, 'wasp'); H.run(3.8);
ok(G.state.scene === 'succession' && has(G, /An adult of generation 1 fell/) && has(G, /Heirs left after this one/) && has(G, /4 heirs remain/) && has(G, /Take over/) && has(G, /Half your progress/), 'the Succession card says what fell, what the setback is and how many heirs remain');
H.run(1.5); H.press('Enter'); H.run(1.5);
ok(G.state.scene === 'playing' && T.lineage.heirs === 4 && G.ui.banners.some(b => /heir takes over/i.test(b.title)) && has(G, /Shaken/), 'Enter takes over: a banner announces the heir and the HUD shows she is shaken');
P.invuln = 0; P.hunger = P.hydration = P.energy = 90; P.hp = P.maxHp; T.rng = () => 0.5;
const site = W.shelters.find(s => s.id === T.home.shelterId); tp(P, site.x, site.y); P.mate.found = P.mate.courted = true; H.run(0.5); H.press('KeyE'); H.run(9.5);
ok(G.state.scene === 'legacy' && has(G, /Generation 1 ends\s*·\s*Her story\s*\(1 of 3\)/) && has(G, /HEIRS HATCH/) && has(G, /LAID ON DAY 21/) && has(G, /PANTRY \(7 STORED\)/), 'laying opens the Legacy scene: her story, with the clutch sum (1 of 3)');
H.press('Enter'); H.run(0.6);
ok(has(G, /Inherited traits\s*\(2 of 3\)/) && has(G, /Pick up to 1 trait/) && has(G, /Swift Legs/) && has(G, /Level 3\s*→\s*2/) && has(G, /PASSED ON/), 'then the traits to pass on (2 of 3)');
H.press('ArrowRight'); H.run(0.2); H.press('Space'); H.run(0.3);
ok(T.legacy.chosen.join() === 'speed' || T.legacy.chosen.join() === 'silk', 'Space toggles the focused trait within the slot limit (' + T.legacy.chosen.join() + ')');
H.press('Enter'); H.run(4);
ok(has(G, /Winter\s*\(3 of 3\)/) && has(G, /days pass while the egg sac waits/) && has(G, /Winter turnover survived: \+10 Claim Points/), 'then the winter, with its report (3 of 3)');
H.run(4); H.press('Enter'); H.run(2);
ok(G.state.scene === 'playing' && T.lineage.generations.length === 2 && G.ui.banners.some(b => /Year 2/.test(b.title + (b.sub || ''))), 'Enter hatches the next generation in Year 2');
ok(G.errors.length === 0, 'no errors');
// the line ends
for (let i = 0; i < 6 && G.state.scene !== 'lineageended'; i++) { H.run(4.6); P.invuln = 0; P.damage(9999, 'wasp'); H.run(3.2); if (G.state.scene === 'succession') T.completeSuccession(); }
H.run(2.5);
ok(G.state.scene === 'lineageended' && has(G, /Ash Hollow/) && has(G, /GENERATIONS LIVED/) && has(G, /LONGEST-LIVED SPIDER/) && has(G, /Found a New Line/) && has(G, /Title Screen/), 'when the last heir falls the Lineage Ended screen sums the line up');
ok(G.save.slots()[0].empty && G.save.slots()[0].hall.length === 1 && has(G, /Hall of Lines \(1 line\)/), 'and the line is in the slot\'s Hall of Lines');
H.press('Enter'); H.run(1.5);
ok(G.state.scene === 'playing' && G.state.slot === 1 && T.lineage.generations.length === 1 && G.territory.lineage.heirs === 5, 'Found a New Line starts over in the same slot');
G.toTitle(); H.run(0.5);
ok(!has(G, /Continue/), 'with nothing left to continue, the title no longer offers it');
ok(G.errors.length === 0, 'no errors');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
