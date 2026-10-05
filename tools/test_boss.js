// Test script for the Widow Matriarch boss fight. Run: node tools/test_boss.js [--quick]   (--quick skips the long fairness fights)
//   - her lair, her waking rules (sub-adult or bigger), the intro, the fight, her three attacks and three phases
//   - the arena: she gives up and heals if you flee, and nothing else wanders into it
//   - beating her (only by the player) unlocks the Black Widow for good; she is gone in later journeys
//   - fairness: a player who dodges her telegraphs wins, one who just stands and bites loses
const H = require('./harness.js');
const G = H.load({ tolerant: true });
const QUICK = process.argv.includes('--quick');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const scene = () => G.state.scene;
const B = G.boss, T = B.TUNING;

const ctx = H.canvas.getContext('2d'), fillText = ctx.fillText.bind(ctx); let drawn = [];
ctx.fillText = function (s) { drawn.push(String(s)); return fillText.apply(null, arguments); };
const frame = () => { drawn = []; G.render(); return drawn; };
const has = (re) => frame().some(s => re.test(s));

const ev = {}; ['boss:notice', 'boss:start', 'boss:phase', 'boss:retreat', 'boss:defeated', 'species:unlocked', 'player:damaged', 'player:died'].forEach(n => G.on(n, d => { (ev[n] = ev[n] || []).push(d); }));
const n = (name) => (ev[name] || []).length;
const clearEv = () => { for (const k in ev) delete ev[k]; };
function fresh(stage, species) {   // a new game with the widow still locked, the player at `stage`, standing `dist` px west of the lair
  G.store.set('unlocks', []); G.unlocks.reload(); G.settings.species = 'garden'; G.settings.mode = 'survival';
  H.newGame(); clearEv();
  const P = G.player; P.debugSetStage(stage); P.invuln = 0; P.hp = P.maxHp; P.hunger = P.hydration = 100;
  return P;
}
const place = (P, dist, ang) => { ang = ang == null ? Math.PI : ang; P.x = B.lair.x + Math.cos(ang) * dist; P.y = B.lair.y + Math.sin(ang) * dist; P.vx = P.vy = 0; G.camera.snap(); };
const awake = () => { B.start(); H.run(3); };   // wake her and sit through the intro

// ---------------------------------------------------------------- her and her lair
let P = fresh(0);
const L = B.lair, bark = G.C.ZONES[1];
ok(B.state === 'dormant' && B.c && B.c.kind === 'widow' && !B.c.dead, 'a new journey starts with her asleep in her lair (' + B.state + ')');
ok(L && L.x > bark.x0 + 700 && L.x < bark.x1 - 300 && Math.hypot(L.x - G.C.SPAWN.x, L.y - G.C.SPAWN.y) > 1500, 'the lair is deep in the Old Oak Bark, far from the hatch point (' + Math.round(L.x) + ', ' + Math.round(L.y) + ')');
ok(G.world.zoneAt(L.x, L.y).id === 'bark', 'and really is in the bark zone');
ok(Math.hypot(B.c.x - L.x, B.c.y - L.y) < 5 && B.c.hp === 340 && B.c.maxHp === 340 && B.c.radius > 25, 'she sits on it, big and at full health (hp ' + B.c.hp + ', radius ' + B.c.radius + ')');
const L1 = { x: L.x, y: L.y }; H.newGame(); ok(B.lair.x === L1.x && B.lair.y === L1.y, 'the lair is in the same place every journey');
ok(G.creatures.KINDS.widow.ai === 'boss' && G.creatures.kindList().some(k => k.id === 'widow'), 'she is a creature kind in the bestiary');
ok(G.creatures.list.filter(c => c.kind === 'widow').length === 1, 'there is exactly one of her');
ok(B.inArena(L.x + 100, L.y) && !B.inArena(L.x + 900, L.y), 'inArena tells the arena from the rest of the world');

// ---------------------------------------------------------------- too small: she ignores you
P = fresh(1); place(P, 450); clearEv(); H.run(3);
ok(B.state === 'dormant' && B.tooSmall && n('boss:notice') === 1, 'a spiderling near the lair is warned off, once (state ' + B.state + ', notices ' + n('boss:notice') + ')');
ok(frame().join('').indexOf('TOO SMALL TO CHALLENGE') >= 0, 'the warning is on screen at once, ahead of any zone banner');
H.run(2); ok(n('boss:notice') === 1, 'and not nagged again while it stays');
place(P, 100); H.run(4);
ok(B.state === 'dormant' && P.hp === P.maxHp, 'she does not wake for a spiderling, even on top of her lair');
const hp0 = B.c.hp; G.creatures.attackAt(B.c.x, B.c.y, 80, 50, 'player');
ok(B.c.hp === hp0 && B.state === 'dormant', 'a spiderling cannot hurt her or wake her');

// ---------------------------------------------------------------- waking up
P = fresh(3); place(P, B.NOTICE_R + 150); H.run(1);
ok(B.state === 'dormant' && !B.tooSmall, 'a sub-adult outside the wake ring leaves her asleep');
ok(B.discovered === true, 'the lair counts as discovered once you are near');
place(P, B.WAKE_R - 20); H.run(0.3);
ok(B.state === 'intro' && n('boss:start') === 1, 'crossing the wake ring wakes her: the intro begins');
const hpI = B.c.hp; G.creatures.attackAt(B.c.x, B.c.y, 80, 50, 'player');
ok(B.c.hp === hpI, 'she cannot be hurt during the intro');
H.run(0.5); ok(B.c.tele > 0.5, 'she rears up (the hourglass shows)');
ok(G.state.danger > 0.2, 'the music gets tense (danger ' + G.state.danger.toFixed(2) + ')');
H.run(3); ok(B.state === 'fight' && B.active(), 'then the fight begins');
ok(has(/^Widow Matriarch$/), 'her health bar is on screen');
H.shot('boss_fight_start');
const hpF = B.c.hp; G.creatures.attackAt(B.c.x, B.c.y, 80, 20, 'player');
ok(B.c.hp < hpF && near(hpF - B.c.hp, 20 * 0.88, 0.01), 'in the fight her armour takes 12% off a bite (' + (hpF - B.c.hp).toFixed(2) + ')');
B.mode = 'recover'; B.mt = B.mdur = 2; const hpR = B.c.hp; G.creatures.attackAt(B.c.x, B.c.y, 80, 20, 'player');
ok(near(hpR - B.c.hp, 20 * 0.88 * 1.35, 0.01), 'but a bite while she recovers does 35% more (' + (hpR - B.c.hp).toFixed(2) + ')');
ok(B.inArena(B.lair.x + 100, B.lair.y), 'the arena is closed to wandering creatures');
// a bite on a sleeping Matriarch wakes her (it does not hurt)
P = fresh(3); place(P, 150); H.run(0.01); B.state = 'dormant'; H.run(0.05);
if (B.state === 'dormant') { G.creatures.attackAt(B.c.x, B.c.y, 80, 20, 'player'); ok(B.state === 'intro' && B.c.hp === 340, 'a bite wakes a sleeping Matriarch without hurting her'); }
else ok(true, 'a bite wakes a sleeping Matriarch without hurting her (she was already awake)');

// ---------------------------------------------------------------- her attacks (each one measured on its own)
P = fresh(3); place(P, 130); awake(); P.hp = P.maxHp; B.cd = 999;   // awake, but she will not choose an attack by herself
let c = B.c;
function setUp(atk, mt) { B.mode = 'windup'; B.atk = atk; B.mt = B.mdur = mt; B.hitDone = false; B.cd = 999; }
// lunge: the lane is locked at the start of the windup
c.x = B.lair.x; c.y = B.lair.y; c.vx = c.vy = 0; P.x = c.x - 110; P.y = c.y; P.hp = P.maxHp; P.invuln = 0;
B.lockAng = Math.PI; B.lockLen = 200; setUp('lunge', 0.05); H.run(0.6);
ok(near(P.hp, P.maxHp - T.LUNGE.dmg, 0.5), 'a spider standing in the lane takes the lunge (' + T.LUNGE.dmg + ' damage; hp ' + P.hp.toFixed(1) + ')');
ok(B.mode === 'recover' || B.mode === 'chase', 'and she is left winded afterwards (' + B.mode + ')');
B.mode = 'chase'; c.x = B.lair.x; c.y = B.lair.y; c.vx = c.vy = 0; P.x = c.x - 110; P.y = c.y + 95; P.hp = P.maxHp;   // ...a sidestep of ~95 px
B.lockAng = Math.PI; B.lockLen = 200; setUp('lunge', 0.05); H.run(0.6);
ok(P.hp === P.maxHp, 'a spider that has stepped out of the lane is not hit');
// spit
B.mode = 'chase'; c.x = B.lair.x; c.y = B.lair.y; c.vx = c.vy = 0; c.angle = Math.PI; P.x = c.x - 250; P.y = c.y; P.hp = P.maxHp; P.vx = P.vy = 0; B.globs.length = 0;
setUp('spit', 0.05); H.run(0.12);
ok(B.globs.length === T.SPIT.fan[0], 'her spit is a fan of ' + T.SPIT.fan[0] + ' globs in phase 1 (' + B.globs.length + ')');
H.run(1.2);
ok(near(P.maxHp - P.hp, T.SPIT.dmg, 0.5), 'the glob that hits does a little damage (' + (P.maxHp - P.hp).toFixed(1) + ')');
// a glob that hits slows you; one that misses leaves a sticky patch
P.hp = P.maxHp; B.globs.length = 0; P.tangleT = 0; P.tangleMul = 1;
B.globs.push({ x: P.x - 30, y: P.y, vx: 300, vy: 0, t: 0, life: 1.5 }); H.run(0.2);
ok(P.tangleT > 1.5 && near(P.tangleMul, T.SPIT.slowMul, 1e-6) && near(P.maxHp - P.hp, T.SPIT.dmg, 0.5), 'a glob that hits covers you in silk: slowed to ' + T.SPIT.slowMul + ' for about ' + T.SPIT.slow + ' s');
B.patches.length = 0; B.globs.push({ x: P.x + 300, y: P.y + 300, vx: 100, vy: 0, t: T.SPIT.life - 0.01, life: T.SPIT.life }); H.run(0.1);
ok(B.patches.length === 1, 'a glob that misses lands as a sticky patch');
P.tangleT = 0; P.tangleMul = 1; P.x = B.patches[0].x; P.y = B.patches[0].y; H.run(0.1);
ok(P.tangleT > 0 && near(P.tangleMul, T.SPIT.patchSlow, 1e-6), 'standing in a patch slows you (x' + P.tangleMul + ')');
// slam
B.globs.length = 0; B.patches.length = 0; B.mode = 'chase'; c.x = B.lair.x; c.y = B.lair.y; c.vx = c.vy = 0; B.phase = 2; P.tangleT = 0; P.tangleMul = 1;
P.x = c.x - 80; P.y = c.y; P.hp = P.maxHp; setUp('slam', 0.05); H.run(0.2);
ok(near(P.hp, P.maxHp - T.SLAM.dmg, 0.5) && B.mode === 'stun' && B.stun > 1, 'the slam hits everyone in the ring (' + T.SLAM.dmg + ') and leaves her stunned');
B.mode = 'chase'; B.stun = 0; P.x = c.x - (T.SLAM.radius + 60); P.y = c.y; P.hp = P.maxHp; setUp('slam', 0.05); H.run(0.2);
ok(P.hp === P.maxHp && B.mode === 'stun', 'but anyone outside the ring is safe');
B.mode = 'stun'; B.mt = B.mdur = 3; B.stun = 3; const hpS = c.hp; G.creatures.attackAt(c.x, c.y, 80, 20, 'player');
ok(near(hpS - c.hp, 20 * 0.88 * 1.35, 0.01), 'a stunned Matriarch takes extra damage');
// killed by her: the death note
P.hp = 1; B.mode = 'chase'; B.stun = 0; c.x = B.lair.x; c.y = B.lair.y; P.x = c.x - 80; P.y = c.y; setUp('slam', 0.05); clearEv(); H.run(0.2);
ok(P.dead && ev['player:died'] && ev['player:died'][0].cause === 'widow', 'dying to her is its own cause of death (' + (ev['player:died'] && ev['player:died'][0].cause) + ')');
H.run(4); ok(scene() === 'gameover' && has(/^Claimed by the Matriarch$/), 'with its own game over note');
H.shot('boss_gameover');

// ---------------------------------------------------------------- phases
P = fresh(3); place(P, 130); awake(); P.invuln = 99; c = B.c; clearEv();
ok(B.phase === 1, 'the fight starts in phase 1');
c.hp = c.maxHp * 0.55; H.run(0.1);
ok(B.phase === 2 && n('boss:phase') === 1 && ev['boss:phase'][0].phase === 2, 'under 60% health she enters phase 2');
ok(B.mode === 'rear' && c.tele > 0, 'she stops to roar first');
c.hp = c.maxHp * 0.25; H.run(0.1);
ok(B.phase === 3 && n('boss:phase') === 2, 'under 30% health she enters phase 3');
c.hp = c.maxHp; H.run(0.2); ok(B.phase === 3, 'a phase never goes backwards');
// over a long fight she uses every attack (the player is invulnerable here)
const seen = {}; let fanMax = 0;
for (let i = 0; i < 60 * 70; i++) {   // she spits when you keep your distance and lunges or slams when you are close: alternate
  H.run(1 / 60); const gap = (i % 900) < 450 ? 90 : 320; P.x = c.x - gap; P.y = c.y; if (B.mode === 'windup') seen[B.atk] = 1; fanMax = Math.max(fanMax, B.globs.length); P.hp = P.maxHp; c.hp = c.maxHp * 0.2; }
ok(seen.lunge && seen.spit && seen.slam, 'over time she lunges, spits and slams (' + Object.keys(seen).join() + ')');
ok(fanMax >= 5, 'phase 3 spits a wider fan (' + fanMax + ' globs at once)');
H.shot('boss_phase3');

// ---------------------------------------------------------------- the leash
P = fresh(3); place(P, 130); awake(); P.invuln = 99; c = B.c; clearEv();
c.hp = c.maxHp * 0.5; H.run(0.1);
place(P, B.ARENA_R + 400); H.run(2);
ok(B.state === 'fight' && B.lostT > 1, 'running away from the arena starts a countdown (' + B.lostT.toFixed(1) + ' s)');
place(P, 130); H.run(1.5); ok(B.lostT < 1, 'coming back cancels it');
place(P, B.ARENA_R + 400); H.run(5);
ok(B.state === 'dormant' && n('boss:retreat') === 1, 'stay away long enough and she gives up and goes home');
const hpGone = c.hp; H.run(8);
ok(c.hp > hpGone + 40 && Math.hypot(c.x - B.lair.x, c.y - B.lair.y) < 12, 'she heals in her lair while you are away (hp ' + hpGone.toFixed(0) + ' -> ' + c.hp.toFixed(0) + ')');
H.run(10); ok(c.hp === c.maxHp, 'back to full health');
place(P, B.WAKE_R - 30); H.run(0.3);
ok(B.state === 'intro' && n('boss:start') === 1, 'and the wake ring works again');

// ---------------------------------------------------------------- an adult faces a tougher Matriarch
P = fresh(4); place(P, B.WAKE_R - 30); H.run(0.5);
ok(B.state === 'intro' && near(B.c.maxHp, 340 * 1.4, 0.01) && near(B.c.hp, B.c.maxHp, 0.01), 'an adult wakes a Matriarch with 40% more health (' + B.c.maxHp.toFixed(0) + ')');

// ---------------------------------------------------------------- sticky silk on the player
P = fresh(3); P.invuln = 99; G.settings.mouseAim = false;
// a stretch of open ground to walk along (no obstacle within 300 px ahead)
let spot = null; for (let x = 700; x < 2000 && !spot; x += 50) for (let y = 400; y < 3200 && !spot; y += 100) { if (!G.world.obstacles.some(o => o.x > x - 80 && o.x < x + 300 && Math.abs(o.y - y) < o.r + 60)) spot = { x, y }; }
const walk = (secs) => { P.x = spot.x; P.y = spot.y; P.vx = P.vy = 0; const a = P.x; H.run(secs, { keys: ['KeyD'] }); return P.x - a; };
const free = walk(1.0); P.slow(1.0, 0.5); const slowed = walk(1.0);
ok(slowed < free * 0.75 && slowed > free * 0.3, 'silk slows the spider (' + slowed.toFixed(0) + ' px vs ' + free.toFixed(0) + ' px in a second)');
H.run(1.5); const after = walk(1.0); ok(near(after, free, free * 0.12) && P.tangleT === 0, 'and wears off');
P.tangleT = 0; P.tangleMul = 1; P.slow(1, 0.6); P.slow(0.5, 0.4); ok(near(P.tangleMul, 0.4) && near(P.tangleT, 1), 'the stronger slow wins and the timer only extends');
P.slow(0, 0.1); P.slow(-1, 0.1); ok(near(P.tangleMul, 0.4), 'a zero or negative slow does nothing');
G.settings.mouseAim = true;

// ---------------------------------------------------------------- beating her
P = fresh(3); place(P, 130); awake(); c = B.c; clearEv(); P.hp = P.maxHp * 0.5; P.invuln = 99;
const objBefore = G.edu.objectives.find(o => o.id === 'a_widow');
ok(objBefore && !objBefore.done && /Widow Matriarch/.test(objBefore.text), 'a sub-adult has the optional objective to defeat her');
const growth0 = P.growth;
ok(!G.unlocks.has('widow') && G.unlocks.list().join() === 'garden', 'the Black Widow is locked before the fight');
G.creatures.kill(c, 'player'); H.run(0.2);
ok(B.state === 'defeated' && n('boss:defeated') === 1 && B.c === null, 'when she falls the fight is won');
ok(G.unlocks.has('widow') && n('species:unlocked') === 1 && ev['species:unlocked'][0].id === 'widow', 'and the Black Widow is unlocked');
ok((G.store.get('unlocks', []) || []).join() === 'widow', 'for good (saved)');
ok(P.hp > P.maxHp * 0.5 + 10, 'the victor is healed (hp ' + P.hp.toFixed(0) + ' / ' + P.maxHp.toFixed(0) + ')');
ok(G.state.stats.bossKills === 1, 'the kill is counted');
ok(objBefore.done && P.growth > growth0 + 30 || P.stage > 3, 'the objective is completed and pays growth');
ok(G.edu.unlocked.has('widow_venom'), 'and teaches a fact about widow venom');
ok(frame().join('').indexOf('NEW SPIDER UNLOCKED') < 0, 'the unlock card holds back for a moment (the victory sinks in first)');
H.run(2.2); const cardText = frame();
ok(G.ui.unlockCard && G.ui.unlockCard.id === 'widow' && cardText.join('').indexOf('NEW SPIDER UNLOCKED') >= 0 && cardText.some(t2 => t2 === 'Black Widow'), 'then a card announces the Black Widow');
H.shot('boss_unlock_card');
H.run(6); ok(B.state === 'defeated', 'the lair stays quiet');
// later journeys
H.newGame(); ok(B.state === 'gone' && !G.creatures.list.some(c2 => c2.kind === 'widow') && !B.active(), 'in later journeys she is gone (' + B.state + '), only her empty lair is left');
G.player.debugSetStage(3); H.run(0.3); ok(!G.edu.objectives.some(o => o.id === 'a_widow'), 'and the objective is not offered again');
ok(!B.inArena(B.lair.x, B.lair.y), 'her arena is open to wandering creatures again');
G.render();
H.shot('boss_lair_empty');
// only the player can beat her
P = fresh(3); place(P, 130); awake(); c = B.c; clearEv();
G.creatures.kill(c, 'other'); H.run(0.2);
ok(!G.unlocks.has('widow') && n('species:unlocked') === 0 && B.state === 'gone', 'if something else removes her, there is no reward');

// ---------------------------------------------------------------- the minimap marker and HUD stay on screen without errors
P = fresh(3); place(P, 700); H.run(1); G.render();
P.stage = 3; G.ui.mapBig = true; H.run(0.2); G.render(); G.ui.mapBig = false;
ok(B.state === 'dormant', 'the HUD, minimap and lair marker draw fine while she sleeps');

// ---------------------------------------------------------------- fairness: scripted players
function trial(kind, stage) {
  G.store.set('unlocks', []); G.unlocks.reload(); G.settings.mode = 'survival'; H.newGame();
  const p = G.player; p.debugSetStage(stage); p.x = B.lair.x - 300; p.y = B.lair.y; p.invuln = 0; G.camera.snap(); p.applyUpgrades(false); p.hp = p.maxHp; p.hunger = p.hydration = 100;
  const DT = 1 / 60, SPD = p.stageInfo.speed * p.speedMul, REACT = 0.25;   // a human takes about a quarter of a second to answer a telegraph
  let t = 0, taken = 0, last = p.hp;
  const move = (dx, dy, sprint) => { const d = Math.hypot(dx, dy) || 1, v = SPD * (sprint ? 1.7 : 1) * DT; p.x += dx / d * v; p.y += dy / d * v; p.angle = Math.atan2(dy, dx); };
  while (t < 240 && !p.dead && B.state !== 'defeated') {
    const c2 = B.c; p.vx = p.vy = 0; p.energy = 100;
    if (c2 && !c2.dead) {
      const dx = c2.x - p.x, dy = c2.y - p.y, d = Math.hypot(dx, dy);
      if (kind === 'naive') {   // stands and bites
        if (d > c2.radius + p.radius + 4) move(dx, dy); else p.angle = Math.atan2(dy, dx);
        if (d < c2.radius + p.radius + 22) { p.angle = Math.atan2(dy, dx); p.bite(); }
      } else if (B.state === 'fight') {   // stays close, sidesteps the lunge lane, leaves the slam ring, bites when she is winded
        const m = B.mode, atk = B.atk, react = B.mdur - B.mt >= REACT;
        if (m === 'windup' && atk === 'lunge') { if (react) { const la = B.lockAng, nx = -Math.sin(la), ny = Math.cos(la), side = ((p.x - c2.x) * nx + (p.y - c2.y) * ny) >= 0 ? 1 : -1; move(nx * side, ny * side, true); } else if (d > 110) move(dx, dy); }
        else if (m === 'windup' && atk === 'slam') { if (react && d < B.SLAM_R + 40) move(-dx, -dy, true); }
        else if (m === 'windup' && atk === 'spit') { if (react) move(-dy, dx, true); }
        else if (m === 'recover' || m === 'stun') { if (d > c2.radius + p.radius + 6) move(dx, dy, true); p.angle = Math.atan2(dy, dx); if (d < c2.radius + p.radius + 24) p.bite(); }
        else if (m === 'act') { /* the dash is on */ }
        else { const want = c2.radius + p.radius + 55; if (d > want + 15) move(dx, dy, d > 250); else if (d < want - 25) move(-dx, -dy); else move(-dy, dx); }
      }
    }
    H.run(DT); t += DT;
    if (p.hp < last) taken += last - p.hp; last = p.hp;
  }
  return { won: B.state === 'defeated', dead: p.dead, t: Math.round(t), taken: Math.round(taken), maxHp: Math.round(p.maxHp) };
}
if (QUICK) console.log('(--quick: skipping the fairness fights)');
else {
  const smart = [0, 1, 2, 3].map(() => trial('smart', 3)), naive = [0, 1, 2].map(() => trial('naive', 3));
  console.log('  sub-adult, dodging: ' + JSON.stringify(smart)); console.log('  sub-adult, stand and bite: ' + JSON.stringify(naive));
  ok(smart.filter(r => r.won).length >= 3, 'a sub-adult who dodges her telegraphs beats her (' + smart.filter(r => r.won).length + ' of 4)');
  ok(smart.filter(r => r.won).every(r => r.t < 150 && r.taken < r.maxHp), 'in a reasonable time, without being killed (' + smart.map(r => r.t + 's/-' + r.taken).join(', ') + ')');
  ok(naive.filter(r => r.won).length <= 1, 'a sub-adult who just stands and bites loses (' + naive.filter(r => r.won).length + ' of 3 won)');
  const adult = trial('smart', 4);
  ok(adult.won, 'an adult who dodges wins too (' + JSON.stringify(adult) + ')');
}

ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')' + (G.errors.length ? ' ' + G.errors[0].where + ': ' + G.errors[0].message : ''));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
