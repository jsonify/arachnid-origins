// Test script for the Territory calendar and seasons (src/territory.js, plus the season hooks in world, creatures, player and webs).
// Run: node tools/test_seasons.js
//   - a 36-day year of four 9-day seasons, read from world.dayCount (day, year, progress through the season)
//   - season:change fires once per crossing; Brood and Survival have no calendar effects at all
//   - what each season changes: hunger/thirst drain, prey and flyer numbers, birds, weather odds (frost only in winter), winter healing in a retreat
//   - the mating season opens on day 16
//   - frost damages exposed webs and small spiders left in the open
const H = require('./harness.js');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= e;

function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function territory(G, o) {
  o = o || {};
  G.newGame('territory', 'garden', { slot: o.slot || 1, name: 'Seasons' });
  G.player.debugSetStage(o.stage == null ? 2 : o.stage); G.player.invuln = 99999;
  return G;
}
function setDay(G, day, t) { G.world.dayCount = day; G.world.time01 = t == null ? 0.3 : t; }
const keepAlive = (G) => () => { const P = G.player; P.hp = P.maxHp; };

// ================================================================ the calendar
let G = territory(H.load({ tolerant: true }));
const T = G.territory, P = G.player, W = G.world;
const cal = (d) => { W.dayCount = d; return T.calendar(); };
let c = cal(0);
ok(c.year === 1 && c.day === 1 && c.season === 'spring' && c.dayInSeason === 1 && c.daysLeftInSeason === 8, 'day 0 is day 1 of Year 1, the first day of spring');
c = cal(8); ok(c.season === 'spring' && c.day === 9 && c.daysLeftInSeason === 0, 'the ninth day is still spring (the last one)');
c = cal(9); ok(c.season === 'summer' && c.day === 10 && c.dayInSeason === 1, 'the tenth day opens summer');
c = cal(18); ok(c.season === 'autumn' && c.day === 19, 'the nineteenth day opens autumn');
c = cal(27); ok(c.season === 'winter' && c.day === 28, 'the 28th day opens winter');
c = cal(35); ok(c.season === 'winter' && c.day === 36 && c.year === 1, 'day 36 is the last day of Year 1');
c = cal(36); ok(c.season === 'spring' && c.day === 1 && c.year === 2, 'the next day is spring of Year 2');
c = cal(36 * 3 + 20); ok(c.year === 4 && c.season === 'autumn' && c.label === 'Day 21 of 36, Year 4', 'later years count on (' + c.label + ')');
W.dayCount = 12; W.time01 = 0; ok(near(T.calendar().progress, 3 / 9, 0.001), 'progress through the season follows the day and the time of day (' + T.calendar().progress.toFixed(3) + ')');
W.time01 = 0.5; ok(near(T.calendar().progress, 3.5 / 9, 0.001), 'half a day later it has moved on');
ok(T.SEASONS.length === 4 && T.SEASONS.map(s => s.id).join() === 'spring,summer,autumn,winter', 'the four seasons come in order');

// ================================================================ season:change
G = territory(H.load({ tolerant: true }));
const changes = []; G.on('season:change', d => changes.push(d.prev + '>' + d.season));
setDay(G, 8, 0.99); H.run(0.5); changes.length = 0;
H.run(5);
ok(changes.join() === 'spring>summer', 'crossing midnight into day 10 fires season:change once (' + changes.join() + ')');
H.run(5); ok(changes.length === 1, 'and only once');
setDay(G, 17, 0.99); H.run(0.2); H.run(5); ok(changes.join() === 'spring>summer,summer>autumn', 'then autumn follows summer (' + changes.join() + ')');
setDay(G, 26, 0.99); H.run(0.2); H.run(5); ok(changes[changes.length - 1] === 'autumn>winter', 'and winter follows autumn');
setDay(G, 35, 0.99); H.run(0.2); H.run(5); ok(changes[changes.length - 1] === 'winter>spring' && G.territory.calendar().year === 2, 'winter turns to spring when the year rolls over (' + changes.join() + ')');
ok(G.errors.length === 0, 'no errors turning through a year');

// ================================================================ Brood and Survival have no calendar
['brood', 'survival'].forEach(mode => {
  const g = H.load({ tolerant: true }); g.newGame(mode);
  const t = g.territory, ch = []; g.on('season:change', d => ch.push(d));
  g.player.invuln = 99999;
  setDay(g, 30, 0.3); H.run(3); setDay(g, 40, 0.99); H.run(3);
  ok(t.active === false && t.popMul('springtail') === 1 && t.popMul('bird') === 1 && t.healMul() === 1 && t.mateAllowed() === true, mode + ': the territory module is inert (no population, heal or mating changes)');
  ok(ch.length === 0 && t.metab.hunger === 1 && t.metab.thirst === 1, mode + ': no season events and no metabolism changes');
  ok(g.player.dead === false && g.save.canWrite() === false && g.save.hasAny() === false, mode + ': nothing is saved');
  ok(g.errors.length === 0, mode + ': no errors');
});

// ================================================================ hunger and thirst
G = territory(H.load({ tolerant: true })); const P2 = G.player, W2 = G.world;
function drain(day) {
  setDay(G, day, 0.3); H.run(0.2); P2.hunger = 80; P2.hydration = 80;
  H.run(20, { fps: 20, onFrame: keepAlive(G) });
  return { h: 80 - P2.hunger, t: 80 - P2.hydration };
}
const dSpring = drain(2), dSummer = drain(12), dAutumn = drain(22), dWinter = drain(30);
ok(near(dWinter.h / dSummer.h, 0.7, 0.06) && near(dWinter.t / dSummer.t, 0.7 / 1.2, 0.06), 'winter hunger and thirst drain slower, summer thirst faster (hunger ' + dWinter.h.toFixed(1) + '/' + dSummer.h.toFixed(1) + ', thirst ' + dWinter.t.toFixed(1) + '/' + dSummer.t.toFixed(1) + ')');
ok(near(dSpring.h / dSummer.h, 0.9, 0.06) && near(dSpring.t / dSummer.t, 0.9 / 1.2, 0.06), 'spring sits between the two (' + dSpring.h.toFixed(1) + ' / ' + dSpring.t.toFixed(1) + ')');
ok(near(dAutumn.h, dSummer.h, 0.6) && near(dAutumn.t, dSummer.t / 1.2, 0.6), 'autumn drains at the base rate');

// ================================================================ prey, flyers and birds
const T2 = G.territory;
setDay(G, 0, 0); H.run(0.2); const springStart = T2.popMul('springtail');
setDay(G, 8, 0.99); H.run(0.2); const springEnd = T2.popMul('springtail');
ok(near(springStart, 0.85, 0.01) && springEnd > 1.1 && springEnd < 1.16, 'spring prey climbs from 0.85x to 1.15x through the season (' + springStart.toFixed(2) + ' -> ' + springEnd.toFixed(2) + ')');
setDay(G, 12, 0.3); H.run(0.2);
ok(near(T2.popMul('springtail'), 1.3, 0.01) && near(T2.popMul('midge'), 1.3 * 1.15, 0.01) && near(T2.popMul('wasp'), 1.3, 0.01), 'summer brings 1.3x prey, more flyers and more wasps (' + T2.popMul('springtail').toFixed(2) + ', midge ' + T2.popMul('midge').toFixed(2) + ', wasp ' + T2.popMul('wasp').toFixed(2) + ')');
setDay(G, 18, 0); H.run(0.2); const autStart = T2.popMul('springtail');
setDay(G, 26, 0.99); H.run(0.2); const autEnd = T2.popMul('springtail');
ok(near(autStart, 1.0, 0.02) && near(autEnd, 0.6, 0.06) && near(T2.popMul('bird'), 1.2, 0.001), 'autumn prey thins from 1.0x to 0.6x and birds are 1.2x (' + autStart.toFixed(2) + ' -> ' + autEnd.toFixed(2) + ')');
setDay(G, 30, 0.3); H.run(0.2);
ok(near(T2.popMul('springtail'), 0.25, 0.001) && T2.popMul('midge') === 0 && T2.popMul('bird') === 1, 'winter prey is 0.25x and nothing flies');
function census(day) {
  setDay(G, day, 0.3); P2.hp = P2.maxHp; H.run(60, { fps: 20, onFrame: keepAlive(G) });
  const l = G.creatures.list.filter(x => !x.dead && !x.rival);
  return { prey: l.filter(x => x.role === 'prey').length, fly: l.filter(x => x.k.isFlyer).length, all: l.length };
}
const cSummer = census(12), cWinter = census(30);
ok(cWinter.prey < cSummer.prey * 0.8 && cWinter.fly < cSummer.fly * 0.8, 'the living world follows: winter has far less prey and fewer flyers than summer (prey ' + cWinter.prey + ' vs ' + cSummer.prey + ', flyers ' + cWinter.fly + ' vs ' + cSummer.fly + ')');
ok(G.errors.length === 0, 'no errors through the seasons');

// ================================================================ weather odds
// each roll is forced by ending a clear spell at once, so a few hundred rolls per season take seconds rather than hours
G = territory(H.load({ tolerant: true }));
{
  const wS = G.world._dbg.wS, Wd = G.world;
  const rolls = (day, n) => {
    const out = {}; setDay(G, day, 0.3); G.player.hp = G.player.maxHp; H.run(0.1);
    for (let i = 0; i < n; i++) {
      Wd.forceWeather('clear', 0); wS.lastType = 'clear'; wS.phase = 'gap'; wS.timer = 0; setDay(G, day, 0.3);
      G.step(1 / 60); const t = Wd.weather.type; out[t] = (out[t] || 0) + 1; G.player.hp = G.player.maxHp;
    }
    return out;
  };
  const N = 300, spring = rolls(2, N), summer = rolls(12, N), autumn = rolls(22, N), winter = rolls(30, N);
  const share = (o, k) => (o[k] || 0) / N;
  ok(share(spring, 'frost') === 0 && share(summer, 'frost') === 0 && share(autumn, 'frost') === 0, 'frost never comes in spring, summer or autumn (' + N + ' rolls each)');
  ok(share(winter, 'frost') > 0.35 && share(winter, 'frost') < 0.75, 'in winter about half of all weather spells are cold snaps (' + (share(winter, 'frost') * 100).toFixed(0) + '%)');
  ok(share(spring, 'rain') + share(spring, 'drizzle') > share(summer, 'rain') + share(summer, 'drizzle') + 0.05, 'spring is wetter than summer (' + ((share(spring, 'rain') + share(spring, 'drizzle')) * 100).toFixed(0) + '% vs ' + ((share(summer, 'rain') + share(summer, 'drizzle')) * 100).toFixed(0) + '%)');
  ok(share(autumn, 'fog') > share(spring, 'fog') + 0.05 && share(autumn, 'fog') > share(summer, 'fog') + 0.04, 'autumn is the foggy season (' + (share(autumn, 'fog') * 100).toFixed(0) + '%)');
  ok(share(winter, 'rain') + share(winter, 'drizzle') < share(spring, 'rain') + share(spring, 'drizzle'), 'winter weather is mostly cold rather than wet');
  setDay(G, 12, 0.3); H.run(0.2); ok(G.territory.weatherBias().gap === 1.6, 'summer stretches the dry gaps between spells');
  setDay(G, 2, 0.3); H.run(0.2); ok(G.territory.weatherBias().gap === 0.8, 'and spring shortens them');
  Wd.forceWeather('clear', 0);
  ok(G.errors.length === 0, 'no errors while the weather turns through a year');
}

// ================================================================ frost: webs, small spiders, and healing in a retreat
G = territory(H.load({ tolerant: true }), { stage: 2 });
const P3 = G.player, W3 = G.world, T3 = G.territory;
setDay(G, 30, 0.3); H.run(0.5);
P3.silk = 300; G.webs.select('sheet'); P3.x += 150; G.webs.spin('sheet'); H.run(3);
const sheet = G.webs.list.find(w => w.type === 'sheet');
ok(!!sheet, 'a sheet is in place');
// weather is the only difference: clear for 60 s, then frost for 60 s
sheet.integrity = 1; W3.forceWeather('clear', 0);
function lose(type, s) { sheet.integrity = 1; W3.forceWeather(type, 0.9); const keep = () => { sheet.dying = false; W3.forceWeather(type, 0.9); G.player.hp = G.player.maxHp; }; H.run(s, { fps: 20, onFrame: keep }); return 1 - sheet.integrity; }
const lClear = lose('clear', 40), lFrost = lose('frost', 40);
ok(lFrost > lClear + 0.02, 'frost wears an exposed web down faster than clear weather (' + lFrost.toFixed(3) + ' vs ' + lClear.toFixed(3) + ' in 40 s)');
// a small spider in the open is hurt by frost, a sheltered one is not
W3.forceWeather('frost', 0.9); P3.invuln = 0;
let open = null, bestE = 0;
for (let k = 0; k < 400; k++) { const x = 5200 + (k % 20) * 150, y = 3200 + Math.floor(k / 20) * 150; const e = W3.exposure ? W3.exposure(x, y) : 0; if (e > bestE) { bestE = e; open = { x, y }; } }
if (open) { P3.x = open.x; P3.y = open.y; }
P3.hp = P3.maxHp; P3.hunger = P3.hydration = 90; P3.debugSetStage(1); P3.invuln = 0; P3.hp = P3.maxHp;
const hp0 = P3.hp; H.run(10, { fps: 20, onFrame: () => { W3.forceWeather('frost', 0.9); } });
ok(!open || P3.hp < hp0, 'a spiderling left in the open in a cold snap loses health (' + hp0.toFixed(0) + ' -> ' + P3.hp.toFixed(0) + ', exposure ' + bestE.toFixed(2) + ')');
P3.debugSetStage(2); P3.invuln = 99999;
// healing: faster in a silk retreat in winter, ordinary in summer (a fresh retreat, the frost has had its turn with the old webs)
W3.forceWeather('clear', 0); P3.debugSetStage(2); P3.invuln = 99999; P3.x = sheet.x - 400; P3.y = sheet.y; P3.silk = 300; setDay(G, 30, 0.3); H.run(0.5);
G.webs.select('retreat'); G.webs.spin('retreat'); H.run(3);
const retreat = G.webs.list.find(w => w.type === 'retreat');
ok(!!retreat && G.webs.isSheltered(retreat.x, retreat.y), 'a silk retreat is up and shelters the spot it covers');
function healRate(day, inRetreat) {
  setDay(G, day, 0.3); W3.forceWeather('clear', 0); retreat.integrity = 1; retreat.dying = false; H.run(0.2);
  const spot = inRetreat ? retreat : { x: retreat.x + 700, y: retreat.y + 700 };
  P3.x = spot.x; P3.y = spot.y; P3.vx = P3.vy = 0; P3.hp = P3.maxHp * 0.3; P3.hunger = P3.hydration = 90; P3.energy = 90;
  if (P3.resting) { H.press('KeyR'); H.run(0.6); }
  for (let i = 0; i < 6 && !P3.resting; i++) { H.press('KeyR'); H.run(0.6); P3.x = spot.x; P3.y = spot.y; }
  const mul = T3.healMul(); P3.hp = P3.maxHp * 0.1; const h0 = P3.hp;
  H.run(1.5, { fps: 20, onFrame: () => { P3.x = spot.x; P3.y = spot.y; P3.hunger = P3.hydration = 90; W3.forceWeather('clear', 0); } });
  const out = { gain: P3.hp - h0, mul, resting: P3.resting };
  H.press('KeyR'); H.run(0.6);
  return out;
}
const hWinterIn = healRate(30, true), hWinterOut = healRate(30, false), hSummerIn = healRate(12, true);
ok(hWinterIn.resting && hWinterOut.resting && hSummerIn.resting, 'the spider rests in all three places');
ok(hWinterIn.mul === 1.5 && hWinterOut.mul === 1 && hSummerIn.mul === 1, 'healMul is 1.5 only in a retreat in winter (' + hWinterIn.mul + ', ' + hWinterOut.mul + ', ' + hSummerIn.mul + ')');
ok(hWinterIn.gain > hSummerIn.gain * 1.2 && hWinterIn.gain > hWinterOut.gain * 1.5, 'and she really does heal faster there (' + hWinterIn.gain.toFixed(1) + ' hp vs ' + hSummerIn.gain.toFixed(1) + ' in summer, ' + hWinterOut.gain.toFixed(1) + ' in the open)');

// ================================================================ the mating season opens on day 16
G = territory(H.load({ tolerant: true }), { stage: 4 });
const P4 = G.player, T4 = G.territory;
setDay(G, 3, 0.3); H.run(4);
ok(T4.mateAllowed() === false && !G.creatures.mate && T4.matingNote().indexOf('day 16') >= 0, 'before day 16 an adult has no mate (' + T4.matingNote() + ')');
setDay(G, 14, 0.3); H.run(1); ok(T4.mateAllowed() === false && /1 day to go/.test(T4.matingNote()), 'the note counts the days down (' + T4.matingNote() + ')');
setDay(G, 15, 0.3); H.run(6);
ok(T4.mateAllowed() === true && !!G.creatures.mate && T4.matingNote() === '', 'on day 16 a mate arrives');
ok(G.errors.length === 0, 'no errors');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
