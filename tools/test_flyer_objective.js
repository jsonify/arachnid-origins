// Test script for the "Catch a flying insect in a web" objective (a_flyer). Run: node tools/test_flyer_objective.js
//   - catching each flying kind in a real orb web completes it (creatures.trap() grounds the creature before web:trapped fires,
//     so the objective must not read c.flying at that point)
//   - catching ground prey in the same web does not
//   - matcher edge cases: a landed flyer still counts, so does any creature caught mid-flight; a plain walker does not
const H = require('./harness.js');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

const flyerObj = () => G.edu.objectives.find(o => o.id === 'a_flyer');

// a fresh sub-adult with a finished orb web; returns the web
function orbWeb() {
  H.newGame(); H.run(4);
  const P = G.player, cr = G.creatures;
  cr.list.slice().forEach(c => { if (!c.dead && c.role !== 'spider') cr.kill(c, 'other'); });
  P.stage = 3; P.silk = P.maxSilk = 300; P.hp = P.maxHp;
  G.emit('stage:change', { stage: 3, prev: 2 }); H.run(1);
  G.webs.select('orb'); G.webs._cool = 0;
  const w = G.webs.spin('orb');
  H.run(6);
  return w;
}
// drop a creature into the web and run until it is stuck; returns it
function catchIn(w, kind) {
  const c = G.creatures.spawn(kind, w.x, w.y);
  if (c.k.flying) { c.flying = true; c.alt = c.altT = 10; c.state = 'wander'; }
  let n = 0;
  while (c.state !== 'stuck' && n++ < 240) { c.x = w.x; c.y = w.y; H.run(1 / 60); }
  return c;
}

// ---------------------------------------------------------------- real flow, one fresh run per kind
['midge', 'fruitfly', 'moth', 'wasp'].forEach(kind => {
  const w = orbWeb();
  ok(!!flyerObj() && !flyerObj().done, kind + ': objective is active and not yet done');
  const c = catchIn(w, kind);
  ok(c.state === 'stuck' && w.trapped.indexOf(c) >= 0, kind + ': caught in the orb web');
  H.run(1);
  ok(flyerObj() && flyerObj().done, kind + ': "Catch a flying insect in a web" completes');
});

// ---------------------------------------------------------------- ground prey does not count
{
  const w = orbWeb();
  const c = catchIn(w, 'springtail');
  ok(c.state === 'stuck', 'springtail: caught in the orb web');
  H.run(1);
  ok(flyerObj() && !flyerObj().done, 'springtail: ground prey does not complete the flying objective');
  const f = catchIn(w, 'midge');
  H.run(1);
  ok(f.state === 'stuck' && flyerObj().done, 'a midge caught afterwards in the same web still completes it');
}

// ---------------------------------------------------------------- the matcher itself
{
  const m = G.edu.OBJECTIVE_DEFS[3].find(o => o.id === 'a_flyer').match;
  ok(m({ creature: { flying: false, wasFlying: true, k: { flying: false } } }) === true, 'caught mid-flight (wasFlying) counts');
  ok(m({ creature: { flying: false, wasFlying: false, k: { flying: true } } }) === true, 'a flying kind that had landed still counts');
  ok(m({ creature: { flying: true } }) === true, 'still airborne counts');
  ok(m({ creature: { flying: false, wasFlying: false, k: { flying: false } } }) === false, 'a walker does not count');
  ok(m({}) === false && m(undefined) === false, 'no creature in the event does not count');
}

ok(G.errors.length === 0, 'no errors raised (' + G.errors.length + ')');
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
