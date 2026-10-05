// Test script for the sibling revive. Run: node tools/test_revive.js
//   - a fatal blow downs the spider instead of killing it while a sibling is left; the sibling gives its life and the spider gets back up
//   - 1 sibling = 1 revive; with none left the next fatal blow ends the run as before
//   - a downed spider can't be hurt, move or spin silk; the giving sibling can't be eaten on the way; hunters nearby are startled off
//   - drifting-away siblings don't count; a far-off sibling still arrives; hunger/thirst deaths don't loop
const H = require('./harness.js');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

const ev = {};
['player:downed', 'player:revived', 'player:died', 'kin:sacrifice'].forEach(n => G.on(n, d => { (ev[n] = ev[n] || []).push(d); }));
const atRevive = [];   // meters at the instant each revive lands
G.on('player:revived', () => { const p = G.player; atRevive.push({ hunger: p.hunger, hydration: p.hydration, energy: p.energy, hp: p.hp }); });
const count = (n) => (ev[n] || []).length, last = (n) => (ev[n] || [])[count(n) - 1];
const P = () => G.player, cr = () => G.creatures;
// hunters would be the one thing that costs siblings behind the test's back: clear them out
function quiet() { cr().list.slice().forEach(c => { if (c.kind !== 'kin' && !c.dead) cr().kill(c, 'other'); }); }
// a fresh run past the hatching grace period
function fresh() { H.newGame(); H.run(4); quiet(); for (const k in ev) ev[k].length = 0; }
// run until the spider is up again (or give up); returns seconds taken
function untilUp(max) { let t = 0; while (P().reviving && t < (max || 6)) { H.run(0.1); t += 0.1; } return t; }

// ---------------------------------------------------------------- the first revive
fresh();
const start = cr().siblings;
ok(start === 5 && cr().siblingsMax === 5, 'hatches with 5 siblings (' + start + ')');
ok(P().invuln === 0 && !P().dead, 'past the spawn grace period');
const dealt = P().damage(9999, 'wasp');
ok(dealt > 0 && !P().dead && P().reviving && G.state.scene === 'playing', 'fatal blow downs the spider instead of ending the run');
ok(count('player:died') === 0 && count('player:downed') === 1, 'player:downed fires, player:died does not');
ok(last('player:downed').cause === 'eaten' && last('player:downed').left === 4, 'player:downed carries the cause and the siblings left');
ok(cr().siblings === 4 && cr().count('kin') === 5, 'the claimed sibling is already spoken for (4 left to give, 5 still alive)');
const sib = cr().list.find(c => c.sac);
ok(!!sib && cr().kill(sib, 'predator') === false, 'a sibling on its way to give its life cannot be eaten');
ok(P().damage(5, 'wasp') === 0 && P().hp === 0, 'a downed spider takes no further damage');
const x0 = P().x, y0 = P().y;
H.run(0.3, { keys: ['KeyD'] });
ok(Math.hypot(P().x - x0, P().y - y0) < 2, 'a downed spider does not move');
ok(G.webs.canSpin('line') === false, 'a downed spider cannot spin silk');
const took = untilUp(6);
ok(!P().reviving && !P().dead && took < 4, 'the spider gets back up (' + took.toFixed(1) + ' s)');
ok(Math.abs(P().hp - P().maxHp * 0.5) < 0.01, 'back up with half health (' + P().hp.toFixed(1) + '/' + P().maxHp + ')');
ok(P().invuln > 3 && P().damage(5, 'wasp') === 0, 'a few seconds of grace after getting up');
ok(cr().count('kin') === 4 && cr().siblings === 4, 'the sibling is gone: 4 left');
ok(count('player:revived') === 1 && last('player:revived').left === 4 && count('kin:sacrifice') === 1, 'player:revived and kin:sacrifice fire once');
ok(P().revives === 1 && G.state.stats.revives === 1, 'revives counted (player.revives and stats)');
ok(G.state.scene === 'playing', 'still playing');

// ---------------------------------------------------------------- hunger / thirst deaths don't loop
H.run(5); quiet();
P().hunger = 0; P().hydration = 0; P().hp = 0.5;
H.run(3);
ok(P().revives === 2 && count('player:revived') === 2 && last('player:revived').cause !== 'eaten', 'starving to death is revived too (' + last('player:revived').cause + ')');
const m = atRevive[atRevive.length - 1];
ok(m.hunger >= 35 && m.hydration >= 35 && m.energy >= 35, 'meters topped up so the revive is not wasted (' + Math.round(m.hunger) + '/' + Math.round(m.hydration) + '/' + Math.round(m.energy) + ')');
H.run(8);
ok(!P().dead && P().revives === 2, 'no death loop afterwards');

// ---------------------------------------------------------------- hunters nearby are startled off
H.run(5); quiet();
const wasp = cr().spawn('wasp', P().x + P().radius * 3, P().y);
wasp.state = 'hunt'; wasp.target = P(); wasp.tIsP = true; wasp.cool2 = 0;
P().damage(9999, 'wasp');
untilUp(6);
ok(!P().dead && wasp.state === 'flee', 'a hunter next to the spider is startled off by the gift (' + wasp.state + ')');

// ---------------------------------------------------------------- 1 sibling = 1 revive, then it is over
fresh();
let n = 0, lost = 0;
while (cr().siblings > 0 && n < 8) {
  H.run(4.5); quiet();
  const before = cr().siblings;
  P().damage(9999, 'wasp');
  untilUp(6);
  const after = cr().siblings;
  if (P().dead) break;
  n++; if (after !== before - 1) lost++;
}
ok(n === 5 && P().revives === 5 && !P().dead, 'five siblings give five revives (' + n + ')');
ok(lost === 0 && cr().siblings === 0 && cr().count('kin') === 0, 'every revive cost exactly one sibling, none left');
H.run(4.5); quiet();
ev['player:died'] = [];
P().damage(9999, 'wasp');
ok(P().dead && !P().reviving && count('player:died') === 1 && last('player:died').cause === 'eaten', 'with no siblings left the next fatal blow ends the run');
H.run(3);
ok(G.state.scene === 'gameover', 'and the game over screen follows');

// ---------------------------------------------------------------- siblings that are drifting away don't count
fresh();
cr().list.forEach(c => { if (c.kind === 'kin') c.disperse = true; });
ok(cr().siblings === 0, 'siblings that are drifting away are not revives');
P().damage(9999, 'wasp');
ok(P().dead, 'so a fatal blow is fatal');

// ---------------------------------------------------------------- a sibling that is far off still comes
fresh();
const kin = cr().list.filter(c => c.kind === 'kin'), far = kin[0];
kin.slice(1).forEach(c => { c.disperse = true; });
far.x = P().x + 420; far.y = P().y;
ok(cr().siblings === 1, 'one sibling left, 420 px away');
P().damage(9999, 'wasp');
const t2 = untilUp(6);
ok(!P().dead && !P().reviving && t2 < 4 && far.dead, 'it runs in and gives its life (' + t2.toFixed(1) + ' s)');
ok(cr().siblings === 0, 'and that was the last one');

// ---------------------------------------------------------------- a molt that comes due while downed waits until the spider is up
fresh();
P().damage(9999, 'wasp');
P().addGrowth(1000);
ok(P().reviving && !P().molting && G.state.scene === 'playing', 'growth while downed does not start a molt');
untilUp(6);
ok(!P().reviving && P().molting && G.state.scene === 'molting', 'the molt starts once the spider is back up');

ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')' + (G.errors.length ? ' ' + G.errors[0].where + ': ' + G.errors[0].message : ''));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
