/* ============================================================================
 * Arachnid Origins  --  player.js  (module `player`, priority 30)
 * The spider: movement, procedural rendering (IK gait), meters, molting,
 * upgrades, death and the adult ending sequence.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util;
  const TAU = Math.PI * 2;
  const clamp = U.clamp, lerp = U.lerp, smooth = U.smooth;

  // ---- tuning ---------------------------------------------------------------
  const HATCH_T = 3.0;        // hatch-in animation (s), controls locked
  const MOLT_T = 6.0;         // molt animation (s)
  const MOLT_SOFT = 12;       // soft, vulnerable period after molting (s)
  const COURT_T = 4.6;        // courtship dance (s)
  const LAY_T = 3.2;          // egg-laying sequence (s)
  const DEATH_T = 2.4;        // death animation before 'gameover'
  const SPAWN_INVULN = 2.5, MOLT_INVULN = 2.0;
  const SPRINT_MUL = 1.7, SPRINT_DRAIN = 7.0;   // energy / s while sprinting
  const REST_REGEN = 6.0;                       // energy / s while resting (x3 sheltered)
  // Huddling with siblings (Game.creatures.huddle, up to 3 of them close by) while resting: per sibling, recover faster and burn less food and water
  const HUDDLE_ENERGY = 0.15, HUDDLE_HEAL = 0.2, HUDDLE_DRAIN = 0.12;
  // Sibling revive: a fatal blow downs the spider instead while a sibling is left (Game.creatures.claimSibling). The sibling runs in and gives its
  // life, and the spider gets up with REVIVE_HP of its health, meters topped up to REVIVE_METER and REVIVE_INVULN s of grace. 1 sibling = 1 revive.
  const REVIVE_HP = 0.5, REVIVE_METER = 35, REVIVE_INVULN = 4;
  const REVIVE_MAX = 4;       // longest the spider stays down waiting for the gift (s); the sibling normally arrives well before
  // Territory (territory.js): after a fatal blow an heir takes over with a Setback (SETBACK_* in territory.js); "shaken" is -15% speed for a while
  const SHAKEN_MUL = 0.85;

  // ---- art constants ----------------------------------------------------------
  // leg attachment points (x, |y|) on the cephalothorax in units of body radius, splay angles, lengths
  const LEG_ATT = [[0.50, 0.30], [0.28, 0.34], [0.06, 0.34], [-0.16, 0.30]];
  const LEG_ANG = [30, 54, 126, 152].map(d => d * Math.PI / 180);
  const LEG_LEN = [2.55, 2.25, 2.2, 2.7];
  // stage palettes: carapace, abdomen, dark outline/pigment, mark, leg, leg-dark
  const PAL = [
    { cara: '#cfa971', abd: '#dcc08f', dark: '#7a5a30', mark: '#f6e6bd', leg: '#c29a62', legD: '#6e4f2a', eye: '#1a120a' },
    { cara: '#ab7c43', abd: '#bb8d55', dark: '#5b3b1d', mark: '#ead08f', leg: '#9a6e3c', legD: '#4a2f17', eye: '#150e08' },
    { cara: '#80573a', abd: '#8f6540', dark: '#40291a', mark: '#ddbc7c', leg: '#764e30', legD: '#35210f', eye: '#120a06' },
    { cara: '#5f3e29', abd: '#6c452c', dark: '#2e1b11', mark: '#d8ab5c', leg: '#573621', legD: '#26150b', eye: '#0e0805' },
    { cara: '#46291d', abd: '#522f20', dark: '#1d100a', mark: '#e6b457', leg: '#3c2216', legD: '#170c06', eye: '#0a0503' },
  ];
  // Black Widow (Latrodectus mactans): the young are pale and striped with orange-red spots; they darken with every molt until the adult
  // female is glossy black with a red spot above the spinnerets. `spot` is the red/orange of those spots and the hourglass.
  const PAL_WIDOW = [
    { cara: '#e3cc9c', abd: '#efdfba', dark: '#86663a', mark: '#fff3d4', spot: '#e8863a', leg: '#d4b984', legD: '#76562c', eye: '#1a120a' },
    { cara: '#b8884e', abd: '#c9a068', dark: '#5c3b1c', mark: '#fff0cc', spot: '#e0702c', leg: '#a97b46', legD: '#4a2f17', eye: '#150e08' },
    { cara: '#6c4c38', abd: '#7b5a42', dark: '#2e1d16', mark: '#e6d3b0', spot: '#e0582a', leg: '#5e4030', legD: '#241410', eye: '#100907' },
    { cara: '#33262a', abd: '#3a2b30', dark: '#120a0e', mark: '#c9b8a4', spot: '#d8401f', leg: '#2e2226', legD: '#0f0809', eye: '#0a0506' },
    { cara: '#1a1620', abd: '#1e1924', dark: '#050407', mark: '#8a8696', spot: '#d8141c', leg: '#2b2430', legD: '#08060a', eye: '#050305' },
  ];
  const PALS = { garden: PAL, widow: PAL_WIDOW };
  const ABD_SHAPE = { garden: [1, 1], widow: [0.9, 1.22] };   // abdomen scale along / across the body: the widow's is round and globular
  const CAMO = '#7d7260';
  const LIGHT = { x: -0.55, y: -0.83 };   // light comes from the upper-left
  const VS = 1.22;      // visual scale of the sprite relative to the collision radius
  const LEGBEND = 1.02; // total leg length vs. relaxed reach (more bend = more visible knees)
  const KNEE_FWD = 0.7; // how far fore/aft (vs. straight out) the knees prefer to bow: front pairs back, rear pairs forward

  const has = (o, f) => !!(o && typeof o[f] === 'function');
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const hash = (i, s) => U.hash2(i, 7, s || 3);

  // ---- the module -------------------------------------------------------------
  const P = {
    priority: 30, alwaysUpdate: true,
    // contract state
    x: C.SPAWN.x, y: C.SPAWN.y, vx: 0, vy: 0, angle: -0.5, radius: 5,
    stage: 0, stageInfo: C.STAGES[0],
    hp: 30, maxHp: 30, hunger: 80, hydration: 80, energy: 100, silk: 20, maxSilk: 20,
    growth: 0, growthNeeded: 60, upgrades: {},
    speedMul: 1, biteMul: 1, stealth: 1, damageTaken: 1, senseRadius: 60, drainMul: 1,
    species: C.SPECIES[0], stealthBase: 1, venomPower: 0, tangleT: 0, tangleMul: 1,   // which spider this is (Game.C.SPECIES entry), stealth before night bonuses, poison share of a bite, silk-slow timer
    hidden: false, resting: false, moltTimer: 0, molting: false, dead: false, deathCause: null, reviving: false, revives: 0,
    stateLabel: 'walking', mate: { found: false, courted: false, laid: false }, mateHint: null,
    // extras (documented in the report)
    interactHint: '', inShelter: null, exhausted: false, sprinting: false, silkMul: 1, huddled: 0,
    invuln: 0, offers: [], moltPhase: 'none', soft: 0, eggSac: null, courting: false, laying: false, hatching: false,
    shaken: 0,   // Territory: seconds of "shaken" left after an heir takes over (-15% speed)
  };
  Game.player = P;   // available immediately for modules loaded later

  // scratch / internal state (reset in reset())
  let anim = 0, bitePhase = 0, biteCd = 0, flash = 0, curl = 0, shiver = 0, spinT = 0, eatT = 0, drinkT = 0, drinkAcc = 0;
  let hatchT = 0, moltT = 0, courtT = 0, layT = 0, deathT = 0, endT = 0, victoryFired = false, gaitPhase = 0, abAng = 0, prevAng = 0;
  let sfxStepT = 0, trailT = 0, mateRetryT = 0, exhaustedFlag = false, dotBuf = 0, dotSrc = 'damage', hurtSfxT = 0, chooseWait = 0;
  let enterT = 0, exitCd = 0, restToggleCd = 0, noInputT = 0, statT = 0, lastGood = { x: 0, y: 0 };
  let reviveSib = null, reviveCause = null, reviveLanded = false, reviveGlow = 0, bellyK = 0;   // bellyK: 0..1 how much the underside (a widow's hourglass) shows while she hangs to spin or rests
  let sac = null, exuvia = null, pendingStage = 0, swapped = false, courtMateRef = null, layTarget = null, bodyBob = 0;
  const feet = [];     // per-leg gait state
  const trail = [];    // dragline trail points
  const parts = [];    // particles
  for (let i = 0; i < 8; i++) feet.push({ x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, step: 0, dur: 0.1, on: false, lift: 0 });

  // ---- helpers ------------------------------------------------------------------
  function world() { return Game.world; }
  function sceneIs(s) { return Game.state.scene === s; }
  function sfx(name, vol, x, y) { try { Game.emit('sfx', { name, x: x === undefined ? P.x : x, y: y === undefined ? P.y : y, vol: vol === undefined ? 1 : vol }); } catch (e) { /* ignore */ } }
  function stat(k, a) { try { Game.stat(k, a); } catch (e) { /* ignore */ } }
  function addParticle(type, x, y, vx, vy, life, size, color, g) {
    if (parts.length > 90) parts.shift();
    parts.push({ type, x, y, vx, vy, life, max: life, size, color, g: g || 0 });
  }
  function causeFor(src) {
    switch (src) {
      case 'starvation': return 'starved';
      case 'dehydration': return 'dehydrated';
      case 'exhaustion': return 'exhausted';
      case 'rain': case 'frost': case 'exposure': return 'exposure';
      case 'drowned': case 'fell': return src;
      case 'widow': return 'widow';   // the Widow Matriarch boss
      default: return 'eaten';
    }
  }

  // ---- upgrades & stage stats ------------------------------------------------------
  P.applyUpgrades = function (keepRatio) {
    const si = this.stageInfo, u = this.upgrades, sm = (this.species && this.species.mods) || {};   // sm: this species' stat multipliers
    const hpR = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const silkR = this.maxSilk > 0 ? this.silk / this.maxSilk : 1;
    this.speedMul = (1 + 0.08 * (u.speed || 0)) * (sm.speed || 1);
    this.silkMul = (1 + 0.25 * (u.silk || 0)) * (sm.silk || 1);
    this.stealthBase = clamp(1 - 0.2 * (u.camo || 0), 0.3, 1);
    this.stealth = this.stealthBase;   // simulate() applies the species' night bonus on top
    this.biteMul = (1 + 0.25 * (u.venom || 0)) * (sm.bite || 1);
    this.venomPower = sm.venom || 0;
    this.damageTaken = Math.pow(0.9, u.carapace || 0);
    this.senseRadius = 60 + 110 * (u.vibration || 0);
    this.drainMul = Math.pow(0.85, u.metabolism || 0);
    this.maxHp = si.maxHp * (1 + 0.2 * (u.carapace || 0)) * (sm.hp || 1);
    this.maxSilk = si.maxSilk * this.silkMul;
    if (keepRatio) { this.hp = clamp(hpR * this.maxHp, 0, this.maxHp); this.silk = clamp(silkR * this.maxSilk, 0, this.maxSilk); }
    this.growthNeeded = si.growthNeeded;
  };

  P.reset = function () {
    const T = Game.territory, tsp = (T && T.active && T.spawnPoint) ? T.spawnPoint() : null;   // Territory: hatch at the Home Site
    const sp = tsp || C.SPAWN;
    this.x = sp.x; this.y = sp.y; this.vx = 0; this.vy = 0; this.angle = -0.6; prevAng = this.angle;
    this.stage = 0; this.stageInfo = C.STAGES[0]; this.radius = C.STAGES[0].radius;
    this.species = Game.speciesInfo(Game.state.species); this.tangleT = 0; this.tangleMul = 1; bellyK = 0;
    this.upgrades = {}; C.UPGRADES.forEach(u => { this.upgrades[u.id] = 0; });
    const inh = (T && T.active && T.inherited) ? T.inherited() : null;   // Territory: traits the mother passed on (one level below hers)
    if (inh) C.UPGRADES.forEach(u => { if (inh[u.id] > 0) this.upgrades[u.id] = clamp(Math.floor(inh[u.id]), 0, u.max); });
    this.shaken = 0;
    this.maxHp = 0; this.maxSilk = 0; this.hp = 0; this.silk = 0;
    this.applyUpgrades(false);
    this.hp = this.maxHp; this.silk = this.maxSilk;
    this.hunger = 80; this.hydration = 80; this.energy = 100;
    this.growth = 0; this.growthNeeded = this.stageInfo.growthNeeded;
    this.hidden = false; this.resting = false; this.moltTimer = 0; this.molting = false; this.moltPhase = 'none';
    this.dead = false; this.deathCause = null; this.reviving = false; this.revives = 0; this.stateLabel = 'walking';
    this.mate = { found: false, courted: false, laid: false }; this.mateHint = null;
    this.interactHint = ''; this.inShelter = null; this.exhausted = false; this.sprinting = false; this.huddled = 0;
    this.invuln = SPAWN_INVULN; this.offers = []; this.soft = 0; this.eggSac = null;
    this.courting = false; this.laying = false; this.hatching = true; this.ending = false;
    anim = 0; bitePhase = 0; biteCd = 0; flash = 0; curl = 0; shiver = 0; spinT = 0; eatT = 0; drinkT = 0; drinkAcc = 0;
    hatchT = 0; moltT = 0; courtT = 0; layT = 0; deathT = 0; endT = 0; victoryFired = false; gaitPhase = 0; abAng = 0;
    sfxStepT = 0; trailT = 0; mateRetryT = 0; exhaustedFlag = false; dotBuf = 0; hurtSfxT = 0; chooseWait = 0;
    enterT = 0; exitCd = 0; restToggleCd = 0; noInputT = 0; statT = 0; swapped = false; courtMateRef = null; layTarget = null; bodyBob = 0;
    exuvia = null; trail.length = 0; parts.length = 0;
    reviveSib = null; reviveCause = null; reviveLanded = false; reviveGlow = 0;
    sac = { x: this.x, y: this.y, r: this.radius * 3.1, ang: this.angle, t: 0 };
    snapFeet();
    lastGood.x = this.x; lastGood.y = this.y;
    // keep the hatching spider out of rocks
    const w = world();
    if (has(w, 'resolve')) { try { const r = w.resolve(this.x, this.y, this.radius); if (r && isFinite(r.x) && isFinite(r.y)) { this.x = r.x; this.y = r.y; sac.x = r.x; sac.y = r.y; snapFeet(); } } catch (e) { /* ignore */ } }
    Game.camera.target = this; Game.camera.targetZoom = C.STAGES[0].zoom;
  };

  P.init = function () {
    Game.camera.target = this;
    Game.addDrawer(Game.LAYER.PLAYER, drawAll);
    Game.on('web:spun', () => { spinT = 0.55; });
    Game.on('mate:found', () => { if (P.mate) P.mate.found = true; });
    Game.on('kin:sacrifice', (d) => { if (P.reviving && d && d.creature === reviveSib) reviveLanded = true; });
  };

  // ---- silk ----------------------------------------------------------------------------
  P.useSilk = function (n) {
    n = num(n, 0); if (n <= 0) return true;
    if (this.dead || this.silk + 1e-6 < n) return false;
    this.silk = Math.max(0, this.silk - n); return true;
  };
  P.addSilk = function (n) { n = num(n, 0); this.silk = clamp(this.silk + n, 0, this.maxSilk); };
  // Stuck in sticky silk (the Widow Matriarch's spit and the patches it leaves): move at `mul` x normal speed for `t` seconds.
  // Calling it again extends the timer; the stronger (lower) slow wins while both last.
  P.slow = function (t, mul) {
    t = num(t, 0); mul = clamp(num(mul, 1), 0.2, 1);
    if (t <= 0 || this.dead) return;
    this.tangleMul = this.tangleT > 0 ? Math.min(this.tangleMul, mul) : mul;
    this.tangleT = Math.max(this.tangleT, t);
  };

  // ---- feeding, healing, damage -------------------------------------------------------------
  P.feed = function (hunger, growth, kind) {
    if (this.dead) return;
    hunger = num(hunger, 0); growth = num(growth, 0);
    this.hunger = clamp(this.hunger + hunger, 0, 100);
    eatT = 0.55;
    const a = this.angle;
    const fx = this.x + Math.cos(a) * this.radius * 1.1, fy = this.y + Math.sin(a) * this.radius * 1.1;
    for (let i = 0; i < 7; i++) addParticle('spark', fx, fy, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30 - 8, 0.6 + Math.random() * 0.4, 0.5 + Math.random() * 0.7, '#ffd98a', 0);
    stat('eaten');
    Game.emit('player:ate', { kind, value: hunger, x: this.x, y: this.y });
    sfx('eat', 1);
    if (growth > 0) this.addGrowth(growth);
  };
  P.drink = function (n) {
    n = num(n, 0); if (n <= 0 || this.dead) return;
    this.hydration = clamp(this.hydration + n, 0, 100);
    Game.emit('player:drank', { amount: n });
  };
  P.heal = function (n) { n = num(n, 0); if (n <= 0 || this.dead) return; this.hp = clamp(this.hp + n, 0, this.maxHp); };

  P.damage = function (amount, source) {
    amount = num(amount, 0);
    if (this.dead || this.reviving || amount <= 0 || this.invuln > 0) return 0;
    const soft = (this.molting || this.moltTimer > 0) ? 2 : 1;
    const actual = Math.min(this.hp, amount * this.damageTaken * soft);
    this.hp -= actual;
    flash = Math.min(1, Math.max(flash, 0.4 + actual / Math.max(1, this.maxHp) * 3));
    dotBuf += actual; dotSrc = source || 'damage';
    if (dotBuf >= 0.5) {
      Game.emit('player:damaged', { amount: dotBuf, source: dotSrc });
      stat('damageTaken', dotBuf); dotBuf = 0;
    }
    if (hurtSfxT <= 0 && actual > 0.3) { sfx('hurt', 1); hurtSfxT = 0.4; Game.camera.shake(Math.min(7, 1.5 + actual * 0.7)); }
    if (this.resting) setResting(false);
    if (this.hp <= 0.0001) die(causeFor(source));
    return actual;
  };

  // damage over time (starvation, rain ...): no flash spam, no i-frames respected for survival drains
  function dot(amount, source, dt) {
    if (P.dead || P.reviving || amount <= 0) return;
    if (P.invuln > 0) return;
    const soft = (P.molting || P.moltTimer > 0) ? 2 : 1;
    const a = Math.min(P.hp, amount * P.damageTaken * soft);
    P.hp -= a; dotBuf += a; dotSrc = source;
    flash = Math.max(flash, 0.12);
    if (dotBuf >= 1) { Game.emit('player:damaged', { amount: dotBuf, source }); stat('damageTaken', dotBuf); dotBuf = 0; if (hurtSfxT <= 0) { sfx('hurt', 0.6); hurtSfxT = 1.2; } }
    if (P.hp <= 0.0001) die(causeFor(source));
  }

  function die(cause) {
    if (P.dead || P.reviving) return;
    if (beginRevive(cause)) return;
    P.dead = true; P.deathCause = cause; P.hp = 0; deathT = 0;
    P.resting = false; P.courting = false; P.laying = false; P.stateLabel = 'dead';
    P.vx *= 0.3; P.vy *= 0.3;
    if (dotBuf > 0) { Game.emit('player:damaged', { amount: dotBuf, source: dotSrc }); dotBuf = 0; }
    Game.emit('player:died', { cause });
    sfx('death', 1); Game.camera.shake(9);
    stat('deaths');
    for (let i = 0; i < 12; i++) addParticle('spark', P.x, P.y, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50, 0.9, 0.8, '#b9a58a', 0);
  }

  // a sibling is still around: go down instead of dying; reviveUpdate() keeps the spider down until the sibling's gift lands
  function beginRevive(cause) {
    const cr = Game.creatures; if (!has(cr, 'claimSibling') || Game.state.mode === 'survival' || Game.state.mode === 'territory') return false;   // Survival: one life; Territory: succession instead (territory.js)
    let sib = null;
    try { sib = cr.claimSibling(P.x, P.y); } catch (e) { Game.reportError('player.revive', e); }
    if (!sib) return false;
    P.reviving = true; reviveSib = sib; reviveCause = cause; reviveLanded = false; deathT = 0;
    P.hp = 0; P.invuln = REVIVE_MAX + REVIVE_INVULN;   // nothing can touch a downed spider
    P.courting = false; P.laying = false; P.stateLabel = 'downed';
    setResting(false); P.vx *= 0.3; P.vy *= 0.3;
    if (dotBuf > 0) { Game.emit('player:damaged', { amount: dotBuf, source: dotSrc }); dotBuf = 0; }
    Game.emit('player:downed', { cause, left: num(cr.siblings, 0) });
    sfx('hurt', 1); Game.camera.shake(6);
    for (let i = 0; i < 8; i++) addParticle('spark', P.x, P.y, (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 36, 0.8, 0.7, '#b9a58a', 0);
    return true;
  }
  function reviveUpdate(dt) {
    deathT += dt;
    P.vx *= Math.exp(-6 * dt); P.vy *= Math.exp(-6 * dt);
    moveBy(P.vx * dt, P.vy * dt);
    curl = Math.min(1.15, curl + dt * 1.1);
    if (reviveLanded || deathT > REVIVE_MAX) finishRevive();
  }
  function finishRevive() {
    const cr = Game.creatures, cause = reviveCause;
    P.reviving = false; reviveSib = null; reviveLanded = false;
    P.hp = Math.max(1, P.maxHp * REVIVE_HP);
    // top the meters up too, or a spider downed by hunger, thirst or exhaustion would drop straight back down
    P.hunger = Math.max(P.hunger, REVIVE_METER); P.hydration = Math.max(P.hydration, REVIVE_METER); P.energy = Math.max(P.energy, REVIVE_METER);
    exhaustedFlag = false; exhaustT = 0; P.exhausted = false;
    P.invuln = REVIVE_INVULN; P.stateLabel = 'walking';
    reviveGlow = 1; flash = 0; P.revives++; stat('revives');
    if (P.stage < 4 && P.growth >= P.growthNeeded && !P.molting) startMolt();
    Game.emit('player:revived', { cause, left: has(cr, 'claimSibling') ? num(cr.siblings, 0) : 0, total: P.revives });
    sfx('revive', 1); Game.camera.shake(3);
    for (let i = 0; i < 18; i++) addParticle('spark', P.x + (Math.random() - 0.5) * P.radius * 2, P.y + (Math.random() - 0.5) * P.radius * 2, (Math.random() - 0.5) * 30, -10 - Math.random() * 22, 1.0 + Math.random() * 0.8, 0.6 + Math.random() * 0.8, '#ffe6a0', 0);
  }

  function setResting(on) {
    if (P.resting === on) return;
    P.resting = on; Game.emit('player:rest', { on }); if (on) sfx('rest', 0.7);
  }

  // ---- growth ---------------------------------------------------------------------------------
  P.addGrowth = function (n) {
    n = num(n, 0); if (n <= 0 || this.dead) return;
    this.growth += n;
    Game.emit('growth:gain', { amount: n, total: this.growth, needed: this.growthNeeded });
    if (this.stage < 4 && this.growth >= this.growthNeeded && !this.molting) startMolt();
    else if (this.stage >= 4) this.growth = Math.min(this.growth, 999);
  };

  // ---- molting ----------------------------------------------------------------------------------
  P.offerUpgrades = function () {
    const ids = [];
    C.UPGRADES.forEach(u => { if ((this.upgrades[u.id] || 0) < u.max) ids.push(u.id); });
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    return ids.slice(0, 3);
  };

  function startMolt() {
    if (P.molting || P.dead || P.reviving || P.stage >= 4) return;   // (a molt that came due while downed starts once the spider is up: finishRevive)
    P.molting = true; P.moltPhase = 'choose'; P.offers = P.offerUpgrades(); chooseWait = 0;
    pendingStage = P.stage + 1; swapped = false; moltT = 0;
    setResting(false); P.inShelter = null; P.vx = P.vy = 0; P.stateLabel = 'molting';
    P.invuln = Math.max(P.invuln, 0.2);
    Game.setScene('molting');
    // `stage` is the stage being molted INTO (ui shows its lore); `from` is the current one.
    Game.emit('molt:start', { stage: pendingStage, from: P.stage, offers: P.offers.slice() });
    sfx('molt_start', 1);
  }

  P.chooseUpgrade = function (id) {
    if (this.moltPhase !== 'choose') return false;
    const def = C.UPGRADES.find(u => u.id === id);
    if (!def) return false;
    const lvl = this.upgrades[id] || 0;
    if (lvl >= def.max) return false;
    this.upgrades[id] = lvl + 1;
    this.applyUpgrades(true);
    Game.emit('molt:choose', { id, level: lvl + 1 });
    this.moltPhase = 'anim'; moltT = 0; swapped = false;
    this.invuln = Math.max(this.invuln, MOLT_INVULN);
    Game.setScene('playing');
    return true;
  };

  function doSwap() {
    swapped = true;
    const prev = P.stage;
    exuvia = { x: P.x, y: P.y, ang: P.angle, r: P.radius, stage: prev, species: P.species.id, legK: P.species.leg || 1, t: 0, camo: P.upgrades.camo || 0, feet: feet.map(f => ({ x: f.x, y: f.y, lift: 0 })), abAng: abAng };
    const left = Math.max(0, P.growth - P.growthNeeded);
    P.stage = pendingStage; P.stageInfo = C.STAGES[P.stage];
    P.applyUpgrades(true);
    P.growth = P.stage >= 4 ? 0 : Math.min(left, P.growthNeeded * 0.5);
    P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.35);
    P.silk = Math.min(P.maxSilk, P.silk + P.maxSilk * 0.5);
    P.energy = Math.max(P.energy, 60);
    P.hunger = Math.max(15, P.hunger - 6);
    Game.camera.targetZoom = P.stageInfo.zoom;
    stat('moltCount');
    Game.emit('stage:change', { stage: P.stage, prev });
    sfx('levelup', 1);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, s = 12 + Math.random() * 40;
      addParticle('shard', P.x, P.y, Math.cos(a) * s, Math.sin(a) * s, 1.2 + Math.random() * 0.8, 0.5 + Math.random() * 0.9, '#f2e4c4', 0);
    }
    if (P.stage === 4) trySpawnMate();
  }

  function trySpawnMate() {
    const cr = Game.creatures;
    if (!has(cr, 'spawnMate')) return;
    if (cr.mate) return;
    const T = Game.territory; if (T && T.active && T.mateAllowed && !T.mateAllowed()) return;   // Territory: the mating season has not opened yet
    try { cr.spawnMate(); } catch (e) { Game.reportError('player.spawnMate', e); }
  }

  function moltUpdate(dt) {
    moltT += dt;
    const u = clamp(moltT / MOLT_T, 0, 1);
    shiver = u < 0.5 ? 0.35 + u * 1.3 : Math.max(0.1, 0.9 - (u - 0.5) * 2);
    if (u >= 0.5 && !swapped) doSwap();
    if (swapped && u < 0.8) {   // new body slides forward out of the old skin
      const step = (P.radius * 2.0) / (0.3 * MOLT_T) * dt;
      moveBy(Math.cos(P.angle) * step, Math.sin(P.angle) * step);
    }
    if (Math.random() < dt * 14 && u > 0.2 && u < 0.85) {
      const a = Math.random() * TAU;
      addParticle('shard', P.x + Math.cos(a) * P.radius * 0.7, P.y + Math.sin(a) * P.radius * 0.7, Math.cos(a) * 8, Math.sin(a) * 8, 0.8, 0.4, '#fff3d8', 0);
    }
    if (u >= 1) {
      P.molting = false; P.moltPhase = 'none'; P.moltTimer = MOLT_SOFT; shiver = 0;
      P.invuln = Math.max(P.invuln, 0.4);
      Game.emit('molt:end', { stage: P.stage });
      sfx('molt_end', 1);
    }
  }

  // scene === 'molting': waiting for the choice screen
  function chooseUpdate(dt) {
    chooseWait += dt;
    shiver = 0.3 + 0.08 * Math.sin(anim * 9);
    tickGait(dt, 0);
    if (P.moltPhase === 'choose') {
      if ((!Game.ui && chooseWait > 0.4) || chooseWait > 180) P.chooseUpgrade(P.offers[0] || (P.offerUpgrades()[0]));
    } else if (P.moltPhase === 'none') {   // safety: stuck in molting scene without a molt
      Game.setScene('playing');
    }
  }

  // ---- courtship & egg laying (adult ending) ----------------------------------------------------------
  function startCourt(m) {
    P.courting = true; courtT = 0; courtMateRef = m; setResting(false); P.inShelter = null;
    P.vx = P.vy = 0; P.stateLabel = 'courting'; sfx('courtship', 1);
  }
  function courtUpdate(dt) {
    const m = courtMateRef;
    if (!m || m.hp <= 0 && m.state === 'dead') { P.courting = false; return; }
    courtT += dt;
    const d = Math.hypot(m.x - P.x, m.y - P.y), want = P.radius + (m.radius || 10) + 12;
    P.angle = U.turnToward(P.angle, Math.atan2(m.y - P.y, m.x - P.x), 6 * dt);
    if (d > want + 3) { const s = Math.min(70 * dt, d - want); moveBy((m.x - P.x) / d * s, (m.y - P.y) / d * s); }
    m.courting = true;
    if (Math.random() < dt * 9) {
      const t = Math.random();
      addParticle('heart', lerp(P.x, m.x, t), lerp(P.y, m.y, t) - 2, (Math.random() - 0.5) * 8, -14 - Math.random() * 10, 1.3, 1 + Math.random() * 0.8, Math.random() < 0.5 ? '#ffb7c9' : '#ffd98a', 0);
    }
    if (courtT >= COURT_T) {
      P.courting = false; P.mate.courted = true; m.courting = false; m.courted = true;
      P.hunger = Math.max(0, P.hunger - 8);
      stat('courted'); Game.emit('courtship:done'); sfx('courtship', 1);
      for (let i = 0; i < 14; i++) addParticle('heart', (P.x + m.x) / 2, (P.y + m.y) / 2, (Math.random() - 0.5) * 40, -10 - Math.random() * 28, 1.6, 1 + Math.random(), '#ffc4d4', 0);
    }
  }

  function findEggSite() {
    const w = world(); if (!w || !w.shelters) return null;
    let best = null, bd = 1e9, anyBest = null, ad = 1e9;
    for (let i = 0; i < w.shelters.length; i++) {
      const s = w.shelters[i], d = Math.hypot(s.x - P.x, s.y - P.y) - s.r;
      if (s.eggSite && d < bd) { bd = d; best = s; }
      if (d < ad) { ad = d; anyBest = s; }
    }
    // if the world defines no egg sites at all, any shelter will do
    let haveEgg = false; for (let i = 0; i < w.shelters.length; i++) if (w.shelters[i].eggSite) { haveEgg = true; break; }
    return haveEgg ? best : anyBest;
  }
  function startLay(site) {
    P.laying = true; layT = 0; layTarget = site; P.mate.laid = true; P.vx = P.vy = 0; P.stateLabel = 'courting';
    setResting(false); P.inShelter = null; sfx('egg', 1);
    P.eggSac = { x: P.x - Math.cos(P.angle) * P.radius * 3.4, y: P.y - Math.sin(P.angle) * P.radius * 3.4, t: 0, r: P.radius * 1.5 };
  }
  function layUpdate(dt) {
    layT += dt;
    if (layTarget) {   // settle at the nest site
      const d = Math.hypot(layTarget.x - P.x, layTarget.y - P.y);
      if (d > layTarget.r * 0.25) { const s = Math.min(50 * dt, d); moveBy((layTarget.x - P.x) / d * s, (layTarget.y - P.y) / d * s); }
      P.eggSac.x = P.x - Math.cos(P.angle) * P.radius * 3.4; P.eggSac.y = P.y - Math.sin(P.angle) * P.radius * 3.4;
    }
    P.eggSac.t = clamp(layT / LAY_T, 0, 1);
    if (Math.random() < dt * 10) addParticle('spark', P.eggSac.x + (Math.random() - 0.5) * P.radius, P.eggSac.y + (Math.random() - 0.5) * P.radius, (Math.random() - 0.5) * 12, -8 - Math.random() * 10, 1.1, 0.7, '#fff7e0', 0);
    if (layT >= LAY_T + 0.9 && !victoryFired) {
      victoryFired = true; P.laying = false; P.ending = true;
      const T = Game.territory; let handled = false;
      if (T && T.active && T.onLaid) {   // Territory: the egg sac starts the next generation (Legacy scene) instead of ending the game
        try { handled = !!T.onLaid(layTarget); } catch (e) { Game.reportError('player.onLaid', e); }
        if (handled) { stat('laid'); sfx('victory', 1); }
      }
      if (!handled) {
        Game.state.victory = true; stat('victory');
        Game.emit('game:victory'); sfx('victory', 1);
        Game.setScene('victory');
      }
    }
  }

  // ---- death ------------------------------------------------------------------------------------------------
  function deathUpdate(dt) {
    deathT += dt;
    P.vx *= Math.exp(-6 * dt); P.vy *= Math.exp(-6 * dt);
    moveBy(P.vx * dt, P.vy * dt);
    curl = Math.min(1.15, curl + dt * 1.1);
    tickGait(dt, 0);
    if (deathT >= DEATH_T && sceneIs('playing')) Game.setScene(deathScene());
  }

  // the screen that follows a death: Game Over, or in Territory the Succession card (an heir takes over) / Lineage Ended (no heirs left)
  function deathScene() {
    const T = Game.territory;
    if (T && T.active && T.deathScene) { try { return T.deathScene(P.deathCause) || 'gameover'; } catch (e) { Game.reportError('player.deathScene', e); } }
    return 'gameover';
  }
  // Territory succession: a new body (an heir) takes over at `pt` {x,y}. Same stage, same molt upgrades; the Setback (territory.js passes the numbers):
  // part of the progress to the next molt is lost, meters restart, silk is empty, and the spider is shaken for a while.
  P.respawnHeir = function (pt, o) {
    o = o || {};
    const w = world();
    this.dead = false; this.deathCause = null; this.reviving = false; deathT = 0; curl = 0; flash = 0; dotBuf = 0; exhaustedFlag = false; exhaustT = 0; this.exhausted = false;
    let x = pt && isFinite(pt.x) ? pt.x : this.x, y = pt && isFinite(pt.y) ? pt.y : this.y;
    if (has(w, 'resolve')) { try { const r = w.resolve(x, y, this.radius); if (r && isFinite(r.x) && isFinite(r.y)) { x = r.x; y = r.y; } } catch (e) { /* ignore */ } }
    this.x = x; this.y = y; this.vx = this.vy = 0; lastGood.x = x; lastGood.y = y;
    this.hp = this.maxHp;
    const m = num(o.meter, 50); this.hunger = this.hydration = this.energy = m; this.silk = num(o.silk, 0);
    if (this.stage < 4) this.growth *= (1 - num(o.growthLoss, 0.5));
    this.shaken = num(o.shaken, 0); this.invuln = num(o.invuln, 4);
    this.resting = false; this.inShelter = null; this.courting = false; this.laying = false; this.stateLabel = 'walking'; this.sprinting = false; this.tangleT = 0; this.tangleMul = 1;
    exuvia = null; trail.length = 0; parts.length = 0; snapFeet(); reviveGlow = 1;
    Game.camera.targetZoom = this.stageInfo.zoom; Game.camera.snap();
    for (let i = 0; i < 16; i++) addParticle('spark', x + (Math.random() - 0.5) * this.radius * 2, y + (Math.random() - 0.5) * this.radius * 2, (Math.random() - 0.5) * 26, -8 - Math.random() * 20, 1.0 + Math.random() * 0.8, 0.6 + Math.random() * 0.8, '#ffe6a0', 0);
    Game.emit('player:respawned', { x, y });
    return this;
  };

  // ---- movement ------------------------------------------------------------------------------------------------
  function moveBy(dx, dy) {
    const w = world();
    let nx = P.x + dx, ny = P.y + dy;
    if (has(w, 'resolve')) {
      let r = null;
      try { r = w.resolve(nx, ny, P.radius * 0.85); } catch (e) { r = null; }
      if (r && isFinite(r.x) && isFinite(r.y)) {
        const px = r.x - nx, py = r.y - ny, pl = Math.hypot(px, py);
        if (pl > 1e-4) {
          const nxn = px / pl, nyn = py / pl, vn = P.vx * nxn + P.vy * nyn;
          if (vn < 0) { P.vx -= vn * nxn; P.vy -= vn * nyn; }
        }
        nx = r.x; ny = r.y;
      }
    } else {
      nx = clamp(nx, P.radius, C.WORLD_W - P.radius); ny = clamp(ny, P.radius, C.WORLD_H - P.radius);
    }
    P.x = nx; P.y = ny;
  }

  function updateRadius(dt) {
    const si = P.stageInfo;
    if (P.molting && !swapped) {
      const u = clamp(moltT / MOLT_T, 0, 1);
      P.radius = si.radius * (1 + 0.1 * smooth(Math.min(1, u / 0.45)));
    } else if (P.hatching) {
      P.radius = si.radius;
    } else {
      P.radius += (si.radius - P.radius) * (1 - Math.exp(-1.8 * dt));
    }
  }

  function steer(dt, ax, ay, sprint, aim) {
    const si = P.stageInfo, w = Game.webs;
    let spd = si.speed * P.speedMul, mod = 1;
    if (P.molting || P.moltTimer > 0) mod *= 0.5;
    if (exhaustedFlag) mod *= 0.62;
    if (P.tangleT > 0) mod *= P.tangleMul;
    if (P.shaken > 0) mod *= SHAKEN_MUL;
    if (P.hunger < 12) mod *= 0.9;
    if (has(w, 'speedBonusAt')) { try { mod *= clamp(num(w.speedBonusAt(P.x, P.y), 1), 1, 2.5); } catch (e) { /* ignore */ } }
    if (sprint) mod *= SPRINT_MUL;
    const top = spd * mod, tx = ax * top, ty = ay * top;
    const hasIn = ax !== 0 || ay !== 0;
    const acc = (hasIn ? 5.8 : 9.0) * Math.max(top, si.speed * 0.6);
    const dvx = tx - P.vx, dvy = ty - P.vy, d = Math.hypot(dvx, dvy), step = acc * dt;
    if (d <= step) { P.vx = tx; P.vy = ty; } else { P.vx += dvx / d * step; P.vy += dvy / d * step; }
    const sp = Math.hypot(P.vx, P.vy);
    if (aim != null) {
      // mouse-aim: always face the cursor, regardless of travel direction
      P.angle = U.turnToward(P.angle, aim, (16 - P.stage * 1.2) * dt);
      moveBy(P.vx * dt, P.vy * dt);
      return sp;
    }
    let ta = P.angle;
    if (sp > 14) ta = Math.atan2(P.vy, P.vx); else if (hasIn) ta = Math.atan2(ay, ax); else ta = P.angle;
    if (sp > 14 || hasIn) P.angle = U.turnToward(P.angle, ta, (12 - P.stage * 1.1) * dt);
    moveBy(P.vx * dt, P.vy * dt);
    return sp;
  }

  // ---- biting ----------------------------------------------------------------------------------------------------------
  P.bite = function () {
    if (this.dead || this.reviving || this.molting || this.courting || this.laying || this.hatching || biteCd > 0) return false;
    const cr = Game.creatures, si = this.stageInfo;
    biteCd = Math.max(0.34, 0.58 - 0.05 * this.stage);
    bitePhase = 1;
    const reach = this.radius * 1.7 + 8;
    let cx = this.x + Math.cos(this.angle) * this.radius * 1.1, cy = this.y + Math.sin(this.angle) * this.radius * 1.1;
    let dmg = si.bite * this.biteMul, target = null, hitR = this.radius * 0.9 + 5;
    if (has(cr, 'nearest')) {
      try {
        target = cr.nearest(this.x, this.y, c => c && c.state !== 'dead' && c.hp > 0 && Math.hypot(c.x - P.x, c.y - P.y) - (c.radius || 3) <= reach, reach + 14);
      } catch (e) { target = null; }
    }
    if (target) {
      cx = target.x; cy = target.y; hitR = (target.radius || 3) + 3;
      this.angle = U.turnToward(this.angle, Math.atan2(target.y - this.y, target.x - this.x), 1.2);
      if (target.state === 'stuck') dmg *= 1.8;   // trapped prey is easy to subdue
    }
    let res = null;
    if (has(cr, 'attackAt')) { try { res = cr.attackAt(cx, cy, hitR, dmg, 'player'); } catch (e) { Game.reportError('player.bite', e); } }
    const hit = res && res.hit && res.hit.length;
    stat('bites');
    sfx('bite', hit ? 1 : 0.5);
    if (hit) { Game.camera.shake(1.2); for (let i = 0; i < 4; i++) addParticle('spark', cx, cy, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.4, 0.6, '#ffe6b0', 0); }
    return true;
  };

  // ---- interaction --------------------------------------------------------------------------------------------------------
  function nearestShelter() {
    const w = world(); if (!w || !w.shelters) return null;
    let best = null, bd = 1e9; const lim = P.radius * 2.2;
    for (let i = 0; i < w.shelters.length; i++) {
      const s = w.shelters[i], d = Math.hypot(s.x - P.x, s.y - P.y) - s.r;
      if (d < lim && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  function interact(dt) {
    const I = Game.input, w = world(), cr = Game.creatures;
    P.interactHint = '';
    const pressed = I.pressed('interact'), held = I.down('interact');
    // --- ending: mate and egg sac
    if (P.stage >= 4 && !P.mate.laid) {
      const m = cr && cr.mate;
      if (m && !P.mate.courted) {
        const d = Math.hypot(m.x - P.x, m.y - P.y);
        if (d < P.radius + (m.radius || 10) + 44) {
          P.mate.found = true;
          if (P.hunger > 35) { P.interactHint = 'E - Court the mate'; if (pressed) { startCourt(m); return; } }
          else P.interactHint = 'Too hungry to court - eat first';
          return;
        }
      } else if (P.mate.courted) {
        const site = findEggSite();
        if (site && Math.hypot(site.x - P.x, site.y - P.y) < site.r + P.radius * 1.2) {
          P.interactHint = 'E - Lay your egg sac'; if (pressed) { startLay(site); return; }
        }
      }
    }
    // --- drinking / sipping
    if (has(w, 'nearestResource')) {
      let res = null, kind = '';
      try {
        res = w.nearestResource(P.x, P.y, 'dew', P.radius + 18); kind = 'dew';
        if (!res || res.amount <= 0.05) { res = w.nearestResource(P.x, P.y, 'nectar', P.radius + 18); kind = 'nectar'; }
      } catch (e) { res = null; }
      if (res && res.amount > 0.05) {
        const full = kind === 'dew' ? P.hydration >= 99.5 : P.hunger >= 99.5;
        P.interactHint = full ? (kind === 'dew' ? 'Fully hydrated' : 'Not hungry') : (kind === 'dew' ? 'Hold E - Drink dew' : 'Hold E - Sip nectar');
        if (held && !full && P.speedNow() < 40) {
          const want = (kind === 'dew' ? 16 : 10) * dt;
          let took = want;
          if (has(w, 'consumeResource')) { try { took = num(w.consumeResource(res, want), 0); } catch (e) { took = 0; } }
          if (took > 0) {
            if (kind === 'dew') { P.hydration = clamp(P.hydration + took * 1.6, 0, 100); }
            else { P.hunger = clamp(P.hunger + took * 0.8, 0, 100); }
            drinkT = 0.25; drinkAcc += took * (kind === 'dew' ? 1.6 : 0.8);
            if (P.resting) setResting(false);
            if (Math.random() < dt * 14) addParticle('drop', res.x + (Math.random() - 0.5) * (res.r || 3), res.y + (Math.random() - 0.5) * (res.r || 3), (Math.random() - 0.5) * 6, -6 - Math.random() * 6, 0.5, 0.5, kind === 'dew' ? '#bfe8ff' : '#ffe08a', 0);
            P._drinkSfx = (P._drinkSfx || 0) - dt;
            if (P._drinkSfx <= 0) { sfx('drink', 0.8); P._drinkSfx = 0.32; }
            if (drinkAcc >= 4) { if (kind === 'dew') Game.emit('player:drank', { amount: drinkAcc }); stat('drinks'); drinkAcc = 0; }
          }
        }
        if (held) return;
      }
    }
    // --- Territory: heirloom webs, wrapping prey for the pantry, recycling silk
    const ter = Game.territory;
    if (ter && ter.active && ter.interact) {
      let used = false;
      try { used = ter.interact(pressed, held, dt); } catch (e) { Game.reportError('player.territory', e); }
      if (used) return;
    }
    // --- shelters
    const sh = nearestShelter();
    if (P.inShelter) {
      P.interactHint = 'E - Leave shelter';
      if (pressed) { P.inShelter = null; exitCd = 0.5; }
    } else if (sh && exitCd <= 0) {
      P.interactHint = P.interactHint || 'E - Enter shelter';
      if (pressed) { P.inShelter = sh; enterT = 0; sfx('rest', 0.5); }
    }
  }
  P.speedNow = function () { return Math.hypot(this.vx, this.vy); };

  // ---- meters ---------------------------------------------------------------------------------------------------------------
  let exhaustT = 0;
  function meters(dt, moving, sprinting) {
    if (dt <= 0) return;
    const si = P.stageInfo, w = world();
    const sheltered = P.shelteredNow;
    const cr = Game.creatures, huddled = (P.resting && cr) ? num(cr.huddle, 0) : 0;
    P.huddled = huddled;
    const k = P.drainMul * (P.resting ? 0.5 * (1 - HUDDLE_DRAIN * huddled) : sprinting ? 1.8 : moving ? 1.15 : 1);
    const ter = Game.territory, tm = (ter && ter.active && ter.metab) ? ter.metab : null;   // Territory: the season changes how fast you get hungry and thirsty
    P.hunger = clamp(P.hunger - si.hungerRate * k * (tm ? tm.hunger : 1) * dt, 0, 100);
    P.hydration = clamp(P.hydration - si.thirstRate * k * (tm ? tm.thirst : 1) * dt, 0, 100);
    // energy
    if (sprinting) P.energy -= SPRINT_DRAIN * dt;
    else if (P.hunger <= 0) P.energy -= si.energyRate * 2 * dt;       // starving: no recovery
    else if (P.resting) P.energy += REST_REGEN * (sheltered ? 3 : 1) * (1 + HUDDLE_ENERGY * huddled) * dt;
    else P.energy += ((moving ? 1.0 : 3.0) - si.energyRate) * dt;
    P.energy = clamp(P.energy, 0, 100);
    if (P.energy <= 0) exhaustedFlag = true; else if (P.energy >= 25) exhaustedFlag = false;
    P.exhausted = exhaustedFlag;
    if (P.energy <= 0) exhaustT += dt; else exhaustT = Math.max(0, exhaustT - dt * 2);
    // consequences
    if (P.hunger <= 0) dot(P.maxHp * 0.03 * dt, 'starvation', dt);
    if (P.hydration <= 0) dot(P.maxHp * 0.035 * dt, 'dehydration', dt);
    if (exhaustT > 12) dot(P.maxHp * 0.02 * dt, 'exhaustion', dt);
    // rain on small, exposed spiders
    if (w && w.weather && (w.weather.type === 'rain' || w.weather.type === 'drizzle') && P.stage <= 2 && !P.inShelter && !sheltered && has(w, 'exposure')) {
      let e = 0; try { e = num(w.exposure(P.x, P.y), 0); } catch (er) { e = 0; }
      const kk = P.stage === 0 ? 0.022 : P.stage === 1 ? 0.016 : 0.006;
      if (e > 0.25) dot(P.maxHp * kk * num(w.weather.intensity, 0.5) * e * dt, 'rain', dt);
    }
    // a cold snap hurts small spiders left in the open, much like rain does
    if (w && w.weather && w.weather.type === 'frost' && P.stage <= 3 && !P.inShelter && !sheltered && has(w, 'exposure')) {
      let e = 0; try { e = num(w.exposure(P.x, P.y), 0); } catch (er) { e = 0; }
      const kk = P.stage === 0 ? 0.03 : P.stage === 1 ? 0.022 : P.stage === 2 ? 0.014 : 0.007;
      if (e > 0.25) dot(P.maxHp * kk * num(w.weather.intensity, 0.5) * e * dt, 'frost', dt);
    }
    // healing: resting while fed/watered (x3 in shelter), faint passive recovery when thriving
    if (P.hp < P.maxHp) {
      const wm = (ter && ter.active && ter.healMul) ? ter.healMul() : 1;   // Territory winter: a silk retreat heals faster
      if (P.resting && P.hunger > 40 && P.hydration > 40) P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.025 * (sheltered ? 3 : 1) * wm * (1 + HUDDLE_HEAL * huddled) * dt);
      else if (P.hunger > 60 && P.hydration > 60) P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.002 * dt);
    }
    // silk
    const sr = si.silkRegen * P.silkMul * (P.hunger < 20 ? 0.4 : 1) * (P.resting ? 1.4 : 1);
    P.silk = Math.min(P.maxSilk, P.silk + sr * dt);
  }

  function computeHidden(sp) {
    const w = world(), wb = Game.webs;
    let cover = !!P.inShelter;
    if (!cover && has(w, 'shelterAt')) { try { cover = !!w.shelterAt(P.x, P.y); } catch (e) { cover = false; } }
    if (!cover && has(wb, 'isSheltered')) { try { cover = !!wb.isSheltered(P.x, P.y); } catch (e) { cover = false; } }
    P.shelteredNow = cover;
    let h = cover;
    if (!h && sp < 10 && has(w, 'exposure')) { try { h = num(w.exposure(P.x, P.y), 1) < 0.35; } catch (e) { h = false; } }
    P.hidden = h;
  }

  // ---- hatch-in ---------------------------------------------------------------------------------------------------------------
  function hatchUpdate(dt) {
    hatchT += dt;
    if (sac) sac.t = hatchT;
    const u = hatchT / HATCH_T;
    let ax = 0, ay = 0;
    if (u > 0.5) { const f = clamp((u - 0.5) / 0.5, 0, 1) * 0.35; ax = Math.cos(P.angle) * f; ay = Math.sin(P.angle) * f; }
    steer(dt, ax, ay, false);
    if (hatchT >= HATCH_T) { P.hatching = false; if (sac) sac.doneAt = Game.time.t; }
    return Math.hypot(P.vx, P.vy);
  }

  // ---- main simulation ------------------------------------------------------------------------------------------------------------
  function simulate(dt) {
    const I = Game.input;
    P.invuln = Math.max(0, P.invuln - dt);
    biteCd = Math.max(0, biteCd - dt); hurtSfxT -= dt; exitCd -= dt;
    if (P.tangleT > 0) { P.tangleT = Math.max(0, P.tangleT - dt); if (P.tangleT <= 0) P.tangleMul = 1; }
    bellyK += (((spinT > 0 || P.resting) ? 1 : 0) - bellyK) * (1 - Math.exp(-5 * dt));
    if (P.moltTimer > 0) P.moltTimer = Math.max(0, P.moltTimer - dt);
    if (P.shaken > 0) P.shaken = Math.max(0, P.shaken - dt);
    P.soft = P.molting ? 1 : (P.moltTimer > 0 ? 0.85 * P.moltTimer / MOLT_SOFT : 0);
    if (!P.molting) shiver *= Math.exp(-6 * dt);
    let sp = 0, mScale = 1, moving = false, sprint = false;

    if (P.dead) {
      deathUpdate(dt); sp = 0; mScale = 0; P.sprinting = false;
    } else if (P.reviving) {
      reviveUpdate(dt); sp = 0; mScale = 0; P.sprinting = false;
    } else if (P.hatching) {
      sp = hatchUpdate(dt); mScale = 0; P.stateLabel = 'walking';
    } else if (P.molting) {
      moltUpdate(dt); mScale = 0.4; P.vx = P.vy = 0; P.stateLabel = 'molting'; P.sprinting = false;
    } else if (P.courting) {
      courtUpdate(dt); P.vx = P.vy = 0; P.stateLabel = 'courting';
    } else if (P.laying) {
      layUpdate(dt); P.vx = P.vy = 0; P.stateLabel = 'courting';
    } else {
      // ---- normal control
      const a = I.axis(); let ax = a.x, ay = a.y, aim = null;
      if (Game.settings.mouseAim && I.mouse) {
        // FPS-style: W/S move toward/away from the cursor, A/D strafe
        const m = I.mouse, dx = m.wx - P.x, dy = m.wy - P.y;
        if (dx * dx + dy * dy > P.radius * P.radius * 0.36) aim = Math.atan2(dy, dx);
        const fa = aim != null ? aim : P.angle, fx = Math.cos(fa), fy = Math.sin(fa);
        const fwd = -ay, side = ax;
        ax = fx * fwd - fy * side; ay = fy * fwd + fx * side;
        if (aim == null) aim = P.angle;
      }
      moving = ax !== 0 || ay !== 0;
      if (I.pressed('rest') && restToggleCd <= 0) { if (P.resting) setResting(false); else if (Math.hypot(P.vx, P.vy) < 70) setResting(true); }
      if (P.resting && moving) setResting(false);
      if (P.inShelter) {
        enterT += dt;
        if (moving && enterT > 0.45) { P.inShelter = null; exitCd = 0.5; }
        else {
          ax = ay = 0; moving = false;
          const s = P.inShelter, d = Math.hypot(s.x - P.x, s.y - P.y);
          if (d > Math.max(2, s.r * 0.3)) { const k = Math.min(1, 4 * dt); moveBy((s.x - P.x) * k, (s.y - P.y) * k); }
        }
      }
      if (P.resting) { ax = ay = 0; moving = false; }
      sprint = moving && I.down('sprint') && P.energy > 0 && !exhaustedFlag && P.hunger > 0;
      P.sprinting = sprint;
      sp = steer(dt, ax, ay, sprint, aim);
      if (I.down('bite')) P.bite();
      interact(dt);
      P.stateLabel = spinT > 0 ? 'spinning' : P.resting ? 'resting' : sprint ? 'sprinting' : 'walking';
    }

    updateRadius(dt);
    computeHidden(sp);
    { // a species may hide better after dusk (the Black Widow is a night hunter)
      const w = world(), nb = P.species && P.species.mods && P.species.mods.nightStealth;
      P.stealth = (nb && has(w, 'isNight') && w.isNight()) ? clamp(P.stealthBase * nb, 0.2, 1) : P.stealthBase;
    }
    meters(dt * mScale, sp > 8, sprint);
    // visual state
    const curlT = (P.resting && sp < 6) ? 1 : 0;
    if (!P.dead && !P.reviving) curl += (curlT - curl) * (1 - Math.exp(-5 * dt));
    tickGait(dt, P.dead || P.reviving ? 0 : sp);
    tickTrail(dt, sp);
    if (sp > 90 && P.sprinting && Math.random() < dt * 22) addParticle('dust', P.x - Math.cos(P.angle) * P.radius * 1.4 + (Math.random() - 0.5) * P.radius, P.y - Math.sin(P.angle) * P.radius * 1.4 + (Math.random() - 0.5) * P.radius, -P.vx * 0.12, -P.vy * 0.12, 0.5, 0.8 + Math.random() * 0.8, '#d8c7a4', 0);
    if (P.stage >= 4) { hintT -= dt; if (hintT <= 0) { hintT = 0.15; updateMateHint(); } } else P.mateHint = null;
    // stats
    statT += dt; if (statT >= 1) { statT = 0; const w = world(); if (w && typeof w.dayCount === 'number') Game.state.stats.daysSurvived = w.dayCount; }
    if (sp > 1) Game.state.stats.distance = (Game.state.stats.distance || 0) + sp * dt;
    sanitize();
  }
  let hintT = 0;

  function updateMateHint() {
    if (P.stage < 4 || P.mate.laid) { P.mateHint = null; return; }
    const cr = Game.creatures;
    if (!(cr && cr.mate)) { mateRetryT -= 0.15; if (mateRetryT <= 0) { trySpawnMate(); mateRetryT = 3; } }
    let tx, ty, kind;
    if (!P.mate.courted) {
      const m = cr && cr.mate; if (!m) { P.mateHint = null; return; }
      tx = m.x; ty = m.y; kind = 'mate';
      if (Math.hypot(tx - P.x, ty - P.y) < 420) P.mate.found = true;
    } else {
      const s = findEggSite(); if (!s) { P.mateHint = null; return; }
      tx = s.x; ty = s.y; kind = 'eggsite';
    }
    const dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy) || 1;
    const h = P.mateHint || (P.mateHint = {});
    h.x = h.dx = dx / d; h.y = h.dy = dy / d; h.dist = d; h.tx = tx; h.ty = ty; h.kind = kind; h.angle = Math.atan2(dy, dx);
  }

  function sanitize() {
    const bad = !isFinite(P.x) || !isFinite(P.y) || !isFinite(P.vx) || !isFinite(P.vy) || !isFinite(P.hp) || !isFinite(P.hunger) || !isFinite(P.hydration) || !isFinite(P.energy) || !isFinite(P.silk) || !isFinite(P.radius) || !isFinite(P.angle);
    if (bad) {
      Game.reportError('player.nan', new Error('non-finite player state'));
      P.x = lastGood.x; P.y = lastGood.y; P.vx = P.vy = 0;
      if (!isFinite(P.hp)) P.hp = P.maxHp; if (!isFinite(P.hunger)) P.hunger = 50; if (!isFinite(P.hydration)) P.hydration = 50;
      if (!isFinite(P.energy)) P.energy = 50; if (!isFinite(P.silk)) P.silk = 0; if (!isFinite(P.radius)) P.radius = P.stageInfo.radius; if (!isFinite(P.angle)) P.angle = 0;
    } else { lastGood.x = P.x; lastGood.y = P.y; }
  }

  // ---- gait (alternating tetrapod, IK-style stepping) -------------------------------------------------------------------------------------
  function homeOf(i, out, curlV) {
    const k = i >> 1, s = (i & 1) ? 1 : -1, R = P.radius * VS, a = LEG_ANG[k], att = LEG_ATT[k];
    const cf = Math.max(0.22, 1 - 0.42 * Math.min(curlV, 1) - 2.4 * Math.max(0, curlV - 1)), len = LEG_LEN[k] * 0.86 * cf * ((P.species && P.species.leg) || 1);
    const lx = att[0] + Math.cos(a) * len, ly = s * (att[1] + Math.sin(a) * len);
    const c = Math.cos(P.angle), sn = Math.sin(P.angle);
    out.x = P.x + (lx * c - ly * sn) * R; out.y = P.y + (lx * sn + ly * c) * R;
  }
  const tmpH = { x: 0, y: 0 };
  function snapFeet() {
    for (let i = 0; i < 8; i++) { homeOf(i, tmpH, 0); const f = feet[i]; f.x = tmpH.x; f.y = tmpH.y; f.on = false; f.lift = 0; }
  }
  function tickGait(dt, sp) {
    const R = P.radius * VS, moving = sp > 4;
    const thr = R * (0.28 + 0.77 * clamp(sp / 60, 0, 1));
    const stepping = [false, false];
    const sprinting = P.sprinting;
    // advance active steps
    for (let i = 0; i < 8; i++) {
      const f = feet[i]; if (!f.on) continue;
      f.step += dt / f.dur;
      const g = ((i >> 1) + (i & 1)) & 1;
      if (f.step >= 1) {
        f.on = false; f.x = f.tx; f.y = f.ty; f.lift = 0;
        sfxStepT -= 1;
        if (moving && sfxStepT <= 0 && !P.dead) { sfxStepT = 3; sfx(sprinting ? 'sprint' : 'step', sprinting ? 0.5 : 0.25); }
      } else {
        const e = smooth(f.step);
        f.x = lerp(f.fx, f.tx, e); f.y = lerp(f.fy, f.ty, e); f.lift = Math.sin(Math.PI * f.step); stepping[g] = true;
      }
    }
    // start new steps when a foot lags too far behind
    const lead = clamp(0.1 * sp, 0, R * 1.3), vnx = sp > 1 ? P.vx / sp : 0, vny = sp > 1 ? P.vy / sp : 0;
    const curlV = curl;
    for (let i = 0; i < 8; i++) {
      const f = feet[i]; if (f.on) continue;
      f.lift = 0;
      if (P.courting && i < 2) { courtFoot(i, f); continue; }
      homeOf(i, tmpH, curlV);
      const hx = tmpH.x + vnx * lead, hy = tmpH.y + vny * lead;
      const d = Math.hypot(f.x - hx, f.y - hy), g = ((i >> 1) + (i & 1)) & 1;
      if (d > thr && (!stepping[1 - g] || d > thr * 2.4)) {
        f.on = true; f.step = 0; f.fx = f.x; f.fy = f.y;
        f.tx = hx + vnx * sp * 0.04; f.ty = hy + vny * sp * 0.04;
        f.dur = moving ? clamp(thr * 1.7 / Math.max(sp, 40), 0.07, 0.2) : 0.13;
        stepping[g] = true;
      } else if (curlV > 1.05 || (P.molting && !swapped)) {
        // dead / molting: legs track the pose directly
        f.x += (hx - f.x) * Math.min(1, 6 * dt); f.y += (hy - f.y) * Math.min(1, 6 * dt);
      }
    }
    // body motion cues
    gaitPhase += dt * (4 + sp / Math.max(3, R) * 0.9);
    const turn = U.angleDiff(prevAng, P.angle) / Math.max(dt, 1e-4); prevAng = P.angle;
    let tgt = clamp(-turn * 0.05, -0.42, 0.42) + Math.sin(gaitPhase) * 0.05 * clamp(sp / 80, 0, 1);
    if (spinT > 0) tgt += 0.28 * Math.sin(anim * 11);
    if (P.laying) tgt += 0.2 * Math.sin(anim * 5);
    abAng += (tgt - abAng) * (1 - Math.exp(-10 * dt));
    bodyBob = Math.sin(gaitPhase * 2) * 0.03 * clamp(sp / 80, 0, 1);
  }
  // front legs wave during the courtship dance
  function courtFoot(i, f) {
    const k = 0, s = (i & 1) ? 1 : -1, R = P.radius * VS, t = courtT;
    const lx = LEG_ATT[k][0] + 1.35 + 0.28 * Math.sin(t * 9 + i * 1.7), ly = s * (0.95 + 0.55 * Math.abs(Math.sin(t * 4.5 + i)));
    const c = Math.cos(P.angle), sn = Math.sin(P.angle);
    f.x = P.x + (lx * c - ly * sn) * R; f.y = P.y + (lx * sn + ly * c) * R; f.lift = 0.9;
  }

  function tickTrail(dt, sp) {
    trailT += dt;
    if (P.stage < 1 || P.dead || P.hatching) { if (trail.length) trail.length = 0; return; }
    const R = P.radius, tp = tailPos(TAIL), tx = tp.x, ty = tp.y;
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(last.x - tx, last.y - ty) > R * 0.5) { trail.push({ x: tx, y: ty }); if (trail.length > 28) trail.shift(); }
    if (sp < 4 && trail.length > 1 && trailT > 0.12) { trailT = 0; trail.shift(); }
  }

  function stepParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-2 * dt); p.vy = p.vy * Math.exp(-2 * dt) + p.g * dt;
    }
  }

  // ---- update entry --------------------------------------------------------------------------------------------------------------------------
  P.update = function (dt) {
    dt = Math.min(dt, 0.05);
    const sc = Game.state.scene;
    if (sc === 'paused' || sc === 'codex' || sc === 'territory') return;
    if (!Game.camera.target) Game.camera.target = P;
    anim += dt;
    flash = Math.max(0, flash - dt * 2.2); bitePhase = Math.max(0, bitePhase - dt * 4.5);
    eatT -= dt; drinkT -= dt; spinT -= dt; reviveGlow = Math.max(0, reviveGlow - dt * 0.7);
    stepParticles(dt);
    if (P.huddled > 0 && P.resting && Math.random() < dt * 1.5 * P.huddled) addParticle('spark', P.x + (Math.random() - 0.5) * P.radius * 3, P.y + (Math.random() - 0.5) * P.radius * 3, 0, -5 - Math.random() * 4, 1.2, 0.5, '#ffd9a0', 0);
    if (spinT > 0 && P.stage >= 1 && Math.random() < dt * 30) { const tp = tailPos(TAIL); addParticle('spark', tp.x, tp.y, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.5, 0.45, '#ffffff', 0); }
    if (exuvia) { exuvia.t += dt; if (exuvia.t > 80) exuvia = null; }
    if (sc === 'playing') simulate(dt);
    else if (sc === 'molting') chooseUpdate(dt);
    else if (sc === 'gameover' || sc === 'succession' || sc === 'lineageended') { deathT += dt; curl = Math.min(1.15, curl + dt); tickGait(dt, 0); updateRadius(dt); }
    else if (sc === 'victory' || sc === 'legacy') { if (P.eggSac) P.eggSac.t = 1; tickGait(dt, 0); }
    else { updateRadius(dt); tickGait(dt, 0); }
  };

  // ---- Territory: saving ---------------------------------------------------------------------------------------------------------------------------
  // serialize() is a plain JSON-safe slice, deserialize(d) restores it after reset(). A save can land mid-molt or mid-laying (a suspend snapshot is the
  // exact moment), so those two carry their timers; courting is simply cancelled (press E at the mate again).
  const rdn = (v, n) => { const k = Math.pow(10, n || 0); return Math.round(v * k) / k; };
  P.serialize = function () {
    const d = {
      x: rdn(this.x, 1), y: rdn(this.y, 1), angle: rdn(this.angle, 3), stage: this.stage, hp: rdn(this.hp, 1), hunger: rdn(this.hunger, 1), hydration: rdn(this.hydration, 1), energy: rdn(this.energy, 1),
      silk: rdn(this.silk, 1), growth: rdn(this.growth, 1), upgrades: Object.assign({}, this.upgrades), mate: { found: !!this.mate.found, courted: !!this.mate.courted, laid: !!this.mate.laid },
      moltTimer: rdn(this.moltTimer, 1), shaken: rdn(this.shaken, 1), species: this.species && this.species.id, shelter: this.inShelter ? this.inShelter.id : null,
    };
    if (this.molting && this.moltPhase === 'anim') d.molt = { t: rdn(moltT, 2), pending: pendingStage, swapped: !!swapped };
    if (this.laying) d.lay = { t: rdn(layT, 2), site: layTarget ? layTarget.id : null };
    if (this.ending) d.ending = true;
    return d;
  };
  P.deserialize = function (d) {
    if (!d || typeof d !== 'object') return;
    const n = (v, def) => (typeof v === 'number' && isFinite(v)) ? v : def;
    const w = world();
    this.stage = clamp(Math.floor(n(d.stage, 0)), 0, C.STAGES.length - 1); this.stageInfo = C.STAGES[this.stage]; this.radius = this.stageInfo.radius;
    C.UPGRADES.forEach(u => { this.upgrades[u.id] = clamp(Math.floor(n(d.upgrades && d.upgrades[u.id], 0)), 0, u.max); });
    this.applyUpgrades(false);
    this.x = clamp(n(d.x, this.x), 0, C.WORLD_W); this.y = clamp(n(d.y, this.y), 0, C.WORLD_H); this.vx = this.vy = 0; this.angle = n(d.angle, this.angle); prevAng = this.angle;
    this.hp = clamp(n(d.hp, this.maxHp), 1, this.maxHp); this.hunger = clamp(n(d.hunger, 80), 0, 100); this.hydration = clamp(n(d.hydration, 80), 0, 100); this.energy = clamp(n(d.energy, 100), 0, 100);
    this.silk = clamp(n(d.silk, 0), 0, this.maxSilk); this.growth = Math.max(0, n(d.growth, 0)); this.growthNeeded = this.stageInfo.growthNeeded;
    if (d.mate && typeof d.mate === 'object') this.mate = { found: !!d.mate.found, courted: !!d.mate.courted, laid: !!d.mate.laid };
    this.moltTimer = Math.max(0, n(d.moltTimer, 0)); this.shaken = Math.max(0, n(d.shaken, 0));
    this.dead = false; this.reviving = false; this.hatching = false; this.resting = false; this.courting = false; this.laying = false; this.molting = false; this.moltPhase = 'none'; this.ending = false;
    this.invuln = 2.5; this.inShelter = null; this.stateLabel = 'walking'; this.eggSac = null; sac = null; exuvia = null; trail.length = 0; parts.length = 0;
    if (d.shelter && w && w.shelters) { for (let i = 0; i < w.shelters.length; i++) if (w.shelters[i].id === d.shelter) { this.inShelter = w.shelters[i]; break; } }
    Game.camera.targetZoom = this.stageInfo.zoom; Game.camera.zoom = this.stageInfo.zoom; Game.camera.target = this;
    snapFeet(); lastGood.x = this.x; lastGood.y = this.y;
    if (d.molt && typeof d.molt === 'object') {   // mid-molt (the choice was already made): the animation carries on
      this.molting = true; this.moltPhase = 'anim'; moltT = Math.max(0, n(d.molt.t, 0)); pendingStage = clamp(Math.floor(n(d.molt.pending, this.stage + 1)), 1, 4); swapped = !!d.molt.swapped;
      this.invuln = Math.max(this.invuln, 2); this.stateLabel = 'molting';
    }
    if (d.lay && typeof d.lay === 'object' && this.stage >= 4) {   // mid-laying: she finishes laying the sac
      this.laying = true; this.mate.laid = true; layT = Math.max(0, n(d.lay.t, 0)); layTarget = null;
      if (w && w.shelters) for (let i = 0; i < w.shelters.length; i++) if (w.shelters[i].id === d.lay.site) layTarget = w.shelters[i];
      this.eggSac = { x: this.x - Math.cos(this.angle) * this.radius * 3.4, y: this.y - Math.sin(this.angle) * this.radius * 3.4, t: clamp(layT / LAY_T, 0, 1), r: this.radius * 1.5 };
      victoryFired = false;
    }
    if (d.ending) { this.ending = true; this.mate.laid = true; victoryFired = true; this.eggSac = { x: this.x - Math.cos(this.angle) * this.radius * 3.4, y: this.y - Math.sin(this.angle) * this.radius * 3.4, t: 1, r: this.radius * 1.5 }; }
    if (!this.molting && this.stage < 4 && this.growth >= this.growthNeeded) startMolt();   // a molt that was due when the game was saved
  };

  // ---- debug helper ------------------------------------------------------------------------------------------------------------------------------
  P.debugSetStage = function (n) {
    n = clamp(Math.floor(num(n, 0)), 0, 4);
    this.stage = n; this.stageInfo = C.STAGES[n]; this.radius = this.stageInfo.radius;
    this.molting = false; this.moltPhase = 'none'; this.moltTimer = 0; this.hatching = false; this.dead = false; this.invuln = 0;
    this.applyUpgrades(false); this.hp = this.maxHp; this.silk = this.maxSilk; this.growth = 0; this.growthNeeded = this.stageInfo.growthNeeded;
    Game.camera.targetZoom = this.stageInfo.zoom; Game.camera.zoom = this.stageInfo.zoom;
    snapFeet(); sac = null;
    if (n >= 4) trySpawnMate();
    if (Game.state.scene === 'molting') Game.setScene('playing');
    return this;
  };
  P.debugState = function () { return { anim, hatchT, moltT, courtT, layT, deathT, curl, flash, exuvia: !!exuvia, parts: parts.length, trail: trail.length }; };

  // =========================================================================================================
  //  RENDERING
  // =========================================================================================================
  const rgbCache = {};
  function H(hex) { return rgbCache[hex] || (rgbCache[hex] = U.hexToRgb(hex)); }
  const SOFTC = H('#f1e4cc'), FLASHC = H('#ff5a48'), DEADC = H('#7d776b'), CAMOC = H(CAMO), SHELLC = H('#e0d2b0');
  // colour with optional camo / soft / shell / dead / flash mixing, then lighten(k>0) or darken(k<0)
  function tint(hex, st, k, a) {
    const c = H(hex); let r = c[0], g = c[1], b = c[2], m;
    if (st.camoK > 0) { m = st.camoK; r += (CAMOC[0] - r) * m; g += (CAMOC[1] - g) * m; b += (CAMOC[2] - b) * m; }
    if (st.softness > 0) { m = st.softness * 0.8; r += (SOFTC[0] - r) * m; g += (SOFTC[1] - g) * m; b += (SOFTC[2] - b) * m; }
    if (st.shell) { r += (SHELLC[0] - r) * 0.5; g += (SHELLC[1] - g) * 0.5; b += (SHELLC[2] - b) * 0.5; }
    if (st.deadK > 0) { m = st.deadK * 0.6; r += (DEADC[0] - r) * m; g += (DEADC[1] - g) * m; b += (DEADC[2] - b) * m; }
    if (st.flash > 0) { m = Math.min(0.7, st.flash * 0.6); r += (FLASHC[0] - r) * m; g += (FLASHC[1] - g) * m; b += (FLASHC[2] - b) * m; }
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else if (k < 0) { const q = 1 + k; r *= q; g *= q; b *= q; }
    const al = (a === undefined ? 1 : a) * st.alpha;
    return al >= 0.995 ? 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')' : 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + al.toFixed(3) + ')';
  }

  const KX = new Float64Array(8), KY = new Float64Array(8), MX = new Float64Array(8), MY = new Float64Array(8);
  const FX = new Float64Array(8), FY = new Float64Array(8), AX = new Float64Array(8), AY = new Float64Array(8), LF = new Float64Array(8);

  function drawLegs(ctx, st, R, ca, sa, ox, oy, pal) {
    const fl = st.feet;
    for (let i = 0; i < 8; i++) {
      const k = i >> 1, side = (i & 1) ? 1 : -1, att = LEG_ATT[k];
      const lx = att[0] * R, ly = side * att[1] * R * 0.85;
      const ax = st.x + ox + lx * ca - ly * sa, ay = st.y + oy + lx * sa + ly * ca;
      let fx = fl[i].x, fy = fl[i].y; const lift = fl[i].lift || 0;
      const L = LEG_LEN[k] * R * 0.5 * LEGBEND * (st.legK || 1);
      let dx = fx - ax, dy = fy - ay, d = Math.hypot(dx, dy) || 0.001;
      const reach = L * 2 * 0.985 * (1 - 0.07 * lift);
      if (d > reach) { fx = ax + dx / d * reach; fy = ay + dy / d * reach; dx = fx - ax; dy = fy - ay; d = reach; }
      else { const dmin = Math.max(R * 0.4, reach * 0.55); if (d < dmin) { const q = dmin / d; fx = ax + dx * q; fy = ay + dy * q; dx = fx - ax; dy = fy - ay; d = dmin; } }   // a foot the body has run over can't fold the leg into a needle
      const ux = dx / d, uy = dy / d, a = d / 2, h = Math.sqrt(Math.max(0, L * L - a * a));
      const bx = ax + ux * a, by = ay + uy * a;
      const k1x = bx - uy * h, k1y = by + ux * h, k2x = bx + uy * h, k2y = by - ux * h;
      // knees bulge outward, like a real spider seen from above: front pairs bow back-and-out, rear pairs bow forward-and-out.
      // Judged against a fixed direction per pair (not the current foot line) so the knee never flips sides mid-stride.
      const pf = k < 2 ? -KNEE_FWD : KNEE_FWD;
      const o1 = (k1x - ax) * (ca * pf - sa * side) + (k1y - ay) * (sa * pf + ca * side), o2 = (k2x - ax) * (ca * pf - sa * side) + (k2y - ay) * (sa * pf + ca * side);
      let kx, ky;
      if (o1 >= o2) { kx = k1x; ky = k1y; } else { kx = k2x; ky = k2y; }
      if (lift > 0) { const ex = kx - bx, ey = ky - by, el = Math.hypot(ex, ey) || 1; kx += ex / el * lift * R * 0.22; ky += ey / el * lift * R * 0.22; }
      AX[i] = ax; AY[i] = ay; KX[i] = kx; KY[i] = ky; FX[i] = fx; FY[i] = fy; LF[i] = lift;
      MX[i] = kx + (fx - kx) * 0.68; MY[i] = ky + (fy - ky) * 0.68;
    }
    const w = Math.max(0.55, R * 0.14);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!st.shell) {   // faint cast shadow of the legs
      ctx.save(); ctx.translate(R * 0.09, R * 0.15); ctx.strokeStyle = 'rgba(0,0,0,' + (0.17 * st.alpha).toFixed(3) + ')'; ctx.lineWidth = w * 1.15; ctx.beginPath();
      for (let i = 0; i < 8; i++) { ctx.moveTo(AX[i], AY[i]); ctx.lineTo(KX[i], KY[i]); ctx.lineTo(FX[i], FY[i]); }
      ctx.stroke(); ctx.restore();
    }
    const dark = tint(pal.legD, st, 0, st.shell ? 0.7 : 1), light = tint(pal.leg, st, 0.04, st.shell ? 0.55 : 1);
    const widths = [[1.55, 1.1], [1.15, 0.8], [0.72, 0.45]];
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? dark : light;
      for (let sgm = 0; sgm < 3; sgm++) {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          if (sgm === 0) { ctx.moveTo(AX[i], AY[i]); ctx.lineTo(KX[i], KY[i]); }
          else if (sgm === 1) { ctx.moveTo(KX[i], KY[i]); ctx.lineTo(MX[i], MY[i]); }
          else { ctx.moveTo(MX[i], MY[i]); ctx.lineTo(FX[i], FY[i]); }
        }
        ctx.lineWidth = w * widths[sgm][pass];
        ctx.stroke();
      }
    }
    if (!st.shell) {
      // pale banding on the tibia and bright patella joints (more pronounced with stage)
      if (st.stage >= 2) {
        ctx.strokeStyle = tint(pal.mark, st, 0, 0.55); ctx.lineWidth = w * 0.7;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const x0 = KX[i] + (MX[i] - KX[i]) * 0.25, y0 = KY[i] + (MY[i] - KY[i]) * 0.25, x1 = KX[i] + (MX[i] - KX[i]) * 0.5, y1 = KY[i] + (MY[i] - KY[i]) * 0.5;
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        }
        ctx.stroke();
        ctx.fillStyle = tint(pal.mark, st, 0.1, 0.5);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { ctx.moveTo(KX[i] + w * 0.55, KY[i]); ctx.arc(KX[i], KY[i], w * 0.55, 0, TAU); }
        ctx.fill();
      }
      // fine hairs (setae) on the leg segments
      ctx.strokeStyle = tint(pal.mark, st, 0.1, 0.38); ctx.lineWidth = Math.max(0.12, R * 0.022);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        for (let q = 0; q < 3; q++) {
          const t = 0.25 + q * 0.3, px = MX[i] + (KX[i] - MX[i]) * t * 1.2, py = MY[i] + (KY[i] - MY[i]) * t * 1.2;
          const ddx = FX[i] - KX[i], ddy = FY[i] - KY[i], dl = Math.hypot(ddx, ddy) || 1, nx = -ddy / dl, ny = ddx / dl, sg = (q & 1) ? 1 : -1;
          ctx.moveTo(px, py); ctx.lineTo(px + (nx * sg * 0.9 + ddx / dl * 0.5) * R * 0.2, py + (ny * sg * 0.9 + ddy / dl * 0.5) * R * 0.2);
        }
      }
      ctx.stroke();
    }
  }

  // body outlines (unit radius, local frame, +x forward)
  function cephPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.9, 0);
    ctx.bezierCurveTo(0.92, -0.26, 0.66, -0.54, 0.26, -0.56);
    ctx.bezierCurveTo(-0.14, -0.58, -0.54, -0.44, -0.6, -0.1);
    ctx.lineTo(-0.6, 0.1);
    ctx.bezierCurveTo(-0.54, 0.44, -0.14, 0.58, 0.26, 0.56);
    ctx.bezierCurveTo(0.66, 0.54, 0.92, 0.26, 0.9, 0);
    ctx.closePath();
  }
  function abdPath(ctx) {   // origin at the pedicel, extends to -x
    ctx.beginPath();
    ctx.moveTo(-0.02, 0);
    ctx.bezierCurveTo(-0.05, -0.55, -0.45, -0.94, -0.92, -0.88);
    ctx.bezierCurveTo(-1.38, -0.82, -1.68, -0.4, -1.82, 0);
    ctx.bezierCurveTo(-1.68, 0.4, -1.38, 0.82, -0.92, 0.88);
    ctx.bezierCurveTo(-0.45, 0.94, -0.05, 0.55, -0.02, 0);
    ctx.closePath();
  }
  function eye(ctx, st, x, y, r, lx, ly, pal) {
    ctx.fillStyle = st.shell ? tint('#cbbd9c', st, 0, 0.8) : '#0b0b10';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (st.shell) return;
    ctx.strokeStyle = tint(st.stage >= 3 ? '#8a6a30' : '#4a4a58', st, 0, 0.55); ctx.lineWidth = r * 0.22;
    ctx.beginPath(); ctx.arc(x, y, r * 0.86, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.arc(x + lx * r * 0.36, y + ly * r * 0.36, r * 0.27, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(190,225,255,0.35)';
    ctx.beginPath(); ctx.arc(x - lx * r * 0.25, y - ly * r * 0.25, r * 0.17, 0, TAU); ctx.fill();
  }

  // Black Widow abdomen markings (abdomen space). The young carry cream stripes and orange-red spots that fade as she molts; the adult is
  // glossy black with a red spot above the spinnerets. Her red hourglass is on the underside, so it only shows while she hangs belly-up
  // to spin or rest (st.belly).
  function widowMarks(ctx, st, pal, stg) {
    const stripeA = [0.5, 0.85, 0.7, 0.4, 0][stg], nSpots = [3, 4, 5, 3, 0][stg];
    if (stripeA > 0) {
      ctx.strokeStyle = tint(pal.mark, st, 0, stripeA); ctx.lineWidth = 0.09; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {   // curved stripes sweeping back from each flank
        const x0 = -0.35 - j * 0.38;
        ctx.moveTo(x0, -0.8 + j * 0.1); ctx.quadraticCurveTo(x0 - 0.32, -0.36, x0 - 0.12, -0.06);
        ctx.moveTo(x0, 0.8 - j * 0.1); ctx.quadraticCurveTo(x0 - 0.32, 0.36, x0 - 0.12, 0.06);
      }
      ctx.stroke();
    }
    if (nSpots) {
      ctx.fillStyle = tint(pal.spot, st, 0.05, 0.9);
      for (let j = 0; j < nSpots; j++) { ctx.beginPath(); ctx.arc(-0.5 - j * 0.28, 0, 0.085 - j * 0.006, 0, TAU); ctx.fill(); }
    }
    if (stg >= 3) {   // the red spot above the spinnerets
      const a = stg === 4 ? 1 : 0.55;
      ctx.fillStyle = tint(pal.spot, st, 0, a); ctx.beginPath(); ctx.ellipse(-1.52, 0, 0.18, 0.14, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = tint('#ff7a5c', st, 0, 0.35 * a); ctx.beginPath(); ctx.ellipse(-1.56, -0.04, 0.09, 0.05, 0, 0, TAU); ctx.fill();
    }
    if (stg >= 3 && st.belly > 0.02) {   // the hourglass: two triangles meeting at the waist
      ctx.fillStyle = tint(pal.spot, st, 0.05, 0.95 * st.belly * (stg === 4 ? 1 : 0.5));
      ctx.beginPath(); ctx.moveTo(-0.62, -0.3); ctx.lineTo(-0.62, 0.3); ctx.lineTo(-0.92, 0.035); ctx.lineTo(-1.22, 0.3); ctx.lineTo(-1.22, -0.3); ctx.lineTo(-0.92, -0.035); ctx.closePath(); ctx.fill();
    }
  }

  function drawBody(ctx, st, pal) {
    const stg = st.stage, mk = [0.35, 0.6, 0.75, 0.9, 1][stg], widow = st.species === 'widow';
    const lx = LIGHT.x * st.ca + LIGHT.y * st.sa, ly = -LIGHT.x * st.sa + LIGHT.y * st.ca;   // light direction in local space
    const breathe = 1 + 0.02 * Math.sin(st.t * (st.resting ? 1.6 : 2.6)) + (st.pulse || 0);
    const bite = st.bite, chew = st.eat > 0 ? Math.sin(st.t * 38) * 0.5 + 0.5 : 0;

    // pedipalps
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = tint(pal.cara, st, -0.1); ctx.lineWidth = 0.1;
    for (let s = -1; s <= 1; s += 2) {
      const wob = Math.sin(st.t * 7 + s) * 0.05 + (st.drink > 0 ? Math.sin(st.t * 22) * 0.07 : 0) + (st.dance ? Math.sin(st.t * 12 + s) * 0.18 : 0);
      ctx.beginPath(); ctx.moveTo(0.78, s * 0.2); ctx.lineTo(1.04, s * (0.4 + bite * 0.12) + wob * 0.5); ctx.lineTo(1.26 + bite * 0.06, s * (0.28 - bite * 0.04) + wob); ctx.stroke();
      ctx.fillStyle = tint(pal.dark, st, 0.1); ctx.beginPath(); ctx.arc(1.28 + bite * 0.06, s * (0.28 - bite * 0.04) + wob, 0.065, 0, TAU); ctx.fill();
    }
    // chelicerae and fangs
    const open = Math.max(bite, chew * 0.6);
    for (let s = -1; s <= 1; s += 2) {
      ctx.fillStyle = tint(pal.cara, st, -0.18);
      ctx.beginPath(); ctx.ellipse(0.93 + bite * 0.08, s * (0.12 + open * 0.07), 0.2, 0.115, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = st.venom ? tint('#6a1f14', st, 0) : tint('#2a1209', st, 0);
      ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.moveTo(1.04 + bite * 0.08, s * (0.11 + open * 0.07));
      ctx.quadraticCurveTo(1.18 + bite * 0.16, s * (0.1 + open * 0.26), 1.16 + bite * 0.26, s * (0.03 + open * 0.42)); ctx.stroke();
    }

    // abdomen
    ctx.save();
    const abd = ABD_SHAPE[st.species] || ABD_SHAPE.garden;
    ctx.translate(-0.5, 0); ctx.rotate(st.abAng); ctx.scale(0.86 * breathe * abd[0], 0.86 * breathe * abd[1]);
    let g = ctx.createRadialGradient(lx * 0.45, ly * 0.45 - 0.0, 0.05, -0.85, 0, 1.05);
    g.addColorStop(0, tint(pal.abd, st, 0.28)); g.addColorStop(0.5, tint(pal.abd, st, 0)); g.addColorStop(1, tint(pal.abd, st, -0.32));
    abdPath(ctx); ctx.fillStyle = g; ctx.fill();
    ctx.save(); abdPath(ctx); ctx.clip();
    if (!st.shell) {
      // markings: cardiac folium + chevrons + flank bands, bolder with each stage; camouflage adds mottling
      if (widow) widowMarks(ctx, st, pal, stg);
      else {
      ctx.fillStyle = tint(pal.mark, st, 0, 0.55 * mk);
      ctx.beginPath(); ctx.moveTo(-0.12, 0); ctx.quadraticCurveTo(-0.55, -0.26 - stg * 0.025, -1.0, -0.2 - stg * 0.02); ctx.quadraticCurveTo(-1.45, -0.1, -1.55, 0);
      ctx.quadraticCurveTo(-1.45, 0.1, -1.0, 0.2 + stg * 0.02); ctx.quadraticCurveTo(-0.55, 0.26 + stg * 0.025, -0.12, 0); ctx.fill();
      const nch = [0, 2, 3, 4, 5][stg];
      if (nch) {
        ctx.strokeStyle = tint(pal.mark, st, 0, 0.65 * mk); ctx.lineWidth = 0.06 + stg * 0.012;
        ctx.beginPath();
        for (let j = 0; j < nch; j++) {
          const x = -0.6 - j * 0.2, wj = 0.62 - j * 0.07;
          ctx.moveTo(x + 0.12, -wj); ctx.lineTo(x - 0.1, -0.05); ctx.lineTo(x + 0.12, wj); }
        ctx.stroke();
      }
      if (stg >= 2) {   // pale flank bands
        ctx.strokeStyle = tint(pal.mark, st, 0, 0.4 * mk); ctx.lineWidth = 0.1;
        ctx.beginPath(); ctx.moveTo(-0.2, -0.7); ctx.quadraticCurveTo(-0.9, -0.95, -1.5, -0.38); ctx.moveTo(-0.2, 0.7); ctx.quadraticCurveTo(-0.9, 0.95, -1.5, 0.38); ctx.stroke();
      }
      if (stg >= 4) {   // adult: golden crescents and dark spots
        ctx.strokeStyle = tint('#f2c25a', st, 0, 0.85); ctx.lineWidth = 0.12;
        ctx.beginPath(); ctx.arc(-0.35, 0, 0.62, Math.PI * 0.72, Math.PI * 1.28, false); ctx.stroke();
        ctx.beginPath(); ctx.arc(-0.35, 0, 0.62, -Math.PI * 0.28, Math.PI * 0.28, false); ctx.stroke();
        ctx.fillStyle = tint(pal.dark, st, 0, 0.8);
        for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(-0.7 - j * 0.24, -0.38 + (j & 1) * 0, 0.045, 0, TAU); ctx.arc(-0.7 - j * 0.24, 0.38, 0.045, 0, TAU); ctx.fill(); }
      } else if (stg === 0) {
        ctx.fillStyle = tint(pal.dark, st, 0, 0.35);
        for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(-0.7 - j * 0.22, (j & 1 ? 0.3 : -0.3), 0.05, 0, TAU); ctx.fill(); }
      }
      }
      if (st.camo > 0) {
        for (let j = 0; j < 9 + st.camo * 6; j++) {
          const px = -0.15 - hash(j, 1) * 1.5, py = (hash(j, 2) - 0.5) * 1.5, rr = 0.04 + hash(j, 3) * 0.07;
          ctx.fillStyle = hash(j, 4) > 0.5 ? 'rgba(30,22,14,0.32)' : 'rgba(235,225,200,0.3)';
          ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill();
        }
      }
    } else {   // shed skin: faint segmentation lines
      ctx.strokeStyle = 'rgba(120,100,70,0.35)'; ctx.lineWidth = 0.03;
      for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(-0.9, 0, 0.35 + j * 0.15, 0, TAU); ctx.stroke(); }
    }
    // gloss
    if (!st.shell) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + 0.05 * (st.carapace || 0) + st.softness * 0.1 + (widow && stg >= 3 ? 0.1 * mk : 0)).toFixed(3) + ')';   // an adult widow is glossy
      ctx.beginPath(); ctx.ellipse(-0.75 + lx * 0.38, ly * 0.38, 0.42, 0.22, Math.atan2(ly, lx), 0, TAU); ctx.fill();
    }
    ctx.restore();
    abdPath(ctx); ctx.strokeStyle = tint(pal.dark, st, 0, 0.75); ctx.lineWidth = 0.05; ctx.stroke();
    // abdomen hairs and spinnerets
    if (!st.shell) {
      ctx.strokeStyle = tint(pal.mark, st, 0.1, 0.4); ctx.lineWidth = 0.022; ctx.beginPath();
      for (let j = 0; j < 22; j++) {
        const th = hash(j, 11) * TAU, px = -0.92 + Math.cos(th) * 0.9, py = Math.sin(th) * 0.86;
        if (px > -0.1) continue;
        const l = 0.1 + hash(j, 12) * 0.08; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(th) * l, py + Math.sin(th) * l);
      }
      ctx.stroke();
      ctx.fillStyle = tint(pal.dark, st, 0.05); ctx.beginPath(); ctx.ellipse(-1.82, -0.07 - (st.silkUp || 0) * 0.02, 0.1, 0.045, 0, 0, TAU); ctx.ellipse(-1.82, 0.07, 0.1, 0.045, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // cephalothorax
    g = ctx.createRadialGradient(lx * 0.35 + 0.15, ly * 0.35, 0.05, 0.1, 0, 0.95);
    g.addColorStop(0, tint(pal.cara, st, 0.3)); g.addColorStop(0.55, tint(pal.cara, st, 0)); g.addColorStop(1, tint(pal.cara, st, -0.3));
    cephPath(ctx); ctx.fillStyle = g; ctx.fill();
    ctx.save(); cephPath(ctx); ctx.clip();
    if (!st.shell) {
      ctx.strokeStyle = tint(pal.mark, st, 0, (0.4 * mk + 0.1) * (widow && stg >= 3 ? 0.35 : 1)); ctx.lineWidth = 0.09; ctx.lineCap = 'round';
      if (stg >= 1) { ctx.beginPath(); ctx.moveTo(0.7, -0.2); ctx.quadraticCurveTo(0.1, -0.24, -0.45, -0.18); ctx.moveTo(0.7, 0.2); ctx.quadraticCurveTo(0.1, 0.24, -0.45, 0.18); ctx.stroke(); }
      ctx.strokeStyle = tint(pal.dark, st, 0, 0.55); ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.moveTo(-0.12, -0.07); ctx.lineTo(-0.28, 0); ctx.lineTo(-0.12, 0.07);   // thoracic fovea
      if (stg >= 2) { for (let s = -1; s <= 1; s += 2) for (let j = 0; j < 3; j++) { ctx.moveTo(-0.2, s * 0.05); ctx.lineTo(-0.1 + j * 0.22, s * (0.42 - j * 0.02)); } }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.1 + 0.05 * (st.carapace || 0)).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(0.1 + lx * 0.3, ly * 0.3, 0.4, 0.2, Math.atan2(ly, lx), 0, TAU); ctx.fill();
      // cracking along the back during molting
      if (st.crack > 0) {
        const c = st.crack;
        ctx.fillStyle = tint('#fff6dc', st, 0, 0.95); ctx.beginPath();
        ctx.moveTo(0.66, 0); ctx.lineTo(0.25, -0.09 * c - 0.01); ctx.lineTo(-0.1, 0.08 * c + 0.01); ctx.lineTo(-0.55, -0.07 * c - 0.01);
        ctx.lineTo(-0.55, 0.07 * c + 0.01); ctx.lineTo(-0.1, -0.08 * c); ctx.lineTo(0.25, 0.09 * c + 0.01); ctx.closePath(); ctx.fill();
      }
    } else {   // the split down the back of the shed carapace
      ctx.fillStyle = 'rgba(70,52,32,0.55)'; ctx.beginPath();
      ctx.moveTo(0.62, 0); ctx.lineTo(0.25, -0.1); ctx.lineTo(-0.1, 0.08); ctx.lineTo(-0.5, -0.08); ctx.lineTo(-0.5, 0.08); ctx.lineTo(-0.1, -0.08); ctx.lineTo(0.25, 0.1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    cephPath(ctx); ctx.strokeStyle = tint(pal.dark, st, 0, 0.8); ctx.lineWidth = 0.05; ctx.stroke();

    // eyes: two rows of four -> 8 eyes (AME, ALE, PME, PLE)
    for (let s = -1; s <= 1; s += 2) {
      eye(ctx, st, 0.76, s * 0.1, 0.07, lx, ly, pal);
      eye(ctx, st, 0.69, s * 0.23, 0.058, lx, ly, pal);
      eye(ctx, st, 0.5, s * 0.19, 0.105, lx, ly, pal);
      eye(ctx, st, 0.36, s * 0.31, 0.068, lx, ly, pal);
    }
    // carapace hairs
    if (!st.shell) {
      ctx.strokeStyle = tint(pal.mark, st, 0.15, 0.42); ctx.lineWidth = 0.022; ctx.beginPath();
      for (let j = 0; j < 20; j++) {
        const th = hash(j, 21) * TAU, px = 0.15 + Math.cos(th) * 0.74, py = Math.sin(th) * 0.55;
        const l = 0.08 + hash(j, 22) * 0.07; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(th) * l, py + Math.sin(th) * l);
      }
      ctx.stroke();
    }
  }

  function drawSpider(ctx, st) {
    const R = st.r * st.scale * VS; if (R <= 0.01) return;
    const pal = (PALS[st.species] || PAL)[st.stage] || PAL[0];
    const ca = Math.cos(st.ang), sa = Math.sin(st.ang);
    st.ca = ca; st.sa = sa; st.camoK = (st.camo || 0) * 0.16; st.t = st.t || 0;
    const ox = ca * st.lunge * R - sa * st.bobLat * R, oy = sa * st.lunge * R + ca * st.bobLat * R;
    // soft contact shadow
    ctx.save();
    ctx.translate(st.x + R * 0.28 + ox * 0.4, st.y + R * 0.34 + oy * 0.4); ctx.rotate(st.ang); ctx.scale(R * 2.3, R * 1.55);
    const sg = ctx.createRadialGradient(-0.2, 0, 0.1, -0.2, 0, 1);
    const sh = (st.shell ? 0.1 : 0.3) * st.alpha;
    sg.addColorStop(0, 'rgba(0,0,0,' + sh.toFixed(3) + ')'); sg.addColorStop(0.6, 'rgba(0,0,0,' + (sh * 0.45).toFixed(3) + ')'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(-0.2, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
    // pale glow while the skin splits
    if (st.crack > 0 && !st.shell) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, R * 3);
      gg.addColorStop(0, 'rgba(255,240,200,' + (0.35 * st.crack).toFixed(3) + ')'); gg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(st.x, st.y, R * 3, 0, TAU); ctx.fill(); ctx.restore();
    }
    drawLegs(ctx, st, R, ca, sa, ox, oy, pal);
    ctx.save();
    ctx.translate(st.x + ox, st.y + oy); ctx.rotate(st.ang);
    ctx.scale(R * st.sx, R * st.sy);
    drawBody(ctx, st, pal);
    ctx.restore();
  }

  // ---- spinneret position / dragline trail ---------------------------------------------------------------------------
  const TAIL = { x: 0, y: 0 };
  function tailPos(o) {
    const R = P.radius * VS, a = P.angle, b = a + abAng;
    const px = P.x - Math.cos(a) * R * 0.5, py = P.y - Math.sin(a) * R * 0.5;
    o.x = px - Math.cos(b) * R * 1.55; o.y = py - Math.sin(b) * R * 1.55; return o;
  }
  function drawTrail(ctx) {
    if (trail.length < 1 || P.stage < 1 || P.dead) return;
    const R = P.radius, t = tailPos(TAIL), z = Game.camera.zoom || 1;
    const lw = Math.max(0.3, R * 0.045, 0.9 / z);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(255,250,235,0.1)' : 'rgba(255,252,240,0.42)';
      ctx.lineWidth = pass === 0 ? lw * 3.2 : lw;
      ctx.beginPath(); ctx.moveTo(t.x, t.y);
      for (let i = trail.length - 1; i >= 0; i--) { const p = trail[i]; ctx.lineTo(p.x + Math.sin(anim * 3 + i) * R * 0.03, p.y + Math.cos(anim * 2.6 + i) * R * 0.03); }
      ctx.stroke();
    }
  }

  // ---- hatching egg sac -----------------------------------------------------------------------------------------------------
  function pearl(ctx, R, alpha) {
    const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
    g.addColorStop(0, 'rgba(255,252,240,' + alpha + ')'); g.addColorStop(0.65, 'rgba(240,228,198,' + (alpha * 0.9).toFixed(3) + ')'); g.addColorStop(1, 'rgba(206,188,150,' + (alpha * 0.8).toFixed(3) + ')');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.42)'; ctx.lineWidth = Math.max(0.2, R * 0.025); ctx.beginPath();
    for (let j = 0; j < 14; j++) {
      const a1 = hash(j, 31) * TAU, a2 = a1 + 1.2 + hash(j, 32) * 2.2;
      ctx.moveTo(Math.cos(a1) * R * 0.97, Math.sin(a1) * R * 0.97);
      ctx.quadraticCurveTo(Math.cos((a1 + a2) / 2) * R * 0.55, Math.sin((a1 + a2) / 2) * R * 0.55, Math.cos(a2) * R * 0.97, Math.sin(a2) * R * 0.97);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,130,95,0.45)'; ctx.lineWidth = Math.max(0.2, R * 0.03);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  }
  function sacAge() { return (sac && sac.doneAt != null) ? Game.time.t - sac.doneAt : 0; }
  function drawSac(ctx) {
    if (!sac || P.stage > 0 && sacAge() > 46) return;
    const hatching = P.hatching, u = hatching ? clamp(hatchT / HATCH_T, 0, 1) : 1, age = sacAge();
    const fade = hatching ? 1 : clamp(1 - (age - 30) / 15, 0, 1); if (fade <= 0) return;
    const collapse = smooth(clamp((u - 0.55) / 0.4, 0, 1)), wob = (hatching && u < 0.6) ? Math.sin(anim * (14 + u * 20)) * 0.035 * (1 - u) : 0;
    const R = sac.r;
    ctx.save();
    ctx.translate(sac.x, sac.y); ctx.rotate(sac.ang); ctx.scale((1 + wob) * (1 + 0.25 * collapse), (1 - wob) * (1 - 0.4 * collapse));
    ctx.globalAlpha = fade;
    // soft shadow
    const sg = ctx.createRadialGradient(R * 0.1, R * 0.15, R * 0.2, R * 0.1, R * 0.15, R * 1.3);
    sg.addColorStop(0, 'rgba(0,0,0,0.25)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(R * 0.1, R * 0.15, R * 1.3, 0, TAU); ctx.fill();
    pearl(ctx, R, (0.86 - 0.4 * collapse).toFixed(3));
    // siblings' unhatched eggs show through the silk
    ctx.fillStyle = 'rgba(250,238,205,0.55)';
    for (let j = 0; j < 7; j++) { const a = hash(j, 41) * TAU, d = R * (0.2 + hash(j, 42) * 0.55); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, R * 0.1, 0, TAU); ctx.fill(); }
    // the tear the hatchling pushes through
    if (u > 0.3) {
      const open = smooth(clamp((u - 0.3) / 0.45, 0, 1)), span = 0.18 + open * 0.75;
      ctx.beginPath(); ctx.moveTo(R * 0.2, 0);
      const n = 6;
      for (let j = 0; j <= n; j++) { const a = -span + (2 * span) * j / n, rr = R * (j % 2 ? 0.97 : 0.84); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fillStyle = 'rgba(46,34,20,' + (0.5 * open + 0.1) + ')'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,250,235,0.7)'; ctx.lineWidth = Math.max(0.2, R * 0.03); ctx.stroke();
    }
    ctx.restore();
  }
  function drawSacFront(ctx) {
    if (!sac || !P.hatching) return;
    const u = clamp(hatchT / HATCH_T, 0, 1); if (u > 0.5) return;
    const a = (1 - u / 0.5) * 0.4;
    ctx.save(); ctx.translate(sac.x, sac.y);
    const g = ctx.createRadialGradient(0, 0, sac.r * 0.2, 0, 0, sac.r);
    g.addColorStop(0, 'rgba(255,250,230,' + (a * 0.6).toFixed(3) + ')'); g.addColorStop(1, 'rgba(235,220,185,' + a.toFixed(3) + ')');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sac.r * 0.98, 0, TAU); ctx.fill(); ctx.restore();
  }

  // ---- final egg sac (ending) ---------------------------------------------------------------------------------------------------
  function drawEggSac(ctx) {
    const e = P.eggSac; if (!e) return;
    const t = smooth(clamp(e.t, 0, 1)), R = e.r * t; if (R < 0.4) return;
    if (P.laying) {   // silk threads from the spinnerets to the forming sac
      const tp = tailPos(TAIL);
      ctx.strokeStyle = 'rgba(255,252,240,0.5)'; ctx.lineWidth = Math.max(0.25, P.radius * 0.04); ctx.beginPath();
      for (let j = 0; j < 3; j++) { ctx.moveTo(tp.x, tp.y); ctx.lineTo(e.x + Math.cos(anim * 3 + j * 2) * R * 0.7, e.y + Math.sin(anim * 3 + j * 2) * R * 0.7); }
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createRadialGradient(e.x, e.y, R * 0.5, e.x, e.y, R * 2.6);
    gg.addColorStop(0, 'rgba(255,236,190,' + (0.28 * t).toFixed(3) + ')'); gg.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(e.x, e.y, R * 2.6, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(e.x, e.y);
    const sg = ctx.createRadialGradient(R * 0.15, R * 0.2, R * 0.3, R * 0.15, R * 0.2, R * 1.4);
    sg.addColorStop(0, 'rgba(0,0,0,0.3)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(R * 0.15, R * 0.2, R * 1.4, 0, TAU); ctx.fill();
    pearl(ctx, R, '0.97');
    ctx.fillStyle = 'rgba(250,236,200,0.6)';
    for (let j = 0; j < 9; j++) { const a = hash(j, 51) * TAU, d = R * (0.15 + hash(j, 52) * 0.6); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, R * 0.09, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // ---- shed skin ------------------------------------------------------------------------------------------------------------------------
  const XST = { species: 'garden', legK: 1, belly: 0, x: 0, y: 0, ang: 0, r: 5, scale: 1, stage: 0, feet: null, abAng: 0, softness: 0, flash: 0, alpha: 1, shell: true, camo: 0, carapace: 0, venom: false, deadK: 0, sx: 1, sy: 1, bobLat: 0, lunge: 0, bite: 0, eat: 0, drink: 0, resting: false, dance: false, pulse: 0, silkUp: 0, crack: 0, t: 0, camoK: 0 };
  function drawExuvia(ctx) {
    if (!exuvia) return;
    const e = exuvia, fade = clamp(1 - (e.t - 50) / 30, 0, 1); if (fade <= 0) return;
    XST.x = e.x; XST.y = e.y; XST.ang = e.ang; XST.r = e.r; XST.stage = e.stage; XST.species = e.species; XST.legK = e.legK; XST.feet = e.feet; XST.abAng = e.abAng * 0.5; XST.alpha = fade * 0.9; XST.t = anim;
    drawSpider(ctx, XST);
  }

  // ---- particles & hints ---------------------------------------------------------------------------------------------------------------------
  function drawParticles(ctx) {
    if (!parts.length) return;
    const k = 2.2 / (Game.camera.zoom || 1);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], a = clamp(p.life / p.max, 0, 1), s = p.size * k;
      if (p.type === 'dust') {
        ctx.fillStyle = U.rgba(p.color, (a * 0.4).toFixed(3)); ctx.beginPath(); ctx.arc(p.x, p.y, s * (1.9 - a), 0, TAU); ctx.fill();
      } else if (p.type === 'spark' || p.type === 'drop') {
        ctx.save(); if (p.type === 'spark') ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = U.rgba(p.color, a.toFixed(3)); ctx.beginPath(); ctx.arc(p.x, p.y, s * (0.5 + a * 0.6), 0, TAU); ctx.fill(); ctx.restore();
      } else if (p.type === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.max * 7 + p.life * 5); ctx.fillStyle = U.rgba(p.color, (a * 0.9).toFixed(3));
        ctx.beginPath(); ctx.moveTo(-s, -s * 0.3); ctx.lineTo(s * 1.2, 0); ctx.lineTo(-s, s * 0.4); ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (p.type === 'heart') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s * 0.9, s * 0.9); ctx.fillStyle = U.rgba(p.color, a.toFixed(3));
        ctx.beginPath(); ctx.moveTo(0, 0.7); ctx.bezierCurveTo(-1.2, -0.1, -0.7, -1, 0, -0.4); ctx.bezierCurveTo(0.7, -1, 1.2, -0.1, 0, 0.7); ctx.fill(); ctx.restore();
      }
    }
  }
  function drawHint(ctx) {
    const h = P.mateHint; if (!h || P.stage < 4 || P.mate.laid || P.dead || h.dist < 140) return;
    const z = Game.camera.zoom || 1, col = h.kind === 'mate' ? '255,170,200' : '255,236,170';
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 5; j++) {
      const ph = ((anim * 0.7 + j * 0.2) % 1), d = (70 + ph * 110) / z * 1.2;
      const al = Math.sin(ph * Math.PI) * 0.55, r = (3.2 - ph * 1.4) / z;
      const x = P.x + h.x * d + Math.sin(anim * 2 + j) * 3 / z, y = P.y + h.y * d + Math.cos(anim * 2.3 + j) * 3 / z;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, 'rgba(' + col + ',' + al.toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---- the player -------------------------------------------------------------------------------------------------------------------------------------
  const ST = { species: 'garden', legK: 1, belly: 0, x: 0, y: 0, ang: 0, r: 5, scale: 1, stage: 0, feet: feet, abAng: 0, softness: 0, flash: 0, alpha: 1, shell: false, camo: 0, carapace: 0, venom: false, deadK: 0, sx: 1, sy: 1, bobLat: 0, lunge: 0, bite: 0, eat: 0, drink: 0, resting: false, dance: false, pulse: 0, silkUp: 0, crack: 0, t: 0, camoK: 0 };
  let sprintK = 0;
  function playerState() {
    const st = ST, R = P.radius, dtv = Math.min(0.05, Game.time.dt || 0.016);
    sprintK += ((P.sprinting ? 1 : 0) - sprintK) * Math.min(1, 10 * dtv);
    let x = P.x, y = P.y, ang = P.angle;
    if (shiver > 0.01) { x += Math.sin(anim * 47) * shiver * R * 0.05; y += Math.sin(anim * 53 + 1) * shiver * R * 0.05; ang += Math.sin(anim * 41) * shiver * 0.04; }
    st.dance = false;
    if (P.courting) {
      const w = Math.sin(courtT * 5);
      x += -Math.sin(ang) * w * R * 0.3; y += Math.cos(ang) * w * R * 0.3; ang += Math.sin(courtT * 5 + 1.2) * 0.2; st.dance = true;
    }
    st.x = x; st.y = y; st.ang = ang; st.r = R; st.stage = P.stage; st.t = anim; st.abAng = abAng;
    st.species = P.species.id; st.legK = P.species.leg || 1; st.belly = bellyK;
    st.camo = P.upgrades.camo || 0; st.carapace = P.upgrades.carapace || 0; st.venom = (P.upgrades.venom || 0) > 0 || P.venomPower > 0;
    st.softness = (P.molting && !swapped) ? 0 : P.soft;
    st.flash = flash; st.alpha = 1; st.shell = false;
    st.deadK = (P.dead || P.reviving) ? Math.min(1, deathT / 1.6) : reviveGlow * 0.7;
    st.sx = 1 + 0.13 * sprintK + (eatT > 0 ? 0.03 * Math.sin(anim * 30) : 0); st.sy = 1 - 0.07 * sprintK;
    st.scale = 1 - 0.07 * Math.min(1, curl);
    st.bobLat = Math.sin(gaitPhase) * 0.035 * clamp(Math.hypot(P.vx, P.vy) / 80, 0, 1) + bodyBob * 0.5;
    st.lunge = bitePhase * bitePhase * 0.32;
    st.bite = bitePhase; st.eat = eatT; st.drink = drinkT; st.resting = P.resting;
    st.pulse = P.laying ? 0.04 * Math.sin(anim * 6) : 0; st.silkUp = spinT > 0 ? 1 : 0;
    st.crack = (P.molting && !swapped) ? clamp((moltT / MOLT_T - 0.2) / 0.3, 0, 1) : 0;
    if (P.hatching) {
      const u = clamp(hatchT / HATCH_T, 0, 1);
      st.scale *= 0.55 + 0.45 * smooth(clamp((u - 0.2) / 0.6, 0, 1));
      st.alpha = 0.4 + 0.6 * smooth(clamp((u - 0.25) / 0.45, 0, 1));
    }
    return st;
  }

  // warm light around the spider as it gets back up (and a faint pulse while it is down waiting for the gift)
  function drawReviveAura(ctx) {
    const a = P.reviving ? 0.18 + 0.08 * Math.sin(anim * 7) : reviveGlow; if (a <= 0.01) return;
    const r = P.radius * (P.reviving ? 3.2 : 3.2 + (1 - reviveGlow) * 4), g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, r);
    g.addColorStop(0, 'rgba(255,240,190,' + (0.6 * a) + ')'); g.addColorStop(0.5, 'rgba(255,205,110,' + (0.28 * a) + ')'); g.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, TAU); ctx.fill(); ctx.restore();
  }

  // sticky silk clinging to the spider (P.slow): pale strands crossing the body, fading as the slow runs out
  function drawTangle(ctx) {
    if (!(P.tangleT > 0) || P.dead) return;
    const a = clamp(P.tangleT / 0.5, 0, 1), R = P.radius * VS;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(244,247,255,' + (0.75 * a).toFixed(3) + ')'; ctx.lineWidth = Math.max(0.3, R * 0.05);
    ctx.beginPath();
    for (let j = 0; j < 7; j++) {
      const a0 = hash(j, 61) * TAU + Math.sin(anim * 4 + j) * 0.05, a1 = a0 + 2.1 + hash(j, 62) * 1.4;
      ctx.moveTo(P.x + Math.cos(a0) * R * 2.1, P.y + Math.sin(a0) * R * 2.1);
      ctx.quadraticCurveTo(P.x + Math.cos((a0 + a1) / 2) * R * 0.3, P.y + Math.sin((a0 + a1) / 2) * R * 0.3, P.x + Math.cos(a1) * R * 2.1, P.y + Math.sin(a1) * R * 2.1);
    }
    ctx.stroke(); ctx.restore();
  }

  // ---- portraits (species roster in the Codex) ------------------------------------------------------------------------------------
  // P.drawPortrait(ctx, speciesId, cx, cy, size, {stage=4, angle=-0.55, silhouette, silColor, alpha, belly=0, t}) draws that spider as it looks in play,
  // centred on (cx, cy) and fitted into a size x size box. `silhouette` fills it with one flat colour (a species that is still locked).
  const PST = { species: 'garden', legK: 1, belly: 0, x: 0, y: 0, ang: 0, r: 5, scale: 1, stage: 4, feet: [], abAng: 0, softness: 0, flash: 0, alpha: 1, shell: false, camo: 0, carapace: 0, venom: false, deadK: 0, sx: 1, sy: 1, bobLat: 0, lunge: 0, bite: 0, eat: 0, drink: 0, resting: false, dance: false, pulse: 0, silkUp: 0, crack: 0, t: 0, camoK: 0 };
  for (let i = 0; i < 8; i++) PST.feet.push({ x: 0, y: 0, lift: 0 });
  let silCv = null;
  function portraitInto(g, sp, cx, cy, size, o) {
    const stage = o.stage != null ? o.stage : 4, ang = o.angle != null ? o.angle : -0.55, r = size / (6 * VS), R = r * VS, c = Math.cos(ang), sn = Math.sin(ang);
    for (let i = 0; i < 8; i++) {   // feet at their relaxed positions (same layout as homeOf)
      const k = i >> 1, s = (i & 1) ? 1 : -1, a = LEG_ANG[k], att = LEG_ATT[k], len = LEG_LEN[k] * 0.86 * (sp.leg || 1);
      const lx = att[0] + Math.cos(a) * len, ly = s * (att[1] + Math.sin(a) * len), f = PST.feet[i];
      f.x = cx + (lx * c - ly * sn) * R; f.y = cy + (lx * sn + ly * c) * R; f.lift = 0;
    }
    PST.species = sp.id; PST.legK = sp.leg || 1; PST.belly = o.belly || 0; PST.stage = stage; PST.x = cx; PST.y = cy; PST.ang = ang; PST.r = r;
    PST.alpha = 1; PST.t = o.t != null ? o.t : Game.time.real; PST.carapace = stage >= 3 ? 1 : 0; PST.venom = !!(sp.mods && sp.mods.venom);
    drawSpider(g, PST);
  }
  P.drawPortrait = function (ctx, speciesId, cx, cy, size, o) {
    o = o || {}; if (!ctx) return;
    const sp = Game.speciesInfo(speciesId);
    if (o.silhouette) {
      const px = Math.max(64, Math.ceil(size * 2));
      try {
        if (!silCv || silCv.width < px) silCv = U.makeCanvas(px, px);
        const g = silCv && silCv.getContext('2d');
        if (g) {
          g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, px, px); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
          portraitInto(g, sp, px / 2, px / 2, px, o);
          g.globalCompositeOperation = 'source-in'; g.fillStyle = o.silColor || '#0d0b09'; g.fillRect(0, 0, px, px); g.globalCompositeOperation = 'source-over';
          ctx.save(); if (o.alpha != null) ctx.globalAlpha = o.alpha; ctx.drawImage(silCv, 0, 0, px, px, cx - size / 2, cy - size / 2, size, size); ctx.restore();
          return;
        }
      } catch (e) { /* fall through to a plain draw */ }
    }
    ctx.save(); if (o.alpha != null) ctx.globalAlpha = o.alpha;
    portraitInto(ctx, sp, cx, cy, size, o);
    ctx.restore();
  };

  function drawAll(ctx) {
    const sc = Game.state.scene; if (sc === 'boot') return;
    drawSac(ctx);
    drawEggSac(ctx);
    drawExuvia(ctx);
    drawTrail(ctx);
    drawReviveAura(ctx);
    drawSpider(ctx, playerState());
    drawTangle(ctx);
    drawSacFront(ctx);
    drawParticles(ctx);
    drawHint(ctx);
  }

  Game.register('player', P);
  try { P.reset(); } catch (e) { Game.reportError('player.reset(load)', e); }
})();
