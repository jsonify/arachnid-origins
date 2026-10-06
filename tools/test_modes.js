// Test script for the game modes. Run: node tools/test_modes.js
//   - New Game on the title opens a "Choose your journey" picker: Brood (default, siblings revive you), Survival (one life) or Territory (saved campaign, see test_territory_ui.js)
//   - the choice is remembered (settings), kept by Try Again, and highlighted next time
//   - Survival: a fatal blow is final even with siblings around, and the HUD has no Siblings row
const H = require('./harness.js');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const scene = () => G.state.scene;

// strings the UI draws during one frame
const ctx = H.canvas.getContext('2d'), fillText = ctx.fillText.bind(ctx); let drawn = [];
ctx.fillText = function (s) { drawn.push(String(s)); return fillText.apply(null, arguments); };
const frame = () => { drawn = []; G.render(); return drawn; };
const has = (re) => frame().some(s => re.test(s));

const NEW_GAME = [640, 336], CARD = [[300, 340], [640, 340], [980, 340]];   // title button / the three mode cards (Brood, Survival, Territory)
const ev = {}; ['player:downed', 'player:revived', 'player:died'].forEach(n => G.on(n, d => { (ev[n] = ev[n] || []).push(d); }));
const n = (name) => (ev[name] || []).length;
const lethal = () => { H.run(4.5); G.creatures.list.slice().forEach(c => { if (c.kind !== 'kin' && !c.dead) G.creatures.kill(c, 'other'); }); G.player.damage(9999, 'wasp'); };

ok(G.C.MODES.map(m => m.id).join() === 'brood,survival,territory', 'three modes, Brood first (the default)');
ok(G.settings.mode === 'brood' && G.state.mode === 'brood', 'Brood is the default mode');
ok(scene() === 'title', 'boots to the title screen');

// ---------------------------------------------------------------- the picker
H.run(0.5);
H.click(...NEW_GAME);
ok(scene() === 'title' && G.ui.sub === 'mode', 'New Game opens the mode picker instead of starting at once');
ok(G.ui.idx.mode === 0, 'Brood is highlighted by default');
H.run(1); ok(has(/^Choose your journey$/i) && has(/^Brood$/) && has(/^Survival$/) && has(/^Territory$/), 'the picker shows all three modes');
H.shot('modes_picker');
H.press('ArrowRight'); ok(G.ui.idx.mode === 1, 'Right arrow moves to Survival'); H.shot('modes_picker_survival');
H.press('Escape'); ok(G.ui.sub === null && scene() === 'title', 'Esc goes back to the title');
H.click(...NEW_GAME); H.press('ArrowRight'); H.press('ArrowRight'); ok(G.ui.idx.mode === 2, 'Right twice reaches Territory'); H.press('ArrowRight'); ok(G.ui.idx.mode === 0, 'selection wraps around');

// ---------------------------------------------------------------- Survival: one life
H.press('ArrowRight'); H.press('Enter');
ok(scene() === 'playing' && G.state.mode === 'survival', 'Enter starts a game in Survival mode');
ok(G.settings.mode === 'survival' && (G.store.get('settings', {}) || {}).mode === 'survival', 'the choice is saved');
H.run(4);
ok(G.creatures.siblings === 5, 'siblings are still around in Survival (' + G.creatures.siblings + ')');
ok(!has(/^Siblings$/) && !has(/revives?$/), 'but the HUD has no Siblings / revives row');
H.shot('modes_hud_survival');
lethal();
ok(G.player.dead && !G.player.reviving && n('player:downed') === 0 && n('player:died') === 1, 'a fatal blow is final: no revive, even with 5 siblings');
H.run(3); ok(scene() === 'gameover', 'game over follows');
ok(has(/Survival mode/), 'the game over screen names the mode');

// ---------------------------------------------------------------- Try Again keeps the mode
H.run(1.2); H.press('Enter');
ok(scene() === 'playing' && G.state.mode === 'survival', 'Try Again keeps Survival');

// ---------------------------------------------------------------- remembered next time; pick Brood with the mouse
H.run(0.5); H.press('Escape'); ok(has(/Survival mode/), 'the pause screen names the mode');
G.toTitle(); H.run(0.5);
H.click(...NEW_GAME);
ok(G.ui.sub === 'mode' && G.ui.idx.mode === 1, 'the picker highlights the mode played last (Survival)');
H.click(...CARD[0]);
ok(scene() === 'playing' && G.state.mode === 'brood' && G.settings.mode === 'brood', 'clicking the Brood card starts a Brood game');
H.run(4);
ok(has(/^Siblings$/) && has(/^5 revives$/), 'Brood shows the Siblings row (5 revives)');
H.shot('modes_hud_brood');
lethal();
ok(!G.player.dead && G.player.reviving && n('player:downed') === 1, 'a fatal blow is a revive in Brood');
H.run(3); ok(!G.player.dead && n('player:revived') === 1 && scene() === 'playing', 'and the spider gets back up');

// ---------------------------------------------------------------- the Survival card by mouse, and Back
G.toTitle(); H.run(0.5); H.click(...NEW_GAME);
H.click(...CARD[1]); ok(scene() === 'playing' && G.state.mode === 'survival', 'clicking the Survival card starts a Survival game');
G.toTitle(); H.run(0.5); H.click(...NEW_GAME); H.click(640, 570);
ok(scene() === 'title' && G.ui.sub === null, 'the Back button closes the picker');

// ---------------------------------------------------------------- bad input falls back
G.settings.mode = 'survival'; G.newGame('nonsense');
ok(G.state.mode === 'brood', 'an unknown mode falls back to the default, Brood (' + G.state.mode + ')');
G.newGame(); ok(G.state.mode === 'survival', 'no mode given = the saved one (' + G.state.mode + ')');
G.newGame('brood'); ok(G.state.mode === 'brood', 'Game.newGame(mode) starts that mode');

ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')' + (G.errors.length ? ' ' + G.errors[0].where + ': ' + G.errors[0].message : ''));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
