/* ============================================================================
 * Arachnid Origins  --  boss.js   (module `boss`, priority 45)
 * The Widow Matriarch: a boss fight in her lair in the Old Oak Bark. Beating her unlocks the Black Widow as a playable spider.
 *
 * She is a creature (kind `widow`, see creatures.js) that this module drives: creatures.js hands her thinking to boss.think(c, dt) and routes
 * damage through boss.onHurt(c, dmg, by); the encounter (waking, leash, silk globs, defeat, unlock) lives in boss.update(dt).
 *
 *   boss.state        'dormant' (asleep in her lair) | 'intro' (she has just woken) | 'fight' | 'defeated' | 'gone' (already beaten in an earlier journey)
 *   boss.lair         {x, y, r}  where she lives         boss.c   her creature, or null
 *   boss.phase        1..3 (more attacks and faster as she is hurt)       boss.hpFrac()  0..1
 *   boss.active()     true during the intro and the fight (the HUD shows her health bar)
 *   boss.tooSmall     true while the player is near the lair but below MIN_STAGE (she ignores them)
 *   boss.inArena(x, y, pad) -> bool      boss.threat(c) -> 0..1 (feeds Game.state.danger)
 *   boss.start()      wake her at once (tests / debugging)
 * Events: boss:notice {small}, boss:start, boss:phase {phase}, boss:retreat, boss:defeated {species}
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || typeof Game.register !== 'function') return;
  const C = Game.C, U = Game.util;
  const TAU = Math.PI * 2, PI = Math.PI;
  const sin = Math.sin, cos = Math.cos, atan2 = Math.atan2, hypot = Math.hypot, max = Math.max, min = Math.min, rnd = Math.random;
  const clamp = U.clamp;

  // ---- tuning ---------------------------------------------------------------
  const MIN_STAGE = 3;          // sub-adult: the smallest spider she will fight
  const WAKE_R = 330;           // crossing this ring around the lair wakes her (when the player is big enough)
  const NOTICE_R = 560;         // closer than this, a too-small spider is warned off
  const ARENA_R = 520;          // she keeps to this radius around the lair
  const LOSE_T = 4;             // seconds the player may stay out of the arena (or dead) before she gives up and goes home to heal
  const INTRO_T = 2.6;          // she rears and roars before the fight starts (she cannot be hurt yet)
  const HEAL_RATE = 0.12;       // fraction of her health regained per second while she is home
  const SPEEDK = [1, 1.12, 1.25], CDK = [1, 0.85, 0.7];   // per phase: move speed and attack-cooldown multipliers
  const PHASE_AT = [0.6, 0.3];  // health fractions where phase 2 and 3 begin
  const REAR_T = 1.3;           // roar at a phase change: she does not attack
  const ADULT_HP = 1.4;         // she sizes you up: an adult spider faces a Matriarch with this much more health
const HURT_OPEN = 1.35;       // damage multiplier while she is recovering or stunned (the player's opening)
  // lunge: a locked, telegraphed dash. The lane is shown from the start of the windup, so sidestepping early dodges it.
  const LUNGE = { windup: 0.6, dash: 0.22, recover: 0.95, dmg: 16, minLen: 150, maxLen: 320, range: 200 };
  // silk spit: a fan of sticky globs. A hit hurts a little and slows; a miss leaves a sticky patch for a while.
  const SPIT = { windup: 0.5, recover: 0.55, speed: 330, life: 1.5, r: 6, dmg: 5, slow: 2.2, slowMul: 0.45, patchR: 26, patchLife: 4.5, patchSlow: 0.55, fan: [3, 3, 5], spread: 0.3 };
  // slam (phase 2+): rears up, then pounds the ground in a ring. Outside the ring is safe. She is stunned afterwards.
  const SLAM = { windup: 0.95, radius: 125, dmg: 24, stun: 1.7 };
  const LAIR_R = 70;            // the dark crevice she sits on (art)

  // ---- state ----------------------------------------------------------------
  const B = {
    priority: 45,
    state: 'gone', lair: null, c: null, phase: 1, introT: 0, tooSmall: false, discovered: false,
    mode: 'chase', atk: '', mt: 0, mdur: 1, cd: 1, stun: 0, strafe: 1, strafeT: 1, lastAtk: '', lostT: 0, hitDone: false,
    lockAng: 0, lockLen: 0, t: 0, deadT: 0, noticed: false,
    globs: [], patches: [], fx: [],
    MIN_STAGE, WAKE_R, NOTICE_R, ARENA_R, SLAM_R: SLAM.radius, TUNING: { LUNGE, SPIT, SLAM },
  };
  const has = (o, f) => !!(o && typeof o[f] === 'function');
  function sfx(name, x, y, vol) { try { Game.emit('sfx', { name, x, y, vol: vol == null ? 1 : vol }); } catch (e) { /* ignore */ } }
  const P = () => Game.player || null;
  const bossSpecies = () => C.SPECIES.find(s => s.boss === 'widow') || null;
  const alive = (c) => !!(c && !c.dead && c.kind === 'widow');   // creature objects are recycled: never trust a stale reference

  B.active = () => B.state === 'intro' || B.state === 'fight';
  B.hpFrac = () => { const c = B.c; return alive(c) ? clamp(c.hp / c.maxHp, 0, 1) : (B.state === 'defeated' ? 0 : 1); };
  B.inArena = (x, y, pad) => !!B.lair && B.state !== 'gone' && hypot(x - B.lair.x, y - B.lair.y) < ARENA_R + (pad || 0);
  B.threat = (c) => {
    if (B.state === 'fight') return 0.6 + 0.12 * (B.phase - 1);
    if (B.state === 'intro') return 0.5;
    const p = P();
    return (B.state === 'dormant' && p && !p.dead && B.lair && p.stage >= MIN_STAGE && hypot(p.x - B.lair.x, p.y - B.lair.y) < WAKE_R * 1.5) ? 0.3 : 0;
  };

  // ---- the lair --------------------------------------------------------------
  // The spot is chosen from the world as it was generated (deterministic): open ground in the bark zone, away from the hatch point and from
  // shelters, with no canopy (bark flap) over it, so the fight is never hidden under a leaf. Obstacles inside the arena stay as cover.
  function pickLair() {
    const w = Game.world, z = C.ZONES[1], obs = (w && w.obstacles) || [], sh = (w && w.shelters) || [];
    const midX = (z.x0 + z.x1) / 2;
    let best = null, bs = -1e9;
    for (let x = z.x0 + 750; x <= z.x1 - 380; x += 90) {   // the heart of the bark: the litter (west) and the garden (east) blend in near the edges
      for (let y = 480; y <= C.WORLD_H - 480; y += 90) {
        if (hypot(x - C.SPAWN.x, y - C.SPAWN.y) < 1500) continue;
        let clear = 360;   // distance to the nearest obstacle edge, capped
        for (let i = 0; i < obs.length; i++) { const o = obs[i], dx = o.x - x; if (dx > clear + o.r || dx < -clear - o.r) continue; const d = hypot(dx, o.y - y) - o.r; if (d < clear) clear = d; }
        let shd = 400;
        for (let i = 0; i < sh.length; i++) { const d = hypot(sh[i].x - x, sh[i].y - y) - sh[i].r; if (d < shd) shd = d; }
        if (clear < 140 || shd < 170) continue;
        let cover = 0;   // samples under a bark flap or leaf, out to 280 px (the exposure of open bark is ~0.9)
        if (has(w, 'exposure')) { try { for (let r = 0; r <= 280; r += 70) for (let k = 0; k < (r ? 8 : 1); k++) { const a = k * TAU / 8 + r; if (w.exposure(x + cos(a) * r, y + sin(a) * r) < 0.87) cover++; } } catch (e) { cover = 0; } }
        const score = min(clear, 330) + min(shd, 300) * 0.4 - cover * 60 - abs2(x - midX) * 0.05;
        if (score > bs) { bs = score; best = { x, y }; }
      }
    }
    if (!best) best = { x: midX, y: C.WORLD_H * 0.45 };
    return { x: best.x, y: best.y, r: LAIR_R };
  }
  function abs2(v) { return v < 0 ? -v : v; }

  // art: baked once per lair. core = the dense tangle and what she keeps in it (3x resolution); web = faint strands reaching out through the arena
  let artCore = null, artWeb = null, artKey = '';
  const CORE_R = 175, CORE_S = 2.2, WEB_R = 520;
  function bakeArt(lair) {
    const key = Math.round(lair.x) + ',' + Math.round(lair.y);
    if (artKey === key && artCore) return;
    artKey = key; artCore = artWeb = null;
    const rn = U.mulberry32((lair.x * 7 + lair.y * 13) | 0);
    const R = (a, b) => a + rn() * (b - a);
    try {
      const cs = Math.ceil(CORE_R * 2 * CORE_S);
      artCore = U.makeCanvas(cs, cs); const g = artCore && artCore.getContext('2d');
      if (g) {
        g.translate(cs / 2, cs / 2); g.scale(CORE_S, CORE_S);
        // the dark crevice
        let gr = g.createRadialGradient(0, 0, 8, 0, 0, LAIR_R * 1.55);
        gr.addColorStop(0, 'rgba(2,1,3,0.96)'); gr.addColorStop(0.6, 'rgba(8,4,8,0.82)'); gr.addColorStop(1, 'rgba(10,6,8,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, LAIR_R * 1.55, 0, TAU); g.fill();
        // thick anchor lines out to the edge, then the dense tangle
        g.lineCap = 'round';
        for (let i = 0; i < 16; i++) {
          const a = i * TAU / 16 + R(-0.1, 0.1), r1 = R(24, 40), r2 = R(120, CORE_R - 6), bend = R(-0.35, 0.35);
          g.strokeStyle = 'rgba(236,238,246,' + R(0.28, 0.5).toFixed(2) + ')'; g.lineWidth = R(0.9, 1.7);
          g.beginPath(); g.moveTo(cos(a) * r1, sin(a) * r1); g.quadraticCurveTo(cos(a + bend) * (r1 + r2) / 2, sin(a + bend) * (r1 + r2) / 2, cos(a) * r2, sin(a) * r2); g.stroke();
        }
        for (let i = 0; i < 90; i++) {
          const a1 = R(0, TAU), a2 = a1 + R(0.5, 2.6), r1 = R(36, CORE_R - 10), r2 = R(36, CORE_R - 10), am = (a1 + a2) / 2, rm = R(10, min(r1, r2));
          g.strokeStyle = 'rgba(232,236,246,' + R(0.14, 0.4).toFixed(2) + ')'; g.lineWidth = R(0.5, 1.2);
          g.beginPath(); g.moveTo(cos(a1) * r1, sin(a1) * r1); g.quadraticCurveTo(cos(am) * rm, sin(am) * rm, cos(a2) * r2, sin(a2) * r2); g.stroke();
        }
        // what she keeps here: beetle shells, wing scraps, a few legs, and her egg sacs
        for (let i = 0; i < 10; i++) {
          const a = R(0, TAU), r = R(60, 140), x = cos(a) * r, y = sin(a) * r, k = i % 3;
          g.save(); g.translate(x, y); g.rotate(R(0, TAU));
          if (k === 0) { g.fillStyle = 'rgba(28,24,30,0.9)'; g.beginPath(); g.ellipse(0, 0, R(5, 8), R(3.5, 5), 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(120,128,150,0.5)'; g.beginPath(); g.ellipse(-1, -1.2, 2.6, 1.3, 0, 0, TAU); g.fill(); }
          else if (k === 1) { g.fillStyle = 'rgba(210,222,236,0.35)'; g.beginPath(); g.ellipse(0, 0, R(7, 11), R(2.6, 4), 0, 0, TAU); g.fill(); g.strokeStyle = 'rgba(160,172,190,0.5)'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(-8, 0); g.lineTo(8, 0); g.stroke(); }
          else { g.strokeStyle = 'rgba(70,52,40,0.85)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(-6, 0); g.lineTo(-1, -2); g.lineTo(6, 1); g.stroke(); }
          g.restore();
        }
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3 + 0.6, r = R(30, 44), x = cos(a) * r, y = sin(a) * r, er = R(11, 14);
          const eg = g.createRadialGradient(x - er * 0.3, y - er * 0.35, er * 0.1, x, y, er);
          eg.addColorStop(0, 'rgba(255,252,240,0.95)'); eg.addColorStop(0.7, 'rgba(236,224,198,0.92)'); eg.addColorStop(1, 'rgba(190,172,140,0.9)');
          g.fillStyle = eg; g.beginPath(); g.arc(x, y, er, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 0.5; g.beginPath(); for (let j = 0; j < 5; j++) { const a1 = R(0, TAU); g.moveTo(x + cos(a1) * er * 0.95, y + sin(a1) * er * 0.95); g.lineTo(x + cos(a1 + 1.7) * er * 0.95, y + sin(a1 + 1.7) * er * 0.95); } g.stroke();
        }
        // dew glints on the silk
        g.fillStyle = 'rgba(255,255,255,0.7)';
        for (let i = 0; i < 26; i++) { const a = R(0, TAU), r = R(40, CORE_R - 14); g.beginPath(); g.arc(cos(a) * r, sin(a) * r, R(0.5, 1.1), 0, TAU); g.fill(); }
      }
      const ws = WEB_R * 2;
      artWeb = U.makeCanvas(ws, ws); const h = artWeb && artWeb.getContext('2d');
      if (h) {   // faint strands reaching through the arena: the lair is the middle of a huge web she feels you through
        h.translate(ws / 2, ws / 2); h.lineCap = 'round';
        for (let i = 0; i < 64; i++) {
          const a = R(0, TAU), r1 = R(CORE_R * 0.8, CORE_R * 1.6), r2 = R(300, WEB_R - 8), bend = R(-0.25, 0.25);
          h.strokeStyle = 'rgba(236,240,250,' + R(0.12, 0.26).toFixed(3) + ')'; h.lineWidth = R(0.7, 1.4);
          h.beginPath(); h.moveTo(cos(a) * r1, sin(a) * r1); h.quadraticCurveTo(cos(a + bend) * (r1 + r2) / 2, sin(a + bend) * (r1 + r2) / 2, cos(a + bend * 0.4) * r2, sin(a + bend * 0.4) * r2); h.stroke();
        }
        for (let ring = 0; ring < 4; ring++) {   // a few cross-threads between the rays
          const r = R(220, 480), a0 = R(0, TAU), span = R(0.6, 1.4);
          h.strokeStyle = 'rgba(236,240,250,0.14)'; h.lineWidth = 0.9; h.beginPath(); h.arc(0, 0, r, a0, a0 + span); h.stroke();
        }
      }
    } catch (e) { artCore = artWeb = null; }
  }

  // ---- encounter -------------------------------------------------------------
  B.reset = function () {
    B.globs.length = 0; B.patches.length = 0; B.fx.length = 0;
    B.c = null; B.phase = 1; B.introT = 0; B.tooSmall = false; B.discovered = false; B.noticed = false;
    B.mode = 'chase'; B.atk = ''; B.mt = 0; B.cd = 1; B.stun = 0; B.lostT = 0; B.hitDone = false; B.deadT = 0; B.t = 0; B.lastAtk = '';
    B.lair = pickLair(); bakeArt(B.lair);
    const sp = bossSpecies();
    B.state = (!sp || Game.unlocks.has(sp.id)) ? 'gone' : 'dormant';   // beaten in an earlier journey: only her empty lair is left
    if (B.state === 'dormant' && Game.creatures && Game.creatures.spawn) {
      const c = Game.creatures.spawn('widow', B.lair.x, B.lair.y, { instant: true, state: 'idle', angle: PI * 0.5, radius: Game.creatures.KINDS.widow.radius });
      if (c) { c.hx = B.lair.x; c.hy = B.lair.y; c.noTurn = true; B.c = c; } else B.state = 'gone';
    }
  };

  // ---- Territory: saving. A fight in progress is not worth carrying over: she goes back to her lair and heals, exactly as when you flee her arena.
  // If she was beaten (or gone) she stays gone, even if this browser has not recorded the unlock.
  B.serialize = function () {
    const st = B.state === 'defeated' ? 'gone' : (B.active() ? 'dormant' : B.state);
    return { state: st, discovered: !!B.discovered };
  };
  B.deserialize = function (d) {
    if (!d || typeof d !== 'object') return;
    B.discovered = !!d.discovered;
    if (d.state === 'gone' && B.state !== 'gone') {
      if (alive(B.c) && Game.creatures && Game.creatures.remove) Game.creatures.remove(B.c);
      B.c = null; B.state = 'gone';
    }
  };

  B.init = function () {
    Game.addDrawer(Game.LAYER.SHELTER, drawLair);
    Game.addDrawer(35, drawGround);
    Game.addDrawer(55, drawAir);
    Game.on('creature:killed', (d) => { if (d && d.creature && d.creature === B.c) onDefeated(d.by === 'player'); });
  };

  function startIntro() {
    const c = B.c, p = P(); if (!alive(c) || !p) return;
    const want = c.k.hp * (p.stage >= 4 ? ADULT_HP : 1);
    if (want !== c.maxHp) { c.hp *= want / c.maxHp; c.maxHp = want; }
    B.state = 'intro'; B.introT = 0; B.phase = 1; B.mode = 'rear'; B.mt = INTRO_T; B.mdur = INTRO_T; B.cd = 1.2; B.stun = 0; B.lostT = 0; B.lastAtk = '';
    B.globs.length = 0; B.patches.length = 0;
    if (Game.creatures && Game.creatures.startle) Game.creatures.startle(B.lair.x, B.lair.y, ARENA_R);   // other hunters clear out of her arena
    sfx('boss_roar', c.x, c.y, 1); if (Game.camera && Game.camera.shake) Game.camera.shake(5);
    Game.emit('boss:start', { phase: 1 });
  }
  B.start = function () { if (B.state === 'dormant') startIntro(); return B.state; };

  function giveUp() {
    B.state = 'dormant'; B.lostT = 0; B.mode = 'chase'; B.globs.length = 0;
    const c = B.c; if (alive(c)) { c.tele = 0; c.atk = 0; c.state = 'idle'; }
    Game.emit('boss:retreat');
  }

  // `byPlayer`: only the player beating her counts. If something else removed her (a script, a test) she is just gone: no reward, no unlock.
  function onDefeated(byPlayer) {
    const c = B.c, p = P();
    B.c = null; B.globs.length = 0; B.patches.length = 0; B.stun = 0;
    if (!byPlayer) { B.state = 'gone'; return; }
    B.state = 'defeated'; B.deadT = 0;
    try { Game.stat('bossKills'); } catch (e) { /* ignore */ }
    const sp = bossSpecies();
    if (c) addFx('slam', c.x, c.y, 160, 0.9);
    if (Game.camera && Game.camera.shake) Game.camera.shake(8);
    sfx('boss_roar', c && c.x, c && c.y, 0.8);
    if (p && !p.dead && has(p, 'heal')) p.heal(p.maxHp * 0.4);
    Game.emit('boss:defeated', { species: sp ? sp.id : null });
    if (sp) Game.unlocks.unlock(sp.id);   // saved at once: dying a moment later does not lose it
  }

  B.update = function (dt) {
    dt = min(dt, 0.1);
    const p = P(); if (!p || !B.lair) return;
    B.t += dt;
    tickFx(dt); tickGlobs(dt, p); tickPatches(dt, p);
    const dl = hypot(p.x - B.lair.x, p.y - B.lair.y), c = B.c;
    if (B.state === 'defeated') { B.deadT += dt; return; }
    if (B.state === 'gone') return;
    if (!alive(c)) { B.state = 'gone'; B.c = null; return; }
    // the spider is told once (per approach) that she is too small for this fight
    B.tooSmall = p.stage < MIN_STAGE && dl < NOTICE_R;
    if (B.tooSmall) { if (!B.noticed) { B.noticed = true; Game.emit('boss:notice', { small: true }); } } else if (dl > NOTICE_R + 140) B.noticed = false;
    if (!B.discovered && dl < 900) B.discovered = true;
    if (B.state === 'dormant') {
      if (p.stage >= MIN_STAGE && !p.dead && !p.reviving && dl < WAKE_R) startIntro();
    } else if (B.state === 'intro') {
      B.introT += dt;
      if (p.dead || dl > ARENA_R + 60) { giveUp(); return; }
      if (B.introT >= INTRO_T) { B.state = 'fight'; B.mode = 'chase'; B.cd = 0.8; }
    } else if (B.state === 'fight') {
      // fleeing = dead, or well outside the arena and away from her; fighting at the arena's edge does not count
      if (p.dead || (dl > ARENA_R + 60 && hypot(p.x - c.x, p.y - c.y) > 260)) B.lostT += dt; else B.lostT = max(0, B.lostT - dt * 2);
      if (B.lostT > LOSE_T) { giveUp(); return; }
      const f = c.hp / c.maxHp, ph = f > PHASE_AT[0] ? 1 : (f > PHASE_AT[1] ? 2 : 3);
      if (ph > B.phase && B.mode !== 'act') {   // a new phase: she stops to roar
        B.phase = ph; B.mode = 'rear'; B.mt = B.mdur = REAR_T; B.atk = ''; B.stun = 0;
        sfx('boss_roar', c.x, c.y, 1); if (Game.camera && Game.camera.shake) Game.camera.shake(5);
        Game.emit('boss:phase', { phase: ph });
      }
    }
  };

  // damage to her goes through here (creatures.hurt): none until she is awake, extra while she is recovering
  B.onHurt = function (c, dmg, by) {
    const p = P();
    if (B.state === 'dormant') { if (p && p.stage >= MIN_STAGE && by === 'player') startIntro(); return 0; }   // a bite wakes her; it does not hurt
    if (B.state !== 'fight') return 0;
    if (p && p.stage < MIN_STAGE) return 0;
    return dmg * ((B.mode === 'recover' || B.mode === 'stun') ? HURT_OPEN : 1);
  };

  // ---- her brain (called by creatures.js every update) ------------------------------------------------------------
  function steerC(c, ang, spd, dt, acc) { const a = min(1, acc * dt); c.vx += (cos(ang) * spd - c.vx) * a; c.vy += (sin(ang) * spd - c.vy) * a; }
  function brakeC(c, dt, acc) { const a = min(1, acc * dt); c.vx -= c.vx * a; c.vy -= c.vy * a; }
  function turnC(c, ang, rate, dt) { c.angle = U.turnToward(c.angle, ang, rate * dt); }
  function decay(v, k) { return v > 0 ? max(0, v - k) : 0; }

  B.think = function (c, dt) {
    if (Game.state.scene !== 'playing') { brakeC(c, dt, 8); return; }
    dt = min(dt, 0.1);
    if (B.state === 'dormant') return homeThink(c, dt);
    if (B.state === 'intro') { introThink(c, dt); return; }
    if (B.state === 'fight') { fightThink(c, dt); return; }
    brakeC(c, dt, 8);
  };

  // asleep (or heading home after giving up): sits on her crevice and heals
  function homeThink(c, dt) {
    c.state = 'idle'; c.tele = decay(c.tele, dt * 3); c.atk = 0;
    if (c.hp < c.maxHp) c.hp = min(c.maxHp, c.hp + c.maxHp * HEAL_RATE * dt);
    const dx = B.lair.x - c.x, dy = B.lair.y - c.y, d = hypot(dx, dy);
    if (d > 10) { c.state = 'hunt'; steerC(c, atan2(dy, dx), 90, dt, 6); turnC(c, atan2(dy, dx), 6, dt); } else brakeC(c, dt, 8);
  }
  function introThink(c, dt) {
    const p = P();
    brakeC(c, dt, 10); c.state = 'windup'; c.tele = min(1, c.tele + dt * 3);
    if (p) turnC(c, atan2(p.y - c.y, p.x - c.x), 5, dt);
  }

  function pickAttack(c, d) {
    const opts = [];
    if (d < LUNGE.range) opts.push(['lunge', 4]); else if (d < 420) opts.push(['lunge', 1]);
    if (d >= 110 && d < 480) opts.push(['spit', 3]);
    if (B.phase >= 2 && d < 240) opts.push(['slam', 2]);
    if (!opts.length) opts.push(['spit', 1]);
    let tot = 0; opts.forEach(o => { if (o[0] === B.lastAtk) o[1] *= 0.4; tot += o[1]; });
    let r = rnd() * tot, pick = opts[0][0];
    for (let i = 0; i < opts.length; i++) { r -= opts[i][1]; if (r <= 0) { pick = opts[i][0]; break; } }
    return pick;
  }
  function beginMode(mode, t, atk) { B.mode = mode; B.mt = B.mdur = t; if (atk !== undefined) B.atk = atk; B.hitDone = false; }

  function fightThink(c, dt) {
    const p = P(), k = c.k, ph = B.phase - 1, spd0 = k.chase * SPEEDK[ph], cdk = CDK[ph];
    const ok = !!(p && !p.dead && !p.reviving);
    const dx = ok ? p.x - c.x : 0, dy = ok ? p.y - c.y : 0, d = hypot(dx, dy) || 1, toP = ok ? atan2(dy, dx) : c.angle;
    if (B.mode === 'chase') B.cd -= dt;   // the cooldown is time spent chasing, so a recovery is never skipped
    B.stun = max(0, B.stun - dt); B.mt -= dt;
    const prog = clamp(1 - B.mt / B.mdur, 0, 1);
    switch (B.mode) {
      case 'rear': {   // roaring: front legs up, belly (and hourglass) showing
        brakeC(c, dt, 10); c.state = 'windup'; c.tele = min(1, c.tele + dt * 4); if (ok) turnC(c, toP, 4, dt);
        if (B.mt <= 0) { c.tele = 0; beginMode('chase', 0.1); B.cd = 0.7; }
        break;
      }
      case 'chase': {
        c.state = 'hunt'; c.tele = decay(c.tele, dt * 4); c.atk = 0; c.open = 0.5;
        if (!ok) { brakeC(c, dt, 6); break; }
        const dl = hypot(c.x - B.lair.x, c.y - B.lair.y);
        let ang = toP, spd = spd0;
        if (d < 105) { ang = toP + B.strafe * 1.5; spd = spd0 * 0.55; }     // circle the player when close
        else if (d < 170) spd = spd0 * 0.7;
        if (dl > ARENA_R - 40 && d > 170) { ang = atan2(B.lair.y - c.y, B.lair.x - c.x); spd = spd0; }   // keep to the arena (but never turn her back on someone right behind her)
        steerC(c, ang, spd, dt, 7); turnC(c, toP, 7, dt);
        B.strafeT -= dt; if (B.strafeT <= 0) { B.strafe = -B.strafe; B.strafeT = 1.2 + rnd() * 1.6; }
        if (B.cd <= 0) {
          const a = pickAttack(c, d); B.lastAtk = a;
          if (a === 'lunge') { B.lockAng = toP; B.lockLen = clamp(d + 60, LUNGE.minLen, LUNGE.maxLen); beginMode('windup', LUNGE.windup, 'lunge'); }
          else if (a === 'spit') beginMode('windup', SPIT.windup, 'spit');
          else { beginMode('windup', SLAM.windup, 'slam'); sfx('boss_roar', c.x, c.y, 0.7); }
        }
        break;
      }
      case 'windup': {
        c.state = 'windup'; brakeC(c, dt, 11); c.tele = prog; c.open = 0.8;
        if (B.atk === 'lunge') turnC(c, B.lockAng, 10, dt);
        else if (ok) turnC(c, toP, B.atk === 'spit' ? 8 : 3, dt);
        if (B.mt <= 0) {
          if (B.atk === 'lunge') { beginMode('act', LUNGE.dash); const sp = B.lockLen / LUNGE.dash; c.vx = cos(B.lockAng) * sp; c.vy = sin(B.lockAng) * sp; c.angle = B.lockAng; sfx('bite', c.x, c.y, 0.8); }
          else if (B.atk === 'spit') { fireSpit(c, ok ? toP : c.angle); beginMode('recover', SPIT.recover); B.cd = 1.1 * cdk; }
          else { slam(c, ok, p); beginMode('stun', SLAM.stun); B.stun = SLAM.stun; B.cd = 1.0 * cdk; }
        }
        break;
      }
      case 'act': {   // the lunge dash (velocity was set at its start; steering stays off)
        c.state = 'attack'; c.atk = clamp(1 - B.mt / B.mdur, 0, 1); c.tele = 1;
        if (!B.hitDone && ok) {
          const contact = c.radius * 0.9 + p.radius + k.attack.reach * 0.45;
          if (hypot(p.x - c.x, p.y - c.y) <= contact) { B.hitDone = true; hitPlayer(c, p, LUNGE.dmg); }
        }
        if (B.mt <= 0) { beginMode('recover', LUNGE.recover * (B.hitDone ? 1 : 1.1)); B.cd = 0.9 * cdk; }
        break;
      }
      case 'recover': {   // winded after a lunge or a spit: the moment to bite her
        c.state = 'recover'; brakeC(c, dt, 9); c.tele = decay(c.tele, dt * 3); c.atk = decay(c.atk, dt * 3); c.open = 0.2;
        if (ok && B.atk !== 'lunge') turnC(c, toP, 6, dt);
        if (B.mt <= 0) beginMode('chase', 0.1);
        break;
      }
      case 'stun': {   // after a slam: stuck in the ground for a moment
        c.state = 'recover'; brakeC(c, dt, 12); c.tele = 0; c.atk = 0; c.open = 0.4;
        if (B.mt <= 0) beginMode('chase', 0.1);
        break;
      }
      default: beginMode('chase', 0.1);
    }
  }

  function hitPlayer(c, p, dmg) {
    const got = has(p, 'damage') ? p.damage(dmg, 'widow') : 0;
    Game.emit('creature:attack', { creature: c, damage: got || 0 });
    sfx('bite', p.x, p.y, 1); if (Game.camera && Game.camera.shake) Game.camera.shake(3 + min(5, dmg * 0.2));
    return got;
  }
  function fireSpit(c, ang) {
    const n = SPIT.fan[B.phase - 1];
    sfx('web_spit', c.x, c.y, 1);
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * SPIT.spread, sx = c.x + cos(a) * c.radius * 1.1, sy = c.y + sin(a) * c.radius * 1.1;
      B.globs.push({ x: sx, y: sy, vx: cos(a) * SPIT.speed, vy: sin(a) * SPIT.speed, t: 0, life: SPIT.life });
    }
  }
  function slam(c, ok, p) {
    sfx('slam', c.x, c.y, 1); if (Game.camera && Game.camera.shake) Game.camera.shake(8);
    addFx('slam', c.x, c.y, SLAM.radius, 0.7);
    if (ok && hypot(p.x - c.x, p.y - c.y) <= SLAM.radius + p.radius * 0.4) hitPlayer(c, p, SLAM.dmg);
    c.tele = 0; c.atk = 0;
  }

  // ---- silk globs, sticky patches, effects --------------------------------------------------------------------------
  function tickGlobs(dt, p) {
    const L = B.lair;
    for (let i = B.globs.length - 1; i >= 0; i--) {
      const g = B.globs[i];
      g.t += dt; g.x += g.vx * dt; g.y += g.vy * dt;
      if (!p.dead && !p.reviving && hypot(p.x - g.x, p.y - g.y) <= p.radius * 0.9 + SPIT.r) {   // a hit: a little damage and a lot of silk
        if (has(p, 'damage')) p.damage(SPIT.dmg, 'widow');
        if (has(p, 'slow')) p.slow(SPIT.slow, SPIT.slowMul);
        sfx('trap', p.x, p.y, 0.7); addFx('splat', g.x, g.y, 22, 0.35);
        B.globs.splice(i, 1); continue;
      }
      if (g.t >= g.life || (L && hypot(g.x - L.x, g.y - L.y) > ARENA_R + 260)) {   // a miss: it lands as a sticky patch
        if (B.patches.length >= 24) B.patches.shift();
        B.patches.push({ x: g.x, y: g.y, r: SPIT.patchR, t: 0, life: SPIT.patchLife });
        addFx('splat', g.x, g.y, 18, 0.3);
        B.globs.splice(i, 1);
      }
    }
  }
  function tickPatches(dt, p) {
    for (let i = B.patches.length - 1; i >= 0; i--) {
      const s = B.patches[i]; s.t += dt;
      if (s.t >= s.life) { B.patches.splice(i, 1); continue; }
      if (!p.dead && !p.reviving && hypot(p.x - s.x, p.y - s.y) < s.r + p.radius * 0.4 && has(p, 'slow')) p.slow(0.25, SPIT.patchSlow);
    }
  }
  function addFx(kind, x, y, r, dur) { if (B.fx.length > 12) B.fx.shift(); B.fx.push({ kind, x, y, r, t: 0, dur }); }
  function tickFx(dt) { for (let i = B.fx.length - 1; i >= 0; i--) { const f = B.fx[i]; f.t += dt; if (f.t >= f.dur) B.fx.splice(i, 1); } }

  // ---- drawing ------------------------------------------------------------------------------------------------------
  function drawLair(ctx) {
    const L = B.lair; if (!L || !Game.camera.inView(L.x, L.y, WEB_R + 40)) return;
    const gone = B.state === 'gone' || B.state === 'defeated';
    ctx.save(); ctx.globalAlpha = gone ? 0.55 : 1;
    if (artWeb) ctx.drawImage(artWeb, L.x - WEB_R, L.y - WEB_R, WEB_R * 2, WEB_R * 2);
    if (artCore) ctx.drawImage(artCore, L.x - CORE_R, L.y - CORE_R, CORE_R * 2, CORE_R * 2);
    ctx.restore();
  }
  function ringPath(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function drawGround(ctx) {
    const L = B.lair, p = P(); if (!L || !Game.camera.inView(L.x, L.y, ARENA_R + 60)) return;
    const z = Game.camera.zoom || 1, T = Game.time.real;
    ctx.lineCap = 'round';
    // the tripwire ring that wakes her: shown to a spider big enough to answer it
    if (B.state === 'dormant' && p && p.stage >= MIN_STAGE) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 4 / z; ringPath(ctx, L.x, L.y, WAKE_R); ctx.stroke();   // a dark edge so the silk reads on any ground
      ctx.strokeStyle = 'rgba(255,226,214,' + (0.5 + 0.15 * sin(T * 2)).toFixed(3) + ')'; ctx.lineWidth = 2.2 / z; ctx.setLineDash([10 / z, 12 / z]); ctx.lineDashOffset = -T * 18 / z;
      ringPath(ctx, L.x, L.y, WAKE_R); ctx.stroke(); ctx.setLineDash([]);
    }
    if (B.active()) {   // the edge of her arena: stay outside it too long and she goes home
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 3.4 / z; ringPath(ctx, L.x, L.y, ARENA_R); ctx.stroke();
      ctx.strokeStyle = B.lostT > 0 ? 'rgba(255,120,100,' + (0.55 + 0.3 * sin(T * 8)).toFixed(3) + ')' : 'rgba(255,226,214,0.32)'; ctx.lineWidth = 1.8 / z; ctx.setLineDash([8 / z, 12 / z]);
      ringPath(ctx, L.x, L.y, ARENA_R); ctx.stroke(); ctx.setLineDash([]);
    }
    // sticky patches
    for (let i = 0; i < B.patches.length; i++) {
      const s = B.patches[i], a = clamp((s.life - s.t) / 1.2, 0, 1) * 0.5;
      const g = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, s.r);
      g.addColorStop(0, 'rgba(240,244,255,' + (a * 0.9).toFixed(3) + ')'); g.addColorStop(1, 'rgba(220,226,244,' + (a * 0.25).toFixed(3) + ')');
      ctx.fillStyle = g; ringPath(ctx, s.x, s.y, s.r); ctx.fill();
      ctx.strokeStyle = 'rgba(250,252,255,' + (a * 0.9).toFixed(3) + ')'; ctx.lineWidth = 0.8 / z; ctx.beginPath();
      for (let j = 0; j < 7; j++) { const an = j * TAU / 7 + s.x; ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + cos(an) * s.r, s.y + sin(an) * s.r); }
      ctx.stroke();
    }
    // telegraphs for whatever she is winding up
    const c = B.c;
    if (B.state === 'fight' && alive(c) && B.mode === 'windup') {
      const prog = clamp(1 - B.mt / B.mdur, 0, 1);
      if (B.atk === 'lunge') {   // the lane the dash will take: sidestep it
        const w = c.radius * 0.8, a = B.lockAng;
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, B.lockLen, 0);
        g.addColorStop(0, 'rgba(255,60,48,' + (0.1 + 0.3 * prog).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,60,48,' + (0.04 + 0.12 * prog).toFixed(3) + ')');
        ctx.fillStyle = g; ctx.fillRect(0, -w, B.lockLen, w * 2);
        ctx.strokeStyle = 'rgba(255,90,70,' + (0.3 + 0.5 * prog).toFixed(3) + ')'; ctx.lineWidth = 1.4 / z; ctx.strokeRect(0, -w, B.lockLen, w * 2);
        ctx.restore();
      } else if (B.atk === 'slam') {   // the ring she will pound: stay outside it
        ctx.fillStyle = 'rgba(255,50,40,' + (0.06 + 0.2 * prog).toFixed(3) + ')'; ringPath(ctx, c.x, c.y, SLAM.radius); ctx.fill();
        ctx.strokeStyle = 'rgba(255,90,70,' + (0.4 + 0.5 * prog).toFixed(3) + ')'; ctx.lineWidth = 2 / z; ringPath(ctx, c.x, c.y, SLAM.radius); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,200,180,' + (0.5 * prog).toFixed(3) + ')'; ctx.lineWidth = 1.2 / z; ringPath(ctx, c.x, c.y, SLAM.radius * (1 - prog)); ctx.stroke();
      } else if (B.atk === 'spit') {   // the fan of globs
        const n = SPIT.fan[B.phase - 1];
        ctx.strokeStyle = 'rgba(235,240,255,' + (0.1 + 0.25 * prog).toFixed(3) + ')'; ctx.lineWidth = 1.2 / z; ctx.setLineDash([6 / z, 8 / z]); ctx.beginPath();
        for (let i = 0; i < n; i++) { const an = c.angle + (i - (n - 1) / 2) * SPIT.spread; ctx.moveTo(c.x + cos(an) * c.radius, c.y + sin(an) * c.radius); ctx.lineTo(c.x + cos(an) * 430, c.y + sin(an) * 430); }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // shockwaves and splats
    for (let i = 0; i < B.fx.length; i++) {
      const f = B.fx[i], q = f.t / f.dur;
      if (f.kind === 'slam') {
        ctx.strokeStyle = 'rgba(255,214,190,' + (0.7 * (1 - q)).toFixed(3) + ')'; ctx.lineWidth = (3 - 2 * q) / z; ringPath(ctx, f.x, f.y, f.r * (0.3 + 0.75 * q)); ctx.stroke();
        ctx.fillStyle = 'rgba(190,150,110,' + (0.3 * (1 - q)).toFixed(3) + ')'; ringPath(ctx, f.x, f.y, f.r * (0.2 + 0.7 * q)); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(244,247,255,' + (0.6 * (1 - q)).toFixed(3) + ')'; ringPath(ctx, f.x, f.y, f.r * (0.4 + 0.6 * q)); ctx.fill();
      }
    }
  }
  function drawAir(ctx) {
    const cam = Game.camera, T = Game.time.real;
    // flying globs of silk
    for (let i = 0; i < B.globs.length; i++) {
      const g = B.globs[i]; if (!cam.inView(g.x, g.y, 40)) continue;
      const sp = hypot(g.vx, g.vy) || 1, tx = g.x - g.vx / sp * 26, ty = g.y - g.vy / sp * 26;
      ctx.strokeStyle = 'rgba(240,244,255,0.5)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(tx, ty); ctx.stroke();
      const gr = ctx.createRadialGradient(g.x - 1.5, g.y - 1.5, 0.5, g.x, g.y, SPIT.r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(206,214,238,0.92)');
      ctx.fillStyle = gr; ringPath(ctx, g.x, g.y, SPIT.r); ctx.fill();
    }
    // a stunned Matriarch: little stars circling her
    const c = B.c;
    if (B.state === 'fight' && alive(c) && B.stun > 0 && cam.inView(c.x, c.y, 80)) {
      ctx.fillStyle = 'rgba(255,226,120,0.95)';
      for (let i = 0; i < 4; i++) { const a = T * 3 + i * TAU / 4, x = c.x + cos(a) * c.radius * 1.1, y = c.y - c.radius * 1.4 + sin(a) * c.radius * 0.28; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill(); }
    }
  }

  Game.register('boss', B);
})();
