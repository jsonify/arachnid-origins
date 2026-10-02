// World tests / screenshot driver.   node tools/test_world.js [shotName ...]   (WORLDONLY=0 loads every module)
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require('./harness');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));
function loadWorldOnly(names) {
  const canvas = createCanvas(1280, 720), store = {};
  const sb = { console, Math, Date, JSON, Object, Array, Set, Map, WeakMap, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Number, String, Boolean, Symbol, Error, RegExp, Promise, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { createElement: t => (t === 'canvas' ? createCanvas(300, 150) : {}), getElementById: () => canvas, readyState: 'complete' }, requestAnimationFrame: () => 0 };
  sb.window = sb; sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
  names.forEach(n => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', n + '.js'), 'utf8'), sb, { filename: n + '.js' }));
  sb.Game.boot(canvas); return { Game: sb.Game, canvas };
}
const t0 = Date.now();
let G, CV;
if (process.env.WORLDONLY === '0') { G = H.load({ tolerant: true }); CV = H.canvas; }
else { const r = loadWorldOnly(['core', 'world']); G = r.Game; CV = r.canvas; }
function shotPng(name) { G.render(); fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'shots', name + '.png'), CV.toBuffer('image/png')); }
console.log('load+boot ms', Date.now() - t0, 'world build ms', G.world && G.world.buildMs);
G.newGame();
const W = G.world;
function frame(x, y, zoom, label, opts) {
  opts = opts || {};
  G.camera.target = { x, y }; G.camera.x = x; G.camera.y = y; G.camera.zoom = G.camera.targetZoom = zoom;
  if (opts.time != null) W.setTime(opts.time);
  if (opts.weather) W.forceWeather(opts.weather[0], opts.weather[1]);
  for (let i = 0; i < (opts.steps || 20); i++) G.step(1 / 60);
  for (let i = 0; i < 90; i++) G.render();
  const t1 = Date.now(); shotPng('world_' + label); console.log('shot', label, Date.now() - t1, 'ms');
}
const which = process.argv.slice(2);
const S = {
  spawn: () => frame(320, 1800, 3.0, 'spawn', { time: 0.12 }),
  litter: () => frame(1200, 1500, 1.9, 'litter', { time: 0.15 }),
  litterwide: () => frame(1200, 1500, 0.8, 'litterwide', { time: 0.15 }),
  bark: () => frame(3300, 1400, 1.9, 'bark', { time: 0.15 }),
  garden: () => frame(5200, 1800, 1.9, 'garden', { time: 0.15 }),
  garden3: () => frame(5100, 1700, 3.0, 'garden3', { time: 0.15 }),
  boundary1: () => frame(2400, 1800, 1.5, 'boundary1', { time: 0.15 }),
  boundary2: () => frame(4200, 1800, 1.5, 'boundary2', { time: 0.15 }),
  night: () => frame(5200, 1800, 1.9, 'night', { time: 0.75 }),
  dusk: () => frame(3300, 1400, 1.9, 'dusk', { time: 0.47 }),
  dawn: () => frame(1200, 1500, 1.9, 'dawn', { time: 0.99 }),
  rain: () => frame(1200, 1500, 1.9, 'rain', { time: 0.2, weather: ['rain', 0.9], steps: 30 }),
  fog: () => frame(5200, 1800, 1.9, 'fog', { time: 0.1, weather: ['fog', 0.9], steps: 30 }),
  wind: () => frame(5200, 1800, 1.9, 'wind', { time: 0.2, weather: ['wind', 0.9], steps: 30 }),
};
(which.length ? which : Object.keys(S)).forEach(k => S[k]());
console.log('errors', G.errors.length); G.errors.slice(0, 5).forEach(e => console.log(e.where, e.message, (e.stack || '').split('\n').slice(0, 4).join('\n')));
