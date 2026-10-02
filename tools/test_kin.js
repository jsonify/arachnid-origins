// Test script for the sibling spiderlings ("kin") and the creature spider sprites. Run: node tools/test_kin.js
//   - spider legs: four pairs fan out from the cephalothorax, knees bow outward, no leg over-stretches or crosses its neighbour
//   - lookouts: a sibling that spots a hunter raises an alarm (event, danger bump, HUD arrow) that refreshes while seen and then fades
//   - huddle: resting with siblings close by speeds recovery and slows the drain on hunger and water
const H = require('./harness.js');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
H.newGame();
const Cr = G.creatures, P = G.player, C = G.C;

const day = () => { if (G.world) G.world.phase = 'day'; };
const kin = () => Cr.list.filter(c => c.kind === 'kin' && !c.dead);
// a fresh hatchling at a quiet spot with its five siblings, nothing else around
function stage() {
  H.newGame(); day(); P.debugSetStage(0);
  P.x = C.SPAWN.x; P.y = C.SPAWN.y; P.invuln = 99; G.camera.x = P.x; G.camera.y = P.y;
  Cr.list.forEach(c => { if (c.kind !== 'kin') Cr.kill(c, 'other'); });
  H.run(0.2, { onFrame: day });
  Cr.list.forEach(c => { if (c.kind !== 'kin' && !c.dead) Cr.kill(c, 'other'); });
  kin().forEach(c => { c.x = P.x + (Math.random() - 0.5) * 80; c.y = P.y + (Math.random() - 0.5) * 80; });
}

// ---------------------------------------------------------------------------------------------- legs
(function () {
  const cx0 = H.canvas.getContext('2d'), run = (id, ph, mv, extra) => Cr._legPose(id, Object.assign({ ph, mv }, extra), cx0);
  let bad = { outward: 0, order: 0, bone: 0, over: 0, mirror: 0, nan: 0, cross: 0 };
  // do two leg polylines (hip-knee-foot) intersect?
  const seg = (a, b, c, d) => { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  // femurs (hip-knee) must never cross - that was the "legs merge into a Y" look; at rest no part of a leg may cross its neighbour (tips overlapping briefly mid-stride is fine: legs sit at different heights)
  const cross = (L, i, j, whole) => { const A = [L.hip[i], L.knee[i], L.foot[i]], B = [L.hip[j], L.knee[j], L.foot[j]]; for (let u = 0; u < (whole ? 2 : 1); u++) for (let v = 0; v < (whole ? 2 : 1); v++) if (seg(A[u], A[u + 1], B[v], B[v + 1])) return true; return false; };
  ['kin', 'mate', 'wolf', 'jumper'].forEach(id => {
    for (let q = 0; q < 24; q++) {
      for (const mv of [0, 0.5, 1]) {
        const L = run(id, q / 24 * Math.PI * 2, mv);
        for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
          const i = k * 2 + (s > 0 ? 1 : 0), hip = L.hip[i], knee = L.knee[i], foot = L.foot[i];
          if (![hip, knee, foot].every(p => isFinite(p[0]) && isFinite(p[1]))) bad.nan++;
          if (s * knee[1] < s * hip[1] + 0.25 || s * foot[1] < s * hip[1] + 0.25) bad.outward++;         // knees and feet sit well outboard of the hip
          const b1 = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]), b2 = Math.hypot(foot[0] - knee[0], foot[1] - knee[1]);
          if (Math.abs(b1 - L.bone[k]) > 0.25 || Math.abs(b2 - L.bone[k]) > 0.25) bad.bone++;           // both bones keep their length (a lifted foot raises the knee a little)
          if (Math.hypot(foot[0] - hip[0], foot[1] - hip[1]) > 2 * L.bone[k] + 1e-6) bad.over++;
          if (k > 0 && foot[0] >= L.foot[i - 2][0]) bad.order++;                                          // feet stay in front-to-back order
          if (k > 0 && cross(L, i, i - 2, mv === 0)) bad.cross++;
        }
        if (mv === 0) for (let i = 0; i < 8; i += 2) { const a = L.foot[i], b = L.foot[i + 1]; if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] + b[1]) > 1e-6) bad.mirror++; }
      }
    }
  });
  Object.keys(bad).forEach(k => ok(bad[k] === 0, 'spider legs: no ' + k + ' violations (' + bad[k] + ')'));
  // splay: front legs reach forward of the head, rear legs trail behind the abdomen's hip line
  const L = run('kin', 0, 0);
  ok(L.foot[0][0] > L.hip[0][0] + 1 && L.foot[6][0] < L.hip[6][0] - 1, 'front legs reach forward, rear legs trail back');
  // poses used in the world: stuck in a web, dead, winding up, hopping
  [{ stuck: 0.6 }, { dead: 1 }, { tele: 1 }, { hop: 1 }].forEach(p => {
    const L2 = run('jumper', 1.3, 0.5, p), fine = L2.foot.every(f => isFinite(f[0]) && isFinite(f[1])) && L2.knee.every(f => isFinite(f[0]) && isFinite(f[1]));
    ok(fine, 'leg pose finite for ' + JSON.stringify(p));
  });
  const cv = H.canvas, ctx = cv.getContext('2d'); let thrown = 0;
  ['kin', 'mate', 'wolf', 'jumper'].forEach(id => { try { Cr.drawKindIcon(ctx, id, 100, 100, 120); Cr.drawKindIcon(ctx, id, 100, 100, 120, { silhouette: true }); } catch (e) { thrown++; console.log(id, e.message); } });
  ok(thrown === 0, 'spider portraits draw without error');
})();

// ------------------------------------------------------------------------------------------ lookouts
(function () {
  stage();
  let events = 0; G.on('kin:alarm', () => events++);
  ok(kin().length >= 3, 'siblings present at hatch (' + kin().length + ')');
  ok(Cr.alarms.length === 0 && G.state.danger < 0.05, 'quiet to begin with');
  // a jumping spider 230px off: beyond the siblings' bolt range (190) but inside their lookout range (260)
  const k0 = kin()[0]; k0.x = P.x + 20; k0.y = P.y;
  const j = Cr.spawn('jumper', k0.x + 230, k0.y, { instant: true }); j.state = 'patrol'; j.cool2 = 99; j.fedT = 99;
  const hold = () => { day(); j.x = k0.x + 230; j.y = k0.y; j.vx = j.vy = 0; j.state = 'patrol'; j.cool2 = 99; j.awareT = 0; };
  H.run(1.2, { onFrame: hold });
  ok(Cr.alarms.length === 1 && Cr.alarms[0].kind === 'jumper', 'a sibling raises an alarm for the jumper (' + Cr.alarms.length + ')');
  ok(events === 1, 'one kin:alarm event, not one per sibling per sense tick (' + events + ')');
  ok(G.state.danger > 0.3, 'the alarm lifts danger so the heartbeat / vignette cue fires (' + G.state.danger.toFixed(2) + ')');
  ok(Math.hypot(Cr.alarms[0].x - j.x, Cr.alarms[0].y - j.y) < 40, 'the alarm points at the predator');
  H.run(3, { onFrame: hold });
  ok(Cr.alarms.length === 1 && Cr.alarms[0].life > 2.5, 'alarm stays alive while a sibling can still see the predator');
  // the HUD draws the arrow when the predator is off-screen
  G.camera.update && G.camera.update(1 / 60);
  const sp = G.camera.worldToScreen(Cr.alarms[0].x, Cr.alarms[0].y);
  console.log('  jumper at screen', sp.x.toFixed(0), sp.y.toFixed(0));
  H.shot('kin_alarm');
  ok(G.errors.length === 0, 'rendering the HUD with an alarm raises no errors');
  // predator gone: alarm fades out and danger returns to nothing
  Cr.kill(j, 'other');
  H.run(5.5, { onFrame: day });
  ok(Cr.alarms.length === 0, 'alarm expires after the predator is gone');
  ok(G.state.danger < 0.1, 'danger settles again (' + G.state.danger.toFixed(2) + ')');
  // edu tip speaks up while an alarm is live
  Cr.alarms.push({ id: -1, kind: 'jumper', x: P.x, y: P.y, life: 3 });
  ok(/siblings spotted/.test(G.edu.tip()), 'tip mentions the siblings\' warning');
  Cr.alarms.length = 0;
})();
(function () {
  // a predator that would never go for you is none of the siblings' business
  stage();
  P.radius = 60;                                   // far too big for a jumping spider to bother with
  const k0 = kin()[0]; k0.x = P.x + 20; k0.y = P.y;
  const j = Cr.spawn('jumper', k0.x + 150, k0.y, { instant: true });
  H.run(1.5, { onFrame: () => { day(); P.radius = 60; j.x = k0.x + 150; j.y = k0.y; j.vx = j.vy = 0; j.state = 'patrol'; } });
  ok(Cr.alarms.length === 0, 'no alarm for a predator that is not hostile to the player (' + Cr.alarms.length + ')');
})();

// -------------------------------------------------------------------------------------------- huddle
(function () {
  function rest(withKin, secs) {
    stage();
    if (!withKin) kin().forEach(c => { c.disperse = true; c.wa = Math.random() * 6.28; c.x = P.x + 900; c.y = P.y + 900; });
    P.energy = 20; P.hp = P.maxHp * 0.5; P.hunger = 90; P.hydration = 90;
    H.press('KeyR');
    ok(P.resting, 'resting (R)' + (withKin ? ' with siblings' : ' alone'));
    const e0 = P.energy, hp0 = P.hp, f0 = P.hunger, w0 = P.hydration;
    H.run(secs, { onFrame: () => { day(); if (!withKin) kin().forEach(c => { c.x = P.x + 900; c.y = P.y + 900; }); } });
    return { n: Cr.huddle, huddled: P.huddled, de: P.energy - e0, dh: P.hp - hp0, df: f0 - P.hunger, dw: w0 - P.hydration, sib: kin().filter(c => Math.hypot(c.x - P.x, c.y - P.y) < 40).length };
  }
  const alone = rest(false, 4), together = rest(true, 4);
  console.log('  alone   ', JSON.stringify(alone, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  console.log('  together', JSON.stringify(together, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  ok(alone.n === 0 && alone.huddled === 0, 'no huddle bonus when alone');
  ok(together.n >= 3 && together.huddled >= 3, 'siblings tuck in and huddle (' + together.n + ')');
  ok(together.sib >= 3, 'siblings really are within a couple of body lengths (' + together.sib + ')');
  ok(together.de > alone.de * 1.3, 'energy recovers faster huddled (' + together.de.toFixed(2) + ' vs ' + alone.de.toFixed(2) + ')');
  ok(together.dh > alone.dh * 1.3, 'health recovers faster huddled (' + together.dh.toFixed(3) + ' vs ' + alone.dh.toFixed(3) + ')');
  ok(together.df < alone.df * 0.9 && together.dw < alone.dw * 0.9, 'hunger and thirst drain slower huddled');
  // the bonus belongs to resting: it stops the moment the player gets up
  H.press('KeyR'); H.run(0.5, { onFrame: day });
  ok(!P.resting && P.huddled === 0, 'no bonus once the player is up and about');
  // siblings leave the huddle to follow again
  H.run(3, { keys: ['KeyD'], onFrame: day });
  ok(Cr.huddle <= 3 && G.errors.length === 0, 'following again after the rest; no errors');
})();

// ---------------------------------------------------------------------------------- long-run sanity
(function () {
  H.newGame(); day();
  let nan = 0;
  H.run(60, { keys: ['KeyD'], onFrame: (i) => { day(); if (i % 120 === 60) H.press('KeyR'); if (P.dead || P.hp < 5) P.hp = P.maxHp; for (const c of Cr.list) if (!isFinite(c.x) || !isFinite(c.y)) nan++; if (!(Cr.huddle >= 0 && Cr.huddle <= 3)) nan++; } });
  ok(nan === 0, 'no NaN / out-of-range huddle over a minute of play');
  ok(G.errors.length === 0, 'Game.errors empty (' + G.errors.length + ')');
  G.errors.slice(0, 5).forEach(e => console.log(e.where, e.message));
})();

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
