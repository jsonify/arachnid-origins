/* Test + screenshot script for src/edu.js and src/ui.js (Agent E).
 *   node tools/test_ui.js [shots|logic|all]       (env ICON=1 adds a stub Game.creatures.drawKindIcon)
 * Loads real modules when present; creatures (and any other missing module) get a stub that follows ARCHITECTURE.md.
 * STUB=1 forces stubs for world/webs/player too.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));
const SRC = path.join(__dirname, '..', 'src'), SHOTS = path.join(__dirname, 'shots');
const FORCE = !!process.env.STUB;

const KIND_DEFS = [
  ['springtail', 'Springtail', 'Collembola', 'prey', ['leaf_litter'], 3, 0, ['fungi', 'detritus'], false, 1, 4],
  ['mite', 'Soil Mite', 'Acari', 'prey', ['litter'], 2, 0, ['fungi', 'detritus'], false, 1, 3],
  ['aphid', 'Aphid', 'Aphidoidea', 'prey', ['garden'], 3, 0, ['plant sap'], false, 1, 5],
  ['midge', 'Midge', 'Chironomidae', 'prey', ['garden', 'litter'], 3, 0, ['nectar'], true, 1, 4],
  ['fruitfly', 'Fruit Fly', 'Drosophila melanogaster', 'prey', ['garden'], 3, 0, ['fungi'], true, 2, 6],
  ['pillbug', 'Pillbug', 'Armadillidium vulgare', 'prey', ['litter', 'bark'], 7, 0, ['detritus'], false, 3, 9],
  ['ant', 'Black Garden Ant', 'Lasius niger', 'neutral', ['bark', 'garden'], 5, 3, ['aphid', 'springtail', 'nectar'], false, 3, 10],
  ['moth', 'Night Moth', 'Noctuidae', 'prey', ['garden'], 8, 0, ['nectar'], true, 4, 14],
  ['cricket', 'Field Cricket', 'Gryllus campestris', 'prey', ['litter', 'garden'], 9, 0, ['plant leaves', 'detritus'], false, 4, 16],
  ['caterpillar', 'Caterpillar', 'Lepidoptera larva', 'prey', ['garden'], 9, 0, ['plant leaves'], false, 4, 15],
  ['grasshopper', 'Meadow Grasshopper', 'Chorthippus parallelus', 'prey', ['garden'], 11, 0, ['plant leaves'], false, 5, 22],
  ['beetle', 'Armored Beetle', 'Carabidae', 'prey', ['bark'], 10, 0, ['detritus', 'fungi'], false, 5, 24],
  ['centipede', 'House Centipede', 'Scutigera coleoptrata', 'predator', ['litter', 'bark'], 10, 6, ['springtail', 'mite', 'cricket', 'midge'], false, 0, 0],
  ['wasp', 'Paper Wasp', 'Polistes', 'predator', ['garden'], 8, 12, ['caterpillar', 'fruitfly', 'aphid', 'nectar'], true, 0, 0],
  ['bird', 'Wren', 'Troglodytes troglodytes', 'predator', ['garden', 'bark'], 40, 30, ['caterpillar', 'grasshopper', 'beetle', 'cricket', 'moth'], true, 0, 0],
  ['mantis', 'Praying Mantis', 'Mantis religiosa', 'predator', ['garden'], 18, 18, ['fruitfly', 'moth', 'cricket', 'midge'], false, 0, 0],
  ['groundbeetle', 'Ground Beetle', 'Carabus', 'predator', ['litter'], 9, 5, ['springtail', 'mite', 'pillbug', 'caterpillar'], false, 0, 0],
  ['wolfspider', 'Wolf Spider', 'Lycosidae', 'spider', ['litter', 'bark'], 16, 14, ['cricket', 'ant', 'springtail', 'beetle'], false, 0, 0],
  ['jumpingspider', 'Jumping Spider', 'Salticidae', 'spider', ['bark', 'garden'], 9, 7, ['midge', 'fruitfly', 'aphid', 'springtail'], false, 0, 0],
  ['mate_spider', 'Wandering Mate', 'Araneae', 'spider', ['garden'], 18, 0, ['midge'], false, 0, 0],
];
const STUB_CREATURES = (iconToo) => `
(function(){ const G=Game, C=G.C; const D=${JSON.stringify(KIND_DEFS)}; const KINDS={};
 const colors={prey:'#8fb86a',predator:'#c9604d',spider:'#a58ad8',neutral:'#b9a78a'};
 D.forEach(d=>{ KINDS[d[0]]={id:d[0],name:d[1],latin:d[2],role:d[3],habitat:d[4],radius:d[5],danger:d[6],diet:d[7],flying:d[8],nocturnal:d[0]==='moth'||d[0]==='centipede',value:{hunger:d[9],growth:d[10]},hp:5,speed:40,color:colors[d[3]],
   fact:'A short but scientifically careful fact about the '+d[1].toLowerCase()+' that fits into the Did You Know box nicely.',
   description:'The '+d[1].toLowerCase()+' ('+d[2]+') is a typical member of the micro world. It lives in '+d[4].join(' and ')+' habitats and matters to the food web in many quiet ways.'}; });
 const c={priority:40,list:[],mate:null,KINDS,visibleKinds:new Set(),
  spawn(kind,x,y,o){ const cr=Object.assign({id:c.list.length+1,kind,x,y,vx:0,vy:0,angle:0,radius:(KINDS[kind]||{radius:3}).radius,hp:2,maxHp:2,state:'wander',role:(KINDS[kind]||{role:'prey'}).role,flying:!!(KINDS[kind]||{}).flying},o||{}); c.list.push(cr); return cr; },
  nearest(x,y,f,m){ let b=null,bd=m; for(const k of c.list){ if(f&&!f(k))continue; const d=Math.hypot(k.x-x,k.y-y); if(d<=bd){bd=d;b=k;} } return b; },
  canEat(r,cr){ return cr.radius<=r*1.35; },
  attackAt(){ return {killed:[],hit:[]}; },
  spawnMate(){ const P=G.player; c.mate=c.spawn('mate_spider',P.x+400,P.y+120,{role:'spider',radius:18,hp:50,maxHp:50}); return c.mate; },
  reset(){ c.list.length=0; c.mate=null; } };
 ${iconToo ? `c.drawKindIcon=function(ctx,id,x,y,size,o){ const k=KINDS[id]; ctx.save(); ctx.fillStyle=(o&&o.silhouette)?'#222':k.color; ctx.beginPath(); ctx.ellipse(x,y,size*0.28,size*0.4,0.3,0,6.28); ctx.fill(); ctx.fillStyle='#fff'; ctx.fillRect(x-1,y-1,3,3); ctx.restore(); };` : ''}
 G.register('creatures', c); })();`;
const STUB_WORLD = `(function(){ const G=Game,U=G.util,C=G.C; const cols=Math.ceil(C.WORLD_W/64), rows=Math.ceil(C.WORLD_H/64);
 const w={priority:10,width:C.WORLD_W,height:C.WORLD_H,time01:0.3,dayCount:0,light:1,phase:'day',weather:{type:'clear',intensity:0,windX:0,windY:0},obstacles:[],resources:[{id:1,type:'dew',x:300,y:1860,r:5,amount:40,max:40}],shelters:[{id:1,type:'leaf',x:240,y:1780,r:30,safety:0.9,eggSite:false}],anchors:[],
  explored:new Uint8Array(cols*rows),exploredCell:64,isNight(){return this.phase==='night'},zoneAt(x){return x<2400?C.ZONES[0]:(x<4200?C.ZONES[1]:C.ZONES[2])},exposure(){return 1},resolve(x,y){return {x,y}},
  shelterAt(x,y){ for(const s of this.shelters) if(Math.hypot(s.x-x,s.y-y)<s.r) return s; return null; },nearestResource(x,y,t,m){ for(const r of this.resources) if((!t||r.type===t)&&Math.hypot(r.x-x,r.y-y)<m+r.r) return r; return null; },
  markExplored(x,y,rad){ for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++) if(Math.hypot(cx*64+32-x,cy*64+32-y)<rad) this.explored[cy*cols+cx]=1; },
  drawMinimapTerrain(g,x,y,w2,h){ C.ZONES.forEach(z=>{ g.fillStyle=z.color; g.fillRect(x+z.x0/C.WORLD_W*w2,y,(z.x1-z.x0)/C.WORLD_W*w2,h); }); },
  reset(){ this.explored.fill(0); this.markExplored(C.SPAWN.x,C.SPAWN.y,320); },
  init(){ G.addDrawer(G.LAYER.BACKGROUND,(ctx)=>{ const v=G.camera.view; ctx.fillStyle='#5a4327'; ctx.fillRect(v.x0,v.y0,v.x1-v.x0,v.y1-v.y0); const r=U.mulberry32(9); for(let i=0;i<500;i++){ const x=v.x0+r()*(v.x1-v.x0), y=v.y0+r()*(v.y1-v.y0); ctx.fillStyle=i&1?'#6b5232':'#4a3820'; ctx.beginPath(); ctx.ellipse(x,y,14+r()*10,6+r()*6,r()*3,0,6.28); ctx.fill(); } }); } };
 G.register('world',w); })();`;
const STUB_WEBS = `(function(){ Game.register('webs',{priority:20,list:[],selected:'line',reset(){}}); })();`;
const STUB_PLAYER = `(function(){ const G=Game,C=G.C; const P={priority:30,x:C.SPAWN.x,y:C.SPAWN.y,vx:0,vy:0,angle:0,radius:5,stage:0,hp:30,maxHp:30,hunger:80,hydration:70,energy:90,silk:20,maxSilk:20,growth:0,growthNeeded:60,upgrades:{},speedMul:1,biteMul:1,stealth:1,senseRadius:0,hidden:false,resting:false,moltTimer:0,molting:false,dead:false,mate:{found:false,courted:false,laid:false},
  addGrowth(n){ this.growth+=n; G.emit('growth:gain',{amount:n}); if(this.growth>=this.growthNeeded&&this.stage<4){ this.molting=true; G.setScene('molting'); G.emit('molt:start',{stage:this.stage+1,from:this.stage,offers:this.offers=this.offerUpgrades()}); } },
  offerUpgrades(){ return C.UPGRADES.filter(u=>(this.upgrades[u.id]||0)<u.max).slice(0,3).map(u=>u.id); },
  chooseUpgrade(id){ this.upgrades[id]=(this.upgrades[id]||0)+1; this.stage++; this.growth=0; this.growthNeeded=(C.STAGES[this.stage]||{}).growthNeeded||0; this.molting=false; G.setScene('playing'); G.emit('molt:choose',{id}); G.emit('stage:change',{stage:this.stage,prev:this.stage-1}); return true; },
  feed(){}, damage(a){ this.hp-=a; G.emit('player:damaged',{amount:a,source:'test'}); }, reset(){ Object.assign(this,{x:C.SPAWN.x,y:C.SPAWN.y,stage:0,hp:30,growth:0,growthNeeded:60,upgrades:{},dead:false,molting:false}); } };
 G.register('player',P); })();`;

let canvas = null, Game = null; const used = {};
function load(o) {
  o = o || {};
  canvas = createCanvas(1280, 720); const store = o.store || {};
  const sandbox = { console, Math, Date, JSON, Object, Array, Set, Map, WeakMap, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Number, String, Boolean, Symbol, Error, RegExp, Promise, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { createElement: (t) => (t === 'canvas' ? createCanvas(300, 150) : {}), getElementById: () => canvas, readyState: 'complete' }, requestAnimationFrame: () => 0 };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const vctx = vm.createContext(sandbox), file = (n) => path.join(SRC, n + '.js');
  const runc = (code, name) => vm.runInContext(code, vctx, { filename: name });
  const stubOr = (n, stub) => { if (!FORCE && !(o.stub || {})[n] && fs.existsSync(file(n))) { runc(fs.readFileSync(file(n), 'utf8'), n + '.js'); used[n] = 'real'; } else { runc(stub, n + '-stub'); used[n] = 'stub'; } };
  runc(fs.readFileSync(file('core'), 'utf8'), 'core.js');
  stubOr('world', STUB_WORLD); stubOr('webs', STUB_WEBS); stubOr('player', STUB_PLAYER);
  if (!o.noCreatures) stubOr('creatures', STUB_CREATURES(!!process.env.ICON));
  ['edu', 'audio', 'ui'].forEach(n => { if (fs.existsSync(file(n))) { runc(fs.readFileSync(file(n), 'utf8'), n + '.js'); used[n] = 'real'; } });
  Game = sandbox.Game; Game.boot(canvas); return Game;
}
function step(n) { for (let i = 0; i < (n || 1); i++) Game.step(1 / 60); }
function run(sec, o) { o = o || {}; const n = Math.round(sec * 60); (o.keys || []).forEach(k => Game.input.inject.keyDown(k)); for (let i = 0; i < n; i++) { if (o.onFrame) o.onFrame(i); Game.step(1 / 60); } (o.keys || []).forEach(k => Game.input.inject.keyUp(k)); }
function tap(code) { Game.input.inject.keyDown(code); Game.step(1 / 60); Game.input.inject.keyUp(code); Game.step(1 / 60); }
function click(x, y) { Game.input.inject.click(x, y); Game.step(1 / 60); Game.input.mouse.down = false; Game.step(1 / 60); }
function hover(x, y) { const m = Game.input.mouse; m.x = x; m.y = y; m.moved = true; Game.step(1 / 60); }
function shot(name) { Game.render(); fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, 'ui_' + name + '.png'); fs.writeFileSync(f, canvas.toBuffer('image/png')); return f; }
let fails = 0; function assert(c, msg) { if (!c) { fails++; console.log('  FAIL:', msg); } else console.log('  ok  :', msg); }
function noErrors(label) { const e = Game.errors; if (e.length) { console.log('  ERRORS' + (label ? ' (' + label + ')' : '') + ':'); e.slice(0, 6).forEach(x => console.log('   -', x.where, x.message, (x.stack || '').split('\n').slice(0, 3).join(' | '))); } assert(e.length === 0, 'Game.errors empty' + (label ? ' (' + label + ')' : '')); }
module.exports = { load, step, run, tap, click, hover, shot, assert, noErrors, used, get Game() { return Game; }, get canvas() { return canvas; }, get fails() { return fails; } };

if (require.main === module) {
  const mode = process.argv[2] || 'shots';
  const cases = require('./test_ui_cases.js');
  const T = module.exports;
  (cases[mode] || (() => { console.log('unknown mode', mode); }))(T);
  console.log('modules:', JSON.stringify(used), ' fails:', fails);
  process.exit(fails ? 1 : 0);
}
