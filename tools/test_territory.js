// Test script for the Territory (src/territory.js): the Home Site and Claim, Rank, heirloom webs, the pantry and the summer rival.
// Run: node tools/test_territory.js
//   - generation 1 hatches at an egg site: that is the Home Site; its Claim is a circle that grows with Rank (Claim Points thresholds)
//   - E marks a web inside the Claim as an heirloom (silk, slots by Rank), repairs it, hold X recycles it; heirloom webs are never culled
//   - trapped prey can be wrapped for the pantry (silk, retreat nearby, inside the Claim, capacity by Rank); it spoils by season and feeds a resting spider
//   - Claim Points: a night with an intact heirloom web, trapped prey (capped per day), a repelled rival
//   - the summer rival raids heirloom webs once a year, is driven off at half health, and otherwise leaves on its own
const H = require('./harness.js');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= e;

function territory(G, o) {
  o = o || {};
  G.newGame('territory', o.species || 'garden', { slot: o.slot || 1, name: 'Claim Test' });
  const P = G.player; P.debugSetStage(o.stage == null ? 3 : o.stage); P.silk = 300; P.hp = P.maxHp; P.hunger = P.hydration = P.energy = 90;
  return G;
}
function tp(P, x, y) { P.inShelter = null; P.x = x; P.y = y; P.vx = P.vy = 0; }
const calm = (G) => () => { G.player.hp = G.player.maxHp; };
function spin(G, type, dx, dy) {
  const P = G.player; P.silk = 300; if (dx != null) tp(P, P.x + dx, P.y + (dy || 0));
  G.webs.select(type); const n = G.webs.list.length; G.webs.spin(type); H.run(2.5);
  return G.webs.list.length > n ? G.webs.list[G.webs.list.length - 1] : null;
}
function spinOutside(G, type) {
  const T = G.territory, P = G.player;
  for (let r = 760; r <= 1000; r += 80) for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6, x = T.home.x + Math.cos(a) * r, y = T.home.y + Math.sin(a) * r;
    tp(P, x, y); P.silk = 300; H.run(0.3); P.silk = 300; G.webs.select(type); const n = G.webs.list.length; G.webs.spin(type); H.run(2.5);
    const w = G.webs.list.length > n ? G.webs.list[G.webs.list.length - 1] : null;
    if (w && !T.inClaim((w.x != null ? w.x : (w.x1 + w.x2) / 2), (w.y != null ? w.y : (w.y1 + w.y2) / 2))) return w;
  }
  return null;
}
const ctr = (w) => w.x != null ? { x: w.x, y: w.y } : { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 };
// prey that wandered into the new webs would take the E prompt (wrapping comes first): clear them away so the web is what the spider stands on
function unstick(G) { G.creatures.list.filter(c => c.state === 'stuck' && !c.rival).forEach(c => G.creatures.remove(c)); }
function standOn(G, w) { const c = ctr(w); tp(G.player, c.x, c.y); unstick(G); H.run(0.3); unstick(G); H.run(0.05); }

// ================================================================ the Home Site and the Claim
let G = territory(H.load({ tolerant: true }));
let T = G.territory, P = G.player, W = G.world;
const site = W.shelters.find(s => s.id === T.home.shelterId);
ok(T.active && !!site && site.eggSite === true, 'generation 1 hatches at an egg site: it is the Home Site (' + (site && site.id) + ')');
ok(Math.hypot(P.x - T.home.x, P.y - T.home.y) < 120, 'the spider starts at home');
ok(T.rank === 1 && T.rankInfo().name === 'Claim' && T.claimRadius() === 600 && T.cp === 0, 'a new lineage holds a Claim of 600 px with 0 Claim Points');
ok(T.inClaim(T.home.x + 590, T.home.y) && !T.inClaim(T.home.x + 650, T.home.y) && T.inClaim(T.home.x + 650, T.home.y, 100), 'inClaim tests the circle (with optional padding)');
ok(T.lineage.heirs === 5 && T.lineage.generations.length === 1 && T.currentGeneration().n === 1 && T.currentGeneration().status === 'alive', 'five heirs wait in the clutch and generation 1 is alive');
ok(T.spawnPoint().x === T.home.x && T.spawnPoint().y === T.home.y, 'new bodies appear at the Home Site');
// Rank thresholds
const ranks = []; G.on('territory:rank', d => ranks.push(d.name));
const table = [[24.9, 1, 'Claim', 600, 4, 6, 1, 0], [25, 2, 'Hold', 800, 6, 10, 1, 0], [75, 3, 'Domain', 1000, 8, 15, 2, 1], [150, 4, 'Stronghold', 1200, 10, 20, 2, 1], [300, 5, 'Dominion', 1400, 12, 30, 3, 2]];
table.forEach(r => {
  T.addCP(r[0] - T.cp, 'test');
  const ri = T.rankInfo();
  ok(T.rank === r[1] && ri.name === r[2] && T.claimRadius() === r[3] && T.heirloomSlots() === r[4] && T.pantryCapacity() === r[5] && T.traitSlots() === r[6] && ri.heirs === r[7],
    'at ' + r[0] + ' CP: ' + r[2] + ' (radius ' + r[3] + ', ' + r[4] + ' heirloom webs, pantry ' + r[5] + ', ' + r[6] + ' trait slots, +' + r[7] + ' heirs)');
});
ok(ranks.join() === 'Hold,Domain,Stronghold,Dominion', 'each rank-up is announced once (' + ranks.join() + ')');
T.addCP(-5, 'test'); T.addCP(0, 'test'); ok(T.cp === 300, 'Claim Points never go down');
ok(T.nextRank().to === null && T.nextRank().f === 1, 'nothing comes after Dominion');
ok(G.errors.length === 0, 'no errors');

// ================================================================ heirloom webs
G = territory(H.load({ tolerant: true })); T = G.territory; P = G.player; W = G.world;
H.run(1);
const orb = spin(G, 'orb');
ok(!!orb && !orb.heirloom, 'an ordinary orb web is spun inside the Claim');
standOn(G, orb);
let pr = T.prompt();
ok(pr && pr.key === 'E' && /Mark as heirloom web \(5 silk\)/.test(pr.text) && !pr.warn, 'standing in it offers "' + (pr && pr.text) + '"');
let s0 = P.silk, marked = [];
G.on('web:heirloom', d => marked.push(d.web));
H.press('KeyE');
ok(orb.heirloom === true && Math.round(s0 - P.silk) === 5 && marked.length === 1 && T.heirloomWebs().length === 1, 'E marks it for 5 silk and announces it');
ok(G.webs.list.indexOf(orb) >= 0 && T.prompt() === null || (T.prompt() && /recycle|Repair/.test(T.prompt().text)), 'a marked web in good shape offers only recycling');
// repair
orb.integrity = 0.4; H.run(0.2);
pr = T.prompt(); ok(pr && /Repair heirloom web \((\d+) silk\)/.test(pr.text), 'a worn heirloom web offers a repair: "' + (pr && pr.text) + '"');
s0 = P.silk; const cost = T.repairCost(orb);
H.press('KeyE');
ok(near(orb.integrity, 0.7, 0.03) && Math.round(s0 - P.silk) === cost.silk && cost.silk >= 1, 'E restores 30% integrity for ' + cost.silk + ' silk (' + orb.integrity.toFixed(2) + ')');
P.silk = 0; orb.integrity = 0.4; H.run(0.2); pr = T.prompt(); H.press('KeyE');
ok(pr && pr.warn && /Need \d+ silk/.test(pr.text) && near(orb.integrity, 0.4, 0.03), 'without the silk the repair is refused and says why ("' + (pr && pr.text) + '")');
// not outside the Claim
const outer = spinOutside(G, 'line');
ok(!!outer && !T.inClaim(ctr(outer).x, ctr(outer).y), 'a web spun well outside the Claim');
standOn(G, outer); ok(T.prompt() === null && T.markHeirloom(outer) === false && !outer.heirloom, 'outside the Claim it cannot be an heirloom and offers nothing');
// slots by rank
tp(P, T.home.x, T.home.y); H.run(0.3);
const more = []; for (let i = 0; i < 5; i++) { const w = spin(G, 'line', i ? 130 : 0, i ? (i % 2 ? 90 : -90) : 0); if (w) more.push(w); }
let marks = 0; more.forEach(w => { if (T.inClaim(ctr(w).x, ctr(w).y)) { standOn(G, w); if (T.markHeirloom(w)) marks++; } });
ok(T.heirloomWebs().length === 4 && marks === 3, 'a Claim holds four heirloom webs (' + T.heirloomWebs().length + '/' + T.heirloomSlots() + ')');
const fifth = more.find(w => !w.heirloom && T.inClaim(ctr(w).x, ctr(w).y));
if (fifth) { standOn(G, fifth); pr = T.prompt(); ok(pr && pr.warn && /Heirloom slots full \(4\/4\)/.test(pr.text) && T.markHeirloom(fifth) === false, 'a fifth is refused: "' + (pr && pr.text) + '"'); }
T.addCP(25, 'test'); ok(T.heirloomSlots() === 6, 'a Hold has six slots');
// culling: with the web cap exceeded, ordinary webs go and heirloom webs stay
const keep = T.heirloomWebs().slice(); P.invuln = 99999;
for (let i = 0; i < 45; i++) { keep.forEach(w => { w.integrity = 1; }); P.silk = 300; tp(P, T.home.x + ((i * 97) % 500) - 250, T.home.y + ((i * 53) % 500) - 250); G.webs.select('line'); G.webs.spin('line'); H.run(0.4); }
keep.forEach(w => { w.integrity = 1; }); H.run(5);
ok(G.webs.list.filter(w => !w.dying).length <= G.webs.maxWebs + keep.length && keep.every(w => G.webs.list.indexOf(w) >= 0 && !w.dying), 'heirloom webs survive the web cap (' + G.webs.list.length + ' webs, ' + keep.length + ' heirloom)');
// recycle (hold X)
const toRecycle = G.webs.list.find(w => w.type === 'line' && !w.heirloom && !w.dying && w.build >= 1 && w.integrity > 0.7);
standOn(G, toRecycle); P.silk = 100; const sv0 = P.silk, nW = G.webs.list.length;
G.input.inject.keyDown('KeyX'); H.run(0.6); const mid = T.recycleProgress(); H.run(1.2); G.input.inject.keyUp('KeyX'); H.run(1.5);
const gained = P.silk - sv0, lineCost = G.webs.cost('line');
ok(mid > 0.3 && mid < 1 && gained >= lineCost * 0.3 && (toRecycle.dying || G.webs.list.indexOf(toRecycle) < 0), 'holding X for 1.2 s eats the web and returns about half its silk (ring ' + mid.toFixed(2) + ', +' + gained.toFixed(1) + ' silk of ' + lineCost + ')');
const sample = G.webs.list.find(w => w.type === 'line' && !w.heirloom && !w.dying && w.build >= 1); sample.integrity = 1;
const give = T.recycleWeb(sample); ok(give === Math.round(lineCost * 0.5), 'recycling a sound web returns exactly half its cost (' + give + ' of ' + lineCost + ')');
// letting go early does not recycle
const toKeep = G.webs.list.find(w => w.type === 'line' && !w.heirloom && !w.dying && w.build >= 1 && w.integrity > 0.7 && w !== toRecycle); toKeep.integrity = 1;
standOn(G, toKeep); G.input.inject.keyDown('KeyX'); H.run(0.5); G.input.inject.keyUp('KeyX'); H.run(1.5);
ok(!toKeep.dying && T.recycleProgress() === 0, 'letting go early keeps the web and resets the ring');
ok(G.errors.length === 0, 'no errors');

// ================================================================ the pantry
G = territory(H.load({ tolerant: true })); T = G.territory; P = G.player; W = G.world;
H.run(1);
const retreat = spin(G, 'retreat');
const CR = G.creatures;
function stuckPrey(kind, dx, dy) {
  const c = CR.spawn(kind, P.x + (dx == null ? 14 : dx), P.y + (dy || 0), { instant: true }); CR.trap(c, retreat); c.stuckT = 1e6; return c;
}
tp(P, retreat.x + 30, retreat.y); H.run(0.2);
let prey = stuckPrey('cricket'); H.run(0.2);
ok(T.storeCheck(prey) === null, 'a trapped cricket beside a retreat inside the Claim can be wrapped');
pr = T.prompt(); ok(pr && pr.key === 'E' && /Wrap and store for later \(5 silk\)/.test(pr.text), 'the prompt says so ("' + (pr && pr.text) + '")');
s0 = P.silk; let stored = 0; G.on('pantry:store', () => stored++);
H.press('KeyE');
ok(T.pantry.length === 1 && T.pantry[0].kind === 'cricket' && near(T.pantry[0].fresh, 1, 0.01) && Math.round(s0 - P.silk) === 5 && G.creatures.list.indexOf(prey) < 0 && stored === 1, 'E wraps it for 5 silk: the pantry has a cricket, the prey is gone');
ok((G.state.stats.stored || 0) === 1, 'the stat "stored" counts it');
// refusals
const wild = stuckPrey('cricket', 0, 0); wild.state = 'idle';
ok(T.storeCheck(wild) === 'Nothing to wrap', 'a creature that is not trapped is not wrapped');
P.silk = 3; let p2 = stuckPrey('cricket', 20, 0); ok(/Need 5 silk/.test(T.storeCheck(p2)), 'without silk: "' + T.storeCheck(p2) + '"'); P.silk = 300;
const pfar = CR.spawn('cricket', T.home.x + 900, T.home.y, { instant: true }); CR.trap(pfar, retreat); pfar.stuckT = 1e6;
ok(T.storeCheck(pfar) === 'Outside your Claim', 'outside the Claim: "' + T.storeCheck(pfar) + '"');
const noRet = CR.spawn('cricket', T.home.x - 590, T.home.y, { instant: true }); CR.trap(noRet, retreat); noRet.stuckT = 1e6;
ok(T.inClaim(noRet.x, noRet.y) && /retreat/i.test(T.storeCheck(noRet) || ''), 'with no retreat nearby: "' + T.storeCheck(noRet) + '"');
const big = CR.spawn('wolf', P.x + 10, P.y, { instant: true }); CR.trap(big, retreat); big.stuckT = 1e6;
ok(T.storeCheck(big) === 'Nothing to wrap', 'predators are not stored');
// capacity
while (T.pantry.length < T.pantryCapacity()) T.pantry.push({ id: 100 + T.pantry.length, kind: 'springtail', nutrition: 6, fresh: 1, day: 0 });
const lastP = stuckPrey('cricket', 20, 6);
ok(/Pantry full \(6\/6\)/.test(T.storeCheck(lastP)) && !T.canStore(), 'a Claim holds six bundles: "' + T.storeCheck(lastP) + '"');
T.addCP(25, 'test'); ok(T.canStore() && T.pantryCapacity() === 10, 'a Hold holds ten');
// freshness by season
T.pantry.length = 0; T.pantry.push({ id: 1, kind: 'cricket', nutrition: 10, fresh: 1, day: 0 });
const fresh = (day, secs) => { G.world.dayCount = day; G.world.time01 = 0.3; T.pantry[0].fresh = 1; H.run(secs, { fps: 20, onFrame: calm(G) }); return 1 - T.pantry[0].fresh; };
P.invuln = 99999;
const fSpring = fresh(2, 60), fAutumn = fresh(20, 60), fWinter = fresh(30, 60), fSummer = fresh(12, 60);
ok(near(fSpring, 60 / (300 * 6), 0.004) && near(fSummer, 60 / (300 * 4), 0.004) && near(fAutumn, 60 / (300 * 7), 0.004) && near(fWinter, 60 / (300 * 14), 0.003), 'food keeps 6 days in spring, 4 in summer, 7 in autumn and 14 in winter (lost in 60 s: ' + [fSpring, fSummer, fAutumn, fWinter].map(x => x.toFixed(3)).join(' / ') + ')');
const spoiled = []; G.on('pantry:spoil', d => spoiled.push(d.kind));
T.pantry[0].fresh = 0.001; G.world.dayCount = 12; H.run(2, { onFrame: calm(G) });
ok(T.pantry.length === 0 && spoiled.join() === 'cricket', 'a bundle that runs out of freshness spoils and is announced');
// eating: rest in the retreat
T.pantry.push({ id: 5, kind: 'cricket', nutrition: 10, fresh: 1, day: 0 }, { id: 6, kind: 'springtail', nutrition: 6, fresh: 0.5, day: 0 });
G.world.dayCount = 2; tp(P, retreat.x, retreat.y); P.hunger = 30; P.growth = 10; retreat.integrity = 1; H.run(0.3);
const g0 = P.growth; H.press('KeyR'); H.run(0.5, { onFrame: () => { P.hp = P.maxHp; tp(P, retreat.x, retreat.y); } });
ok(P.resting && T.pantry.length === 1 && T.pantry[0].kind === 'springtail', 'resting in the retreat at home eats the best bundle first (left: ' + T.pantry.map(i => i.kind).join() + ')');
ok(P.hunger > 30 + 8 && near(P.growth, g0, 0.5), 'it feeds her but does not make her grow (hunger ' + P.hunger.toFixed(1) + ', growth ' + g0.toFixed(1) + ' -> ' + P.growth.toFixed(1) + ')');
H.run(5, { onFrame: () => { P.hp = P.maxHp; tp(P, retreat.x, retreat.y); P.hunger = Math.min(P.hunger, 60); } });
ok(T.pantry.length === 0, 'she keeps eating while hungry until the pantry is empty');
ok(G.save.slots()[0].kinds.manual, 'resting at home also saved the game (' + Object.keys(G.save.slots()[0].kinds).join() + ')');
ok(G.errors.length === 0, 'no errors');

// ================================================================ Claim Points from a night, from prey, from a rival
G = territory(H.load({ tolerant: true })); T = G.territory; P = G.player; W = G.world; P.invuln = 99999; H.run(1);
const orb2 = spin(G, 'orb'); const line2 = spin(G, 'line', 60, 30);
T.markHeirloom(orb2); T.markHeirloom(line2); line2.integrity = 1; orb2.integrity = 1;
const nights = []; G.on('territory:night', d => nights.push(d));
W.dayCount = 3; W.time01 = 0.45; H.run(25, { onFrame: calm(G) });
ok(W.phase === 'dusk' || W.phase === 'night' || W.phase === 'day', 'the evening comes on (phase ' + W.phase + ')');
W.time01 = 0.99; let cp0 = T.cp;
for (let i = 0; i < 40; i++) { orb2.integrity = Math.max(orb2.integrity, 0.9); line2.integrity = 0.3; if (i < 3) { W.time01 = 0.55; } H.run(0.5, { onFrame: calm(G) }); }
W.time01 = 0.97; H.run(8, { onFrame: calm(G) });
ok(nights.length >= 1 && T.cp - cp0 >= 1 - 1e-9, 'a night through which an heirloom web stays above half integrity earns 1 CP per web (' + JSON.stringify(nights.slice(-1)[0]) + ', +' + (T.cp - cp0).toFixed(2) + ' CP)');
// prey caught in the Claim: +0.2 each, up to 3 a day
const prey1 = G.creatures.spawn('cricket', orb2.x, orb2.y, { instant: true }); cp0 = T.cp; W.dayCount = 5;
for (let i = 0; i < 30; i++) G.emit('web:trapped', { web: orb2, creature: prey1 });
ok(near(T.cp - cp0, 3, 0.001), 'prey trapped in the Claim is worth 0.2 CP each, at most 3 a day (+' + (T.cp - cp0).toFixed(2) + ' after 30)');
W.dayCount = 6; cp0 = T.cp; for (let i = 0; i < 4; i++) G.emit('web:trapped', { web: orb2, creature: prey1 });
ok(near(T.cp - cp0, 0.8, 0.001), 'and the allowance renews the next day (+' + (T.cp - cp0).toFixed(2) + ')');
const outsideWeb = { x: T.home.x + 2000, y: T.home.y, type: 'orb' }; cp0 = T.cp; G.emit('web:trapped', { web: outsideWeb, creature: prey1 });
ok(T.cp === cp0, 'prey caught outside the Claim earns nothing');
ok(G.errors.length === 0, 'no errors');

// ================================================================ the summer rival
function rivalGame(stage) {
  const g = territory(H.load({ tolerant: true }), { stage }); const t = g.territory, p = g.player; p.invuln = 99999; H.run(1.5);
  const o = spin(g, stage >= 3 ? 'orb' : 'sheet'); t.markHeirloom(o); return { g, t, p, o };
}
{
  const R = rivalGame(3); G = R.g; T = R.t; P = R.p; W = G.world;
  const ev = []; ['territory:rival_started', 'territory:rival_repelled', 'territory:rival_left'].forEach(e => G.on(e, d => ev.push(e.split('_')[1] + ':' + d.kind)));
  W.dayCount = 4; W.time01 = 0.2; H.run(8, { onFrame: calm(G) });
  ok(!T.rival && T.rivalPos() === null, 'no rival in spring');
  W.dayCount = 10; W.time01 = 0.2; H.run(8, { onFrame: calm(G) });
  ok(!T.rival, 'nor in the first two days of summer');
  W.dayCount = 12; W.time01 = 0.2; H.run(6, { onFrame: calm(G) });
  ok(!!T.rival && T.rival.kind === 'wolf' && ev[0] === 'started:wolf', 'from the third day of summer an adult\'s Claim is raided by a wolf spider (' + ev.join() + ')');
  ok(T.rivalYears[1] === true && T.rivalPos() && !T.rivalPos().leaving, 'the year is marked: one invasion a year');
  const cr = T.rival.c, rid = cr.id, inClaimNow = T.inClaim(cr.x, cr.y, 120);   // creature objects are pooled: compare ids, not just identity
  ok(cr.rival === 1 && inClaimNow, 'it prowls inside the Claim');
  const orb0 = R.o.integrity; tp(P, T.home.x - 500, T.home.y - 500);
  let raided = false; for (let i = 0; i < 40 && !raided; i++) { H.run(2, { onFrame: () => { P.hp = P.maxHp; tp(P, T.home.x - 500, T.home.y - 500); } }); raided = R.o.integrity < orb0 - 0.05 || R.o.dying; }
  ok(raided, 'left alone, it tears at the heirloom web (' + orb0.toFixed(2) + ' -> ' + (R.o.dying ? 'gone' : R.o.integrity.toFixed(2)) + ')');
  // drive it off: wound it to half health
  const cp1 = T.cp; cr.hp = cr.maxHp * 0.4; H.run(1.5, { onFrame: calm(G) });
  ok(cr.rival === 2 && T.cp - cp1 >= 5 - 1e-6 && ev.indexOf('repelled:wolf') >= 0, 'wounded to half health it flees and the Claim earns 5 CP (+' + (T.cp - cp1) + ')');
  ok((G.state.stats.rivalsRepelled || 0) >= 1, 'the stat "rivalsRepelled" counts it');
  H.run(60, { onFrame: calm(G) });
  ok(T.rival === null && (cr.dead || cr.id !== rid || !cr.rival || G.creatures.list.indexOf(cr) < 0), 'the rival is gone a little later' + (T.rival ? ' [rival t=' + T.rival.t.toFixed(0) + ' c.rival=' + cr.rival + ' dead=' + cr.dead + ' hp=' + Math.round(cr.hp) + ' at ' + Math.round(cr.x - T.home.x) + ',' + Math.round(cr.y - T.home.y) + ' state=' + cr.state + ']' : ''));
  W.dayCount = 14; H.run(10, { onFrame: calm(G) });
  ok(!T.rival, 'and it does not come back that summer');
  // next year it does
  W.dayCount = 36 + 12; W.time01 = 0.2; tp(P, T.home.x, T.home.y); if (R.o.dying || G.webs.list.indexOf(R.o) < 0 || !R.o.heirloom) { const o2 = spin(G, 'orb'); T.markHeirloom(o2); } H.run(8, { onFrame: calm(G) });
  ok(!!T.rival && T.rivalYears[2] === true, 'a new summer, a new rival (year 2)');
  ok(G.errors.length === 0, 'no errors');
}
{
  const R = rivalGame(2); G = R.g; T = R.t; P = R.p; W = G.world;
  W.dayCount = 12; W.time01 = 0.2; H.run(6, { onFrame: calm(G) });
  ok(!!T.rival && T.rival.kind === 'jumper', 'a young spider (stage 2) meets a jumping spider instead (' + (T.rival && T.rival.kind) + ')');
  // it leaves by itself after its stay if nobody drives it off
  const ev = []; G.on('territory:rival_left', d => ev.push(d.kind));
  tp(P, T.home.x - 450, T.home.y);
  H.run(320, { fps: 20, onFrame: () => { P.hp = P.maxHp; tp(P, T.home.x - 450, T.home.y); R.o.integrity = 1; } });
  ok(ev.length === 1 && ev[0] === 'jumper', 'unchallenged, it leaves after about five minutes (' + ev.join() + ')');
  H.run(60, { fps: 20, onFrame: calm(G) }); ok(T.rival === null, 'and is gone');
}
{
  // no heirloom webs: nothing worth raiding
  G = territory(H.load({ tolerant: true })); T = G.territory; P = G.player; P.invuln = 99999; H.run(1);
  G.world.dayCount = 12; G.world.time01 = 0.2; H.run(10, { onFrame: calm(G) });
  ok(!T.rival, 'with no heirloom web there is nothing to raid, so no rival comes');
  // winter and autumn: never
  const R = rivalGame(3); ['autumn:20', 'winter:30'].forEach(x => { const [n, d] = x.split(':'); R.g.world.dayCount = +d; R.g.world.time01 = 0.2; H.run(8, { onFrame: calm(R.g) }); ok(!R.t.rival, 'no rival in ' + n); });
  ok(R.g.errors.length === 0 && G.errors.length === 0, 'no errors');
}

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
