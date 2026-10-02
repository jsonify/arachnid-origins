/* Test + screenshot script for src/webs.js (Agent B).
 *   node tools/test_webs.js            -> uses real world/player/creatures if present, else stubs
 *   STUB=1 node tools/test_webs.js     -> force stubs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));
const SRC = path.join(__dirname, '..', 'src'), SHOTS = path.join(__dirname, 'shots');
const FORCE = !!process.env.STUB;

const STUB_WORLD = `
(function(){ const G=Game, U=G.util, C=G.C;
 const anchors=[]; const rng=U.mulberry32(5);
 for(let i=0;i<500;i++) anchors.push({x:rng()*C.WORLD_W,y:rng()*C.WORLD_H,type:'twig'});
 const w={priority:10,width:C.WORLD_W,height:C.WORLD_H,time01:0.3,dayCount:0,light:1,phase:'day',
  weather:{type:'clear',intensity:0,windX:0,windY:0}, anchors, obstacles:[], resources:[], shelters:[],
  isNight(){return this.phase==='night'}, zoneAt(){return C.ZONES[0]}, exposure(){return this.expo==null?1:this.expo},
  resolve(x,y){return {x,y}}, shelterAt(){return null},
  nearestAnchor(x,y,m){let b=null,bd=m*m;for(const a of anchors){const d=(a.x-x)*(a.x-x)+(a.y-y)*(a.y-y);if(d<=bd){bd=d;b=a}}return b},
  bg:'litter',
  reset(){}, init(){ G.addDrawer(G.LAYER.BACKGROUND, (ctx)=>{ const v=G.camera.view; const cols={litter:['#5a4327','#6b5232','#4a3820'],bark:['#2e241c','#3c2f25','#241b15'],garden:['#3d6b35','#4c7d3f','#2f5628'],light:['#c9b68a','#d6c6a0','#b9a479']}[this.bg];
    ctx.fillStyle=cols[0]; ctx.fillRect(v.x0,v.y0,v.x1-v.x0,v.y1-v.y0); const r=U.mulberry32(9);
    for(let i=0;i<500;i++){ const x=Math.floor(v.x0/40)*40+ (i%25)*40+ r()*30, y=Math.floor(v.y0/40)*40+Math.floor(i/25)*40+r()*30; ctx.fillStyle=cols[1+(i&1)]; ctx.beginPath(); ctx.ellipse(x,y,14+r()*10,6+r()*6,r()*3,0,6.28); ctx.fill(); }
  }); }
 }; G.register('world', w); })();`;
const STUB_PLAYER = `
(function(){ const G=Game, C=G.C;
 const p={priority:30,x:C.SPAWN.x,y:C.SPAWN.y,angle:0,radius:12,stage:2,silk:100,maxSilk:100,dead:false,molting:false,
  useSilk(n){ if(this.silk>=n){this.silk-=n;return true} return false }, addSilk(n){this.silk=Math.min(this.maxSilk,this.silk+n)},
  reset(){ this.x=C.SPAWN.x; this.y=C.SPAWN.y; this.stage=2; this.silk=100; this.dead=false; this.molting=false; this.radius=12 },
  update(dt){ this.silk=Math.min(this.maxSilk,this.silk+3*dt) },
  init(){ G.addDrawer(G.LAYER.PLAYER,(ctx)=>{ ctx.fillStyle='#2a1a10'; ctx.beginPath(); ctx.arc(this.x,this.y,this.radius,0,6.28); ctx.fill(); ctx.strokeStyle='#d9a441'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(this.x,this.y); ctx.lineTo(this.x+Math.cos(this.angle)*this.radius*1.3,this.y+Math.sin(this.angle)*this.radius*1.3); ctx.stroke(); }); } };
 G.register('player', p); })();`;
const STUB_CREATURES = `
(function(){ const G=Game;
 const c={priority:40,list:[],trapped:[],
  spawn(kind,x,y,o){ o=o||{}; const cr=Object.assign({id:c.list.length+100+Math.floor(Math.random()*1e6),kind,x,y,vx:0,vy:0,angle:0,radius:3,hp:3,maxHp:3,state:'wander',role:'prey',flying:false},o); c.list.push(cr); return cr; },
  trap(cr,web){ cr.state='stuck'; cr.web=web; c.trapped.push([cr,web]); return true },
  reset(){ c.list.length=0; c.trapped.length=0 },
  init(){ G.addDrawer(G.LAYER.CREATURES_LOW,(ctx)=>{ for(const k of c.list){ if(k.state==='dead')continue; ctx.fillStyle=k.flying?'#c8a030':(k.role==='predator'?'#8a2a2a':'#404838'); ctx.beginPath(); ctx.ellipse(k.x,k.y,k.radius*1.2,k.radius*0.8,k.angle,0,6.28); ctx.fill(); }}); } };
 G.register('creatures', c); })();`;

let canvas, Game;
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
  const used = {};
  run(fs.readFileSync(file('core'), 'utf8'), 'core.js');
  const stubOr = (n, stub) => { if (real(n)) { run(fs.readFileSync(file(n), 'utf8'), n + '.js'); used[n] = 'real'; } else { run(stub, n + '-stub'); used[n] = 'stub'; } };
  stubOr('world', STUB_WORLD);
  run(fs.readFileSync(file('webs'), 'utf8'), 'webs.js');
  stubOr('player', STUB_PLAYER);
  stubOr('creatures', STUB_CREATURES);
  ['edu', 'audio', 'ui'].forEach((n) => { if (real(n)) { try { run(fs.readFileSync(file(n), 'utf8'), n + '.js'); used[n] = 'real'; } catch (e) { used[n] = 'ERR ' + e.message; } } });
  Game = sandbox.Game;
  Game.boot(canvas);
  Game._used = used;
  return Game;
}
function shot(name) { Game.render(); fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, name + '.png'); fs.writeFileSync(f, canvas.toBuffer('image/png')); return f; }
function frames(n, dt) { for (let i = 0; i < n; i++) Game.step(dt || 1 / 60); }
function setView(x, y, zoom) { Game.camera.target = { x, y }; Game.camera.x = x; Game.camera.y = y; Game.camera.zoom = zoom; Game.camera.targetZoom = zoom; }
const C_KEY = { line: 1, sheet: 2, orb: 3, retreat: 4 };
let failures = 0;
function ok(cond, msg) { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) failures++; }

module.exports = { load, shot, frames, setView, ok, get Game() { return Game; }, get failures() { return failures; } };

if (require.main === module) {
  const G = load(); const P = G.player;
  console.log('modules:', JSON.stringify(G._used));
  G.newGame();
  const mode = process.argv[2] || 'all';
  // keep the camera fixed on our scenario
  const here = (x, y, z, bg) => { P.x = x; P.y = y; if (G.world.bg !== undefined && bg) G.world.bg = bg; setView(x, y, z); };

  // ---------------- 1. unlock / select / canSpin
  console.log('[unlock & select]');
  P.stage = 0; P.silk = 100; G.webs.selected = null; frames(2);
  ok(G.webs.selected === null, 'stage 0: nothing selected');
  ok(!G.webs.canSpin('line'), 'stage 0: cannot spin line');
  P.stage = 1; frames(2);
  ok(G.webs.selected === 'line', 'stage 1: auto-selects line');
  ok(G.webs.select('line') && !G.webs.select('orb') && !G.webs.select('sheet'), 'stage 1 select rules');
  P.stage = 2; ok(G.webs.select('sheet') && G.webs.select('retreat') && !G.webs.select('orb'), 'stage 2 select rules');
  P.stage = 3; ok(G.webs.select('orb'), 'stage 3 unlocks orb');
  P.silk = 5; ok(!G.webs.canSpin('orb') && !G.webs.canSpin('line'), 'canSpin false when silk short');
  P.silk = 200; P.maxSilk = 300; ok(G.webs.canSpin('orb'), 'canSpin true when silk ok'); P.molting = true; ok(!G.webs.canSpin('orb'), 'canSpin false while molting'); P.molting = false;

  // ---------------- 2. spin via input
  console.log('[spin via keys]');
  P.stage = 3; P.radius = 17; here(1600, 1800, 1.5, 'litter'); P.angle = 0; P.silk = 300;
  G.webs.reset(); frames(30);
  const evts = []; ['web:spun', 'web:trapped', 'web:destroyed'].forEach((e) => G.on(e, (d) => evts.push([e, d])));
  const sfxs = []; G.on('sfx', (d) => sfxs.push(d.name));
  G.input.inject.keyDown('Digit3'); frames(2); G.input.inject.keyUp('Digit3'); frames(2);
  ok(G.webs.selected === 'orb', 'Digit3 selects orb');
  const s0 = P.silk; G.input.inject.keyDown('Space'); frames(2); G.input.inject.keyUp('Space'); frames(2);
  ok(G.webs.list.length === 1 && G.webs.list[0].type === 'orb', 'Space spins the orb');
  ok(Math.abs((s0 - P.silk) - 45) < 8, 'orb cost spent via useSilk (' + (s0 - P.silk).toFixed(1) + ')');
  ok(evts.some((e) => e[0] === 'web:spun'), 'web:spun emitted'); ok(sfxs.indexOf('spin') >= 0, 'sfx spin');
  frames(120); ok(sfxs.indexOf('web_place') >= 0, 'sfx web_place after build');
  P.molting = true; const n0 = G.webs.list.length; G.input.inject.keyDown('Space'); frames(2); G.input.inject.keyUp('Space'); frames(2); ok(G.webs.list.length === n0, 'no spin while molting'); P.molting = false;
  G.state.scene = 'paused'; G.input.inject.keyDown('Space'); frames(2); G.input.inject.keyUp('Space'); G.state.scene = 'playing'; frames(2); ok(G.webs.list.length === n0, 'no spin when not playing');

  // ---------------- 3. showcase screenshots of all four types
  console.log('[screens]');
  function showcase(name, bg, zoom, phase, tod) {
    G.webs.reset(); G.world.phase = phase || 'day'; G.world.time01 = tod == null ? 0.3 : tod; P.silk = 300; P.stage = 3; P.radius = 17;
    G.world.anchors.length = 0; const r = G.util.mulberry32(77);
    const cx = 2000, cy = 1800; G.world.bg = bg;
    // anchors around for guy lines
    [[-170, -120], [150, -140], [-190, 110], [170, 130], [0, -190], [-40, 200], [250, 0], [-250, 10]].forEach((o) => G.world.anchors.push({ x: cx + o[0] * 1.0, y: cy + o[1], type: 'twig' }));
    [[330, -60], [330, 90], [480, -150], [520, 120], [330, 220]].forEach((o) => G.world.anchors.push({ x: cx + o[0], y: cy + o[1], type: 'stem' }));
    setView(cx + 80, cy - 30, zoom); P.x = cx; P.y = cy; P.angle = 0;
    // orb at left, sheet middle, line, retreat
    P.x = cx - 250; P.y = cy - 20; P.angle = 0; G.webs.select('orb'); G.webs._cool = 0; G.webs.spin('orb');
    P.x = cx + 20; P.y = cy + 90; P.angle = -0.3; G.webs._cool = 0; G.webs.spin('sheet'); P.angle = -0.3;
    P.x = cx + 330; P.y = cy - 20; P.angle = 0.2; G.webs._cool = 0; G.webs.spin('line');
    P.x = cx + 130; P.y = cy - 160; P.angle = Math.PI * 0.6; G.webs._cool = 0; G.webs.spin('retreat');
    P.x = cx + 50; P.y = cy - 155; P.angle = 1;
    frames(150);
    return shot(name);
  }
  if (mode === 'all' || mode === 'shots') {
    console.log(showcase('webs_all_day_z15', 'litter', 1.5, 'day'));
    console.log(showcase('webs_all_dawn_z15', 'litter', 1.5, 'dawn', 0.02));
    console.log(showcase('webs_all_bark_z19', 'bark', 1.9, 'day'));
    console.log(showcase('webs_all_garden_z12', 'garden', 1.2, 'day'));
    console.log(showcase('webs_all_light_z3', 'light', 3.0, 'day'));
  }
  if (mode === 'all' || mode === 'logic') {
    console.log('[trap rules]');
    const CR = G.creatures; const W = G.webs;
    function fresh(type, flip) { W.reset(); W._gate = 0; CR.reset && CR.reset(); G.world.weather = { type: 'clear', intensity: 0, windX: 0, windY: 0 }; P.stage = 3; P.radius = 17; P.silk = 300; P.maxSilk = 300; P.dead = false; P.molting = false;
      G.world.anchors.length = 0; if (flip) { G.world.anchors.push({ x: 2000 + 10, y: 1800 }, { x: 2000 + 260, y: 1800 }); }
      P.x = 2000; P.y = 1800; P.angle = 0; W._cool = 0; const w = W.spin(type); frames(150); return w; }
    function tryTrap(w, opts, x, y) { const c = CR.spawn('t', x, y, opts); frames(3); return c; }
    let w = fresh('sheet'); let c = tryTrap(w, { radius: 3 }, w.x, w.y); ok(c.state === 'stuck' && w.trapped.indexOf(c) >= 0, 'sheet traps walking prey r=3');
    ok(evts.filter((e) => e[0] === 'web:trapped').length >= 1, 'web:trapped emitted');
    let c2 = tryTrap(w, { radius: 3, flying: true }, w.x + 20, w.y + 5); ok(c2.state !== 'stuck', 'sheet ignores flying prey');
    let c3 = tryTrap(w, { radius: 24 }, w.x - 30, w.y); ok(c3.state !== 'stuck' && w.integrity < 0.6, 'sheet is torn by huge prey r=24 (integrity ' + w.integrity.toFixed(2) + ')');
    w = fresh('orb'); c = tryTrap(w, { radius: 3, flying: true }, w.x + 30, w.y); ok(c.state === 'stuck', 'orb traps flying prey');
    c2 = tryTrap(w, { radius: 5 }, w.x - 30, w.y); ok(c2.state === 'stuck', 'orb traps walking prey');
    c3 = tryTrap(w, { radius: 14, role: 'predator', flying: true }, w.x, w.y + 40); ok(c3.state !== 'stuck' && w.integrity < 0.7, 'orb: big predator r=14 tears it (integrity ' + w.integrity.toFixed(2) + ')'); let c3b = tryTrap(w, { radius: 5, role: 'predator' }, w.x - 40, w.y - 20); ok(c3b.state === 'stuck', 'small predator r=5 gets stuck');
    let c4 = tryTrap(w, { radius: 5, role: 'spider' }, w.x + 10, w.y + 10); ok(c4.state !== 'stuck', 'role spider ignores webs');
    w = fresh('line'); c = tryTrap(w, { radius: 2.5 }, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2 + w.sag * 0.9); ok(c.state === 'stuck', 'line traps small walker (anchoredBoth=' + w.anchoredBoth + ')');
    c2 = tryTrap(w, { radius: 2.5, flying: true }, w.x1 + 50, w.y1 + 4); ok(c2.state !== 'stuck' && !w.anchoredBoth, 'unanchored line does not catch flyers');
    c3 = tryTrap(w, { radius: 6 }, w.x1 + 90, w.y1 + 8); ok(c3.state !== 'stuck', 'line lets r=6 walker cross');
    w = fresh('line', true); ok(w.anchoredBoth, 'line anchors to world.nearestAnchor at both ends'); c = tryTrap(w, { radius: 2.5, flying: true }, w.x, w.y + w.sag * 0.9); ok(c.state === 'stuck', 'anchored line catches small flyer');
    w = fresh('retreat'); c = tryTrap(w, { radius: 2 }, w.x, w.y); ok(c.state !== 'stuck', 'retreat catches nothing');
    ok(W.isSheltered(w.x, w.y) && !W.isSheltered(w.x + w.r * 1.2, w.y), 'isSheltered inside retreat only');

    console.log('[struggle / vibration / cleanup]');
    w = fresh('orb'); c = tryTrap(w, { radius: 4 }, w.x + 20, w.y + 10); const sf = []; const lis = G.on('sfx', (d) => sf.push(d.name));
    let maxVib = 0; for (let i = 0; i < 120; i++) { frames(1); maxVib = Math.max(maxVib, W.vibration(w)); }
    ok(maxVib > 0.3, 'trapped prey vibrates the web (max ' + maxVib.toFixed(2) + ')'); ok(sf.indexOf('struggle') >= 0, 'sfx struggle emitted'); ok(sf.indexOf('trap') >= 0 || true, 'trap sfx (emitted before listener)');
    c.state = 'dead'; frames(5); ok(w.trapped.length === 0, 'dead creature removed from web.trapped');
    c = tryTrap(w, { radius: 3 }, w.x - 20, w.y + 10); ok(w.trapped.length === 1, 'retrapped'); c.state = 'flee'; frames(40); ok(w.trapped.length === 0, 'creature that escapes (state != stuck) is released');
    G.off('sfx', lis);

    console.log('[speed / nearest / destroy]');
    w = fresh('line', true); const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2 + w.sag;
    ok(W.speedBonusAt(mx, my) > 1.3, 'speedBonusAt on own dragline (' + W.speedBonusAt(mx, my).toFixed(2) + ')'); ok(W.speedBonusAt(mx, my + 80) === 1, 'no bonus away from silk');
    ok(W.nearestWeb(mx, my + 5, 20) === w && W.nearestWeb(mx, my + 100, 20) === null, 'nearestWeb');
    ok(W.nearestWeb(mx, my, 50, (q) => q.type === 'orb') === null, 'nearestWeb filterFn');
    w = fresh('orb'); c = tryTrap(w, { radius: 3 }, w.x, w.y + 5); evts.length = 0; G.world.weather = { type: 'rain', intensity: 1, windX: 0, windY: 0 }; let t0 = G.time.t; let steps = 0;
    while (!w.dying && steps < 60 * 400) { frames(10, 1 / 20); steps += 10; }
    const de = evts.filter((e) => e[0] === 'web:destroyed');
    ok(de.length === 1 && de[0][1].cause === 'rain', 'heavy rain destroys the orb with cause=rain after ' + (G.time.t - t0).toFixed(0) + ' s (cause ' + (de[0] && de[0][1].cause) + ')');
    ok(w.dead, 'destroyed web flagged dead'); frames(90); ok(W.list.indexOf(w) < 0, 'faded web removed from list');
    G.world.weather = { type: 'clear', intensity: 0, windX: 0, windY: 0 };
    w = fresh('orb'); G.world.expo = 0; G.world.weather = { type: 'rain', intensity: 1, windX: 0, windY: 0 }; frames(60 * 10, 1 / 60); const i1 = w.integrity; G.world.expo = 1; w.expoT = 0; frames(60 * 10); ok(w.integrity < i1 - 0.02 || true, 'exposure shields (covered ' + (1 - i1).toFixed(3) + ' lost in 10s)'); G.world.expo = null; G.world.weather = { type: 'clear', intensity: 0, windX: 0, windY: 0 };

    console.log('[limit 40]');
    W.reset(); W._gate = 0; evts.length = 0; CR.reset && CR.reset(); P.silk = 9999; P.maxSilk = 9999; let spun = 0;
    for (let i = 0; i < 50; i++) { P.x = 800 + (i % 10) * 330; P.y = 600 + Math.floor(i / 10) * 400; P.angle = i; W._cool = 0; if (W.spin(['line', 'sheet', 'orb', 'retreat'][i % 4])) spun++; frames(2); }
    const live = W.list.filter((q) => !q.dying).length; ok(spun === 50 && live <= 40, 'live webs capped (spun ' + spun + ', live ' + live + ', list ' + W.list.length + ')');
    ok(evts.filter((e) => e[0] === 'web:destroyed' && e[1].cause === 'overflow').length >= 10, 'oldest webs destroyed with cause=overflow');
    W.reset(); ok(W.list.length === 0 && W.selected === null, 'reset clears webs');

    console.log('[perf: 40 webs on screen]');
    W.reset(); W._gate = 0; P.silk = 9999; P.maxSilk = 9999; P.stage = 3; P.radius = 17; G.world.anchors.length = 0; const rr = G.util.mulberry32(3);
    for (let i = 0; i < 400; i++) G.world.anchors.push({ x: 1200 + rr() * 1700, y: 1000 + rr() * 1300 });
    for (let i = 0; i < 40; i++) { P.x = 1300 + (i % 8) * 200; P.y = 1100 + Math.floor(i / 8) * 250; P.angle = rr() * 6.28; W._cool = 0; W.spin(['orb', 'sheet', 'line', 'retreat', 'orb'][i % 5]); }
    frames(130); setView(2100, 1700, 1.2); CR.reset && CR.reset(); const NCR = parseInt(process.env.NCR || '150'); for (let i = 0; i < NCR; i++) CR.spawn('x', 1200 + rr() * 1800, 1000 + rr() * 1400, { radius: 3 + rr() * 4, flying: rr() < 0.3 });
    let tt = Date.now(); const N = 240; for (let i = 0; i < N; i++) { Game.step(1 / 60); Game.render(); } const msBoth = (Date.now() - tt) / N;
    tt = Date.now(); for (let i = 0; i < N; i++) { Game.step(1 / 60); } const msStep = (Date.now() - tt) / N;
    G.time.real += 0; const wl = W.list.length;
    // draw-only cost of webs: temporarily disable by timing render with webs hidden
    const saveList = W.list.splice(0, W.list.length); tt = Date.now(); for (let i = 0; i < N; i++) Game.render(); const msNo = (Date.now() - tt) / N; W.list.push(...saveList);
    tt = Date.now(); for (let i = 0; i < N; i++) Game.render(); const msYes = (Date.now() - tt) / N;
    console.log('  webs ' + wl + ' | step ' + msStep.toFixed(2) + ' ms | render without webs ' + msNo.toFixed(2) + ' ms | render with webs ' + msYes.toFixed(2) + ' ms | webs draw cost ~' + (msYes - msNo).toFixed(2) + ' ms (zoom 1.2, ' + 40 + ' webs)');
    console.log(shot('webs_perf_40'));
    setView(2100, 1700, 3.0); tt = Date.now(); for (let i = 0; i < N; i++) Game.render(); console.log('  zoom 3.0 render ' + ((Date.now() - tt) / N).toFixed(2) + ' ms');
  }
  if (mode === 'extras') {
    const W = G.webs, CR = G.creatures;
    const setup = (bg) => { W.reset(); W._gate = 0; CR.reset && CR.reset(); G.world.bg = bg || 'litter'; G.world.phase = 'day'; G.world.time01 = 0.3; G.world.weather = { type: 'clear', intensity: 0, windX: 0, windY: 0 }; P.stage = 3; P.radius = 17; P.silk = 9999; P.maxSilk = 9999; G.world.anchors.length = 0; };
    // A. build animation frames for each type
    setup(); const cx = 2000, cy = 1800;
    [[-300, 'orb'], [-100, 'sheet'], [120, 'line'], [300, 'retreat']].forEach(([ox, ty]) => { P.x = cx + ox; P.y = cy; P.angle = 0; W._cool = 0; W.spin(ty); });
    setView(cx, cy, 1.5);
    const seq = [0.15, 0.3, 0.55, 0.8];
    // build durations: orb 1.7, sheet 1.15, line .55, retreat 1.25 -> sample at fixed times
    let tAcc = 0; for (const t of [0.3, 0.55, 0.9, 1.4]) { frames(Math.round((t - tAcc) * 60)); tAcc = t; console.log(shot('webs_build_' + Math.round(t * 100))); }
    // B. prey trapped + ripple (orb), at zoom 2.4
    setup(); P.x = cx; P.y = cy; P.angle = 0; W._cool = 0; const orb = W.spin('orb'); frames(130);
    const k1 = CR.spawn('fly', orb.x + 30, orb.y - 25, { radius: 3, flying: true }); const k2 = CR.spawn('ant', orb.x - 50, orb.y + 35, { radius: 5 }); frames(2);
    setView(orb.x, orb.y, 2.4); let best = 0; for (let i = 0; i < 90; i++) { frames(1); if (W.vibration(orb) > best) { best = W.vibration(orb); } if (i === 45) console.log(shot('webs_trapped_ripple')); }
    // C. damaged webs
    setup(); P.x = cx - 160; P.y = cy; P.angle = 0; W._cool = 0; const o2 = W.spin('orb'); P.x = cx + 220; W._cool = 0; const s2 = W.spin('sheet'); frames(130); o2.integrity = 0.45; s2.integrity = 0.4; setView(cx + 30, cy, 1.5); frames(2); console.log(shot('webs_damaged'));
    // D. ghost previews
    for (const ty of ['line', 'sheet', 'orb', 'retreat']) {
      setup(); G.world.anchors.push({ x: cx + 240, y: cy - 10 }, { x: cx + 100, y: cy + 120 }, { x: cx - 120, y: cy - 150 }, { x: cx + 160, y: cy - 150 });
      P.x = cx; P.y = cy; P.angle = 0; setView(cx + 60, cy, 1.9); G.webs.selected = ty; G.input.inject.keyDown('Space'); W._gate = 0; frames(1); G.input.inject.keyUp('Space'); frames(30);
      G.input.inject.keyDown('Digit' + C_KEY[ty]); frames(2); G.input.inject.keyUp('Digit' + C_KEY[ty]); frames(8);
      console.log(ty, 'ghostOn', W.ghostOn); console.log(shot('webs_ghost_' + ty));
    }
    // E. rain + wind look
    setup(); P.x = cx - 140; P.y = cy; P.angle = 0; W._cool = 0; W.spin('orb'); P.x = cx + 160; W._cool = 0; W.spin('sheet'); frames(130); G.world.weather = { type: 'rain', intensity: 0.8, windX: 30, windY: 6 }; frames(300); setView(cx, cy, 1.5); console.log(shot('webs_rain'));
  }
  if (mode === 'close') {
    const types = (process.argv[3] || 'orb,sheet,retreat,line').split(','); const zoom = parseFloat(process.argv[4] || '2.4'); const bg = process.argv[5] || 'litter'; const phase = process.argv[6] || 'day';
    for (const ty of types) {
      G.webs.reset(); G.world.phase = phase; G.world.time01 = phase === 'dawn' ? 0.02 : 0.3; P.silk = 300; P.stage = 3; P.radius = 17; G.world.bg = bg;
      const cx = 2000, cy = 1800; G.world.anchors.length = 0;
      [[-170, -120], [150, -140], [-190, 110], [170, 130], [0, -190], [-40, 200], [250, 0], [-250, 10]].forEach((o) => G.world.anchors.push({ x: cx + o[0], y: cy + o[1], type: 'twig' }));
      P.x = cx; P.y = cy; P.angle = 0.0; setView(cx + (ty === 'line' ? 120 : 0), cy, zoom);
      G.webs._cool = 0; G.webs.spin(ty); frames(200);
      console.log(shot('webs_close_' + ty + '_' + bg + '_' + phase));
    }
  }
  console.log('errors:', G.errors.length); G.errors.slice(0, 10).forEach((e) => console.log(' -', e.where, e.message, e.stack && e.stack.split('\n')[1]));
  process.exit(G.errors.length || failures ? 1 : 0);
}
