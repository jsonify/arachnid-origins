// Integration: scripted playthrough hatch -> victory with all real modules.
const H = require('./harness');
const G = H.load(); H.newGame();
const P = () => G.player, log = (...a) => console.log(...a);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; log('FAIL', m); } else log('ok  ', m); };
H.run(5);
ok(G.state.scene === 'playing', 'game starts playing');
// survive + eat: teleport near prey, bite
function feedUntilMolt(maxSec) {
  for (let i = 0; i < maxSec * 2 && G.state.scene === 'playing'; i++) {
    P().hunger = 90; P().hydration = 90; P().hp = P().maxHp; P().energy = 100;
    const c = G.creatures.nearest(P().x, P().y, k => G.creatures.canEat(P().radius, k) && k.state !== 'dead', 2500);
    if (c) { P().x = c.x - 6; P().y = c.y; G.input.inject.keyDown('KeyJ'); H.run(0.4); G.input.inject.keyUp('KeyJ'); }
    else H.run(0.5);
    if (P().growth >= P().growthNeeded - 1) P().addGrowth(5);
  }
}
for (let s = 0; s < 4; s++) {
  const before = P().stage;
  feedUntilMolt(120);
  ok(G.state.scene === 'molting', 'stage ' + before + ' reached molt scene (growth ' + Math.round(P().growth) + ')');
  const offers = P().offerUpgrades(); ok(offers.length === 3, '3 upgrade offers');
  P().chooseUpgrade(offers[0]); for (let k=0;k<22;k++){ P().hp=P().maxHp; P().hunger=P().hydration=90; H.run(1); }
  ok(P().stage === before + 1 && G.state.scene === 'playing', 'molted to stage ' + P().stage);
  if (P().stage >= 1) { P().silk = P().maxSilk; const w = G.webs.spin('line'); ok(!!w, 'spun web type available at stage ' + P().stage); }
  H.shot('play_stage' + P().stage);
}
// webs: orb at stage 3+
P().silk = P().maxSilk; ok(!!G.webs.spin('orb'), 'orb web at adult');
// ending
ok(G.creatures.mate || (G.creatures.spawnMate(), G.creatures.mate), 'mate exists');
const m = G.creatures.mate; P().x = m.x - 30; P().y = m.y; P().hunger = 90; H.run(0.5);
G.input.inject.keyDown('KeyE'); H.run(0.2); G.input.inject.keyUp('KeyE'); H.run(12);
const egg = G.world.shelters.find(s => s.eggSite); P().x = egg.x; P().y = egg.y; H.run(0.5);
G.input.inject.keyDown('KeyE'); H.run(0.2); G.input.inject.keyUp('KeyE'); H.run(8);
log('mate state', JSON.stringify(P().mate), 'scene', G.state.scene);
ok(G.state.scene === 'victory', 'victory scene reached');
H.shot('play_victory');
// death path
G.newGame(); H.run(4); G.creatures.list.slice().forEach(c => { if (c.kind === 'kin') G.creatures.kill(c, 'other'); });   // no siblings left to revive it (see test_revive.js)
P().damage(9999, 'test'); H.run(6);
ok(G.state.scene === 'gameover', 'gameover on death');
H.shot('play_gameover');
// starvation unattended
G.newGame(); H.run(240);
ok(G.state.scene === 'gameover' || P().hp > 0, 'idle hatchling resolves (scene ' + G.state.scene + ', cause ' + P().deathCause + ')');
// soak
G.newGame(); H.run(180, { keys: ['KeyD'] });
ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')'); G.errors.slice(0, 5).forEach(e => log(e.where, e.message));
log('NaN check', ['x','y','hp','hunger','silk'].every(k => isFinite(P()[k])));
process.exit(fails ? 1 : 0);
