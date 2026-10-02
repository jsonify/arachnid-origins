/* Headless test harness for Arachnid Origins.
 *
 *   node tools/harness.js [seconds=20] [--shots]
 *
 * Programmatic use (from your own test script):
 *   const H = require('./harness');
 *   const Game = H.load();                 // loads every src/*.js in load order into a vm context, boots the game
 *   H.newGame();                           // Game.newGame()
 *   H.run(10, {keys:['KeyD']});            // simulate 10 s at 60 fps holding keys; returns Game
 *   H.press('Space'); H.click(640,360);    // one-frame key press / click (then advance frames with H.run)
 *   H.shot('name');                        // render current frame -> tools/shots/name.png (view with Read tool)
 *   H.errors();                            // Game.errors (must be empty)
 *   Game.player.x = 3000 ...               // you can freely poke module state to stage scenarios
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));
const SRC = path.join(__dirname, '..', 'src');
const ORDER = ['core', 'world', 'webs', 'player', 'creatures', 'edu', 'audio', 'ui'];
const SHOTS = path.join(__dirname, 'shots');
let ctxG = null, canvas = null, Game = null;

function load(opts) {
  opts = opts || {};
  canvas = createCanvas(1280, 720);
  const store = {};
  const sandbox = {
    console, Math, Date, JSON, Object, Array, Set, Map, WeakMap, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Number, String, Boolean, Symbol, Error, RegExp, Promise, parseInt, parseFloat, isNaN, isFinite,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: {
      createElement: (t) => { if (t === 'canvas') return createCanvas(300, 150); return {}; },
      getElementById: () => canvas, readyState: 'complete',
    },
    requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  ctxG = vm.createContext(sandbox);
  ORDER.forEach(n => {
    const f = path.join(SRC, n + '.js');
    if (!fs.existsSync(f)) { if (opts.verbose) console.log('[harness] missing', n); return; }
    try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctxG, { filename: f }); }
    catch (e) { console.error('[harness] LOAD ERROR in ' + n + '.js:', e.message); if (!opts.tolerant) throw e; }
  });
  Game = sandbox.Game;
  Game.boot(canvas);
  return Game;
}
function newGame() { Game.newGame(); return Game; }
function run(seconds, o) {
  o = o || {}; const keys = o.keys || []; const fps = o.fps || 60; const n = Math.round(seconds * fps);
  keys.forEach(k => Game.input.inject.keyDown(k));
  for (let i = 0; i < n; i++) {
    if (o.onFrame) o.onFrame(i, Game);
    Game.step(1 / fps);
    if (o.render && (i % o.render === 0)) Game.render();
  }
  keys.forEach(k => Game.input.inject.keyUp(k));
  return Game;
}
function press(code) { Game.input.inject.keyDown(code); Game.step(1 / 60); Game.input.inject.keyUp(code); Game.step(1 / 60); }
function click(x, y) { Game.input.inject.click(x, y); Game.step(1 / 60); Game.step(1 / 60); }
function shot(name) {
  Game.render();
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, name + '.png');
  fs.writeFileSync(f, canvas.toBuffer('image/png'));
  return f;
}
function errors() { return Game.errors; }
module.exports = { load, newGame, run, press, click, shot, errors, get Game() { return Game; }, get canvas() { return canvas; } };

if (require.main === module) {
  const secs = parseFloat(process.argv[2]) || 20; const shots = process.argv.includes('--shots');
  const G = load({ verbose: true, tolerant: true });
  console.log('modules:', Object.keys(G.modules).join(', '));
  if (shots) shot('00_title');
  newGame();
  console.log('start', JSON.stringify(G.snapshot()));
  let t0 = Date.now();
  run(secs, { keys: ['KeyD'], render: 30 });
  console.log('after walk', JSON.stringify(G.snapshot()), 'ms/frame(sim+render)=', ((Date.now() - t0) / (secs * 60)).toFixed(2));
  if (shots) shot('01_walk');
  console.log('errors:', G.errors.length); G.errors.slice(0, 10).forEach(e => console.log(' -', e.where, e.message));
  process.exit(G.errors.length ? 1 : 0);
}
