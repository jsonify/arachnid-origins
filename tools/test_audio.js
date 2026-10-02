// Audio tests with a strict mock AudioContext.   node tools/test_audio.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'));

const stats = { nodes: 0, live: 0, maxLive: 0, started: 0, violations: [] };
function bad(m) { stats.violations.push(m); if (stats.violations.length < 40) console.log('VIOLATION', m); }

let ctxTime = 0;
class Param {
  constructor(name, v) { this.name = name; this._v = v; this.last = 0; }
  get value() { return this._v; }
  set value(v) { if (typeof v !== 'number' || !isFinite(v)) bad(this.name + '.value=' + v); this._v = v; }
  _chk(fn, v, t) {
    if (typeof v !== 'number' || !isFinite(v)) bad(this.name + '.' + fn + ' non-finite value ' + v);
    if (typeof t !== 'number' || !isFinite(t)) bad(this.name + '.' + fn + ' non-finite time ' + t);
  }
  setValueAtTime(v, t) { this._chk('setValueAtTime', v, t); this.last = t; this.has = true; return this; }
  linearRampToValueAtTime(v, t) { this._chk('linearRamp', v, t); return this; }
  exponentialRampToValueAtTime(v, t) { this._chk('expRamp', v, t); if (!(v > 0)) bad(this.name + ' expRamp target<=0 ' + v); if (!this.has) bad(this.name + ' expRamp without prior setValueAtTime'); return this; }
  setTargetAtTime(v, t, tc) { this._chk('setTarget', v, t); if (!(tc > 0)) bad(this.name + ' setTarget tc ' + tc); return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
  setValueCurveAtTime() { return this; }
}
class Node {
  constructor(kind) { this.kind = kind; stats.nodes++; this.out = []; this.connected = false; }
  connect(n) { if (!n || !(n instanceof Node || n instanceof Param)) bad(this.kind + '.connect bad target'); this.out.push(n); return n; }
  disconnect() { this.out = []; }
}
class Gain extends Node { constructor() { super('gain'); this.gain = new Param('gain', 1); } }
class Filt extends Node { constructor() { super('biquad'); this.type = 'lowpass'; this.frequency = new Param('freq', 350); this.Q = new Param('Q', 1); this.gain = new Param('fgain', 0); this.detune = new Param('fdet', 0); } }
class Pan extends Node { constructor() { super('pan'); this.pan = new Param('pan', 0); } }
class Osc extends Node {
  constructor() { super('osc'); this.type = 'sine'; this.frequency = new Param('ofreq', 440); this.detune = new Param('odet', 0); }
  start(t) { if (this.started) bad('osc start twice'); if (t != null && !isFinite(t)) bad('osc.start non-finite'); this.started = true; stats.started++; stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live); }
  stop(t) { if (!this.started) bad('osc stop before start'); if (t != null && !isFinite(t)) bad('osc.stop non-finite'); if (!this.stopped) { this.stopped = true; stats.live--; } }
}
class BufSrc extends Node {
  constructor() { super('bufsrc'); this.buffer = null; this.loop = false; this.playbackRate = new Param('rate', 1); }
  start(t, off, dur) { if (this.started) bad('bufsrc start twice'); if (!this.buffer) bad('bufsrc start without buffer'); if (off != null && (!isFinite(off) || off < 0)) bad('bufsrc offset ' + off); if (this.buffer && off > this.buffer.duration) bad('bufsrc offset beyond buffer'); this.started = true; stats.started++; stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live); }
  stop() { if (!this.started) bad('bufsrc stop before start'); if (!this.stopped) { this.stopped = true; stats.live--; } }
}
class Comp extends Node { constructor() { super('comp'); ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach(k => { this[k] = new Param(k, 0); }); this.reduction = 0; } }
class Conv extends Node { constructor() { super('conv'); this.buffer = null; this.normalize = true; } }
class Buf { constructor(ch, len, sr) { if (!(len > 0)) bad('createBuffer len ' + len); this.ch = []; for (let i = 0; i < ch; i++) this.ch.push(new Float32Array(Math.max(1, len))); this.length = len; this.sampleRate = sr; this.duration = len / sr; this.numberOfChannels = ch; } getChannelData(i) { return this.ch[i]; } }
class MockAC {
  constructor() { this.sampleRate = 44100; this.state = 'suspended'; this.destination = new Node('dest'); this.listener = {}; }
  get currentTime() { return ctxTime; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createGain() { return new Gain(); }
  createBiquadFilter() { return new Filt(); }
  createStereoPanner() { return new Pan(); }
  createOscillator() { return new Osc(); }
  createBufferSource() { return new BufSrc(); }
  createDynamicsCompressor() { return new Comp(); }
  createConvolver() { return new Conv(); }
  createBuffer(c, l, s) { return new Buf(c, l, s); }
}

function load(withAC) {
  const canvas = createCanvas(1280, 720), store = {};
  const sb = { console, Math, Date, JSON, Object, Array, Set, Map, WeakMap, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Number, String, Boolean, Symbol, Error, RegExp, Promise, parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { createElement: t => (t === 'canvas' ? createCanvas(300, 150) : {}), getElementById: () => canvas, readyState: 'complete' }, requestAnimationFrame: () => 0 };
  if (withAC) sb.AudioContext = MockAC;
  sb.window = sb; sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
  ['core', 'world', 'audio'].forEach(n => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', n + '.js'), 'utf8'), sb, { filename: n + '.js' }));
  sb.Game.boot(canvas); return sb.Game;
}

let fail = 0;
function check(c, m) { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); }

// ---------- 1) no AudioContext
{
  const G = load(false);
  G.newGame();
  let threw = false;
  try { G.audio.unlock(); G.audio.setMuted(true); G.audio.setMuted(false); Object.values(G.C.SFX).forEach(n => G.emit('sfx', { name: n })); for (let i = 0; i < 120; i++) G.step(1 / 60); } catch (e) { threw = e; }
  check(!threw, 'no AudioContext: nothing throws ' + (threw || ''));
  check(G.errors.length === 0, 'no AudioContext: Game.errors empty (' + G.errors.length + ')');
}

// ---------- 2) mock AudioContext
{
  const G = load(true);
  G.newGame();
  const A = G.audio;
  check(typeof A.unlock === 'function' && typeof A.setMuted === 'function', 'API present');
  A.unlock();
  check(A.ctx != null, 'unlock creates context');
  const tick = (n, dt) => { for (let i = 0; i < n; i++) { ctxTime += dt || 1 / 60; G.step(dt || 1 / 60); } };
  tick(60);
  const names = Object.values(G.C.SFX);
  check(names.length >= 25, 'SFX names count ' + names.length);
  // every sfx, non-positional and positional (near/far/left/right)
  const p = G.player ? { x: G.camera.x, y: G.camera.y } : { x: 320, y: 1800 };
  names.forEach(n => {
    const before = stats.nodes;
    G.emit('sfx', { name: n });
    G.emit('sfx', { name: n, x: p.x + 300, y: p.y });
    G.emit('sfx', { name: n, x: p.x - 900, y: p.y + 100 });
    G.emit('sfx', { name: n, x: p.x + 5000, y: p.y });
    ctxTime += 0.6; tick(3);
    if (stats.nodes === before) console.log('  note: sfx "' + n + '" created no nodes');
  });
  check(G.errors.length === 0, 'all SFX: Game.errors empty (' + G.errors.length + ')');
  G.errors.slice(0, 5).forEach(e => console.log(' ', e.where, e.message, (e.stack || '').split('\n').slice(0, 3).join('|')));

  // voice flood
  for (let i = 0; i < 400; i++) G.emit('sfx', { name: names[i % names.length] });
  tick(2);
  console.log('  live voices after flood', stats.live, 'max', stats.maxLive);

  // world state sweep
  const W = G.world;
  const times = [0.02, 0.2, 0.5, 0.47, 0.75, 0.97];
  const weathers = [['clear', 0], ['rain', 0.9], ['drizzle', 0.6], ['wind', 0.9], ['fog', 0.9]];
  const zonesX = [300, 3300, 5200];
  G.state.danger = 0;
  zonesX.forEach(zx => {
    if (G.camera) { G.camera.x = zx; G.camera.y = 1800; }
    const pl = G.player; if (pl && pl.pos) { pl.pos.x = zx; pl.pos.y = 1800; } else if (pl && pl.x != null) { pl.x = zx; pl.y = 1800; }
    times.forEach(t => weathers.forEach(w => {
      W.setTime(t); W.forceWeather(w[0], w[1]);
      G.state.danger = (Math.random() < 0.3) ? Math.random() : 0;
      tick(30, 1 / 30);
    }));
  });
  check(G.errors.length === 0, 'state sweep: Game.errors empty (' + G.errors.length + ')');
  G.errors.slice(0, 5).forEach(e => console.log(' ', e.where, e.message, (e.stack || '').split('\n').slice(0, 3).join('|')));
  // long run so scheduled music/birds/crickets fire
  W.setTime(0.9); W.forceWeather('clear', 0);
  tick(600, 1 / 20);
  W.setTime(0.75); tick(600, 1 / 20);
  W.setTime(0.3); tick(600, 1 / 20);
  check(G.errors.length === 0, 'long run: Game.errors empty (' + G.errors.length + ')');
  G.errors.slice(0, 5).forEach(e => console.log(' ', e.where, e.message, (e.stack || '').split('\n').slice(0, 3).join('|')));

  // mute / settings
  const s = G.settings; s.master = 0.5; s.music = 0; s.sfx = 1; A.setMuted(true); tick(30); A.setMuted(false); tick(30);
  s.muted = true; tick(10); s.muted = false; tick(10);
  check(typeof A.isMuted === 'function' ? A.isMuted() === false : true, 'unmute works');
  // scene changes
  ['title', 'play', 'gameover', 'victory', 'play'].forEach(sc => { try { G.emit('scene:change', { to: sc, from: 'x' }); } catch (e) { check(false, 'scene ' + sc + ' ' + e); } tick(20); });
  A.reset(); tick(30);
  check(G.errors.length === 0, 'settings/scene/reset: Game.errors empty (' + G.errors.length + ')');
  G.errors.slice(0, 5).forEach(e => console.log(' ', e.where, e.message, (e.stack || '').split('\n').slice(0, 3).join('|')));
  check(stats.violations.length === 0, 'AudioParam violations: ' + stats.violations.length);
  console.log('nodes created', stats.nodes, 'sources started', stats.started, 'live now', stats.live, 'max live', stats.maxLive);
}
console.log(fail ? 'FAILED ' + fail : 'ALL OK');
process.exit(fail ? 1 : 0);
