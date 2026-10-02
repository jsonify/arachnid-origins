// Frame-time probe: pans the camera across the world (worst case: constant chunk baking) and reports ms/frame.
const path = require('path'), fs = require('fs'), vm = require('vm');
process.env.WORLDONLY = process.env.WORLDONLY || '1';
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));
const canvas = createCanvas(1280, 720), store = {};
const sb = { console, Math, Date, JSON, Object, Array, Set, Map, WeakMap, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Number, String, Boolean, Symbol, Error, RegExp, Promise, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  document: { createElement: t => (t === 'canvas' ? createCanvas(300, 150) : {}), getElementById: () => canvas, readyState: 'complete' }, requestAnimationFrame: () => 0 };
sb.window = sb; sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
(process.env.WORLDONLY === '0' ? ['core', 'world', 'webs', 'player', 'creatures', 'edu', 'audio', 'ui'] : ['core', 'world', 'audio']).forEach(n => { const f = path.join(__dirname, '..', 'src', n + '.js'); if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: n + '.js' }); });
var G = sb.Game; G.boot(canvas); G.newGame();
function pan_unused(label, zoom, speed, secs, x0, y0, dx, dy, weather) {
  G.camera.target = { x: x0, y: y0 }; G.camera.x = x0; G.camera.y = y0; G.camera.zoom = G.camera.targetZoom = zoom;
  if (weather) G.world.forceWeather(weather[0], weather[1]); else G.world.forceWeather('clear');
  const tgt = G.camera.target; let worst = 0, tot = 0, slow = 0, n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) {
    tgt.x += dx * speed / 60; tgt.y += dy * speed / 60;
    G.step(1 / 60); const t = Date.now(); G.render(); const e = Date.now() - t; tot += e; if (i > 3) { if (e > worst) worst = e; if (e > 20) slow++; }
  }
  console.log(label.padEnd(26), 'avg render', (tot / n).toFixed(2), 'ms  worst(after warmup)', worst, 'ms  frames>20ms:', slow);
}

G.world._dbg.setFlush(process.argv[3]==='flush');
G.camera.target = { x: 1200, y: 1000 }; G.camera.x = 1200; G.camera.y = 1000; G.camera.zoom = G.camera.targetZoom = +(process.argv[2]||1.9);
const tgt = G.camera.target; const log = [];
const D=G.world._dbg; const origMake=D.chunkMake; 
for (let i = 0; i < 900; i++) { tgt.x += 135 / 60; tgt.y += 40/60; G.step(1/60); const t = Date.now(); G.render(); const e = Date.now() - t; if (e > 15) log.push(i + ':' + e + 'ms@' + Math.round(tgt.x) + JSON.stringify(G.world.stats)); }
console.log(log.join('  '));
