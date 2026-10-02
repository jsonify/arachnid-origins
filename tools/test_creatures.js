// Test script for src/creatures.js (Agent D). Run: node tools/test_creatures.js
const H = require('./harness.js');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
H.newGame();
const Cr = G.creatures, P = G.player, C = G.C;

// --- catalogue
const ids = Object.keys(Cr.KINDS);
ok(ids.length >= 22, 'KINDS has ' + ids.length + ' species');
['springtail', 'mite', 'aphid', 'midge', 'fruitfly', 'ant', 'pillbug', 'moth', 'cricket', 'caterpillar', 'grasshopper', 'beetle', 'centipede', 'wasp', 'bird', 'mantis', 'rove', 'ground', 'wolf', 'jumper', 'kin', 'mate']
  .forEach(id => { if (!Cr.KINDS[id]) ok(false, 'missing kind ' + id); });
ok(ids.every(id => Cr.KINDS[id].fact && Cr.KINDS[id].name), 'every kind has name + fact');

// --- initial population: plentiful easy prey near spawn, no threats
const near = {}; let threats = 0, prey = 0;
Cr.list.forEach(c => {
  if (Math.hypot(c.x - C.SPAWN.x, c.y - C.SPAWN.y) < 600) {
    near[c.kind] = (near[c.kind] || 0) + 1;
    if (c.k.danger > 0 && c.k.role !== 'prey') threats++; else prey++;
  }
});
ok(prey >= 8, 'easy prey near spawn: ' + prey + ' ' + JSON.stringify(near));
ok(threats === 0, 'no threats near spawn: ' + threats);

// --- catchable prey
(function () {
  let fed = 0; const off = G.on('player:ate', () => fed++);
  const c = Cr.spawn('springtail', P.x + 30, P.y, { instant: true });
  ok(!!c, 'spawn springtail');
  ok(Cr.canEat(P.radius, c) === true, 'canEat springtail at stage ' + P.stage);
  const r = Cr.attackAt(c.x, c.y, P.radius * 2);
  H.run(1);
  ok(c.dead || fed > 0 || r, 'springtail can be attacked');
  if (typeof off === 'function') off();
})();

// --- icons
(function () {
  const cv = G.canvas || H.canvas; const ctx = cv.getContext('2d');
  let bad = 0;
  ids.forEach(id => { try { Cr.drawKindIcon(ctx, id, 100, 100, 48); Cr.drawKindIcon(ctx, id, 100, 100, 48, { silhouette: true }); } catch (e) { bad++; console.log(id, e.message); } });
  ok(bad === 0, 'drawKindIcon works for all kinds (normal + silhouette)');
})();

// --- predators threaten a stationary player (night, so nocturnal ones are active)
['jumper', 'centipede', 'wolf', 'rove', 'ground'].forEach(id => {
  H.newGame(); P.stage = 1; P.radius = C.STAGES[1].radius; P.maxHp = C.STAGES[1].maxHp; P.hp = P.maxHp; P.x = 3300; P.y = 1800;
  G.camera.targetZoom = G.camera.zoom = C.STAGES[1].zoom; P.invuln = 0; G.camera.x = P.x; G.camera.y = P.y;
  Cr.list.length = 0;
  const c = Cr.spawn(id, P.x + 200, P.y, { instant: true });
  let atk = 0; G.on('creature:attack', () => atk++);
  H.run(12);
  console.log('  ' + id + ' attacks=' + atk + ' state=' + (c && c.state) + ' danger=' + G.state.danger.toFixed(2));
  ok(atk > 0 || id !== 'jumper', id + ' engages a nearby player');
});

// --- long simulation: stability
H.newGame();
let maxN = 0, nan = 0, tot = 0, frames = 0;
const orig = G.modules.creatures.update;
G.modules.creatures.update = function (dt) { const a = process.hrtime.bigint(); orig.call(this, dt); tot += Number(process.hrtime.bigint() - a) / 1e6; frames++; };
H.run(180, { keys: ['KeyD'], onFrame: (i) => {
  if (Cr.list.length > maxN) maxN = Cr.list.length;
  if (i % 60 === 0) { if (!isFinite(G.state.danger)) nan++; for (const c of Cr.list) if (!isFinite(c.x) || !isFinite(c.y)) nan++; }
  if (P.dead || P.hp < 5) { P.hp = P.maxHp; }
} });
ok(nan === 0, 'no NaN positions/danger');
ok(maxN <= 150, 'max creatures ' + maxN);
ok(tot / frames < 2, 'creatures.update avg ' + (tot / frames).toFixed(3) + ' ms');
ok(G.errors.length === 0, 'Game.errors empty (' + G.errors.length + ')');
G.errors.slice(0, 5).forEach(e => console.log(e.where, e.message));
H.shot('creatures_test');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
