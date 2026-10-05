/* ============================================================================
 * Arachnid Origins -- audio.js   (module `audio`, priority 60, alwaysUpdate)
 * Fully procedural Web Audio: synthesized SFX (positional), zone ambient beds,
 * crickets, dawn birds, rain / wind, danger heartbeat and a gentle generative
 * pentatonic pad music whose brightness follows the player's stage.
 * Never throws when AudioContext is missing (headless tests) - every entry
 * point degrades to a silent no-op.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util;
  const clamp = U.clamp, PI = Math.PI;
  const rand = (a, b) => a + Math.random() * (b - a);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const A = {
    name: 'audio', priority: 60, alwaysUpdate: true,
    ctx: null, ready: false, supported: false, state: 'none',
    voices: 0, maxVoices: 22, played: 0, dropped: 0,
  };

  // ---------------------------------------------------------------- graph state
  let ctx = null, master = null, comp = null, sfxBus = null, ambBus = null, musBus = null, ambFilter = null, rev = null, revIn = null;
  let whiteBuf = null, pinkBuf = null, brownBuf = null;
  const L = {};            // ambient layer nodes
  let padFilter = null;
  const voiceEnds = [];    // end times of live sfx voices
  const lastPlayed = {};   // per-name rate limiting
  let disabledSubs = {};

  // ------------------------------------------------------------------ helpers
  function mkNoise(kind) {
    const sr = ctx.sampleRate, len = Math.floor(sr * (kind === 'white' ? 2 : 6)), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    if (kind === 'white') for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    else if (kind === 'pink') { // Paul Kellet's economy pink filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
    } else { let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } }
    // crossfade the loop seam so looped beds never click
    const f = Math.min(2000, len >> 2);
    for (let i = 0; i < f; i++) { const k = i / f; d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k; }
    return buf;
  }
  function mkReverb(sec, decay) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec), buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.4 * t); d[i] = lp * Math.pow(1 - t, decay) * (i < 64 ? i / 64 : 1); }
    }
    return buf;
  }
  function gainNode(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function filt(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function panner(p) { if (!ctx.createStereoPanner) return null; const n = ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); return n; }
  function loopSrc(buf, rate) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; if (rate) s.playbackRate.value = rate; s.start(0, Math.random() * (buf.duration - 0.1)); return s; }
  function smooth(param, v, tc) { try { param.setTargetAtTime(v, ctx.currentTime, tc || 0.25); } catch (e) { param.value = v; } }

  // one-shot oscillator voice with an attack/exp-decay envelope
  function osc(out, type, f0, f1, t, dur, vol, atk, lp, vib) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); atk = Math.min(atk || 0.004, dur * 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = o;
    if (lp) { const f = filt('lowpass', lp, 0.7); o.connect(f); n = f; }
    n.connect(g); g.connect(out);
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    o.start(t); o.stop(t + dur + 0.05); return o;
  }
  // one-shot filtered noise burst; ftype: 'bandpass'|'highpass'|'lowpass', f0->f1 sweep
  function nz(out, t, dur, vol, ftype, f0, f1, q, atk, buf) {
    const s = ctx.createBufferSource(); s.buffer = buf || whiteBuf;
    const f = filt(ftype, f0, q == null ? 1 : q);
    f.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); atk = Math.min(atk || 0.003, dur * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * Math.max(0.01, s.buffer.duration - dur - 0.1)); s.stop(t + dur + 0.05); return s;
  }
  const BELL = [[1, 1, 1], [2.01, 0.34, 0.55], [2.76, 0.26, 0.4], [5.4, 0.1, 0.2]];
  function bell(out, f, t, vol, dur) { BELL.forEach(p => osc(out, 'sine', f * p[0], 0, t, dur * p[2], vol * p[1], 0.003)); }
  function pluck(out, f, t, vol, dur) { osc(out, 'triangle', f, 0, t, dur, vol, 0.004, Math.min(9000, f * 5)); osc(out, 'sine', f * 2, 0, t, dur * 0.5, vol * 0.25, 0.003); }
  function pad(out, f, t, dur, vol, atk) { [-6, 6].forEach(c => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = c; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk); g.gain.setValueAtTime(vol, t + Math.max(atk, dur - atk * 1.4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05); }); }

  // -------------------------------------------------------------------- SFX
  // each: (V) with V.t start time, V.out destination gain, V.r random 0..1
  const SFX = {
    step(V) { const t = V.t; nz(V.out, t, 0.035, 0.085, 'bandpass', 2600 * (0.8 + V.r * 0.4), 1900, 2.2, 0.002); osc(V.out, 'sine', 260 * (0.9 + V.r * 0.2), 160, t, 0.03, 0.03, 0.002); },
    sprint(V) { for (let i = 0; i < 3; i++) nz(V.out, V.t + i * 0.045, 0.03, 0.08, 'bandpass', 3000 + i * 250, 2100, 2.4, 0.002); },
    bite(V) { const t = V.t; nz(V.out, t, 0.06, 0.22, 'highpass', 1800, 2600, 0.8, 0.002); osc(V.out, 'sine', 210, 80, t, 0.09, 0.2, 0.002); osc(V.out, 'triangle', 520, 300, t, 0.04, 0.05, 0.002); },
    eat(V) { const t = V.t; for (let i = 0; i < 3; i++) { nz(V.out, t + i * 0.1, 0.08, 0.2, 'bandpass', 950 - i * 120, 420, 1.4, 0.004); nz(V.out, t + i * 0.1, 0.03, 0.1, 'highpass', 3200, 0, 0.7, 0.002); } osc(V.out, 'sine', 240, 170, t + 0.34, 0.1, 0.09, 0.01); },
    drink(V) { const t = V.t; for (let i = 0; i < 3; i++) osc(V.out, 'sine', 330 + i * 40, 620 + i * 60, t + i * 0.12, 0.1, 0.2, 0.006); nz(V.out, t, 0.4, 0.035, 'bandpass', 1300, 2100, 1.1, 0.05); },
    spin(V) { const t = V.t; nz(V.out, t, 0.6, 0.11, 'bandpass', 2000, 5400, 3, 0.12); osc(V.out, 'sine', 1100, 2000, t, 0.55, 0.03, 0.12); osc(V.out, 'sine', 1650, 2800, t + 0.05, 0.5, 0.015, 0.12); },
    web_place(V) { const t = V.t; pluck(V.out, 660, t, 0.22, 0.45); pluck(V.out, 990, t + 0.04, 0.12, 0.35); nz(V.out, t, 0.02, 0.08, 'highpass', 4000, 0, 0.7, 0.001); },
    web_snap(V) { const t = V.t; nz(V.out, t, 0.05, 0.28, 'highpass', 3000, 0, 0.7, 0.001); osc(V.out, 'triangle', 1300, 240, t, 0.22, 0.2, 0.002); osc(V.out, 'sine', 320, 110, t, 0.18, 0.12, 0.002); },
    trap(V) { const t = V.t; osc(V.out, 'sine', 160, 85, t, 0.38, 0.3, 0.004, 0, [11, 8]); nz(V.out, t, 0.12, 0.2, 'lowpass', 520, 200, 0.8, 0.003); osc(V.out, 'sine', 880, 700, t + 0.03, 0.22, 0.08, 0.004); },
    struggle(V) { const t = V.t; for (let i = 0; i < 4; i++) { osc(V.out, 'triangle', 130 - i * 8, 95, t + i * 0.075, 0.07, 0.14, 0.004, 900); nz(V.out, t + i * 0.075, 0.05, 0.05, 'bandpass', 700, 0, 1.2, 0.002); } },
    hurt(V) { const t = V.t; osc(V.out, 'triangle', 460, 170, t, 0.3, 0.26, 0.005, 2600); osc(V.out, 'sine', 230, 110, t, 0.3, 0.14, 0.005); nz(V.out, t, 0.05, 0.1, 'highpass', 1600, 0, 0.8, 0.002); },
    death(V) { const t = V.t; [392, 311, 233, 156].forEach((f, i) => { osc(V.out, 'triangle', f, f * 0.97, t + i * 0.36, 1.1, 0.2, 0.03, 1800); osc(V.out, 'sine', f / 2, 0, t + i * 0.36, 1.2, 0.12, 0.04); }); nz(V.out, t + 0.2, 1.8, 0.04, 'lowpass', 600, 120, 0.7, 0.4); },
    molt_start(V) { const t = V.t; nz(V.out, t, 1.7, 0.15, 'bandpass', 280, 2600, 2, 1.1); osc(V.out, 'sine', 170, 340, t, 1.8, 0.1, 0.9); osc(V.out, 'triangle', 255, 510, t + 0.1, 1.6, 0.05, 0.9, 1500); for (let i = 0; i < 9; i++) nz(V.out, t + 0.2 + i * 0.16 + Math.random() * 0.06, 0.025, 0.14, 'highpass', 2600, 0, 0.8, 0.001); },
    molt_end(V) { const t = V.t; [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(V.out, f, t + i * 0.1, 0.18, 1.1)); nz(V.out, t + 0.2, 0.7, 0.05, 'highpass', 6000, 0, 0.7, 0.2); },
    levelup(V) { const t = V.t; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(V.out, f, t + i * 0.085, 0.2, 0.9)); [523.25, 659.25, 783.99].forEach(f => bell(V.out, f, t + 0.4, 0.1, 1.4)); },
    ui_click(V) { const t = V.t; osc(V.out, 'sine', 700, 440, t, 0.07, 0.14, 0.002); nz(V.out, t, 0.02, 0.04, 'bandpass', 2500, 0, 1, 0.001); },
    ui_hover(V) { osc(V.out, 'sine', 1000, 1060, V.t, 0.04, 0.045, 0.004); },
    ui_back(V) { osc(V.out, 'sine', 430, 290, V.t, 0.1, 0.13, 0.003); },
    unlock(V) { const t = V.t; bell(V.out, 1318.5, t, 0.16, 1.3); bell(V.out, 1975.5, t + 0.12, 0.13, 1.4); bell(V.out, 2637, t + 0.25, 0.06, 1.2); nz(V.out, t, 0.6, 0.025, 'highpass', 7000, 0, 0.7, 0.1); },
    danger(V) { const t = V.t; for (let i = 0; i < 2; i++) { osc(V.out, 'sine', 110, 100, t + i * 0.42, 0.38, 0.28, 0.02, 500); osc(V.out, 'triangle', 165, 150, t + i * 0.42, 0.34, 0.14, 0.02, 500); } },
    splash(V) { const t = V.t; nz(V.out, t, 0.36, 0.2, 'bandpass', 800, 2600, 1.2, 0.012); osc(V.out, 'sine', 500, 1100, t + 0.05, 0.12, 0.1, 0.004); osc(V.out, 'sine', 700, 1300, t + 0.14, 0.09, 0.07, 0.004); },
    thunder(V) { const t = V.t; nz(V.out, t, 0.28, 0.3, 'highpass', 900, 0, 0.7, 0.002); nz(V.out, t, 0.7, 0.35, 'lowpass', 2200, 220, 0.8, 0.005, brownBuf); nz(V.out, t + 0.05, 3.4, 0.7, 'lowpass', 190, 55, 0.7, 0.12, brownBuf); nz(V.out, t + 0.6, 2.6, 0.3, 'lowpass', 140, 50, 0.7, 0.3, brownBuf); },
    wasp_buzz(V) { const t = V.t; osc(V.out, 'sawtooth', 190, 215, t, 0.75, 0.1, 0.06, 1100, [38, 14]); osc(V.out, 'sawtooth', 195, 221, t, 0.75, 0.06, 0.06, 900, [41, 10]); },
    bird_screech(V) { const t = V.t; osc(V.out, 'sine', 2000, 3600, t, 0.19, 0.14, 0.015, 5200, [30, 90]); osc(V.out, 'sine', 3700, 2100, t + 0.2, 0.24, 0.13, 0.01, 5200, [28, 80]); nz(V.out, t, 0.4, 0.03, 'bandpass', 3500, 0, 1.5, 0.05); },
    ant_hiss(V) { const t = V.t; nz(V.out, t, 0.36, 0.15, 'highpass', 4500, 0, 0.7, 0.05); nz(V.out, t, 0.3, 0.07, 'bandpass', 7000, 0, 2, 0.04); nz(V.out, t, 0.02, 0.08, 'bandpass', 3000, 0, 1, 0.001); },
    rest(V) { const t = V.t; [220, 277.2, 329.6].forEach((f, i) => pad(V.out, f, t + i * 0.1, 2.2, 0.06, 0.7)); nz(V.out, t, 1.5, 0.045, 'lowpass', 500, 200, 0.7, 0.5); },
    courtship(V) { const t = V.t; [659.25, 783.99, 880, 987.77, 880, 783.99, 987.77, 1174.7].forEach((f, i) => pluck(V.out, f, t + i * 0.17, 0.17, 0.8)); },
    egg(V) { const t = V.t; [261.6, 392, 523.25].forEach((f, i) => bell(V.out, f, t + i * 0.24, 0.2, 1.8)); nz(V.out, t + 0.4, 0.9, 0.025, 'highpass', 6500, 0, 0.7, 0.2); },
    revive(V) { const t = V.t; [392, 523.25, 659.25, 783.99].forEach((f, i) => bell(V.out, f, t + i * 0.12, 0.2, 1.5)); [196, 261.6, 329.6].forEach(f => pad(V.out, f, t, 2.4, 0.07, 0.5)); nz(V.out, t + 0.1, 0.9, 0.03, 'highpass', 6500, 0, 0.7, 0.25); },
    victory(V) { const t = V.t; [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => bell(V.out, f, t + i * 0.15, 0.17, 1.6)); [262, 330, 392, 523].forEach(f => pad(V.out, f, t + 0.1, 3.4, 0.07, 1.0)); },
    // the Widow Matriarch: a low rattling hiss that swells, a wet silk spit, and a ground-shaking slam
    boss_roar(V) { const t = V.t; nz(V.out, t, 1.1, 0.2, 'bandpass', 900, 260, 1.4, 0.18); osc(V.out, 'sawtooth', 92, 58, t, 1.0, 0.12, 0.12, 700, [19, 9]); osc(V.out, 'sawtooth', 138, 80, t, 0.9, 0.06, 0.14, 600, [23, 7]); nz(V.out, t, 0.9, 0.05, 'highpass', 5200, 0, 0.7, 0.2); },
    web_spit(V) { const t = V.t; nz(V.out, t, 0.2, 0.2, 'bandpass', 1500, 4200, 2.2, 0.01); osc(V.out, 'sine', 780, 260, t, 0.16, 0.12, 0.004); nz(V.out, t + 0.08, 0.16, 0.06, 'highpass', 5000, 0, 0.7, 0.04); },
    slam(V) { const t = V.t; osc(V.out, 'sine', 120, 38, t, 0.5, 0.42, 0.004); nz(V.out, t, 0.5, 0.3, 'lowpass', 900, 90, 0.8, 0.003, brownBuf); nz(V.out, t, 0.09, 0.2, 'highpass', 2200, 0, 0.7, 0.001); },
  };
  const WET = { boss_roar: 0.4, slam: 0.35, web_spit: 0.15, death: 0.55, revive: 0.5, victory: 0.5, egg: 0.5, unlock: 0.45, levelup: 0.35, molt_end: 0.4, courtship: 0.4, rest: 0.4, thunder: 0.35, web_place: 0.2, bird_screech: 0.3, wasp_buzz: 0.1, ui_click: 0, ui_hover: 0, ui_back: 0, step: 0.06, sprint: 0.06, spin: 0.2, splash: 0.2 };
  const PRIORITY = { boss_roar: 1, slam: 1, death: 1, revive: 1, victory: 1, levelup: 1, molt_start: 1, molt_end: 1, unlock: 1, hurt: 1, thunder: 1, egg: 1, courtship: 1, danger: 1, ui_click: 1, ui_back: 1, ui_hover: 1 };
  const MINGAP = { step: 0.07, sprint: 0.12, struggle: 0.12, ui_hover: 0.05, bite: 0.06, wasp_buzz: 0.5, ant_hiss: 0.3, splash: 0.12, drink: 0.2, eat: 0.2, spin: 0.15 };
  const NO_SPACE = { ui_click: 1, ui_hover: 1, ui_back: 1, unlock: 1, levelup: 1, molt_start: 1, molt_end: 1, death: 1, revive: 1, victory: 1, egg: 1, courtship: 1, danger: 1, rest: 1, thunder: 1 };

  function playSfx(name, o) {
    if (!ctx || !A.ready) return false;
    o = o || {};
    const fn = SFX[name] || SFX._generic;
    const t = ctx.currentTime + 0.01;
    // rate limit
    const gap = MINGAP[name] != null ? MINGAP[name] : 0.03;
    if (lastPlayed[name] != null && t - lastPlayed[name] < gap) return false;
    // voice cap
    for (let i = voiceEnds.length - 1; i >= 0; i--) if (voiceEnds[i] < t) voiceEnds.splice(i, 1);
    A.voices = voiceEnds.length;
    if (voiceEnds.length >= A.maxVoices && !PRIORITY[name]) { A.dropped++; return false; }
    if (voiceEnds.length >= A.maxVoices + 8) { A.dropped++; return false; }
    // positional pan / attenuation
    let vol = o.vol == null ? 1 : o.vol, pan = 0;
    if (o.x != null && o.y != null && !NO_SPACE[name]) {
      const cam = Game.camera, z = cam.zoom || 1, sx = (o.x - cam.x) * z, sy = (o.y - cam.y) * z, d = Math.hypot(sx, sy * 1.25);
      pan = clamp(sx / (C.VIEW_W * 0.55), -1, 1) * 0.85;
      const att = Math.pow(clamp(1 - d / 2600, 0, 1), 1.4);
      if (att < 0.015) return false;
      vol *= 0.18 + 0.82 * att;
    }
    lastPlayed[name] = t;
    const out = gainNode(Math.max(0, vol));
    const p = panner(pan);
    if (p) { out.connect(p); p.connect(sfxBus); } else out.connect(sfxBus);
    const wet = WET[name] != null ? WET[name] : 0.12;
    if (wet > 0 && revIn) { const s = gainNode(wet); out.connect(s); s.connect(revIn); }
    voiceEnds.push(t + (name === 'thunder' ? 5 : name === 'death' || name === 'victory' ? 4 : 1.8));
    A.played++;
    try { fn({ t, out, r: Math.random() }); } catch (e) { Game.reportError('audio.sfx:' + name, e); }
    return true;
  }
  SFX._generic = function (V) { osc(V.out, 'sine', 620, 540, V.t, 0.09, 0.12, 0.004); };

  // ------------------------------------------------------------ graph / unlock
  function buildGraph() {
    master = ctx.createGain(); master.gain.value = 0;
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 4; comp.attack.value = 0.006; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = gainNode(0.9); sfxBus.connect(master);
    musBus = gainNode(0.5); musBus.connect(master);
    ambFilter = filt('lowpass', 18000, 0.5); ambBus = gainNode(0.8); ambFilter.connect(ambBus); ambBus.connect(master);
    // shared reverb
    rev = ctx.createConvolver(); try { rev.buffer = mkReverb(2.6, 2.6); } catch (e) { rev = null; }
    revIn = gainNode(1); if (rev) { revIn.connect(rev); const rg = gainNode(0.8); rev.connect(rg); rg.connect(master); }
    whiteBuf = mkNoise('white'); pinkBuf = mkNoise('pink'); brownBuf = mkNoise('brown');
    buildAmbient(); buildMusic();
  }

  function buildAmbient() {
    // wind: pink noise through a wandering band
    L.windSrc = loopSrc(pinkBuf); L.windF = filt('bandpass', 520, 0.55); L.windG = gainNode(0.0);
    L.windSrc.connect(L.windF); L.windF.connect(L.windG); L.windG.connect(ambFilter);
    L.windLfo = ctx.createOscillator(); L.windLfo.frequency.value = 0.09; const wl = gainNode(240); L.windLfo.connect(wl); wl.connect(L.windF.frequency); L.windLfo.start();
    // litter: dry leaf rustle (noise with randomly gated amplitude)
    L.litSrc = loopSrc(whiteBuf); const lf = filt('bandpass', 3400, 0.7); L.litGate = gainNode(0); L.litG = gainNode(0);
    L.litSrc.connect(lf); lf.connect(L.litGate); L.litGate.connect(L.litG); L.litG.connect(ambFilter);
    L.litLow = loopSrc(pinkBuf, 0.7); const ll = filt('bandpass', 700, 0.6); const llg = gainNode(0.03); L.litLow.connect(ll); ll.connect(llg); llg.connect(L.litG);
    // bark: hollow resonant hum
    L.barkSrc = loopSrc(brownBuf); const bf = filt('lowpass', 210, 0.9); L.barkG = gainNode(0); L.barkSrc.connect(bf); bf.connect(L.barkG); L.barkG.connect(ambFilter);
    L.barkOsc = ctx.createOscillator(); L.barkOsc.type = 'sine'; L.barkOsc.frequency.value = 55; const bo = gainNode(0.12); L.barkOsc.connect(bo); bo.connect(L.barkG); L.barkOsc.start();
    L.barkAir = loopSrc(pinkBuf, 0.9); const ba = filt('bandpass', 1500, 2.2); const bag = gainNode(0.012); L.barkAir.connect(ba); ba.connect(bag); bag.connect(L.barkG);
    // garden: airy grass shimmer + faint bee drone
    L.gardSrc = loopSrc(pinkBuf, 1.1); const gf = filt('bandpass', 4200, 0.5); L.gardG = gainNode(0); L.gardSrc.connect(gf); gf.connect(L.gardG); L.gardG.connect(ambFilter);
    L.gardDrone = [0, 1].map(i => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 138 + i * 3.1; const f = filt('lowpass', 520, 0.8); const g = gainNode(0.012); o.connect(f); f.connect(g); g.connect(L.gardG); o.start(); return o; });
    // rain
    L.rainSrc = loopSrc(whiteBuf); const rf1 = filt('highpass', 700, 0.5), rf2 = filt('lowpass', 8500, 0.5); L.rainG = gainNode(0);
    L.rainSrc.connect(rf1); rf1.connect(rf2); rf2.connect(L.rainG); L.rainG.connect(ambFilter);
    L.rainLow = loopSrc(pinkBuf, 0.6); const rl = filt('lowpass', 320, 0.7); L.rainLowG = gainNode(0); L.rainLow.connect(rl); rl.connect(L.rainLowG); L.rainLowG.connect(ambFilter);
    // crickets: persistent sine voices gated by scheduled envelopes
    L.crickG = gainNode(0); L.crickG.connect(ambFilter);
    L.crickets = [[4300, -0.55, 1.1], [4750, 0.1, 1.45], [5200, 0.65, 0.95], [3900, -0.2, 1.7]].map((c) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = c[0];
      const g = gainNode(0), p = panner(c[1]); o.connect(g); if (p) { g.connect(p); p.connect(L.crickG); } else g.connect(L.crickG); o.start();
      return { o, g, next: ctx.currentTime + Math.random() * 2, iv: c[2], base: c[0] };
    });
    // danger: low beating drone + heartbeat thumps scheduled in update
    L.dangG = gainNode(0); L.dangG.connect(master);
    L.dangOsc = [55, 58.4].map(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = gainNode(0.5); o.connect(g); g.connect(L.dangG); o.start(); return o; });
    L.dangHigh = ctx.createOscillator(); L.dangHigh.type = 'triangle'; L.dangHigh.frequency.value = 233; const dh = filt('lowpass', 420, 0.7), dhg = gainNode(0.09); L.dangHigh.connect(dh); dh.connect(dhg); dhg.connect(L.dangG); L.dangHigh.start();
  }

  // ------------------------------------------------------------------- music
  const SCALE_MAJ = [0, 2, 4, 7, 9], SCALE_MIN = [0, 3, 5, 7, 10];
  const M = { next: 0, bellNext: 0, voices: [], key: 50, mode: 'maj', chordIdx: 0 };
  function buildMusic() {
    padFilter = filt('lowpass', 600, 0.6); padFilter.connect(musBus);
    if (revIn) { const s = gainNode(0.55); padFilter.connect(s); s.connect(revIn); }
    M.next = ctx.currentTime + 0.3; M.bellNext = ctx.currentTime + 4;
  }
  function scaleNotes(lo, hi, night) {
    const sc = night ? SCALE_MIN : SCALE_MAJ, out = [];
    for (let m = lo; m <= hi; m++) { const d = ((m - M.key) % 12 + 12) % 12; if (sc.indexOf(d) >= 0) out.push(m); }
    return out;
  }
  function musicTick(t, stage, night, level) {
    // chords
    if (t >= M.next) {
      const dur = rand(11, 16), roots = scaleNotes(M.key - 5, M.key + 5, night);
      let root = roots[(Math.random() * roots.length) | 0];
      const fifth = scaleNotes(root + 5, root + 9, night)[0] || root + 7, up = scaleNotes(root + 12, root + 19, night);
      const chord = [root, fifth, root + 12, up[(Math.random() * up.length) | 0] || root + 16];
      if (stage >= 2) chord.push(scaleNotes(root + 19, root + 26, night)[0] || root + 24);
      if (stage >= 4) chord.push(scaleNotes(root + 24, root + 31, night)[0] || root + 28);
      for (let i = M.voices.length - 1; i >= 0; i--) if (M.voices[i] < t) M.voices.splice(i, 1);
      chord.forEach((m, i) => { if (M.voices.length >= 10) return; const v = (i === 0 ? 0.075 : 0.05) * (1 - i * 0.06); pad(padFilter, mtof(m), t + i * 0.25, dur + 6, v, 3.6); M.voices.push(t + dur + 6); });
      M.next = t + dur;
    }
    // sparse bells / arpeggios; brighter and busier with stage
    if (t >= M.bellNext) {
      const hi = scaleNotes(M.key + 24, M.key + 38, night), n = hi[(Math.random() * hi.length) | 0];
      if (n) {
        const out = musBus, wet = revIn ? gainNode(0.9) : null; const g = gainNode(1); g.connect(out); if (wet) { g.connect(wet); wet.connect(revIn); }
        bell(g, mtof(n), t, 0.05 + stage * 0.008, 2.6);
        if (stage >= 3 && Math.random() < 0.55) { const run = scaleNotes(n, n + 12, night); for (let k = 1; k < Math.min(4, run.length); k++) bell(g, mtof(run[k]), t + k * 0.22, 0.04, 2.2); }
      }
      M.bellNext = t + rand(3.0, 8.0) * (1.2 - stage * 0.12);
    }
  }

  // ---------------------------------------------------------------- scheduling
  const S = { rustleT: 0, creakT: 0, beeT: 0, birdT: 0, dropT: 0, beatT: 0, lastNight: 0 };
  function sub(name, fn) { if (disabledSubs[name]) return; try { fn(); } catch (e) { disabledSubs[name] = (disabledSubs[name] || 0) + 1; Game.reportError('audio.' + name, e); if (disabledSubs[name] > 3) disabledSubs[name] = true; } }

  function chirpGroup(v, t, level) {
    const n = 3 + (Math.random() < 0.3 ? 1 : 0), g = v.g.gain;
    for (let i = 0; i < n; i++) { const tt = t + i * 0.075; g.setValueAtTime(0.0001, tt); g.linearRampToValueAtTime(0.1 * (0.8 + Math.random() * 0.3), tt + 0.012); g.linearRampToValueAtTime(0.0001, tt + 0.05); }
  }
  function birdSong(t, vol) {
    const p = panner(rand(-0.8, 0.8)), out = gainNode(vol); const lp = filt('lowpass', 6500, 0.5); out.connect(lp);
    if (p) { lp.connect(p); p.connect(ambBus); } else lp.connect(ambBus);
    if (revIn) { const s = gainNode(0.6); lp.connect(s); s.connect(revIn); }
    const sp = (Math.random() * 4) | 0, base = rand(2500, 3500);
    if (sp === 0) { const n = 2 + ((Math.random() * 2) | 0); for (let i = 0; i < n; i++) osc(out, 'sine', base, base * 1.18, t + i * 0.16, 0.1, 0.5, 0.01, 0, [24, 40]); }
    else if (sp === 1) { for (let i = 0; i < 12; i++) osc(out, 'sine', base * (i % 2 ? 1.12 : 1), 0, t + i * 0.05, 0.04, 0.35, 0.004); }
    else if (sp === 2) { osc(out, 'sine', base * 1.25, base * 0.72, t, 0.45, 0.5, 0.03, 0, [6, 70]); osc(out, 'sine', base * 1.1, base * 0.7, t + 0.55, 0.35, 0.4, 0.03, 0, [6, 50]); }
    else { osc(out, 'sine', base * 0.8, base * 0.82, t, 0.2, 0.5, 0.02); osc(out, 'sine', base * 1.02, base * 1.0, t + 0.24, 0.24, 0.5, 0.02); osc(out, 'sine', base * 0.8, base * 0.78, t + 0.55, 0.3, 0.4, 0.02); }
  }
  function beeFlyby(t) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(); o.type = 'sawtooth'; o2.type = 'sawtooth'; const f0 = rand(190, 250); o.frequency.setValueAtTime(f0, t); o2.frequency.setValueAtTime(f0 * 1.012, t);
    const bp = filt('bandpass', 620, 1.1), g = gainNode(0), p = panner(-0.9), dur = rand(2.2, 3.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    if (p) p.pan.linearRampToValueAtTime(0.9, t + dur);
    const vib = ctx.createOscillator(), vg = gainNode(5); vib.frequency.value = 38; vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency); vib.start(t); vib.stop(t + dur + 0.1);
    o.connect(bp); o2.connect(bp); bp.connect(g); if (p) { g.connect(p); p.connect(ambBus); } else g.connect(ambBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
  function creak(t) { const out = gainNode(1); out.connect(ambBus); const f = rand(130, 220); osc(out, 'triangle', f, f * rand(0.7, 0.85), t, rand(0.5, 0.9), 0.035, 0.1, 500, [rand(9, 16), 12]); }
  function heartbeat(t, strength) {
    const out = gainNode(0.5 * strength); out.connect(master);
    osc(out, 'sine', 70, 42, t, 0.16, 1, 0.004); osc(out, 'sine', 62, 38, t + 0.2, 0.2, 0.75, 0.004);
  }

  function playerPos() {
    const t = Game.camera.target || Game.player;
    return (t && typeof t.x === 'number') ? t : Game.camera;
  }

  A.update = function (dt) {
    if (!ctx || !A.ready) return;
    const t = ctx.currentTime, st = Game.settings || {}, scene = Game.state.scene, w = Game.world, P = Game.player;
    // ---- master volumes from settings
    const muted = !!st.muted;
    const sceneDuck = scene === 'paused' ? 0.55 : (scene === 'gameover' ? 0.7 : 1);
    smooth(master.gain, muted ? 0 : clamp(st.master == null ? 0.8 : st.master, 0, 1) * 0.9, 0.06);
    smooth(sfxBus.gain, clamp(st.sfx == null ? 0.9 : st.sfx, 0, 1), 0.06);
    smooth(ambBus.gain, clamp(st.sfx == null ? 0.9 : st.sfx, 0, 1) * 0.85 * (scene === 'paused' ? 0.6 : 1), 0.15);
    const danger = clamp(Game.state.danger || 0, 0, 1);
    const stage = P && typeof P.stage === 'number' ? P.stage : 0;
    let mlevel = clamp(st.music == null ? 0.6 : st.music, 0, 1) * 0.55;
    if (scene === 'paused') mlevel *= 0.45; else if (scene === 'gameover') mlevel *= 0.25; else if (scene === 'molting') mlevel *= 0.8;
    smooth(musBus.gain, mlevel * (1 - 0.5 * danger), 0.4);

    // ---- world state
    let night = 0, rain = 0, drizzle = 0, wind = 0, fog = 0, dawn = 0, zone = 'litter';
    if (w) {
      night = clamp(w.night != null ? w.night : (1 - (w.light || 1)), 0, 1);
      const fx = w.fx; if (fx) { rain = fx.rain; drizzle = fx.drizzle; wind = fx.wind; fog = fx.fog; }
      else if (w.weather) { const ty = w.weather.type, it = w.weather.intensity || 0; rain = ty === 'rain' ? it : 0; drizzle = ty === 'drizzle' ? it : 0; wind = ty === 'wind' ? it : 0; fog = ty === 'fog' ? it : 0; }
      if (w.phase === 'dawn') dawn = 1; else if (w.phase === 'day' && w.time01 < 0.16) dawn = 0.55; else if (w.phase === 'day') dawn = 0.1;
      try { const pp = playerPos(), z = w.zoneAt ? w.zoneAt(pp.x, pp.y) : null; if (z) zone = z.id; } catch (e) { /* ignore */ }
    }
    const hidden = !!(P && P.hidden);
    const rainAmt = clamp(rain + drizzle * 0.55, 0, 1.2);

    // ---- ambient beds
    smooth(L.windG.gain, 0.045 + wind * 0.5 + rain * 0.12, 0.8);
    smooth(L.windF.frequency, 380 + wind * 520 + rain * 120, 0.5);
    smooth(L.litG.gain, zone === 'litter' ? 0.8 : 0, 1.5);
    smooth(L.barkG.gain, zone === 'bark' ? 0.55 : 0, 1.5);
    smooth(L.gardG.gain, zone === 'garden' ? 0.55 * (1 - night * 0.6) : 0, 1.5);
    smooth(L.rainG.gain, rain * 0.2 + drizzle * 0.08, 0.7);
    smooth(L.rainLowG.gain, rain * 0.18, 0.9);
    smooth(L.crickG.gain, night * (1 - clamp(rainAmt * 1.4, 0, 1)) * 0.5, 1.5);
    smooth(ambFilter.frequency, hidden ? 2400 : (fog > 0.1 ? 11000 - fog * 5000 : 18000), 0.35);
    const dg = Math.pow(danger, 1.3) * 0.2; smooth(L.dangG.gain, dg, 0.3);

    sub('rustle', () => { // leaf rustle crackle: random gate targets
      if (zone === 'litter' && t >= S.rustleT) { L.litGate.gain.setTargetAtTime(Math.random() < 0.5 ? rand(0.015, 0.075) * (0.7 + wind) : 0.004, t, 0.03); S.rustleT = t + rand(0.06, 0.28); }
    });
    sub('creak', () => { if (zone === 'bark' && t >= S.creakT) { creak(t + 0.05); S.creakT = t + rand(7, 16); } else if (S.creakT === 0) S.creakT = t + rand(2, 6); });
    sub('bees', () => { if (zone === 'garden' && night < 0.4 && rainAmt < 0.2 && t >= S.beeT) { beeFlyby(t + 0.1); S.beeT = t + rand(9, 22); } else if (S.beeT === 0) S.beeT = t + rand(3, 9); });
    sub('crickets', () => {
      const lvl = night * (1 - rainAmt);
      if (lvl > 0.12) L.crickets.forEach(v => { while (v.next < t + 0.6) { chirpGroup(v, Math.max(v.next, t), lvl); v.next += v.iv * rand(0.85, 1.25) * (1.4 - lvl * 0.4); } });
      else L.crickets.forEach(v => { if (v.next < t) v.next = t + rand(0.1, 1.5); });
    });
    sub('birds', () => {
      const lvl = dawn * (1 - rainAmt * 1.2) * (zone === 'bark' ? 0.6 : 1);
      if (lvl > 0.08 && t >= S.birdT) { const n = 1 + ((Math.random() * 2) | 0); for (let i = 0; i < n; i++) birdSong(t + 0.05 + i * rand(0.4, 1.2), 0.07 * lvl * rand(0.7, 1.2)); S.birdT = t + rand(2.0, 5.5) / Math.max(0.35, lvl); }
    });
    sub('drops', () => {
      if (rainAmt > 0.12 && t >= S.dropT) {
        const out = gainNode(1), p = panner(rand(-0.9, 0.9)); if (p) { out.connect(p); p.connect(ambBus); } else out.connect(ambBus);
        osc(out, 'sine', rand(1500, 4200), 0, t + 0.02, 0.03, rand(0.012, 0.03), 0.002);
        S.dropT = t + rand(0.05, 0.35) / (0.4 + rainAmt);
      }
    });
    sub('heart', () => {
      if (danger > 0.12 && t >= S.beatT) { heartbeat(t + 0.02, 0.35 + danger * 0.65); S.beatT = t + clamp(1.15 - danger * 0.7, 0.42, 1.2); }
      else if (danger <= 0.12 && S.beatT < t) S.beatT = t;
    });
    sub('music', () => {
      if (mlevel > 0.002) {
        const nightMode = night > 0.55;
        // lookahead: schedule slightly ahead of now
        musicTick(t + 0.05, stage, nightMode, mlevel);
      }
      // brightness follows stage; muffled while hidden
      const cutoff = (420 + stage * 560 + danger * 500) * (hidden ? 0.6 : 1);
      smooth(padFilter.frequency, cutoff, 1.2);
    });
  };

  // ----------------------------------------------------------------- public API
  A.unlock = function () {
    if (A.ready) { if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } } return; }
    if (ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { A.state = 'unsupported'; return; }
    try {
      ctx = new AC(); A.ctx = ctx; A.supported = true;
      buildGraph();
      A.ready = true; A.state = ctx.state;
      if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(() => { }); }
    } catch (e) {
      Game.reportError('audio.unlock', e); ctx = null; A.ctx = null; A.ready = false; A.state = 'error';
    }
  };
  A.setMuted = function (b) {
    Game.settings.muted = !!b;
    try { if (Game.saveSettings) Game.saveSettings(); } catch (e) { /* ignore */ }
    if (ctx && master) smooth(master.gain, b ? 0 : clamp(Game.settings.master, 0, 1) * 0.9, 0.05);
  };
  A.isMuted = () => !!Game.settings.muted;
  A.play = (name, o) => { try { return playSfx(name, o); } catch (e) { Game.reportError('audio.play', e); return false; } };

  A.init = function () {
    Game.on('sfx', (e) => { if (e && e.name) A.play(e.name, e); });
    // resume after tab switches (browsers may suspend the context)
    if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', () => { if (ctx && !root.document.hidden && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } } });
    Game.on('scene:change', (e) => {
      if (!e) return;
      if (e.to === 'gameover') A.play('death');
      else if (e.to === 'victory') A.play('victory');
    });
  };
  A.reset = function () {
    S.birdT = S.rustleT = S.beeT = S.creakT = 0; S.beatT = 0; disabledSubs = {};
    if (ctx) { M.next = Math.min(M.next, ctx.currentTime + 0.5); }
  };

  Game.register('audio', A);
})();
