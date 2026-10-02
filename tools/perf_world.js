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
const G = sb.Game; G.boot(canvas); G.newGame();
function pan(label, zoom, speed, secs, x0, y0, dx, dy, weather) {
  G.camera.target = { x: x0, y: y0 }; G.camera.x = x0; G.camera.y = y0; G.camera.zoom = G.camera.targetZoom = zoom;
  if (weather) G.world.forceWeather(weather[0], weather[1]); else G.world.forceWeather('clear');
  const tgt = G.camera.target; let worst = 0, tot = 0, slow = 0, n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) {
    tgt.x += dx * speed / 60; tgt.y += dy * speed / 60;
    G.step(1 / 60); const t = Date.now(); G.render(); const e = Date.now() - t; tot += e; if (i > 3) { if (e > worst) worst = e; if (e > 20) slow++; }
  }
  console.log(label.padEnd(26), 'avg render', (tot / n).toFixed(2), 'ms  worst(after warmup)', worst, 'ms  frames>20ms:', slow);
}
pan('hatchling pan (zoom 3)', 3.0, 95, 12, 320, 1800, 1, 0);
pan('juvenile pan (zoom 1.9)', 1.9, 135, 12, 1200, 1000, 1, 0.3);
pan('adult pan (zoom 1.2)', 1.2, 160, 12, 3800, 1500, 1, 0);
pan('adult garden clear', 1.2, 160, 8, 4500, 2500, 1, 0);
pan('adult garden night+rain', 1.2, 0, 4, 5200, 1800, 0, 0, ['rain', 1]);
G.world.setTime(0.75); pan('garden night (fireflies)', 1.2, 0, 4, 5200, 1800, 0, 0);
G.world.setTime(0.15); pan('zoomed out (0.54) pan', 0.54, 250, 10, 2000, 1500, 1, 0);
pan('fog', 1.2, 0, 3, 5200, 1800, 0, 0, ['fog', 1]);
const w = G.world; console.log('chunks hi', w._dbg.CC[0].size, 'lo', w._dbg.CC[1].size, 'errors', G.errors.length);
G.errors.slice(0, 5).forEach(e => console.log(e.where, e.message));
