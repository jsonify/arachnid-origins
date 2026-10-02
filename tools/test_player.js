/* Test + screenshot script for src/player.js (Agent C).
 *   node tools/test_player.js [shots|numeric|all]
 * Loads real world/webs/creatures/edu/ui when present (unless STUB=1), otherwise tiny stubs that follow ARCHITECTURE.md.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));
const SRC = path.join(__dirname, '..', 'src'), SHOTS = path.join(__dirname, 'shots');
const FORCE = !!process.env.STUB;

const STUB_WORLD = `
(function(){ const G=Game, U=G.util, C=G.C;
 const w={priority:10,width:C.WORLD_W,height:C.WORLD_H,time01:0.3,dayCount:0,light:1,phase:'day',
  weather:{type:'clear',intensity:0,windX:0,windY:0},
  obstacles:[{x:420,y:1800,r:40,type:'rock'}], resources:[{id:1,type:'dew',x:300,y:1860,r:5,amount:40,max:40,regen:0},{id:2,type:'nectar',x:5000,y:1000,r:5,amount:30,max:30,regen:0}],
  shelters:[{id:1,type:'leaf',x:240,y:1780,r:30,safety:0.9,eggSite:false},{id:2,type:'hollow',x:700,y:1900,r:36,safety:0.9,eggSite:true}], anchors:[],
  expo:1, isNight(){return this.phase==='night'}, zoneAt(){return C.ZONES[0]},
  exposure(x,y){ return this.shelterAt(x,y)?0:this.expo; },
  resolve(x,y,r){ x=U.clamp(x,r,C.WORLD_W-r); y=U.clamp(y,r,C.WORLD_H-r); for(const o of this.obstacles){ const dx=x-o.x,dy=y-o.y,d=Math.hypot(dx,dy),m=o.r+r; if(d<m){ const k=d>0.001?m/d:1; x=o.x+(d>0.001?dx*k:m); y=o.y+(d>0.001?dy*k:0);} } return {x,y}; },
  shelterAt(x,y){ for(const s of this.shelters) if(Math.hypot(s.x-x,s.y-y)<s.r) return s; return null; },
  nearestResource(x,y,type,m){ let b=null,bd=1e9; for(const r of this.resources){ if(type&&r.type!==type||r.amount<=0)continue; const d=Math.hypot(r.x-x,r.y-y)-r.r; if(d<=m&&d<bd){bd=d;b=r;} } return b; },
  consumeResource(r,a){ const t=Math.min(a,r.amount); r.amount-=t; return t; },
  nearestAnchor(){return null}, reset(){ this.resources.forEach(r=>r.amount=r.max); },
  init(){ G.addDrawer(G.LAYER.BACKGROUND,(ctx)=>{ const v=G.camera.view; const cols=this.bg||['#5a4327','#6b5232','#4a3820'];
    ctx.fillStyle=cols[0]; ctx.fillRect(v.x0,v.y0,v.x1-v.x0,v.y1-v.y0); const r=U.mulberry32(9);
    for(let i=0;i<600;i++){ const x=Math.floor(v.x0/40)*40+(i%30)*40+r()*30, y=Math.floor(v.y0/40)*40+Math.floor(i/30)*40+r()*30; ctx.fillStyle=cols[1+(i&1)]; ctx.beginPath(); ctx.ellipse(x,y,14+r()*10,6+r()*6,r()*3,0,6.28); ctx.fill(); }
    for(const o of this.obstacles){ ctx.fillStyle='#6b6b66'; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,6.28); ctx.fill(); }
    for(const s of this.shelters){ ctx.fillStyle='rgba(20,40,20,0.35)'; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,6.28); ctx.fill(); }
    for(const q of this.resources){ if(q.amount>0){ ctx.fillStyle=q.type==='dew'?'rgba(180,230,255,0.85)':'rgba(255,200,80,0.85)'; ctx.beginPath(); ctx.arc(q.x,q.y,q.r,0,6.28); ctx.fill(); } } }); } };
 G.register('world', w); })();`;
const STUB_WEBS = `
(function(){ const G=Game; const w={priority:20,list:[],selected:null,speedBonusAt(){return 1},isSheltered(){return false},reset(){}}; G.register('webs',w); })();`;
const STUB_CREATURES = `
(function(){ const G=Game, C=G.C;
 const c={priority:40,list:[],mate:null,KINDS:{springtail:{value:{hunger:10,growth:12}}},
  spawn(kind,x,y,o){ const cr=Object.assign({id:c.list.length+1,kind,x,y,vx:0,vy:0,angle:0,radius:3,hp:2,maxHp:2,state:'wander',role:'prey'},o||{}); c.list.push(cr); return cr; },
  nearest(x,y,f,m){ let b=null,bd=m; for(const k of c.list){ if(f&&!f(k))continue; const d=Math.hypot(k.x-x,k.y-y); if(d<=bd){bd=d;b=k;} } return b; },
  attackAt(x,y,r,dmg,by){ const res={killed:[],hit:[]}; for(const k of c.list){ if(k.state==='dead')continue; if(Math.hypot(k.x-x,k.y-y)<r+k.radius){ k.hp-=dmg; res.hit.push(k); if(k.hp<=0){ k.state='dead'; res.killed.push(k); const v=(c.KINDS[k.kind]||{value:{hunger:8,growth:10}}).value; G.player.feed(v.hunger,v.growth,k.kind); } } } return res; },
  spawnMate(){ const P=G.player; c.mate=c.spawn('mate_spider',P.x+400,P.y+120,{role:'spider',radius:18,hp:50,maxHp:50}); return c.mate; },
  reset(){ c.list.length=0; c.mate=null; } };
 G.register('creatures', c); })();`;

let canvas = null, Game = null;
const used = {};
function load() {
  canvas = createCanvas(1280, 720);
  const store = {};
  const sandbox = {
    console, Math, Date, JSON, Object, Array, Set, Map, WeakMap, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Number, String, Boolean, Symbol, Error, RegExp, Promise, parseInt, parseFloat, isNaN, isFinite,
    setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { createElement: (t) => (t === 'canvas' ? createCanvas(300, 150) : {}), getElementById: () => canvas, readyState: 'complete' },
    requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  const file = (n) => path.join(SRC, n + '.js');
  const real = (n) => !FORCE && fs.existsSync(file(n));
  run(fs.readFileSync(file('core'), 'utf8'), 'core.js');
  const stubOr = (n, stub) => { if (real(n)) { run(fs.readFileSync(file(n), 'utf8'), n + '.js'); used[n] = 'real'; } else { run(stub, n + '-stub'); used[n] = 'stub'; } };
  stubOr('world', STUB_WORLD); stubOr('webs', STUB_WEBS);
  run(fs.readFileSync(file('player'), 'utf8'), 'player.js'); used.player = 'real';
  stubOr('creatures', STUB_CREATURES);
  ['edu', 'audio', 'ui'].forEach(n => { if (real(n)) { try { run(fs.readFileSync(file(n), 'utf8'), n + '.js'); used[n] = 'real'; } catch (e) { console.log('load error', n, e.message); } } });
  Game = sandbox.Game; Game.boot(canvas);
  return Game;
}
function run(sec, o) {
  o = o || {}; const n = Math.round(sec * 60);
  (o.keys || []).forEach(k => Game.input.inject.keyDown(k));
  for (let i = 0; i < n; i++) { if (o.onFrame) o.onFrame(i); Game.step(1 / 60); }
  (o.keys || []).forEach(k => Game.input.inject.keyUp(k));
}
function tap(code) { Game.input.inject.keyDown(code); Game.step(1 / 60); Game.input.inject.keyUp(code); Game.step(1 / 60); }
function shot(name, o) {
  o = o || {};
  if (o.zoom) { Game.camera.targetZoom = o.zoom; Game.camera.zoom = o.zoom; }
  Game.camera.x = Game.player.x; Game.camera.y = Game.player.y;
  Game.step(1 / 600);
  Game.render(); fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, 'player_' + name + '.png'); fs.writeFileSync(f, canvas.toBuffer('image/png')); return f;
}
// crop a centered region and upscale for close inspection
function shotCrop(name, w, h) {
  Game.render();
  const c2 = createCanvas(w * 2, h * 2), x2 = c2.getContext('2d'); x2.imageSmoothingEnabled = true;
  x2.drawImage(canvas, 640 - w / 2, 360 - h / 2, w, h, 0, 0, w * 2, h * 2);
  fs.writeFileSync(path.join(SHOTS, 'player_' + name + '.png'), c2.toBuffer('image/png'));
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('  FAIL:', msg); } else console.log('  ok  :', msg); }
function finite(P) { return ['x', 'y', 'vx', 'vy', 'hp', 'hunger', 'hydration', 'energy', 'silk', 'radius', 'angle'].every(k => isFinite(P[k])); }

module.exports = { load, run, tap, shot, shotCrop, assert, finite, get Game() { return Game; }, get canvas() { return canvas; }, used, get fails() { return fails; } };

const T = module.exports;
const CASES = {};
// ---- cases (appended below) ----
CASES.smoke = function () {
  const P = Game.player;
  Game.camera.snap(); T.run(0.3);
  T.shotCrop('hatch0', 320, 200);
  T.run(1.0); T.shotCrop('hatch1', 320, 200);
  T.run(1.0); T.shotCrop('hatch2', 320, 200);
  T.run(1.5);
  for (let s = 0; s < 5; s++) {
    P.debugSetStage(s); P.invuln = 0;
    T.run(0.5);
    T.shot('stage' + s, { zoom: C().STAGES[s].zoom }); T.shotCrop('stage' + s + '_crop', 320, 200);
    T.run(0.8, { keys: ['KeyD'] });
    T.shot('stage' + s + '_walk', { zoom: C().STAGES[s].zoom }); T.shotCrop('stage' + s + '_walkcrop', 320, 200);
  }
};
function C() { return Game.C; }


CASES.numeric = function () {
  const P = Game.player, W = Game.world;
  // hatch lock & invulnerability
  T.assert(P.hatching && P.invuln > 0, 'starts hatching with invuln');
  T.assert(P.damage(5, 'wasp') === 0, 'no damage during spawn invuln');
  T.run(3.2); T.assert(!P.hatching, 'hatch done');
  // survive without help (hatchling), then die
  P.invuln = 0; let t = 0, deadAt = -1, hp0 = P.hp;
  const log = [];
  while (t < 400 && !P.dead) { T.run(1); t++; if (t % 30 === 0) log.push(t + 's hp=' + P.hp.toFixed(1) + ' hu=' + P.hunger.toFixed(0) + ' hy=' + P.hydration.toFixed(0)); }
  console.log('  ' + log.join(' | ')); console.log('  died at', t, 's cause', P.deathCause);
  T.assert(P.dead && t > 110 && t < 260, 'hatchling survives ~2+ min unaided but not forever (' + t + 's)');
  T.assert(T.finite(P), 'no NaN');
};
CASES.meters = function () {
  const P = Game.player, W = Game.world; P.debugSetStage(0); P.invuln = 0; P.x = 1500; P.y = 1500; Game.camera.snap();
  // sprint drains energy, stops at exhaustion
  T.run(0.2); const e0 = P.energy; T.run(3, { keys: ['KeyD', 'ShiftLeft'] });
  console.log('  energy after 3s sprint', P.energy.toFixed(1), 'speed', Math.hypot(P.vx, P.vy).toFixed(0), 'label', P.stateLabel);
  T.assert(P.energy < e0 - 15, 'sprint drains energy');
  P.x = 1500; T.run(8, { keys: ['KeyA', 'ShiftLeft'] }); P.hunger = 90; T.run(5.0, { keys: ['KeyD', 'ShiftLeft'] }); T.assert(P.energy <= 1 || P.exhausted, 'exhaustion reached: ' + P.energy.toFixed(1));
  const spEx = Math.hypot(P.vx, P.vy); console.log('  exhausted speed', spEx.toFixed(0)); T.assert(spEx < P.stageInfo.speed, 'exhausted slower than walk speed');
  // rest regen: normal vs sheltered
  P.x = 1500; P.y = 1500; P.energy = 10; P.hp = P.maxHp * 0.5; P.hunger = 90; P.hydration = 90; T.run(0.2); T.tap('KeyR'); T.assert(P.resting, 'resting on');
  T.run(3); const eOpen = P.energy, hpOpen = P.hp; console.log('  rest open: energy', eOpen.toFixed(1), 'hp', hpOpen.toFixed(2));
  Game.input.inject.keyDown('KeyD'); T.run(0.1); Game.input.inject.keyUp('KeyD'); T.assert(!P.resting, 'movement cancels rest');
  // sheltered rest
  const sh = W.shelters[0]; P.x = sh.x; P.y = sh.y; P.energy = 10; P.hp = P.maxHp * 0.5; T.run(0.2); T.tap('KeyR'); T.run(3);
  console.log('  rest sheltered: energy', P.energy.toFixed(1), 'hp', P.hp.toFixed(2), 'hidden', P.hidden);
  T.assert(P.energy - 10 > (eOpen - 10) * 2, 'sheltered rest regen is ~3x'); T.assert(P.hidden, 'hidden in shelter');
  // drinking
  P.resting = false; const dew = W.resources.find(r => r.type === 'dew'); P.x = dew.x - 6; P.y = dew.y; P.hydration = 20; T.run(0.2);
  const a0 = dew.amount; let drank = 0; Game.on('player:drank', d => { drank += d.amount; });
  Game.input.inject.keyDown('KeyE'); T.run(1.5); Game.input.inject.keyUp('KeyE');
  console.log('  dew', a0, '->', dew.amount.toFixed(1), 'hydration', P.hydration.toFixed(1), 'drank evt', drank.toFixed(1), 'hint', P.interactHint);
  T.assert(P.hydration > 30 && dew.amount < a0, 'drinking dew works');
  // enter / exit shelter
  P.x = W.shelters[0].x + 20; P.y = W.shelters[0].y; T.run(0.2); T.tap('KeyE'); T.run(1); T.assert(!!P.inShelter, 'entered shelter');
  T.tap('KeyE'); T.run(0.2); T.assert(!P.inShelter, 'exited shelter');
  // rain damage only if exposed
  P.x = 1500; P.y = 1500; W.weather.type = 'rain'; W.weather.intensity = 1; W.expo = 1; P.hp = P.maxHp; T.run(5);
  console.log('  rain 5s hp', P.hp.toFixed(2)); T.assert(P.hp < P.maxHp - 0.5, 'rain hurts exposed hatchling');
  W.expo = 0.0; P.hp = P.maxHp; if (T.used.world === 'stub') { T.run(5); T.assert(P.hp >= P.maxHp - 0.01, 'no rain damage when covered'); } W.weather.type = 'clear';
  // invuln / damage multipliers
  P.debugSetStage(2); P.invuln = 0; P.moltTimer = 5; const h = P.hp; const dd = P.damage(10, 'ant'); T.assert(Math.abs(dd - 20) < 1e-6, 'soft period doubles damage (' + dd + ')');
  P.moltTimer = 0; P.upgrades.carapace = 2; P.applyUpgrades(true); const d2 = P.damage(10, 'ant'); T.assert(Math.abs(d2 - 8.1) < 1e-6, 'carapace reduces damage (' + d2 + ')');
  T.assert(T.finite(P), 'no NaN');
};
CASES.progress = function () {
  const P = Game.player; T.run(3.2); P.invuln = 0;
  const stages = [];
  Game.on('stage:change', d => stages.push(d.stage));
  for (let s = 0; s < 4; s++) {
    P.hunger = 100; P.hydration = 100; P.hp = P.maxHp;
    P.addGrowth(P.growthNeeded + 1); T.assert(Game.state.scene === 'molting', 'stage ' + s + ' molt scene');
    const offers = P.offers.slice(); T.assert(offers.length === 3 && new Set(offers).size === 3, 'distinct offers');
    P.chooseUpgrade(offers[1]); T.run(6.2 + 12.5);
    T.assert(P.stage === s + 1 && !P.molting && P.moltTimer === 0, 'reached stage ' + (s + 1));
    for (let i = 0; i < 400; i++) T.run(0.05); // settle radius
    T.assert(Math.abs(P.radius - Game.C.STAGES[s + 1].radius) < 0.2, 'radius scaled ' + P.radius.toFixed(2));
    T.assert(P.maxSilk >= Game.C.STAGES[s + 1].maxSilk, 'maxSilk updated');
  }
  T.assert(stages.join() === '1,2,3,4', 'stage events ' + stages.join());
  T.assert(P.growthNeeded === 0, 'adult growthNeeded 0');
  const sum = C().UPGRADES.reduce((a, u) => a + P.upgrades[u.id], 0); T.assert(sum === 4, 'four upgrades chosen');
  P.addGrowth(50); T.assert(Game.state.scene === 'playing', 'adult never molts');
  T.assert(!!Game.creatures.mate, 'mate spawned');
  T.assert(T.finite(P), 'no NaN');
};
CASES.upgrades = function () {
  const P = Game.player; P.debugSetStage(1); const base = { hp: P.maxHp, silk: P.maxSilk };
  Game.C.UPGRADES.forEach(u => { P.upgrades[u.id] = 2; }); P.applyUpgrades(true);
  console.log('  speedMul', P.speedMul, 'stealth', P.stealth, 'biteMul', P.biteMul, 'dmgTaken', P.damageTaken, 'sense', P.senseRadius, 'drain', P.drainMul.toFixed(3), 'maxHp', P.maxHp, 'maxSilk', P.maxSilk);
  T.assert(Math.abs(P.speedMul - 1.16) < 1e-9 && Math.abs(P.stealth - 0.6) < 1e-9 && Math.abs(P.biteMul - 1.5) < 1e-9 && Math.abs(P.maxHp - base.hp * 1.4) < 1e-6 && Math.abs(P.maxSilk - base.silk * 1.5) < 1e-6, 'upgrade effects');
  P.upgrades.camo = 3; P.applyUpgrades(true); T.assert(P.stealth >= 0.3 && Math.abs(P.stealth - 0.4) < 1e-9, 'stealth clamp');
  Game.C.UPGRADES.forEach(u => { P.upgrades[u.id] = u.max; }); T.assert(P.offerUpgrades().length === 0, 'no offers when all maxed');
};
CASES.biting = function () {
  const P = Game.player; P.debugSetStage(1); P.invuln = 0; P.x = 1500; P.y = 1500; P.angle = 0; Game.camera.snap(); T.run(0.2);
  const cr = Game.creatures; const st = cr.spawn('springtail', P.x + P.radius * 2.2, P.y, { radius: 3, hp: 4, state: 'wander' });
  let ate = 0; Game.on('player:ate', () => { ate++; });
  Game.input.inject.keyDown('KeyJ'); let n = 0; for (let i = 0; i < 120 && st.state !== 'dead'; i++) { T.run(1 / 60); n++; } Game.input.inject.keyUp('KeyJ');
  console.log('  frames to kill', n, 'bites', Game.state.stats.bites);
  T.assert(st.state === 'dead' && ate === 1 && P.growth > 0, 'bite kills and feeds, growth ' + P.growth);
  const bites = Game.state.stats.bites; Game.input.inject.keyDown('KeyJ'); T.run(1); Game.input.inject.keyUp('KeyJ');
  const per = Game.state.stats.bites - bites; console.log('  bites/s', per); T.assert(per >= 1 && per <= 3, 'bite cooldown limits rate');
  // trapped bonus
  const a = cr.spawn('beetle', P.x + P.radius * 2, P.y, { radius: 3, hp: 100 }), b = cr.spawn('beetle', P.x, P.y + P.radius * 3.6, { radius: 3, hp: 100 });
  a.state = 'stuck'; P.angle = 0; T.run(0.7); Game.input.inject.keyDown('KeyJ'); T.run(0.1); Game.input.inject.keyUp('KeyJ');
  console.log('  stuck hp', a.hp, 'free hp', b.hp); T.assert(a.hp < 100 - P.stageInfo.bite * 1.5, 'trapped creature takes bonus damage');
};
CASES.stress = function () {
  const P = Game.player; let bad = 0;
  P.debugSetStage(3); P.invuln = 0;
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyJ', 'KeyE', 'KeyR', 'Space'];
  for (let i = 0; i < 3000; i++) {
    if (i % 17 === 0) { const k = keys[Math.floor(Math.random() * keys.length)]; Game.input.inject.keyDown(k); if (Math.random() < 0.6) setTimeout(() => {}, 0); }
    if (i % 23 === 0) Game.input.inject.clear();
    Game.step(1 / 60); if (!T.finite(P)) bad++;
    if (P.dead) { Game.newGame(); P.debugSetStage(3); P.invuln = 0; }
  }
  T.assert(bad === 0, 'no NaN under random input'); Game.input.inject.clear();
  // extreme dt
  Game.step(5); Game.step(0); T.assert(T.finite(P), 'extreme dt ok');
};

CASES.poses = function () {
  const P = Game.player; P.debugSetStage(2); P.invuln = 0; P.x = 1500; P.y = 1500; const z = C().STAGES[2].zoom;
  Game.camera.snap(); T.run(0.3);
  T.run(1.2, { keys: ['KeyD', 'ShiftLeft'] }); T.shotCrop('pose_sprint', 360, 220);
  T.run(0.5); T.tap('KeyR'); T.run(1.2); T.shotCrop('pose_rest', 360, 220);
  console.log('  rest state', P.resting, P.stateLabel);
  T.tap('KeyR'); P.hp = 10; P.damage(5, 'wasp'); T.shotCrop('pose_hurt', 360, 220);
  T.run(1);
  const cr = Game.creatures;
  cr.spawn('springtail', P.x + P.radius * 2.5, P.y, { radius: 3, hp: 99 });
  Game.input.inject.keyDown('KeyJ'); T.run(0.12); T.shotCrop('pose_bite', 360, 220); Game.input.inject.keyUp('KeyJ');
  P.stage === 2 && (P.upgrades.camo = 3, P.upgrades.carapace = 2, P.upgrades.venom = 1);
  T.run(0.5); T.shotCrop('pose_camo', 360, 220);
};
CASES.molt = function () {
  const P = Game.player; P.debugSetStage(1); P.invuln = 0; T.run(0.5);
  console.log('  growth', P.growth, '/', P.growthNeeded);
  let started = 0, chosen = 0, ended = 0, stageChanged = 0;
  Game.on('molt:start', d => { started++; console.log('  molt:start', JSON.stringify(d)); });
  Game.on('molt:choose', d => { chosen++; console.log('  molt:choose', JSON.stringify(d)); });
  Game.on('molt:end', d => { ended++; });
  Game.on('stage:change', d => { stageChanged++; console.log('  stage:change', JSON.stringify(d)); });
  P.addGrowth(P.growthNeeded + 5);
  T.assert(Game.state.scene === 'molting' || Game.state.scene === 'playing', 'scene molting after growth (or auto)');
  T.assert(P.molting && P.moltPhase === 'choose', 'molt choose phase');
  const offers = P.offerUpgrades(); T.assert(offers.length === 3, 'offers 3 upgrades');
  T.shotCrop('molt_choose', 360, 220);
  T.assert(P.chooseUpgrade(P.offers[0]), 'chooseUpgrade ok');
  T.assert(Game.state.scene === 'playing', 'back to playing for animation');
  const times = [0.8, 1.4, 1.9, 2.5, 3.2, 3.8, 4.4, 5.2];
  let t0 = 0;
  times.forEach((t, i) => { T.run(t - t0); t0 = t; T.shotCrop('molt_' + i, 360, 240); });
  T.run(1.2); T.assert(!P.molting && P.moltTimer > 0, 'molt finished, soft period active');
  T.shotCrop('molt_soft', 360, 240);
  T.run(6); T.shotCrop('molt_hardening', 360, 240);
  T.run(7);
  T.assert(P.stage === 2 && started === 1 && chosen === 1 && ended === 1 && stageChanged === 1, 'molt events once each; stage 2');
  T.assert(P.moltTimer === 0, 'moltTimer expired');
  T.assert(Math.abs(Game.camera.targetZoom - C().STAGES[2].zoom) < 1e-6, 'camera targetZoom');
};
CASES.death = function () {
  const P = Game.player; P.debugSetStage(2); P.invuln = 0; T.run(0.5);
  let died = null; Game.on('player:died', d => { died = d; });
  P.damage(1000, 'wasp'); T.assert(P.dead && P.deathCause === 'eaten' && died && died.cause === 'eaten', 'died eaten');
  T.run(0.5); T.shotCrop('death_0', 360, 220); T.run(1.0); T.shotCrop('death_1', 360, 220);
  T.run(1.5); T.assert(Game.state.scene === 'gameover', 'gameover scene');
};
CASES.court = function () {
  const P = Game.player; P.debugSetStage(4); P.invuln = 0; P.hunger = 80; T.run(0.5);
  const m = Game.creatures.mate; T.assert(!!m, 'mate spawned on reaching adult');
  console.log('  hint', JSON.stringify(P.mateHint));
  m.x = P.x + 60; m.y = P.y + 10; T.run(0.3);
  console.log('  interactHint', P.interactHint);
  let done = 0; Game.on('courtship:done', () => { done++; });
  T.tap('KeyE'); T.assert(P.courting, 'courting started'); Game.camera.lerp = 60; T.run(1.2); Game.camera.snap(); T.shotCrop('court_0', 400, 240); T.run(0.35); Game.camera.snap(); T.shotCrop('court_1', 400, 240);
  T.run(3.5); T.assert(done === 1 && P.mate.courted, 'courtship done');
  const site = Game.world.shelters.find(s => s.eggSite) || Game.world.shelters[0];
  P.x = site.x; P.y = site.y; Game.camera.snap(); T.run(0.3);
  console.log('  hint2', JSON.stringify(P.mateHint), P.interactHint);
  let won = 0; Game.on('game:victory', () => { won++; });
  T.tap('KeyE'); T.assert(P.laying, 'laying started'); T.run(1.5); T.shotCrop('lay_0', 400, 240); T.run(1.5); T.shotCrop('lay_1', 400, 240);
  T.run(1.5); T.assert(won === 1 && Game.state.scene === 'victory' && P.mate.laid, 'victory');
  T.shotCrop('lay_end', 400, 240);
};



if (require.main === module) {
  const mode = process.argv[2] || 'all';
  load(); console.log('modules:', JSON.stringify(used));
  const names = mode === 'all' ? Object.keys(CASES) : mode.split(',');
  names.forEach(n => { if (!CASES[n]) { console.log('no case', n); return; } console.log('== ' + n); Game.newGame(); CASES[n](); });
  console.log('errors:', Game.errors.length); Game.errors.slice(0, 8).forEach(e => console.log(' -', e.where, e.message, (e.stack || '').split('\n')[1]));
  console.log(fails ? 'FAILED ' + fails : 'ALL OK');
  process.exit(fails || Game.errors.length ? 1 : 0);
}
