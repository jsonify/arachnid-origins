// Test script for playable spiders and unlocks. Run: node tools/test_species.js
//   - Game.C.SPECIES: the starter (Garden Spider) plus the Black Widow, unlocked by the Widow Matriarch boss (see test_boss.js)
//   - Game.unlocks: saved between journeys, unknown ids ignored, the starter is never locked
//   - Game.newGame(mode, species): a locked or unknown species falls back to the starter
//   - the widow's stats, night stealth and neurotoxic bite; her art differs from the garden spider's at every stage
//   - New Game: with only the starter the game starts straight after the mode card; with two spiders a "Choose your spider" step follows
//   - the Codex "Spiders" tab and the title counter
const H = require('./harness.js');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const scene = () => G.state.scene;

// strings the UI draws during one frame
const ctx = H.canvas.getContext('2d'), fillText = ctx.fillText.bind(ctx); let drawn = [];
ctx.fillText = function (s) { drawn.push(String(s)); return fillText.apply(null, arguments); };
const frame = () => { drawn = []; G.render(); return drawn; };
const has = (re) => frame().some(s => re.test(s));
const hasSpaced = (str) => frame().join('').indexOf(str) >= 0;   // headings drawn letter by letter (spaced capitals)
const lock = () => { G.store.set('unlocks', []); G.unlocks.reload(); G.settings.species = 'garden'; };

const NEW_GAME = [640, 336];

// ---------------------------------------------------------------- the data
const SP = G.C.SPECIES, K = G.creatures.KINDS;
ok(SP.length >= 2 && SP[0].id === 'garden', 'the starter is first (' + SP.map(s => s.id).join() + ')');
ok(new Set(SP.map(s => s.id)).size === SP.length, 'species ids are unique');
ok(SP.every(s => s.name && s.latin && s.blurb && Array.isArray(s.perks) && s.perks.length && s.mods && typeof s.leg === 'number'), 'every species has a name, latin name, blurb, perks, mods and leg length');
ok(SP.slice(1).every(s => s.unlock && s.boss && K[s.boss]), 'every locked species says how to unlock it and names a boss that exists');
ok(G.speciesInfo('nope').id === 'garden' && G.speciesInfo('widow').id === 'widow', 'speciesInfo falls back to the starter');
ok(G.settings.species === 'garden', 'the default saved species is the starter');

// ---------------------------------------------------------------- unlocks
ok(G.unlocks.list().join() === 'garden' && G.unlocks.has('garden') && !G.unlocks.has('widow'), 'only the starter is available at first');
const got = []; G.on('species:unlocked', d => got.push(d.id));
ok(G.unlocks.unlock('widow') === true && G.unlocks.has('widow'), 'unlock("widow") unlocks her');
ok(G.unlocks.unlock('widow') === false, 'unlocking twice is a no-op');
ok(G.unlocks.unlock('garden') === false && G.unlocks.unlock('nope') === false, 'the starter and unknown ids cannot be unlocked');
ok(got.join() === 'widow', 'species:unlocked fired once, for the widow (' + got.join() + ')');
ok((G.store.get('unlocks', []) || []).join() === 'widow', 'the unlock is saved');
G.store.set('unlocks', ['bogus', 'widow', 'garden']); G.unlocks.reload();
ok(G.unlocks.list().join() === 'garden,widow', 'reloading reads the saved list and ignores junk (' + G.unlocks.list().join() + ')');
lock();
ok(G.unlocks.list().join() === 'garden', 'clearing the saved list locks her again');

// ---------------------------------------------------------------- newGame(mode, species)
G.newGame('brood', 'widow'); ok(G.state.species === 'garden', 'a locked species falls back to the starter');
G.newGame('brood', 'nonsense'); ok(G.state.species === 'garden', 'an unknown species falls back to the starter');
G.unlocks.unlock('widow');
G.newGame('brood', 'widow'); ok(G.state.species === 'widow' && G.player.species.id === 'widow', 'an unlocked species starts as that spider');
G.settings.species = 'widow'; G.newGame('brood'); ok(G.state.species === 'widow', 'no species given = the saved one');
G.settings.species = 'garden'; G.newGame('brood'); ok(G.state.species === 'garden', 'and back to the starter');

// ---------------------------------------------------------------- stats and perks
function stats() { const p = G.player; return { speed: p.speedMul, bite: p.biteMul, silk: p.silkMul, hp: p.maxHp, venom: p.venomPower, stealth: p.stealth, leg: p.species.leg }; }
G.newGame('brood', 'garden'); G.player.debugSetStage(3); const g = stats();
G.newGame('brood', 'widow'); G.player.debugSetStage(3); const w = stats();
ok(near(w.bite / g.bite, 1.35, 1e-4) && near(w.silk / g.silk, 1.25, 1e-4), 'the widow bites 35% harder and has 25% more silk (' + (w.bite / g.bite).toFixed(2) + ', ' + (w.silk / g.silk).toFixed(2) + ')');
ok(near(w.speed / g.speed, 0.94, 1e-4) && near(w.hp / g.hp, 0.9, 1e-4), 'but is 6% slower and has 10% less health');
ok(g.venom === 0 && w.venom > 0, 'only the widow has a poisonous bite');
ok(w.leg > g.leg, 'her legs are longer');
G.player.upgrades.venom = 2; G.player.applyUpgrades(true);
ok(near(G.player.biteMul, 1.5 * 1.35, 1e-4), 'molt upgrades stack with the species (bite x' + G.player.biteMul.toFixed(3) + ')');
// night stealth: hunters notice her 20% less after dusk
G.player.upgrades.venom = 0; G.player.applyUpgrades(true);
G.world.time01 = 0.25; H.run(0.2); const day = G.player.stealth;
G.world.time01 = 0.75; H.run(0.2); const night = G.world.isNight() ? G.player.stealth : null;
ok(night != null && near(night / day, 0.8, 1e-3), 'the widow hides better at night (' + day.toFixed(2) + ' by day, ' + (night == null ? 'n/a' : night.toFixed(2)) + ' at night)');
G.newGame('brood', 'garden'); G.player.debugSetStage(3); G.world.time01 = 0.75; H.run(0.2);
ok(near(G.player.stealth, 1, 1e-6), 'the garden spider has no night bonus');

// ---------------------------------------------------------------- the neurotoxic bite
function biteTest(species) {
  G.newGame('brood', species); const P = G.player; P.debugSetStage(3); P.invuln = 0; P.x = 3000; P.y = 1800; P.angle = 0; P.hunger = 40;
  G.creatures.list.slice().forEach(c => { if (!c.dead) G.creatures.kill(c, 'other'); });
  const c = G.creatures.spawn('beetle', P.x + P.radius * 1.9, P.y, { instant: true }); c.hp = c.maxHp = 60; c.state = 'idle'; c.vx = c.vy = 0;
  H.run(0.05); P.angle = 0; P.bite(); H.run(0.02);
  return { c, P, hp0: c.hp };
}
let t = biteTest('widow');
ok(t.c.venomT > 0 && t.c.venomDps > 0, 'a widow\'s bite poisons the prey (venomT ' + t.c.venomT.toFixed(1) + ', dps ' + t.c.venomDps.toFixed(2) + ')');
const hpA = t.c.hp; H.run(1.5);
ok(t.c.hp < hpA - 0.5, 'the poison keeps working after the bite (' + hpA.toFixed(1) + ' -> ' + t.c.hp.toFixed(1) + ')');
t.c.hp = 0.3; let killedBy = null; const onKill = G.on('creature:killed', d => { if (d.creature === t.c) killedBy = d.by; });
const hunger0 = t.P.hunger; H.run(1);
ok(killedBy === 'player' && t.P.hunger > hunger0, 'prey that dies of the poison still counts as the widow\'s kill, and feeds her (' + killedBy + ', hunger ' + hunger0.toFixed(0) + ' -> ' + t.P.hunger.toFixed(0) + ')');
G.off('creature:killed', onKill);
t = biteTest('garden');
ok(t.c.venomT === 0 && t.c.venomDps === 0, 'a garden spider\'s bite is not poisonous');

// ---------------------------------------------------------------- the art
const px = (sp, stage, o) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#6a5a46'; ctx.fillRect(0, 0, 400, 400);
  G.player.drawPortrait(ctx, sp, 200, 200, 300, Object.assign({ stage, t: 1 }, o || {}));
  return ctx.getImageData(0, 0, 400, 400).data;
};
const red = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 70 && d[i + 2] < 70) n++; return n; };   // strongly red pixels
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
for (let st = 0; st < 5; st++) ok(diff(px('garden', st), px('widow', st)) > 1500, 'the widow looks different from the garden spider at stage ' + (st + 1));
ok(red(px('widow', 4)) > 20 && red(px('garden', 4)) === 0, 'an adult widow carries a red spot (' + red(px('widow', 4)) + ' red pixels); the garden spider has none');
ok(diff(px('widow', 4, { belly: 0 }), px('widow', 4, { belly: 1 })) > 100, 'the hourglass shows when she hangs belly-up');
ok(diff(px('garden', 4, { belly: 0 }), px('garden', 4, { belly: 1 })) === 0, 'the garden spider has no hourglass');
const sil = px('widow', 4, { silhouette: true, silColor: '#102030' });
let flatN = 0; for (let i = 0; i < sil.length; i += 4) if (Math.abs(sil[i] - 0x10) < 3 && Math.abs(sil[i + 1] - 0x20) < 3 && Math.abs(sil[i + 2] - 0x30) < 3) flatN++;
ok(flatN > 3000 && red(sil) === 0, 'a locked species is drawn as one flat silhouette (' + flatN + ' flat pixels, no red)');
// the whole thing in play, as the widow: moving, spinning, molting, with the red hourglass showing while she spins
G.newGame('brood', 'widow'); H.run(4);
for (let st = 1; st <= 4; st++) { G.player.debugSetStage(st); H.run(0.4, { keys: ['KeyD'] }); G.render(); }
H.press('Space'); H.run(0.3); G.render();
H.shot('species_widow_adult');
G.player.debugSetStage(0); G.player.addGrowth(G.player.growthNeeded + 5); H.run(0.3);
ok(scene() === 'molting', 'a molting widow reaches the upgrade screen');
G.player.chooseUpgrade(G.player.offers[0]); H.run(8); G.render();
ok(scene() === 'playing' && G.player.stage === 1 && G.errors.length === 0, 'and finishes the molt (shed skin drawn in her colours)');

// ---------------------------------------------------------------- New Game flow
lock(); G.toTitle(); H.run(0.5);
ok(has(/^Spiders unlocked\s+1 \/ 2$/), 'the title shows how many spiders are unlocked');
H.click(...NEW_GAME); ok(G.ui.sub === 'mode', 'New Game opens the mode picker');
H.press('Enter'); H.run(0.3);
ok(scene() === 'playing' && G.state.species === 'garden', 'with only the starter, the mode card starts the game at once');

G.unlocks.unlock('widow'); G.toTitle(); H.run(0.5);
ok(has(/^Spiders unlocked\s+2 \/ 2$/), 'the title counts both spiders once the widow is unlocked');
H.click(...NEW_GAME); H.press('Enter'); H.run(0.4);
ok(scene() === 'title' && G.ui.sub === 'species' && G.ui.pendingMode === 'brood', 'with two spiders a "Choose your spider" step follows the mode card');
ok(G.ui.idx.species === 0, 'the starter is highlighted by default');
H.run(0.8); ok(has(/^Choose your spider$/) && has(/^Garden Spider$/) && has(/^Black Widow$/), 'the picker shows both spiders');
ok(has(/Neurotoxic bite/) && has(/Balanced/), 'with their perks');
H.shot('species_picker');
H.press('Escape'); ok(G.ui.sub === 'mode', 'Esc goes back to the mode cards');
H.press('Enter'); H.run(0.3); H.press('ArrowRight'); ok(G.ui.idx.species === 1, 'Right moves to the Black Widow');
H.shot('species_picker_widow');
H.press('Enter'); H.run(0.3);
ok(scene() === 'playing' && G.state.species === 'widow' && G.settings.species === 'widow', 'Enter starts a game as the Black Widow');
ok((G.store.get('settings', {}) || {}).species === 'widow', 'the choice is saved');
ok(G.state.mode === 'brood', 'in the mode picked first');
H.run(3); ok(has(/^Black Widow\s+·\s+Stage 1/), 'the HUD names the spider when it is not the starter');
H.press('Escape'); ok(has(/Black Widow/), 'the pause screen names her too');
H.press('Escape');
// Try Again keeps the spider
G.state.mode = 'survival'; G.player.damage(9999, 'wasp'); H.run(4);   // one life (Brood would revive her): a plain death
ok(scene() === 'gameover', 'dying ends the journey (' + scene() + ')');
ok(has(/Black Widow\s+·\s+Survival mode/), 'the game over screen names the spider');
H.run(1.2); H.press('Enter'); ok(scene() === 'playing' && G.state.species === 'widow', 'Try Again keeps the Black Widow');
// the mouse works on the picker too
G.toTitle(); H.run(0.5); H.click(...NEW_GAME); H.press('Enter'); H.run(0.4);
ok(G.ui.sub === 'species' && G.ui.idx.species === 1, 'the spider played last is highlighted next time');
H.click(436, 340); ok(scene() === 'playing' && G.state.species === 'garden' && G.settings.species === 'garden', 'clicking the Garden Spider card starts as the Garden Spider');
// a locked card cannot be picked
SP.push({ id: 'test', name: 'Test Spider', latin: 'Testus spiderus', tag: 'Test', blurb: 'b', perks: ['p'], mods: {}, leg: 1, unlock: 'Do the unlockable thing.', boss: 'widow' });
G.toTitle(); H.run(0.5); H.click(...NEW_GAME); H.press('Enter'); H.run(0.4);
H.press('ArrowRight'); H.press('ArrowRight'); H.run(0.3);
ok(G.ui.idx.species === 2 && hasSpaced('HOW TO UNLOCK') && has(/Do the unlockable thing/), 'a locked card says how to unlock it');
H.shot('species_picker_locked');
H.press('Enter'); H.run(0.3); ok(scene() === 'title' && G.ui.sub === 'species', 'and cannot be picked');
SP.pop(); G.toTitle(); H.run(0.3);

// ---------------------------------------------------------------- the Codex "Spiders" tab
G.setScene('codex'); G.ui.codex.tab = 4; G.ui.codex.ssel = 1; H.run(0.5);
ok(has(/^Spiders\s+2\/2$/) && has(/^Black Widow$/) && hasSpaced('PERKS AND TRADE-OFFS') && hasSpaced('LIFE STAGES'), 'the Spiders tab lists the roster with perks and life stages');
H.shot('species_codex_widow');
lock(); G.ui.codex.ssel = 1; H.run(0.3);
ok(has(/^Spiders\s+1\/2$/) && hasSpaced('HOW TO UNLOCK') && has(/Defeat the Widow Matriarch/) && !hasSpaced('PERKS AND TRADE-OFFS'), 'a locked spider shows how to unlock it instead of its perks');
H.shot('species_codex_locked');
H.press('Tab'); ok(G.ui.codex.tab === 0, 'Tab wraps past the last tab');
H.press('KeyQ'); ok(G.ui.codex.tab === 4, 'Q goes back to the Spiders tab');
G.setScene('title');

ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')' + (G.errors.length ? ' ' + G.errors[0].where + ': ' + G.errors[0].message : ''));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
