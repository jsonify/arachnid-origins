/* ============================================================================
 * Arachnid Origins  --  webs.js   (module `webs`, priority 20, owner: Agent B)
 * Silk & webs: dragline, sheet web, orb web, silk retreat.
 *
 * WHAT EACH WEB CATCHES (creature radius r in world px, c.flying, c.role):
 *   line    (dragline) : small prey only, r <= 4.  Walking prey: any line.
 *                        Flying prey: only a line "strung high" = anchored at BOTH
 *                        ends to natural anchors (anchorA && anchorB).  Bigger walkers
 *                        (r >= 9) trample/snap it; 4 < r < 9 simply cross it.
 *   sheet               : WALKING prey up to r <= 18.  Flyers pass over it.
 *   orb                 : flying AND walking prey up to r <= 20.
 *   retreat             : catches nothing (shelter only: isSheltered()).
 *   Anything bigger than a web's limit tears it (integrity -0.55..-0.7 per contact,
 *   cause 'torn'/'predator').  Predators: only tiny ones (r <= 0.6 * limit) get stuck,
 *   bigger predators (r >= 6) rip webs; role 'spider' (wolf, jumping, kin, mate) ignore
 *   webs entirely.  Dead / already-stuck creatures are ignored.
 *
 * Extra public API beyond the contract: shake(web,amt,x,y), unlocked(type), cost(type),
 *   sheltered(x,y)->web, info(web)->string[], spinTimer, lastFail, ghostOn.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register || !Game.util || !Game.C) return; // never throw at load time
  const U = Game.util, C = Game.C;
  const TAU = Math.PI * 2;
  const MAX_WEBS = 40;
  const ORDER = ['line', 'sheet', 'orb', 'retreat'];

  // per-type tuning. hold = biggest creature radius that gets stuck. life = seconds of natural decay.
  const TYPE = {
    line:    { build: 0.55, life: 230, hold: 4,  wind: 1.5, rain: 1.4, spinCd: 0.35 },
    sheet:   { build: 1.15, life: 330, hold: 18, wind: 0.9, rain: 1.0, spinCd: 0.6 },
    orb:     { build: 1.70, life: 300, hold: 20, wind: 1.2, rain: 1.2, spinCd: 0.8 },
    retreat: { build: 1.25, life: 640, hold: 0,  wind: 0.5, rain: 0.35, spinCd: 0.8 },
  };

  let nextId = 1;
  let T = 0;                       // visual clock (Game.time.real)
  let DX = 0, DY = 0;              // scratch displacement result
  const SCR_X = new Float32Array(2048), SCR_Y = new Float32Array(2048);
  const RIM_X = new Float32Array(64), RIM_Y = new Float32Array(64);
  const near = [];                 // scratch: creatures near the player/camera

  // view/frame state shared by draw helpers
  const V = { z: 1.5, px: 1 / 1.5, x0: 0, y0: 0, x1: 0, y1: 0, lod: 2 };
  const env = { frame: -1, rain: 0, wind: 0, frost: 0, wdx: 0.97, wdy: 0.24, wet: 0, dew: 0.1 };

  // ------------------------------------------------------------------ helpers
  const clamp = U.clamp;
  function sfx(name, x, y, vol) { Game.emit('sfx', { name: name, x: x, y: y, vol: vol == null ? 1 : vol }); }
  function now() { return Game.time.t; }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const x = x1 + dx * t - px, y = y1 + dy * t - py;
    return Math.sqrt(x * x + y * y);
  }
  // distance to the SAGGED dragline (matches what is drawn)
  function lineDist(w, x, y) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((x - w.x1) * dx + (y - w.y1) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const so = w.sag * 4 * t * (1 - t), cx = w.x1 + dx * t + w.nx * so - x, cy = w.y1 + dy * t + w.ny * so - y;
    return Math.sqrt(cx * cx + cy * cy);
  }
  function keep(rn, integ) { return rn < 0.25 + integ * 1.05; }
  function rgba(r, g, b, a) { return 'rgba(' + r + ',' + g + ',' + b + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')'; }

  function refreshEnv() {
    const f = Game.time.frame; if (env.frame === f) return; env.frame = f;
    const wd = Game.world, wt = wd && wd.weather;
    let rain = 0, wi = 0, wdx = 0.97, wdy = 0.24;
    if (wt) {
      const inten = wt.intensity == null ? 0.6 : wt.intensity;
      if (wt.type === 'rain') rain = inten; else if (wt.type === 'drizzle') rain = inten * 0.5;
      const wm = Math.hypot(wt.windX || 0, wt.windY || 0);
      wi = wm > 3 ? wm / 60 : wm; if (wi > 1) wi = 1;
      if (wt.type === 'wind') wi = Math.max(wi, inten); else if (rain > 0) wi = Math.max(wi, rain * 0.35);
      if (wm > 1e-3) { wdx = (wt.windX || 0) / wm; wdy = (wt.windY || 0) / wm; }
    }
    env.rain = rain; env.wind = wi; env.wdx = wdx; env.wdy = wdy;
    env.frost = (wt && wt.type === 'frost') ? (wt.intensity == null ? 0.6 : wt.intensity) : 0;   // a cold snap (Territory winter) cracks exposed silk
    const dt = Math.min(0.1, Game.time.dt || 0.016);
    env.wet += (Math.min(1, rain * 1.4) - env.wet) * Math.min(1, dt * (rain > env.wet ? 0.8 : 0.08));
    let dew = 0.12;
    if (wd) {
      const ph = wd.phase;
      dew = ph === 'dawn' ? 1 : ph === 'night' ? 0.3 : ph === 'dusk' ? 0.22 : 0.08;
      const t01 = wd.time01;
      if (typeof t01 === 'number' && ph !== 'dawn' && t01 < 0.16) dew = Math.max(dew, 1 - t01 / 0.16);
    }
    env.dew += (Math.max(dew, env.wet * 0.8) - env.dew) * Math.min(1, dt * 1.5);
  }

  // ------------------------------------------------------------ cached gradients (unit circles, scaled at draw time)
  let GRAD = {};
  function grads(ctx) {
    if (ctx.__wg) { GRAD = ctx.__wg; return GRAD; }
    const GR = GRAD = ctx.__wg = {};
    return makeGrads(ctx, GR);
  }
  function makeGrads(ctx, GRAD) {
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.35, 'rgba(210,235,255,0.22)'); g.addColorStop(1, 'rgba(180,215,255,0)'); GRAD.hub = g;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(244,249,255,0.30)'); g.addColorStop(0.6, 'rgba(228,240,255,0.17)'); g.addColorStop(1, 'rgba(215,232,255,0.07)'); GRAD.film = g;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(10,6,16,0.34)'); g.addColorStop(0.7, 'rgba(10,6,16,0.2)'); g.addColorStop(1, 'rgba(10,6,16,0)'); GRAD.shadow = g;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(252,250,255,0.66)'); g.addColorStop(0.55, 'rgba(238,244,255,0.46)'); g.addColorStop(0.9, 'rgba(216,230,252,0.34)'); g.addColorStop(1, 'rgba(216,230,252,0.22)'); GRAD.dome = g;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); GRAD.spec = g;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(8,5,12,0.82)'); g.addColorStop(0.65, 'rgba(14,10,22,0.62)'); g.addColorStop(1, 'rgba(24,18,34,0.2)'); GRAD.hole = g;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,250,235,0.9)'); g.addColorStop(0.4, 'rgba(255,240,200,0.35)'); g.addColorStop(1, 'rgba(255,230,180,0)'); GRAD.spark = g;
    return GRAD;
  }

  // ------------------------------------------------------------------ module
  const webs = {
    priority: 20,
    list: [],
    selected: null,
    spinTimer: 0,        // >0 while the spin animation plays (player.js may read this for stateLabel)
    lastFail: '',        // reason of the last refused spin / select (ui may flash it)
    failT: 0,
    ghostOn: false,
    maxWebs: MAX_WEBS,
    fx: [],              // short-lived visual effects (motes, rings)
    _cool: 0, _gate: 0, _ghostT: 0, _ghostCalc: 0, _ghost: null, _ghostKey: '', _ghostOk: true,
    _nextUpd: 0,

    init() {
      Game.addDrawer(Game.LAYER.WEBS, drawAll);
      Game.addDrawer(Game.LAYER.PLAYER + 5, drawCanopy);
      Game.on('stage:change', () => { try { ensureSelection(); } catch (e) { Game.reportError('webs.stage', e); } });
      Game.on('scene:change', (d) => { if (d && d.to === 'playing') webs._gate = 0.25; });
    },

    reset() {
      webs.list.length = 0; webs.fx.length = 0; webs.selected = null;
      webs.spinTimer = 0; webs.lastFail = ''; webs.failT = 0; webs.ghostOn = false;
      webs._cool = 0; webs._gate = 0.25; webs._ghostT = 0; webs._ghost = null; webs._ghostKey = '';
      env.wet = 0; env.frame = -1;
    },

    // ----------------------------------------------------------- public API
    cost(type) { const t = C.WEB_TYPES[type]; return t ? t.cost : 0; },

    unlocked(type) {
      const P = Game.player, wt = C.WEB_TYPES[type];
      if (!P || !wt) return false;
      const st = P.stage | 0, sd = C.STAGES[st];
      if (sd && sd.webs) return sd.webs.indexOf(type) >= 0;
      return st >= wt.stage;
    },

    select(type) {
      if (!TYPE[type]) return false;
      if (!webs.unlocked(type)) { fail('locked'); return false; }
      webs.selected = type; return true;
    },

    canSpin(type) {
      type = type || webs.selected;
      const P = Game.player;
      if (!type || !TYPE[type] || !P || P.dead || P.reviving || P.molting) return false;
      if (!webs.unlocked(type)) return false;
      return (P.silk || 0) >= webs.cost(type);
    },

    spin(type) {
      type = type || webs.selected;
      const P = Game.player;
      if (!type || !TYPE[type] || !P) return null;
      if (webs._cool > 0) return null;
      if (!webs.unlocked(type)) { fail('locked'); return null; }
      if (P.dead || P.reviving || P.molting) return null;
      if ((P.silk || 0) < webs.cost(type)) { fail('silk'); return null; }
      const ang = typeof P.angle === 'number' ? P.angle : 0;
      const w = newWeb(type, P.x, P.y, ang);
      if (tooClose(w)) { fail('overlap'); return null; }
      if (typeof P.useSilk !== 'function' || !P.useSilk(webs.cost(type))) { fail('silk'); return null; }
      w.born = now();
      webs.list.push(w);
      webs._cool = TYPE[type].spinCd;
      webs.spinTimer = Math.min(0.7, TYPE[type].build * 0.6);
      spawnSpinFx(w);
      Game.stat('webs');
      sfx('spin', w.x, w.y, 0.9);
      Game.emit('web:spun', { web: w, type: type });
      enforceLimit(w);
      return w;
    },

    isSheltered(x, y) { return !!webs.sheltered(x, y); },
    sheltered(x, y) {
      const L = webs.list;
      for (let i = 0; i < L.length; i++) {
        const w = L[i];
        if (w.type !== 'retreat' || w.dead || w.build < 0.7 || w.integrity < 0.08) continue;
        const rr = w.r * 0.86, dx = x - w.x, dy = y - w.y;
        if (dx * dx + dy * dy <= rr * rr) return w;
      }
      return null;
    },

    speedBonusAt(x, y) {
      const L = webs.list; let best = 1;
      for (let i = 0; i < L.length; i++) {
        const w = L[i];
        if (w.dead || w.build < 0.5 || w.type === 'retreat') continue;
        if (x < w.bx0 || x > w.bx1 || y < w.by0 || y > w.by1) continue;
        let b = 1;
        if (w.type === 'line') { if (lineDist(w, x, y) <= 11) b = w.anchoredBoth ? 1.45 : 1.3; }
        else if (w.type === 'sheet') { if (inSheet(w, x, y, 0)) b = 1.22; }
        else if (w.type === 'orb') { const dx = x - w.x, dy = y - w.y; if (dx * dx + dy * dy <= w.r * w.r) b = 1.12; }
        if (b > 1) { b = 1 + (b - 1) * (0.5 + 0.5 * w.integrity); if (b > best) best = b; }
      }
      return best;
    },

    nearestWeb(x, y, maxDist, filterFn) {
      const L = webs.list; let best = null, bd = maxDist == null ? 1e9 : maxDist;
      for (let i = 0; i < L.length; i++) {
        const w = L[i]; if (w.dead) continue;
        if (filterFn && !filterFn(w)) continue;
        const d = webDist(w, x, y);
        if (d <= bd) { bd = d; best = w; }
      }
      return best;
    },

    // Non-mutating: which web would catch/tear creature c right now? (webs.js also scans on its own.)
    checkCreature(c) {
      if (!c) return null;
      const L = webs.list;
      for (let i = 0; i < L.length; i++) {
        const w = L[i];
        if (w.dead || w.build < 0.85) continue;
        if (!touches(w, c)) continue;
        if (eligibility(w, c) === 1) return w;
      }
      return null;
    },

    vibration(web) { return web ? web.vib : 0; },

    // ---- Territory: heirloom webs. territory.js owns the rules (claim, slots, silk cost); this is the mechanics.
    setHeirloom(web, on) {
      if (!web || web.dying) return false;
      web.heirloom = !!on; web.pulse = Math.max(web.pulse, 0.8); web.pulseX = web.x != null ? web.x : (web.x1 + web.x2) / 2; web.pulseY = web.y != null ? web.y : (web.y1 + web.y2) / 2;
      return true;
    },
    heirlooms() { const o = []; for (let i = 0; i < webs.list.length; i++) { const w = webs.list[i]; if (w.heirloom && !w.dying) o.push(w); } return o; },
    // add integrity (0..1 scale); returns how much was actually restored
    repair(web, amount) {
      if (!web || web.dying || !(amount > 0)) return 0;
      const before = web.integrity; web.integrity = Math.min(1, web.integrity + amount);
      web.dmgCause = ''; web.pulse = Math.max(web.pulse, 0.6);
      return web.integrity - before;
    },
    // wear a web down by hand (a rival raiding it, a succession setback); destroys it at 0 unless `floor` keeps it alive
    damage(web, amount, cause, floor) {
      if (!web || web.dying || !(amount > 0)) return 0;
      const before = web.integrity; web.integrity = Math.max(floor == null ? -1 : floor, web.integrity - amount);
      web.dmgCause = cause || 'torn'; web.vib = Math.min(2.4, web.vib + 0.6);
      if (web.integrity <= 0) destroyWeb(web, web.dmgCause);
      return before - web.integrity;
    },
    // silently drop every web the test does not keep (Territory: the winter turnover keeps only heirloom webs); no fade, no events
    keepOnly(fn) { for (let i = webs.list.length - 1; i >= 0; i--) if (!fn(webs.list[i])) webs.list.splice(i, 1); },
    // eat the old silk: the web goes (it fades like any other) and its owner gets part of the silk back. Returns the silk given back.
    recycle(web, share) {
      if (!web || web.dying) return 0;
      const cost = webs.cost(web.type), give = Math.round(cost * (share == null ? 0.5 : share) * (0.4 + 0.6 * Math.min(1, web.integrity)));
      web.heirloom = false; destroyWeb(web, 'recycled');
      return give;
    },

    // Other modules (creatures) may shake a web: amount ~0.2..1.5, optional impact point.
    shake(web, amount, x, y) {
      if (!web) return;
      web.vib = Math.min(2.4, web.vib + (amount == null ? 0.5 : amount));
      if (x != null) { web.vx = x; web.vy = y; }
    },

    info(w) {
      if (!w) return [];
      const nm = (C.WEB_TYPES[w.type] && C.WEB_TYPES[w.type].name) || w.type;
      const out = [nm, 'Integrity: ' + Math.round(w.integrity * 100) + '%', 'Age: ' + Math.round(w.age) + ' s'];
      if (w.type === 'line') out.push(w.anchoredBoth ? 'Anchored at both ends' : 'One free end');
      if (w.type === 'orb') out.push('Anchor guy-lines: ' + (w.anchors || 0));
      if (w.trapped.length) out.push('Prey trapped: ' + w.trapped.length);
      return out;
    },

    // ----------------------------------------------------------- simulation
    update(dt) {
      refreshEnv();
      const P = Game.player;
      if (webs._cool > 0) webs._cool -= dt;
      if (webs._gate > 0) webs._gate -= dt;
      if (webs.spinTimer > 0) webs.spinTimer -= dt;
      if (webs.failT > 0) webs.failT -= dt;
      ensureSelection();

      // ---- input
      const canAct = P && !P.dead && !P.reviving && !P.molting && Game.state.scene === 'playing' && webs._gate <= 0 && Game.input;
      if (canAct) {
        for (let k = 1; k <= 4; k++) {
          if (Game.input.pressed('web' + k)) {
            const ty = typeFromKey(k);
            if (ty && webs.select(ty)) { sfx('ui_click', P.x, P.y, 0.5); webs._ghostT = 1.6; }
            else sfx('ui_back', P.x, P.y, 0.4);
          }
        }
        if (Game.input.pressed('spin')) { webs.failT = 0; if (!webs.spin() && webs.failT > 0 && webs.selected) sfx('ui_back', P.x, P.y, 0.45); }
      }
      if (webs._ghostT > 0) webs._ghostT -= dt;
      webs.ghostOn = !!(canAct && webs.selected && (webs._ghostT > 0 || Game.input.down('spin')));
      if (webs.ghostOn) updateGhost(dt);

      // ---- lifecycle
      const t = now(), L = webs.list;
      const wi = env.wind, rain = env.rain;
      for (let i = L.length - 1; i >= 0; i--) {
        const w = L[i];
        w.age += dt;
        if (w.build < 1) { w.build = Math.min(1, w.build + dt / w.buildDur); if (w.build >= 1 && !w.placed) { w.placed = true; onPlaced(w); } }
        if (w.vib > 0.003) w.vib *= Math.exp(-2.4 * dt); else w.vib = 0;
        if (w.pulse > 0) w.pulse = Math.max(0, w.pulse - dt * 1.4);
        if (w.dying) {
          w.fadeT += dt;
          w.fade = 1 - w.fadeT / 0.8;
          if (w.fade <= 0) { L.splice(i, 1); }
          continue;
        }
        const ty = TYPE[w.type];
        // natural decay (free-ended lines age faster)
        let rate = 1 / ty.life * (w.type === 'line' && !w.anchoredBoth ? 1.35 : 1);
        if (w.type === 'orb') rate *= 1.15 - 0.06 * Math.min(3, w.anchors || 0);
        let cause = 'decay', big = rate;
        // weather (exposure shields webs under cover)
        if (w.expoT <= t) { w.expoT = t + 1 + Math.random() * 0.5; w.expo = exposureAt(w.x, w.y); }
        if (rain > 0.02) { const d = rain * w.expo * 0.010 * ty.rain; rate += d; if (d > big) { big = d; cause = 'rain'; } }
        if (env.frost > 0.02) { const d = env.frost * w.expo * 0.011 * ty.rain; rate += d; if (d > big) { big = d; cause = 'frost'; } }
        if (wi > 0.15) {
          const d = wi * w.expo * 0.012 * ty.wind; rate += d; if (d > big) { big = d; cause = 'wind'; }
          // a hard gust can snap a thin line
          if (wi > 0.65 && w.type === 'line' && !w.anchoredBoth && Math.random() < (wi - 0.65) * 0.06 * w.expo * dt * 3) { w.integrity -= 0.5; w.dmgCause = 'wind'; w.vib += 0.8; }
        }
        w.integrity -= rate * dt;
        if (cause !== 'decay') w.dmgCause = cause; else if (!w.dmgCause) w.dmgCause = 'decay';
        w.integrity = Math.min(1, w.integrity);
        updateTrapped(w, dt, t);
        if (w.integrity <= 0) destroyWeb(w, w.dmgCause || 'decay');
      }

      // ---- creature contact
      if (L.length && Game.creatures && Game.creatures.list && Game.creatures.list.length) {
        try { scanCreatures(dt); } catch (e) { Game.reportError('webs.scan', e); }
      }

      // ---- fx
      const fx = webs.fx;
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i]; f.t += dt;
        if (f.t >= f.life) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }
        if (f.k === 'mote') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.97; f.vy *= 0.97; }
      }
    },
  };

  // --------------------------------------------------------------- selection
  function typeFromKey(k) {
    for (let i = 0; i < ORDER.length; i++) { const t = C.WEB_TYPES[ORDER[i]]; if (t && t.key === k) return ORDER[i]; }
    return null;
  }
  function ensureSelection() {
    const P = Game.player;
    if (webs.selected && !webs.unlocked(webs.selected)) webs.selected = null;
    if (!webs.selected && P) {
      for (let i = 0; i < ORDER.length; i++) if (webs.unlocked(ORDER[i])) { webs.selected = ORDER[i]; break; }
    }
  }
  function fail(reason) { webs.lastFail = reason; webs.failT = 1.2; }
  function exposureAt(x, y) {
    const wd = Game.world;
    if (wd && typeof wd.exposure === 'function') { const e = wd.exposure(x, y); return typeof e === 'number' ? clamp(e, 0, 1) : 1; }
    return 1;
  }

  // ------------------------------------------------------------ web creation
  function blankWeb(type) {
    return {
      id: nextId++, type: type, x1: 0, y1: 0, x2: 0, y2: 0, x: 0, y: 0, r: 0, rx: 0, ry: 0, rot: 0,
      integrity: 1, age: 0, trapped: [], tm: [], anchorA: null, anchorB: null, owner: 'player', heirloom: false,
      build: 0, buildDur: TYPE[type].build, placed: false, fade: 1, fadeT: 0, dying: false, dead: false,
      vib: 0, vx: 0, vy: 0, pulse: 0, pulseX: 0, pulseY: 0, born: 0, seed: 1, dmgCause: '', cd: null,
      expo: 1, expoT: 0, anchoredBoth: false, anchors: 0,
      bx0: 0, by0: 0, bx1: 0, by1: 0, _swx: 0, _swy: 0, _swp: 0,
    };
  }

  // Build a fully-formed web (geometry included) at a player position/facing.
  function newWeb(type, px, py, ang, reuse) {
    const w = reuse || blankWeb(type);
    if (reuse) { w.type = type; w.trapped = []; w.tm = []; w.build = 1; w.integrity = 1; w.fade = 1; w.anchorA = w.anchorB = null; w.vib = 0; w.pulse = 0; w.anchoredBoth = false; w.anchors = 0; w.dying = w.dead = false; }
    const seed = reuse ? 4242 : ((nextId * 7919 + Math.floor(px * 13 + py * 7)) >>> 0);
    w.seed = seed;
    const rng = U.mulberry32(seed);
    const P = Game.player, pr = (P && P.radius) || 10;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const WW = C.WORLD_W, WH = C.WORLD_H;
    if (type === 'line') {
      placeLine(w, px, py, ang, rng);
    } else if (type === 'sheet') {
      w.rx = 108 + pr * 1.0; w.ry = w.rx * 0.62; w.rot = ang + Math.PI / 2;
      w.x = clamp(px + cosA * w.ry * 0.85, w.rx, WW - w.rx); w.y = clamp(py + sinA * w.ry * 0.85, w.rx, WH - w.rx);
      w.r = w.rx;
      geomSheet(w, rng);
    } else if (type === 'orb') {
      w.r = 70 + pr * 2.0;
      w.x = clamp(px + cosA * w.r * 0.25, w.r, WW - w.r); w.y = clamp(py + sinA * w.r * 0.25, w.r, WH - w.r);
      geomOrb(w, rng, ang);
    } else {
      w.r = 30 + pr * 2.2; w.x = clamp(px, w.r, WW - w.r); w.y = clamp(py, w.r, WH - w.r);
      w.rot = ang;
      geomRetreat(w, rng, ang);
    }
    w.buildDur = TYPE[type].build;
    return w;
  }

  const PROBE_D = [300, 240, 185, 130], PROBE_O = [0, 0.32, -0.32, 0.64, -0.64];
  function placeLine(w, px, py, ang, rng) {
    const wd = Game.world, canA = wd && typeof wd.nearestAnchor === 'function';
    let ax = px, ay = py, anchA = null, anchB = null, bx, by;
    if (canA) { const a = wd.nearestAnchor(px, py, 26); if (a) { anchA = a; ax = a.x; ay = a.y; } }
    let bestScore = 1e9;
    if (canA) {
      for (let di = 0; di < PROBE_D.length; di++) for (let oi = 0; oi < PROBE_O.length; oi++) {
        const a2 = ang + PROBE_O[oi], d = PROBE_D[di];
        const an = wd.nearestAnchor(px + Math.cos(a2) * d, py + Math.sin(a2) * d, 50);
        if (!an || an === anchA) continue;
        const ddx = an.x - ax, ddy = an.y - ay, dd = Math.hypot(ddx, ddy);
        if (dd < 80 || dd > 340) continue;
        const da = Math.abs(U.angleDiff(ang, Math.atan2(ddy, ddx)));
        if (da > 0.85) continue;
        const score = da * 140 + Math.abs(dd - 250) * 0.35;
        if (score < bestScore) { bestScore = score; anchB = an; }
      }
    }
    if (anchB) { bx = anchB.x; by = anchB.y; }
    else { const L = 225 + rng() * 55; bx = ax + Math.cos(ang) * L; by = ay + Math.sin(ang) * L; }
    bx = clamp(bx, 4, C.WORLD_W - 4); by = clamp(by, 4, C.WORLD_H - 4);
    w.x1 = ax; w.y1 = ay; w.x2 = bx; w.y2 = by; w.anchorA = anchA; w.anchorB = anchB; w.anchoredBoth = !!(anchA && anchB);
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; }
    w.nx = nx; w.ny = ny; w.len = L;
    w.sag = L * (anchB ? 0.032 : 0.052) * (0.8 + rng() * 0.4);
    w.x = (ax + bx) / 2; w.y = (ay + by) / 2; w.r = L / 2 + 12;
    const nb = Math.max(3, Math.floor(L / 15));
    w.bt = new Float32Array(nb); w.bs = new Float32Array(nb); w.bsp = new Float32Array(nb);
    for (let i = 0; i < nb; i++) { w.bt[i] = (i + 0.5 + (rng() - 0.5) * 0.6) / nb; w.bs[i] = 0.7 + rng() * 0.8; w.bsp[i] = rng(); }
    const m = w.sag + 14;
    w.bx0 = Math.min(ax, bx) - m; w.bx1 = Math.max(ax, bx) + m; w.by0 = Math.min(ay, by) - m; w.by1 = Math.max(ay, by) + m;
  }

  function geomSheet(w, rng) {
    w.ux = Math.cos(w.rot); w.uy = Math.sin(w.rot);
    const NB = 30, NC = 100, NF = 14, NS = 12;
    w.nb = NB; w.bxu = new Float32Array(NB); w.byu = new Float32Array(NB);
    for (let i = 0; i < NB; i++) {
      const th = (i + (rng() - 0.5) * 0.4) * TAU / NB, rho = 1 + (rng() - 0.5) * 0.1;
      w.bxu[i] = Math.cos(th) * rho; w.byu[i] = Math.sin(th) * rho;
    }
    w.nc = NC; w.ci = new Uint8Array(NC); w.cj = new Uint8Array(NC); w.crnd = new Float32Array(NC);
    for (let k = 0; k < NC; k++) {
      const i = Math.floor(rng() * NB), gap = 3 + Math.floor(Math.pow(rng(), 1.4) * 12);
      w.ci[k] = i; w.cj[k] = (i + gap) % NB; w.crnd[k] = rng();
    }
    // funnel mouth sits on the near (player) edge: local (0,+0.72) ; funnel strands fan out from it
    w.fmx = 0; w.fmy = 0.7;
    w.nf = NF; w.fj = new Uint8Array(NF); w.frnd = new Float32Array(NF);
    for (let k = 0; k < NF; k++) { w.fj[k] = (Math.floor(NB / 2) + Math.floor((k - NF / 2) * NB / NF * 0.9) + NB) % NB; w.frnd[k] = rng(); }
    // three irregular inner rings
    w.rings = [];
    for (let q = 0; q < 3; q++) {
      const n = 16, s = 0.28 + q * 0.26, pts = new Float32Array(n * 2), rn = new Float32Array(n);
      for (let i = 0; i < n; i++) { const th = (i + (rng() - 0.5) * 0.5) * TAU / n, rho = s * (1 + (rng() - 0.5) * 0.14); pts[i * 2] = Math.cos(th) * rho; pts[i * 2 + 1] = Math.sin(th) * rho; rn[i] = rng(); }
      w.rings.push({ n: n, pts: pts, rn: rn });
    }
    w.ns = NS; w.sti = new Uint8Array(NS); w.stl = new Float32Array(NS);
    for (let k = 0; k < NS; k++) { w.sti[k] = Math.floor(k * NB / NS + rng() * 1.5) % NB; w.stl[k] = 6 + rng() * 10; }
    const m = Math.max(w.rx, w.ry) * 1.15 + 24;
    w.bx0 = w.x - m; w.bx1 = w.x + m; w.by0 = w.y - m; w.by1 = w.y + m;
  }

  function geomOrb(w, rng, ang) {
    const r = w.r, nr = 15 + Math.floor(rng() * 4), rot = rng() * TAU;
    w.nr = nr; w.ra = new Float32Array(nr); w.rr = new Float32Array(nr); w.rrnd = new Float32Array(nr); w.frnd = new Float32Array(nr);
    for (let i = 0; i < nr; i++) {
      w.ra[i] = rot + (i + (rng() - 0.5) * 0.36) * TAU / nr;
      w.rr[i] = r * (0.9 + rng() * 0.1);
      w.rrnd[i] = rng(); w.frnd[i] = rng();
    }
    w.hubR = r * 0.05;
    const turns = 9 + Math.floor(rng() * 3), r0 = r * 0.21, r1 = r * 0.9, nv = Math.min(1000, turns * nr);
    const b = Math.log(r1 / r0) / nv;
    w.nv = nv; w.sx = new Float32Array(nv); w.sy = new Float32Array(nv); w.sk = new Float32Array(nv);
    w.srnd = new Float32Array(nv); w.sbd = new Float32Array(nv); w.ssp = new Uint8Array(nv);
    for (let k = 0; k < nv; k++) {
      const i = k % nr; let rho = r0 * Math.exp(b * k); if (rho > w.rr[i] * 0.97) rho = w.rr[i] * 0.97;
      w.sx[k] = Math.cos(w.ra[i]) * rho; w.sy[k] = Math.sin(w.ra[i]) * rho;
      w.sk[k] = 0.3 + 0.7 * (1 - (rho / r) * (rho / r));
      w.srnd[k] = rng();
      w.sbd[k] = rng() < 0.82 ? 0.7 + rng() * 0.8 : 0;
      w.ssp[k] = rng() < 0.2 ? 1 : 0;
    }
    // guy lines to real anchors (frame -> natural anchor points); free stubs where none found
    const wd = Game.world, canA = wd && typeof wd.nearestAnchor === 'function';
    w.guys = []; let found = 0;
    for (let g = 0; g < 6; g++) {
      const fi = Math.floor(g * nr / 6 + rng() * 2) % nr, a = w.ra[fi];
      let an = null;
      if (canA && found < 4) an = wd.nearestAnchor(w.x + Math.cos(a) * r * 1.5, w.y + Math.sin(a) * r * 1.5, r * 0.7);
      let dup = false; if (an) for (let q = 0; q < w.guys.length; q++) if (w.guys[q].an === an) dup = true;
      if (an && !dup) { w.guys.push({ fi: fi, an: an, ax: an.x, ay: an.y }); found++; }
      else { const l = 10 + rng() * 14; w.guys.push({ fi: fi, an: null, ax: w.x + Math.cos(a) * (w.rr[fi] + l), ay: w.y + Math.sin(a) * (w.rr[fi] + l) }); }
    }
    w.anchors = found; w.anchorA = null;
    for (let q = 0; q < w.guys.length; q++) if (w.guys[q].an) { if (!w.anchorA) w.anchorA = w.guys[q].an; else if (!w.anchorB) w.anchorB = w.guys[q].an; }
    let m = r + 28;
    w.bx0 = w.x - m; w.bx1 = w.x + m; w.by0 = w.y - m; w.by1 = w.y + m;
    for (let q = 0; q < w.guys.length; q++) {
      const g = w.guys[q]; if (g.ax < w.bx0) w.bx0 = g.ax - 4; if (g.ax > w.bx1) w.bx1 = g.ax + 4; if (g.ay < w.by0) w.by0 = g.ay - 4; if (g.ay > w.by1) w.by1 = g.ay + 4;
    }
  }

  function geomRetreat(w, rng, ang) {
    const NB = 26, L = 3;
    w.nb = NB; w.lm = []; w.lo = [];
    for (let l = 0; l < L; l++) {
      const a = new Float32Array(NB), p1 = rng() * TAU, p2 = rng() * TAU;
      for (let j = 0; j < NB; j++) { const th = j * TAU / NB; a[j] = 1 + 0.05 * Math.sin(3 * th + p1) + 0.03 * Math.sin(5 * th + p2) + (rng() - 0.5) * 0.02; }
      w.lm.push(a); w.lo.push([(rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12]);
    }
    w.ent = ang; w.nrib = 20; w.ribRnd = new Float32Array(w.nrib); for (let i = 0; i < w.nrib; i++) w.ribRnd[i] = rng();
    w.nst = 9; w.stl = new Float32Array(w.nst); w.sta = new Float32Array(w.nst);
    for (let i = 0; i < w.nst; i++) { w.sta[i] = (i + (rng() - 0.5) * 0.3) * TAU / w.nst + ang + 0.35; w.stl[i] = 7 + rng() * 10; }
    const m = w.r * 1.3 + 14;
    w.bx0 = w.x - m; w.bx1 = w.x + m; w.by0 = w.y - m; w.by1 = w.y + m;
  }

  // ------------------------------------------------------------ geometry tests
  function inSheet(w, x, y, pad) {
    const dx = x - w.x, dy = y - w.y;
    const lx = (dx * w.ux + dy * w.uy) / (w.rx + pad), ly = (-dx * w.uy + dy * w.ux) / (w.ry + pad);
    return lx * lx + ly * ly <= 1;
  }
  function webDist(w, x, y) {
    if (w.type === 'line') return lineDist(w, x, y);
    if (w.type === 'sheet') {
      const dx = x - w.x, dy = y - w.y, lx = (dx * w.ux + dy * w.uy) / w.rx, ly = (-dx * w.uy + dy * w.ux) / w.ry;
      const k = Math.sqrt(lx * lx + ly * ly); return k <= 1 ? 0 : (k - 1) * Math.min(w.rx, w.ry);
    }
    return Math.max(0, Math.hypot(x - w.x, y - w.y) - w.r);
  }
  function touches(w, c) {
    const r = c.radius || 3, x = c.x, y = c.y;
    if (x < w.bx0 - r || x > w.bx1 + r || y < w.by0 - r || y > w.by1 + r) return false;
    if (w.type === 'line') return lineDist(w, x, y) <= r + 2.5;
    if (w.type === 'sheet') return inSheet(w, x, y, r * 0.5);
    const dx = x - w.x, dy = y - w.y, rr = w.r * 0.97 + r * 0.3;
    return dx * dx + dy * dy <= rr * rr;
  }
  // 0 = ignore/pass, 1 = gets stuck, 2 = tears the web
  function eligibility(w, c) {
    const role = c.role;
    if (role === 'spider') return 0;
    const r = c.radius || 3, fl = !!c.flying, hold = TYPE[w.type].hold;
    if (w.type === 'retreat') return (role === 'predator' && r >= 9) ? 2 : 0;
    // flying rule: orb catches flyers; a line only if strung high (both ends anchored); sheet never
    const flyOK = w.type === 'orb' ? true : (w.type === 'line' ? w.anchoredBoth : !fl);
    if (fl && !flyOK) return 0;
    if (role === 'predator') { if (r <= hold * 0.6) return 1; return r >= 6 ? 2 : 0; }
    if (r <= hold) return 1;
    if (w.type === 'line') return r >= 9 ? 2 : 0;
    return 2;
  }

  // ------------------------------------------------------------ creature scan
  function scanCreatures(dt) {
    const cl = Game.creatures.list, P = Game.player, cam = Game.camera;
    const px = P ? P.x : cam.x, py = P ? P.y : cam.y, t = now();
    let n = 0;
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      if (!c || c.dead || c.state === 'dead' || c.state === 'stuck' || c.role === 'spider') continue;
      const dx = c.x - px, dy = c.y - py;
      if (dx * dx + dy * dy > 1100 * 1100 && !cam.inView(c.x, c.y, 260)) continue;
      near[n++] = c;
    }
    near.length = n;
    if (!n) return;
    const L = webs.list;
    for (let i = 0; i < L.length; i++) {
      const w = L[i];
      if (w.dead || w.dying) continue;
      if (w.build < (w.type === 'line' ? 1 : 0.85)) continue;
      for (let k = 0; k < n; k++) {
        const c = near[k];
        if (c.state === 'stuck' || c.state === 'dead') continue;
        if (!touches(w, c)) continue;
        if (w.trapped.length && w.trapped.indexOf(c) >= 0) continue;
        if (w.cd && w.cd[c.id] > t) continue;
        const e = eligibility(w, c);
        if (e === 1) { if (trapCreature(w, c)) { if (w.dead) break; } }
        else if (e === 2) {
          if (!w.cd) w.cd = {};
          w.cd[c.id] = t + 1.3;
          w.integrity -= w.type === 'line' ? 0.7 : 0.55;
          w.vib = Math.min(2.4, w.vib + 1.1); w.vx = c.x; w.vy = c.y;
          w.dmgCause = c.role === 'predator' ? 'predator' : 'torn';
          sfx('web_snap', c.x, c.y, 0.8);
          if (w.integrity <= 0) { destroyWeb(w, w.dmgCause); break; }
        }
      }
    }
    near.length = 0;
  }

  function trapCreature(w, c) {
    const cr = Game.creatures, t = now();
    let ok = true;
    if (cr && typeof cr.trap === 'function') { try { ok = cr.trap(c, w); } catch (e) { Game.reportError('webs.trap', e); ok = false; } }
    if (!w.cd) w.cd = {};
    if (ok === false) { w.cd[c.id] = t + 2; return false; }
    w.trapped.push(c);
    w.tm.push({ c: c, t0: t, next: t + 0.15 + Math.random() * 0.3, chk: t + 0.7, sfxT: 0 });
    w.pulse = 1; w.pulseX = c.x; w.pulseY = c.y;
    w.vib = Math.min(2.4, w.vib + 1.0); w.vx = c.x; w.vy = c.y;
    Game.stat('trapped');
    sfx('trap', c.x, c.y, 1);
    Game.emit('web:trapped', { web: w, creature: c });
    return true;
  }

  function updateTrapped(w, dt, t) {
    const tm = w.tm; if (!tm.length) return;
    const cl = Game.creatures && Game.creatures.list;
    const hold = TYPE[w.type].hold || 4;
    for (let i = tm.length - 1; i >= 0; i--) {
      const m = tm[i], c = m.c;
      let gone = !c || c.dead || c.state === 'dead' || (c.hp != null && c.hp <= 0) || c.removed || c.gone, freed = false;
      if (!gone && t - m.t0 > 0.5 && typeof c.state === 'string' && c.state !== 'stuck') { gone = true; freed = true; }
      if (!gone && t >= m.chk) { m.chk = t + 0.7; if (cl && cl.indexOf(c) < 0) gone = true; }
      if (gone) {
        tm.splice(i, 1); const ti = w.trapped.indexOf(c); if (ti >= 0) w.trapped.splice(ti, 1);
        if (freed && c) { if (!w.cd) w.cd = {}; w.cd[c.id] = t + 3; }
        continue;
      }
      const r = c.radius || 3, vigor = Math.max(0.35, Math.exp(-(t - m.t0) / 30));
      if (t >= m.next) {
        const amp = 0.25 + Math.random() * 0.75, size = clamp(r / 7, 0.35, 1.8);
        m.next = t + 0.18 + Math.random() * 0.45;
        w.vib = Math.min(2.4, w.vib + amp * (0.4 + size * 0.7) * vigor); w.vx = c.x; w.vy = c.y;
        if (t >= m.sfxT) { m.sfxT = t + 0.55; sfx('struggle', c.x, c.y, clamp(0.25 + amp * size * 0.5, 0.2, 1)); }
      }
      const ratio = r / hold;
      w.integrity -= (0.004 + 0.07 * ratio * ratio * ratio) * dt * vigor * (w.anchoredBoth || w.type !== 'line' ? 1 : 1.4);
      if (w.dmgCause !== 'rain' && w.dmgCause !== 'wind') w.dmgCause = 'struggle';
    }
  }

  // ------------------------------------------------------------ destroy / limit
  function destroyWeb(w, cause) {
    if (w.dying) return;
    w.dying = true; w.dead = true; w.fadeT = 0; w.integrity = Math.max(0, w.integrity);
    if (cause !== 'overflow') sfx(cause === 'decay' ? 'web_snap' : 'web_snap', w.x, w.y, cause === 'decay' ? 0.35 : 0.8);
    Game.emit('web:destroyed', { web: w, cause: cause });
    const cr = Game.creatures;
    if (w.trapped.length && cr) {
      const fn = cr.release || cr.untrap || cr.free;
      if (typeof fn === 'function') for (let i = 0; i < w.trapped.length; i++) { try { fn.call(cr, w.trapped[i], w); } catch (e) { Game.reportError('webs.release', e); } }
    }
    w.trapped.length = 0; w.tm.length = 0;
  }

  function enforceLimit(keepW) {
    const L = webs.list; let live = 0;
    for (let i = 0; i < L.length; i++) if (!L[i].dying) live++;
    while (live > MAX_WEBS) {
      let oldest = null;
      for (let i = 0; i < L.length; i++) {
        const w = L[i]; if (w.dying || w === keepW || w.heirloom) continue;   // heirloom webs are never culled to make room
        const prot = w.trapped.length > 0 || (w.type === 'retreat' && Game.player && webs.sheltered(Game.player.x, Game.player.y) === w);
        const score = w.born + (prot ? 100000 : 0);
        if (!oldest || score < oldest.s) oldest = { w: w, s: score };
      }
      if (!oldest) break;
      destroyWeb(oldest.w, 'overflow'); live--;
    }
  }

  function tooClose(nw) {
    const L = webs.list;
    for (let i = 0; i < L.length; i++) {
      const w = L[i];
      if (w.dying || w.type !== nw.type || w.integrity < 0.5) continue;
      if (nw.type === 'line') {
        if (Math.hypot(w.x1 - nw.x1, w.y1 - nw.y1) < 18 && Math.hypot(w.x2 - nw.x2, w.y2 - nw.y2) < 18) return true;
      } else if (Math.hypot(w.x - nw.x, w.y - nw.y) < (nw.type === 'retreat' ? nw.r * 0.7 : nw.r * 0.4)) return true;
    }
    return false;
  }

  function onPlaced(w) {
    sfx('web_place', w.x, w.y, 0.8);
    const f = webs.fx; if (f.length > 70) return;
    f.push({ k: 'ring', x: w.x, y: w.y, t: 0, life: 0.6, size: w.type === 'line' ? 10 : w.r * 0.9 });
    if (w.type === 'line') { f.push({ k: 'ring', x: w.x2, y: w.y2, t: 0, life: 0.5, size: 9 }); f.push({ k: 'ring', x: w.x1, y: w.y1, t: 0, life: 0.5, size: 9 }); }
  }
  function spawnSpinFx(w) {
    const f = webs.fx;
    const n = w.type === 'line' ? 10 : 16;
    for (let i = 0; i < n && f.length < 90; i++) {
      let x, y;
      if (w.type === 'line') { const t = Math.random(); x = w.x1 + (w.x2 - w.x1) * t; y = w.y1 + (w.y2 - w.y1) * t; }
      else { const a = Math.random() * TAU, d = Math.random() * w.r * 0.9; x = w.x + Math.cos(a) * d; y = w.y + Math.sin(a) * d; }
      f.push({ k: 'mote', x: x, y: y, vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 8, t: 0, life: 0.7 + Math.random() * 0.7, s: 0.8 + Math.random() * 1.2 });
    }
  }

  // ------------------------------------------------------------ ghost preview
  function updateGhost(dt) {
    const P = Game.player, type = webs.selected;
    webs._ghostOk = webs.canSpin(type);
    webs._ghostCalc -= dt;
    const ang = typeof P.angle === 'number' ? P.angle : 0;
    const key = type + '|' + Math.round(P.x / 2) + '|' + Math.round(P.y / 2) + '|' + Math.round(ang * 12);
    if (key === webs._ghostKey && webs._ghost) return;
    if (webs._ghostCalc > 0 && webs._ghost && webs._ghost.type === type) return;
    webs._ghostCalc = 0.07; webs._ghostKey = key;
    if (!webs._ghost) webs._ghost = blankWeb(type);
    newWeb(type, P.x, P.y, ang, webs._ghost);
    webs._ghost.id = -1;
  }

  // ======================================================================= DRAWING
  // displacement from wind sway + vibration ripples at point (x,y); k = how freely this point moves (0..1)
  let STATIC = false;           // true while rendering a cached sprite (no sway / ripples)
  let spriteBudget = 0;         // sprites (re)rendered per frame
  let dynCount = 0;             // webs drawn with the full vector path this frame
  function dispAt(w, x, y, k) {
    if (STATIC) { DX = 0; DY = 0; return; }
    const s1 = Math.sin(w._swp + x * 0.021 + y * 0.016), s2 = Math.sin(w._swp * 0.83 + x * 0.013 - y * 0.024 + 1.9);
    let dx = w._swx * k * s1 - w._swy * 0.35 * k * s2, dy = w._swy * k * s1 + w._swx * 0.35 * k * s2;
    if (w.vib > 0.012) {
      const ex = x - w.vx, ey = y - w.vy, d = Math.sqrt(ex * ex + ey * ey) + 0.5;
      const a = w.vib * 3.0 * Math.sin(d * 0.12 - T * 20) * Math.exp(-d * 0.010);
      if (w.type === 'line') { dx += w.nx * a * 1.4; dy += w.ny * a * 1.4; }
      else { dx += ex / d * a - ey / d * a * 0.4; dy += ey / d * a + ex / d * a * 0.4; }
    }
    DX = dx; DY = dy;
  }

  function prepSway(w) {
    const f = w.type === 'line' ? 1 : w.type === 'orb' ? 0.9 : w.type === 'sheet' ? 0.6 : 0.25;
    const amp = (0.4 + 3.4 * env.wind) * f;
    w._swx = env.wdx * amp; w._swy = env.wdy * amp;
    w._swp = T * (1.1 + 0.9 * env.wind) + (w.seed % 628) / 100;
  }

  function strokeSilk(ctx, A, cw, gw, hw, ca, ga, ha) {
    const px = V.px;
    if (V.lod > 1 && hw > 0) { ctx.lineWidth = hw * px; ctx.strokeStyle = rgba(16, 12, 24, ha * A); ctx.stroke(); }
    if (V.lod > 0 && gw > 0) { ctx.lineWidth = gw * px; ctx.strokeStyle = rgba(150, 205, 255, ga * A); ctx.stroke(); }
    ctx.lineWidth = cw * px; ctx.strokeStyle = rgba(247, 251, 255, ca * A); ctx.stroke();
  }

  function drawAll(ctx) {
    const webL = webs.list, cam = Game.camera;
    refreshEnv();
    T = Game.time.real;
    V.z = cam.zoom || 1; V.px = 1 / V.z;
    V.x0 = cam.view.x0 - 40; V.y0 = cam.view.y0 - 40; V.x1 = cam.view.x1 + 40; V.y1 = cam.view.y1 + 40;
    V.lod = V.z < 0.85 ? 0 : (V.z < 1.1 ? 1 : 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    grads(ctx); spriteBudget = 3; dynCount = 0;
    if (webL.length) {
      markDynamic(webL, cam);
      for (let pass = 0; pass < 4; pass++) {
        const ty = pass === 0 ? 'sheet' : pass === 1 ? 'orb' : pass === 2 ? 'line' : 'retreat';
        for (let i = 0; i < webL.length; i++) {
          const w = webL[i];
          if (w.type !== ty) continue;
          if (w.bx1 < V.x0 || w.bx0 > V.x1 || w.by1 < V.y0 || w.by0 > V.y1) continue;
          drawWeb(ctx, w, 1, false);
          if (w.heirloom && !w.dying) drawHeirloomMark(ctx, w);
        }
      }
      drawWraps(ctx);
    }
    drawFx(ctx);
    if (webs.ghostOn && webs._ghost) drawGhost(ctx);
  }

  // a warm gold thread round an heirloom web, so you can tell at a glance which webs the territory keeps
  function drawHeirloomMark(ctx, w) {
    const px = V.px, a = 0.34 + 0.12 * Math.sin(T * 2.2 + w.seed), I = Math.min(1, w.integrity * 1.3);
    ctx.save(); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = rgba(255, 206, 120, a * I); ctx.setLineDash([7 * px, 5 * px]); ctx.lineDashOffset = -T * 6 * px;
    ctx.beginPath();
    if (w.type === 'line') { ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); }
    else if (w.type === 'sheet') ctx.ellipse(w.x, w.y, w.rx * 1.04, w.ry * 1.04, w.rot, 0, TAU);
    else ctx.arc(w.x, w.y, w.r * 1.05, 0, TAU);
    ctx.stroke(); ctx.setLineDash([]);
    const cx = w.x != null ? w.x : (w.x1 + w.x2) / 2, cy = w.y != null ? w.y : (w.y1 + w.y2) / 2, d = 4.5 * px;
    ctx.fillStyle = rgba(255, 216, 140, (0.7 + 0.2 * Math.sin(T * 3 + w.seed)) * I);
    ctx.beginPath(); ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Choose which animated (building / vibrating / pulsing) webs get the full per-vertex vector render:
  // all webs under construction + the few nearest to the camera; the rest use their cached sprite.
  const dynScratch = [];
  const DYN_MAX = 3;
  function markDynamic(L, cam) {
    dynScratch.length = 0;
    for (let i = 0; i < L.length; i++) {
      const w = L[i]; w._dyn = false;
      if (w.type === 'line' || w.dying) continue;
      if (w.bx1 < V.x0 || w.bx0 > V.x1 || w.by1 < V.y0 || w.by0 > V.y1) continue;
      if (w.build < 1) { w._dyn = true; continue; }
      if (w.vib >= 0.012 || w.pulse > 0.02) { w._d = Math.hypot(w.x - cam.x, w.y - cam.y); dynScratch.push(w); }
    }
    if (dynScratch.length <= DYN_MAX) { for (let i = 0; i < dynScratch.length; i++) dynScratch[i]._dyn = true; return; }
    dynScratch.sort((a, b) => a._d - b._d);
    for (let i = 0; i < DYN_MAX; i++) dynScratch[i]._dyn = true;
  }

  function drawWeb(ctx, w, alpha, ghost) {
    prepSway(w);
    const A = alpha * (ghost ? 1 : (w.dying ? Math.max(0, w.fade) : 1) * (0.55 + 0.45 * Math.min(1, w.integrity * 1.4)));
    if (A <= 0.01) return;
    const integ = ghost ? 1 : (w.dying ? Math.max(0, w.fade) * 0.9 : w.integrity);
    let done = false;
    if (!ghost && !w.dying && w.type !== 'line' && w.build >= 1 && !w._dyn && spritesOK) done = drawSprite(ctx, w, A);
    if (!done) {
      // many simultaneously animated webs: shed the costliest passes (halo/glow, then droplets)
      const saveLod = V.lod;
      if (!ghost) { if (dynCount > 2 && V.lod > 1) V.lod = 1; dynCount++; }
      if (w.type === 'orb') drawOrb(ctx, w, A, integ, ghost);
      else if (w.type === 'sheet') drawSheet(ctx, w, A, integ, ghost);
      else if (w.type === 'line') drawLine(ctx, w, A, integ, ghost);
      else drawRetreat(ctx, w, A, integ, ghost, false);
      V.lod = saveLod;
    } else if (w.vib > 0.03 && V.lod > 0) {
      // cached web: show the vibration as travelling ripple rings from the struggling prey
      for (let q = 0; q < 2; q++) {
        const p = (T * 1.5 + q * 0.5) % 1, R = 4 + p * 36;
        ctx.beginPath(); ctx.arc(w.vx, w.vy, R, 0, TAU); ctx.lineWidth = 1.1 * V.px; ctx.strokeStyle = rgba(235, 247, 255, Math.min(0.4, w.vib * 0.3) * (1 - p) * A); ctx.stroke();
      }
    }
    if (!ghost && w.pulse > 0.02) {
      const p = 1 - w.pulse, R = 5 + p * 42;
      ctx.beginPath(); ctx.arc(w.pulseX, w.pulseY, R, 0, TAU);
      ctx.lineWidth = 1.5 * V.px; ctx.strokeStyle = rgba(255, 255, 255, w.pulse * 0.55 * A); ctx.stroke();
      ctx.beginPath(); ctx.arc(w.pulseX, w.pulseY, R * 0.55, 0, TAU);
      ctx.lineWidth = 1 * V.px; ctx.strokeStyle = rgba(190, 230, 255, w.pulse * 0.4 * A); ctx.stroke();
    }
  }

  // ------------------------------------------------- sprite cache (settled orb / sheet / retreat webs)
  // A settled web is rendered once into an offscreen canvas at the current zoom and blitted with a small
  // sway transform; webs that are building, vibrating, pulsing or dissolving use the full vector path.
  let spritesOK = true;
  function renderSprite(w, key, scale) {
    const bw = w.bx1 - w.bx0, bh = w.by1 - w.by0;
    const lim = 1500 / Math.max(bw, bh); if (scale > lim) scale = lim;
    const sw = Math.ceil(bw * scale), sh = Math.ceil(bh * scale);
    if (sw < 2 || sh < 2) return null;
    const old = w.spr;
    let cv = (old && old.canvas.width === sw && old.canvas.height === sh) ? old.canvas : U.makeCanvas(sw, sh);
    if (!cv) { spritesOK = false; return null; }
    const c2 = cv.getContext('2d'); if (!c2) { spritesOK = false; return null; }
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, sw, sh);
    c2.setTransform(scale, 0, 0, scale, -w.bx0 * scale, -w.by0 * scale);
    c2.lineCap = 'round'; c2.lineJoin = 'round';
    const svG = GRAD, svz = V.z, svpx = V.px, svl = V.lod;
    grads(c2); V.z = scale; V.px = 1 / scale; V.lod = 2; STATIC = true;
    const integ = w.integrity >= 0.85 ? 1 : Math.max(0.1, Math.ceil(w.integrity * 8) / 8);
    try {
      if (w.type === 'orb') drawOrb(c2, w, 1, integ, false);
      else if (w.type === 'sheet') drawSheet(c2, w, 1, integ, false);
      else drawRetreat(c2, w, 1, integ, false, false);
    } catch (e) { Game.reportError('webs.sprite', e); STATIC = false; GRAD = svG; V.z = svz; V.px = svpx; V.lod = svl; return null; }
    STATIC = false; GRAD = svG; V.z = svz; V.px = svpx; V.lod = svl;
    return { canvas: cv, scale: scale, key: key, w: sw / scale, h: sh / scale };
  }
  function drawSprite(ctx, w, A) {
    const integ = w.integrity, ik = integ >= 0.85 ? 10 : Math.max(1, Math.ceil(integ * 8));
    const key = ik + '|' + Math.round((1 + 0.55 * env.dew + 0.5 * env.wet) * 6);
    const want = Math.min(V.z, 3.2);
    let sp = w.spr;
    if ((!sp || sp.key !== key || want > sp.scale * 1.25 || want < sp.scale * 0.55) && spriteBudget > 0) {
      const n = renderSprite(w, key, want); spriteBudget--;
      if (n) { w.spr = n; sp = n; }
    }
    if (!sp) return false;
    const s1 = Math.sin(w._swp), s2 = Math.sin(w._swp * 0.83 + 1.9);
    ctx.save();
    let jx = 0, jy = 0; if (w.vib > 0.012) { jx = w.vib * 0.7 * Math.sin(T * 41); jy = w.vib * 0.7 * Math.sin(T * 37 + 1); }
    ctx.translate(w.x + w._swx * 0.55 * s1 + jx, w.y + w._swy * 0.55 * s1 + jy); ctx.rotate(0.0035 * (0.5 + env.wind * 3) * s2); ctx.translate(-w.x, -w.y);
    ctx.globalAlpha = A; ctx.drawImage(sp.canvas, w.bx0, w.by0, sp.w, sp.h);
    ctx.globalAlpha = 1;
    if (env.dew > 0.12 && V.lod > 0) twinkles(ctx, w, A);
    ctx.restore();
    return true;
  }
  // dew glints are animated, so they are drawn live on top of the cached sprite
  function twinkles(ctx, w, A) {
    const px = V.px, dew = env.dew; let any = false;
    ctx.beginPath();
    if (w.type === 'orb') {
      const nv = w.nv, cx = w.x, cy = w.y;
      for (let k = 1; k < nv; k++) {
        if (!w.ssp[k] || w.sbd[k] === 0) continue;
        const tw = Math.sin(T * 2.1 + k * 1.7 + w.seed % 13); if (tw < 0.15) continue;
        const bx = cx + (w.sx[k] + w.sx[k - 1]) * 0.5, by = cy + (w.sy[k] + w.sy[k - 1]) * 0.5, len = (1.8 + 3.8 * tw) * px * (0.5 + dew * 0.7);
        ctx.moveTo(bx - len, by); ctx.lineTo(bx + len, by); ctx.moveTo(bx, by - len); ctx.lineTo(bx, by + len);
        const d2 = len * 0.55; ctx.moveTo(bx - d2, by - d2); ctx.lineTo(bx + d2, by + d2); ctx.moveTo(bx - d2, by + d2); ctx.lineTo(bx + d2, by - d2); any = true;
      }
    } else if (w.type === 'sheet') {
      for (let i = 0; i < w.nb; i++) {
        if (w.crnd[(i * 3) % w.nc] < 0.5) continue;
        const tw = Math.sin(T * 2 + i * 2.3); if (tw < 0.2) continue;
        const x = w.x + w.bxu[i] * w.rx * w.ux - w.byu[i] * w.ry * w.uy, y = w.y + w.bxu[i] * w.rx * w.uy + w.byu[i] * w.ry * w.ux, len = (2 + 3 * tw) * px * dew;
        ctx.moveTo(x - len, y); ctx.lineTo(x + len, y); ctx.moveTo(x, y - len); ctx.lineTo(x, y + len); any = true;
      }
    }
    if (any) { ctx.lineWidth = 0.75 * px; ctx.strokeStyle = rgba(255, 255, 250, 0.85 * A * Math.min(1, dew * 1.3)); ctx.stroke(); }
  }

  // ------------------------------------------------------------------ LINE
  function drawLine(ctx, w, A, integ, ghost) {
    const px = V.px, b = w.build;
    const prog = b < 1 ? U.smooth(b) : 1;
    const L = w.len, N = Math.max(8, Math.ceil(L / 16));
    const sag = w.sag * (0.3 + 0.7 * prog) * (b < 1 ? 1 + 0.5 * Math.sin(b * 12) * (1 - b) : 1);
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, nx = w.nx, ny = w.ny;
    const strong = w.anchoredBoth ? 1.2 : 1;
    // two twisted fibres (a dragline is a pair of strands)
    for (let f = 0; f < 2; f++) {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        if (t > prog) { if (i > 0 && prog > (i - 1) / N) pushLinePt(ctx, w, prog, sag, dx, dy, nx, ny, f, px, false); break; }
        pushLinePt(ctx, w, t, sag, dx, dy, nx, ny, f, px, i === 0);
      }
      if (f === 0) strokeSilk(ctx, A, 1.4 * strong, 3.6, 3.2, 0.95 + w.pulse * 0.05, 0.24, 0.15);
      else { ctx.lineWidth = 0.7 * px; ctx.strokeStyle = rgba(230, 244, 255, 0.55 * A); ctx.stroke(); }
    }
    // glue anchors
    const ga = clamp(prog * 3, 0, 1) * A;
    ctx.fillStyle = rgba(236, 246, 255, 0.85 * ga);
    ctx.beginPath(); ctx.arc(w.x1, w.y1, 1.9 * px * strong, 0, TAU); if (prog > 0.97) { ctx.moveTo(w.x2 + 2.2 * px * strong, w.y2); ctx.arc(w.x2, w.y2, 2.2 * px * strong, 0, TAU); } ctx.fill();
    if (w.anchorA) { ctx.strokeStyle = rgba(190, 225, 255, 0.5 * ga); ctx.lineWidth = 0.9 * px; ctx.beginPath(); ctx.arc(w.x1, w.y1, 3.6 * px, 0, TAU); ctx.stroke(); }
    if (w.anchorB && prog > 0.97) { ctx.strokeStyle = rgba(190, 225, 255, 0.5 * ga); ctx.lineWidth = 0.9 * px; ctx.beginPath(); ctx.arc(w.x2, w.y2, 3.6 * px, 0, TAU); ctx.stroke(); }
    // travelling spinner bead during construction
    if (b < 1) {
      const t = prog, bx = w.x1 + dx * t + nx * sag * 4 * t * (1 - t), by = w.y1 + dy * t + ny * sag * 4 * t * (1 - t);
      ctx.save(); ctx.translate(bx, by); ctx.scale(7 * px, 7 * px); ctx.fillStyle = GRAD.spark; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    }
    // dew beads & sparkle
    if (!ghost && b >= 0.98 && V.lod > 0) {
      const ba = clamp((b - 0.9) / 0.1, 0, 1), dew = env.dew, nb = w.bt.length;
      ctx.beginPath();
      for (let i = 0; i < nb; i++) {
        if (!keep(w.bsp[i], integ)) continue;
        const t = w.bt[i]; let x = w.x1 + dx * t + nx * sag * 4 * t * (1 - t), y = w.y1 + dy * t + ny * sag * 4 * t * (1 - t);
        dispAt(w, x, y, 0.15 + 0.85 * 4 * t * (1 - t)); x += DX; y += DY;
        const r = (0.55 + 0.35 * w.bs[i]) * (1 + 0.5 * dew + 0.4 * env.wet) * px * 1.1;
        ctx.moveTo(x + r, y + nx * 0 + 0); ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fillStyle = rgba(222, 242, 255, 0.5 * A * ba); ctx.fill();
      if (dew > 0.2) glints(ctx, w, A * ba, dew, sag, dx, dy, nx, ny);
    }
  }
  function pushLinePt(ctx, w, t, sag, dx, dy, nx, ny, f, px, first) {
    const s = 4 * t * (1 - t);
    let x = w.x1 + dx * t + nx * sag * s, y = w.y1 + dy * t + ny * sag * s;
    dispAt(w, x, y, 0.15 + 0.85 * s); x += DX; y += DY;
    if (f === 1) { const o = 0.55 * px * Math.sin(t * w.len * 0.22 + w.seed % 7); x += nx * o; y += ny * o; }
    if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  function glints(ctx, w, A, dew, sag, dx, dy, nx, ny) {
    const nb = w.bt.length; ctx.beginPath(); let any = false;
    for (let i = 0; i < nb; i++) {
      if (w.bsp[i] < 0.7) continue;
      const tw = Math.sin(T * 2.3 + w.bsp[i] * 40); if (tw < 0.2) continue;
      const t = w.bt[i], s = 4 * t * (1 - t); const x = w.x1 + dx * t + nx * sag * s, y = w.y1 + dy * t + ny * sag * s;
      const len = (2 + 3.5 * tw) * V.px * (0.6 + dew * 0.6);
      ctx.moveTo(x - len, y); ctx.lineTo(x + len, y); ctx.moveTo(x, y - len); ctx.lineTo(x, y + len); any = true;
    }
    if (any) { ctx.lineWidth = 0.8 * V.px; ctx.strokeStyle = rgba(255, 255, 250, 0.75 * A * dew); ctx.stroke(); }
  }

  // ------------------------------------------------------------------- ORB
  function drawOrb(ctx, w, A, integ, ghost) {
    const px = V.px, b = w.build, cx = w.x, cy = w.y, r = w.r, nr = w.nr, hubR = w.hubR, lod = V.lod;
    const ra = w.ra, rr = w.rr;
    const fa = clamp((b - 0.15) / 0.25, 0, 1), sp = clamp((b - 0.3) / 0.62, 0, 1), ba = clamp((b - 0.9) / 0.1, 0, 1), ga = clamp(b / 0.2, 0, 1);
    // soft shadow + hub glow
    ctx.save(); ctx.translate(cx + 3, cy + 4); ctx.scale(r * 0.95, r * 0.95); ctx.globalAlpha = 0.5 * A * ga; ctx.fillStyle = GRAD.shadow; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    // rim points (displaced)
    for (let i = 0; i < nr; i++) { let x = cx + Math.cos(ra[i]) * rr[i], y = cy + Math.sin(ra[i]) * rr[i]; dispAt(w, x, y, 0.3); RIM_X[i] = x + DX; RIM_Y[i] = y + DY; }
    // --- structural strands: radials + frame + guys
    ctx.beginPath();
    for (let i = 0; i < nr; i++) {
      if (!keep(w.rrnd[i], integ)) continue;
      const rv = clamp((b / 0.35) * (1 + nr * 0.03) - i * 0.03, 0, 1); if (rv <= 0) continue;
      const ca = Math.cos(ra[i]), sa = Math.sin(ra[i]), end = hubR + (rr[i] - hubR) * rv;
      for (let s = 0; s <= 6; s++) {
        const rho = hubR + (end - hubR) * s / 6;
        let x = cx + ca * rho, y = cy + sa * rho;
        dispAt(w, x, y, 0.3 + 0.7 * (1 - (rho / r) * (rho / r))); x += DX; y += DY;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    if (fa > 0) {
      for (let i = 0; i < nr; i++) {
        if (!keep(w.frnd[i], integ)) continue;
        const j = (i + 1) % nr, x0 = RIM_X[i], y0 = RIM_Y[i], x1 = RIM_X[j], y1 = RIM_Y[j];
        const ex = x0 + (x1 - x0) * fa, ey = y0 + (y1 - y0) * fa;
        const mx = (x0 + ex) / 2 + (cx - (x0 + ex) / 2) * 0.05, my = (y0 + ey) / 2 + (cy - (y0 + ey) / 2) * 0.05;
        ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, ex, ey);
      }
      for (let q = 0; q < w.guys.length; q++) {
        const g = w.guys[q]; if (!keep(w.frnd[(g.fi + 3) % nr], integ + 0.15)) continue;
        const x0 = RIM_X[g.fi], y0 = RIM_Y[g.fi];
        ctx.moveTo(x0, y0); ctx.lineTo(x0 + (g.ax - x0) * fa, y0 + (g.ay - y0) * fa);
      }
    }
    strokeSilk(ctx, A, 1.3, 3.0, 2.8, 0.88 + w.pulse * 0.1, 0.17, 0.12);

    // --- hub rings
    ctx.beginPath();
    { let hx = cx, hy = cy; dispAt(w, hx, hy, 1); hx += DX; hy += DY;
      for (let q = 0; q < 3; q++) { const rad = hubR * (0.7 + q * 0.75); ctx.moveTo(hx + rad, hy); ctx.arc(hx, hy, rad, 0, TAU); }
      // hub glow (screen-sized so it stays legible at every zoom)
      ctx.save(); ctx.translate(hx, hy); const gs = Math.max(r * 0.22, 14 * px); ctx.scale(gs, gs); ctx.globalAlpha = 0.9 * A * ga; ctx.fillStyle = GRAD.hub; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    }
    ctx.lineWidth = 1.0 * px; ctx.strokeStyle = rgba(245, 250, 255, 0.8 * A * ga); ctx.stroke();

    // --- capture spiral
    const nv = w.nv, sx = w.sx, sy = w.sy, sk = w.sk;
    const cnt = Math.min(nv, Math.floor(nv * sp) + 1);
    let lastX = cx, lastY = cy, started = false;
    if (sp > 0) {
      ctx.beginPath();
      for (let k = 0; k < cnt; k++) {
        let x = cx + sx[k], y = cy + sy[k];
        dispAt(w, x, y, sk[k]); x += DX; y += DY;
        SCR_X[k] = x; SCR_Y[k] = y;
        if (k === cnt - 1 && sp < 1) { const f = nv * sp - Math.floor(nv * sp); if (k > 0) { x = SCR_X[k - 1] + (x - SCR_X[k - 1]) * f; y = SCR_Y[k - 1] + (y - SCR_Y[k - 1]) * f; } }
        const ok = k === 0 || keep(w.srnd[k], integ);
        if (!started || !ok) { ctx.moveTo(x, y); started = true; if (!ok) { started = false; } }
        else ctx.lineTo(x, y);
        lastX = x; lastY = y;
      }
      strokeSilk(ctx, A, 0.85, 2.0, 2.0, 0.78 + w.pulse * 0.15, 0.12, 0.1);
    }
    // builder glint at the spiral head
    if (b < 1 && sp > 0) { ctx.save(); ctx.translate(lastX, lastY); ctx.scale(6 * px, 6 * px); ctx.fillStyle = GRAD.spark; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore(); }

    // --- sticky droplets + dew
    if (!ghost && ba > 0 && lod > 0 && cnt >= nv) {
      const dew = env.dew, wet = env.wet, grow = 1 + 0.55 * dew + 0.5 * wet;
      ctx.beginPath();
      for (let k = 1; k < nv; k++) {
        const bs = w.sbd[k]; if (bs === 0 || !keep(w.srnd[k], integ)) continue;
        const bx = (SCR_X[k] + SCR_X[k - 1]) * 0.5, by = (SCR_Y[k] + SCR_Y[k - 1]) * 0.5, rad = (0.75 + 0.55 * bs) * grow * px * 1.1;
        ctx.moveTo(bx + rad, by); ctx.arc(bx, by, rad, 0, TAU);
      }
      ctx.fillStyle = rgba(222, 242, 255, 0.48 * A * ba); ctx.fill();
      // bright cores
      ctx.beginPath();
      for (let k = 1; k < nv; k += 2) {
        const bs = w.sbd[k]; if (bs === 0 || !keep(w.srnd[k], integ)) continue;
        const bx = (SCR_X[k] + SCR_X[k - 1]) * 0.5 - 0.25 * px, by = (SCR_Y[k] + SCR_Y[k - 1]) * 0.5 - 0.3 * px, rad = 0.42 * bs * grow * px;
        ctx.moveTo(bx + rad, by); ctx.arc(bx, by, rad, 0, TAU);
      }
      ctx.fillStyle = rgba(255, 255, 255, 0.85 * A * ba); ctx.fill();
      if (dew > 0.12 && !STATIC) {
        ctx.beginPath(); let any = false;
        for (let k = 1; k < nv; k++) {
          if (!w.ssp[k] || w.sbd[k] === 0) continue;
          const tw = Math.sin(T * 2.1 + k * 1.7 + w.seed % 13); if (tw < 0.15) continue;
          const bx = (SCR_X[k] + SCR_X[k - 1]) * 0.5, by = (SCR_Y[k] + SCR_Y[k - 1]) * 0.5, len = (1.8 + 3.8 * tw) * px * (0.5 + dew * 0.7);
          ctx.moveTo(bx - len, by); ctx.lineTo(bx + len, by); ctx.moveTo(bx, by - len); ctx.lineTo(bx, by + len);
          const d2 = len * 0.55; ctx.moveTo(bx - d2, by - d2); ctx.lineTo(bx + d2, by + d2); ctx.moveTo(bx - d2, by + d2); ctx.lineTo(bx + d2, by - d2); any = true;
        }
        if (any) { ctx.lineWidth = 0.75 * px; ctx.strokeStyle = rgba(255, 255, 250, 0.85 * A * ba * Math.min(1, dew * 1.3)); ctx.stroke(); }
      }
    }
  }

  // ----------------------------------------------------------------- SHEET
  function sheetPt(w, a, bb, k) {
    let x = w.x + a * w.rx * w.ux - bb * w.ry * w.uy, y = w.y + a * w.rx * w.uy + bb * w.ry * w.ux;
    dispAt(w, x, y, k); DX += x; DY += y;
  }
  function drawSheet(ctx, w, A, integ, ghost) {
    const px = V.px, b = w.build, nb = w.nb, bxu = w.bxu, byu = w.byu;
    const ease = U.smooth(clamp(b / 0.8, 0, 1)), sc = 0.2 + 0.8 * ease;
    // soft ground shadow + translucent silk film
    ctx.save(); ctx.translate(w.x + 3, w.y + 4); ctx.rotate(w.rot); ctx.scale(w.rx * sc, w.ry * sc); ctx.globalAlpha = 0.4 * A; ctx.fillStyle = GRAD.shadow; ctx.beginPath(); ctx.arc(0, 0, 1.05, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot); ctx.scale(w.rx * sc, w.ry * sc); ctx.globalAlpha = A * (0.7 + 0.3 * Math.min(1, integ * 1.5)); ctx.fillStyle = GRAD.film; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    // displaced boundary vertices
    for (let i = 0; i < nb; i++) { sheetPt(w, bxu[i] * ease, byu[i] * ease, 0.35); RIM_X[i] = DX; RIM_Y[i] = DY; }
    // --- fine, dense mesh first (so the structural threads sit on top)
    const nShow = Math.floor(w.nc * clamp((b - 0.08) / 0.82, 0, 1));
    ctx.beginPath();
    for (let k = 12; k < nShow; k++) {
      if (!keep(w.crnd[k], integ)) continue;
      const i = w.ci[k], j = w.cj[k], x0 = RIM_X[i], y0 = RIM_Y[i], x1 = RIM_X[j], y1 = RIM_Y[j];
      sheetPt(w, (bxu[i] + bxu[j]) * 0.5 * ease, (byu[i] + byu[j]) * 0.5 * ease, 1);
      ctx.moveTo(x0, y0); ctx.quadraticCurveTo(DX * 2 - (x0 + x1) / 2, DY * 2 - (y0 + y1) / 2, x1, y1);
    }
    ctx.lineWidth = 0.6 * px; ctx.strokeStyle = rgba(236, 246, 255, 0.36 * A); ctx.stroke();
    // --- rings (smooth, irregular)
    if (b > 0.45) {
      const ra = clamp((b - 0.45) / 0.4, 0, 1);
      ctx.beginPath();
      for (let q = 0; q < w.rings.length; q++) {
        const rg = w.rings[q], n = rg.n, p = rg.pts;
        for (let i = 0; i < n; i++) {
          if (!keep(rg.rn[i], integ)) continue;
          const i0 = (i + n - 1) % n, j = (i + 1) % n;
          sheetPt(w, (p[i0 * 2] + p[i * 2]) * 0.5 * ease, (p[i0 * 2 + 1] + p[i * 2 + 1]) * 0.5 * ease, 0.8); const x0 = DX, y0 = DY;
          sheetPt(w, p[i * 2] * ease, p[i * 2 + 1] * ease, 0.8); const cx = DX, cy = DY;
          sheetPt(w, (p[j * 2] + p[i * 2]) * 0.5 * ease, (p[j * 2 + 1] + p[i * 2 + 1]) * 0.5 * ease, 0.8);
          ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x0 + (DX - x0) * ra, y0 + (DY - y0) * ra);
        }
      }
      ctx.lineWidth = 0.75 * px; ctx.strokeStyle = rgba(240, 248, 255, 0.48 * A); ctx.stroke();
    }
    // --- main load-bearing threads + funnel fan
    ctx.beginPath();
    for (let k = 0; k < Math.min(12, nShow); k++) {
      if (!keep(w.crnd[k], integ)) continue;
      const i = w.ci[k], j = w.cj[k], x0 = RIM_X[i], y0 = RIM_Y[i], x1 = RIM_X[j], y1 = RIM_Y[j];
      sheetPt(w, (bxu[i] + bxu[j]) * 0.5 * ease, (byu[i] + byu[j]) * 0.5 * ease, 1);
      ctx.moveTo(x0, y0); ctx.quadraticCurveTo(DX * 2 - (x0 + x1) / 2, DY * 2 - (y0 + y1) / 2, x1, y1);
    }
    sheetPt(w, w.fmx * ease, w.fmy * ease, 0.9); const fx0 = DX, fy0 = DY;
    const nf = Math.floor(w.nf * clamp((b - 0.4) / 0.5, 0, 1));
    for (let k = 0; k < nf; k++) {
      if (!keep(w.frnd[k], integ)) continue; const j = w.fj[k];
      ctx.moveTo(fx0, fy0); ctx.quadraticCurveTo((fx0 + RIM_X[j]) / 2 + (w.cx0 || 0), (fy0 + RIM_Y[j]) / 2, RIM_X[j], RIM_Y[j]);
    }
    strokeSilk(ctx, A, 0.95, 2.6, 0, 0.75 + w.pulse * 0.2, 0.12, 0);
    // --- rim: smooth scalloped edge + stubs to the ground
    ctx.beginPath();
    for (let i = 0; i < nb; i++) {
      if (!keep(w.crnd[(i * 3) % w.nc], integ + 0.12)) continue;
      const i0 = (i + nb - 1) % nb, j = (i + 1) % nb;
      const sx = (RIM_X[i0] + RIM_X[i]) * 0.5, sy = (RIM_Y[i0] + RIM_Y[i]) * 0.5, ex = (RIM_X[j] + RIM_X[i]) * 0.5, ey = (RIM_Y[j] + RIM_Y[i]) * 0.5;
      ctx.moveTo(sx, sy); ctx.quadraticCurveTo(RIM_X[i], RIM_Y[i], ex, ey);
    }
    for (let i = 0; i < w.ns && b > 0.3; i++) {
      const bi = w.sti[i], a = bxu[bi], c2 = byu[bi], l = w.stl[i] / Math.max(w.rx, w.ry), len = Math.hypot(a, c2) || 1, sa = clamp((b - 0.3) / 0.3, 0, 1);
      sheetPt(w, (a + a / len * l) * ease, (c2 + c2 / len * l) * ease, 0.2);
      ctx.moveTo(RIM_X[bi], RIM_Y[bi]); ctx.lineTo(RIM_X[bi] + (DX - RIM_X[bi]) * sa, RIM_Y[bi] + (DY - RIM_Y[bi]) * sa);
    }
    strokeSilk(ctx, A, 1.25, 3.0, 2.6, 0.85, 0.15, 0.1);
    // --- funnel retreat tube leaving the sheet at its near edge (soft, slightly bent sleeve)
    if (b > 0.5) {
      const fa = clamp((b - 0.5) / 0.4, 0, 1);
      sheetPt(w, w.fmx * ease, w.fmy * ease, 0.5); const mx = DX, my = DY;
      sheetPt(w, 0.16 * ease, (w.fmy + 0.5) * ease, 0.4); const tx = DX, ty = DY;
      sheetPt(w, -0.1 * ease, (w.fmy + 0.26) * ease, 0.45); const qx = DX, qy = DY;
      const dx = tx - mx, dy = ty - my, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
      const mw = Math.max(w.ry * 0.14, 6.5 * px), tw = mw * 0.62, ang = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(mx + nx * mw, my + ny * mw); ctx.quadraticCurveTo(qx + nx * mw * 0.9, qy + ny * mw * 0.9, tx + nx * tw, ty + ny * tw);
      ctx.arc(tx, ty, tw, ang + Math.PI / 2, ang - Math.PI / 2, true);
      ctx.quadraticCurveTo(qx - nx * mw * 0.9, qy - ny * mw * 0.9, mx - nx * mw, my - ny * mw); ctx.closePath();
      ctx.globalAlpha = A * fa; ctx.fillStyle = 'rgba(206,214,244,0.5)'; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.1 * px; ctx.strokeStyle = rgba(246, 250, 255, 0.8 * A * fa); ctx.stroke();
      ctx.beginPath();
      for (let q = 1; q <= 3; q++) { const t = q / 4, cxm = mx + (qx - mx) * 2 * t * (1 - t) + (tx - mx) * t * t, cym = my + (qy - my) * 2 * t * (1 - t) + (ty - my) * t * t, ww = (mw + (tw - mw) * t) * 0.9; ctx.moveTo(cxm + nx * ww, cym + ny * ww); ctx.quadraticCurveTo(cxm + ux * ww * 0.4, cym + uy * ww * 0.4, cxm - nx * ww, cym - ny * ww); }
      ctx.lineWidth = 0.7 * px; ctx.strokeStyle = rgba(240, 248, 255, 0.5 * A * fa); ctx.stroke();
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang + Math.PI / 2); ctx.scale(mw * 1.02, mw * 0.72); ctx.globalAlpha = A * fa; ctx.fillStyle = GRAD.hole; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.ellipse(mx, my, mw * 1.02, mw * 0.72, ang + Math.PI / 2, 0, TAU); ctx.lineWidth = 1.2 * px; ctx.strokeStyle = rgba(248, 251, 255, 0.85 * A * fa); ctx.stroke();
    }
    // --- dew along the edge
    if (!ghost && b >= 0.95 && V.lod > 0) {
      const dew = env.dew, grow = 1 + 0.55 * dew + 0.5 * env.wet;
      ctx.beginPath();
      for (let i = 0; i < nb; i++) { if (!keep(w.crnd[(i * 3) % w.nc], integ)) continue; const rad = (0.6 + 0.5 * w.crnd[(i * 7) % w.nc]) * grow * px * 1.2; ctx.moveTo(RIM_X[i] + rad, RIM_Y[i]); ctx.arc(RIM_X[i], RIM_Y[i], rad, 0, TAU); }
      ctx.fillStyle = rgba(228, 244, 255, 0.6 * A); ctx.fill();
      // droplets strung on the mesh
      ctx.beginPath();
      for (let k = 12; k < w.nc; k += 2) {
        const i = w.ci[k], j = w.cj[k]; if (!keep(w.crnd[k], integ)) continue;
        const f = 0.3 + 0.4 * w.crnd[(k * 5) % w.nc], x = RIM_X[i] + (RIM_X[j] - RIM_X[i]) * f, y = RIM_Y[i] + (RIM_Y[j] - RIM_Y[i]) * f, rad = 0.45 * grow * px * 1.2;
        ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, TAU);
      }
      ctx.fillStyle = rgba(235, 247, 255, 0.5 * A); ctx.fill();
      if (dew > 0.15 && !STATIC) {
        ctx.beginPath(); let any = false;
        for (let i = 0; i < nb; i++) { if (w.crnd[(i * 3) % w.nc] < 0.5) continue; const tw = Math.sin(T * 2 + i * 2.3); if (tw < 0.2) continue; const len = (2 + 3 * tw) * px * dew; ctx.moveTo(RIM_X[i] - len, RIM_Y[i]); ctx.lineTo(RIM_X[i] + len, RIM_Y[i]); ctx.moveTo(RIM_X[i], RIM_Y[i] - len); ctx.lineTo(RIM_X[i], RIM_Y[i] + len); any = true; }
        if (any) { ctx.lineWidth = 0.75 * px; ctx.strokeStyle = rgba(255, 255, 250, 0.8 * A * dew); ctx.stroke(); }
      }
    }
  }

  // --------------------------------------------------------------- RETREAT
  // scalloped tent outline: pegs on a ring, rim sags inward between pegs. pts: peg i radius = R*a[i]
  function tentRim(ctx, w, cx, cy, R, rot, scallop, from, to, move) {
    const np = w.nst, a = w.lm[0];
    for (let i = 0; i < np; i++) {
      const th0 = w.sta[i] + rot, th1 = w.sta[(i + 1) % np] + (i + 1 === np ? TAU : 0) + rot, mid = (th0 + th1) / 2;
      const r0 = R * (0.97 + 0.04 * a[i % w.nb]), r1 = R * (0.97 + 0.04 * a[(i + 1) % w.nb]);
      const x0 = cx + Math.cos(th0) * r0, y0 = cy + Math.sin(th0) * r0, x1 = cx + Math.cos(th1) * r1, y1 = cy + Math.sin(th1) * r1;
      const mr = (r0 + r1) * 0.5 * (1 - scallop);
      if (i === 0 && move) ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx + Math.cos(mid) * mr, cy + Math.sin(mid) * mr, x1, y1);
    }
  }
  function drawRetreat(ctx, w, A, integ, ghost, overlay) {
    const px = V.px, b = w.build, ease = b < 1 ? U.smooth(b) : 1;
    const breathe = STATIC ? 1 : 1 + 0.008 * Math.sin(T * 1.7 + w.seed % 5);
    const R = w.r * (0.25 + 0.75 * ease) * breathe;
    dispAt(w, w.x, w.y, 1);
    const cx = w.x + DX * 0.6, cy = w.y + DY * 0.6, np = w.nst;
    if (!overlay) {
      ctx.save(); ctx.translate(cx + 4, cy + 6); ctx.scale(R * 1.1, R * 1.1); ctx.globalAlpha = 0.85 * A; ctx.fillStyle = GRAD.shadow; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    }
    // base silk skirt (scalloped)
    ctx.beginPath(); tentRim(ctx, w, cx, cy, R, 0, 0.16, 0, np, true); ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.translate(cx - R * 0.08, cy - R * 0.1); ctx.scale(R * 1.1, R * 1.1); ctx.globalAlpha = A * (overlay ? 0.4 : 1); ctx.fillStyle = GRAD.dome; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
    if (overlay) {
      ctx.beginPath(); tentRim(ctx, w, cx, cy, R, 0, 0.16, 0, np, true); ctx.closePath();
      ctx.lineWidth = 1.4 * px; ctx.strokeStyle = rgba(248, 251, 255, 0.5 * A); ctx.stroke();
      return;
    }
    // pleated panels: alternate shading between ribs (reads as a pitched silk canopy)
    const nrib = w.nrib, ax = cx - Math.cos(w.ent) * R * 0.08, ay = cy - Math.sin(w.ent) * R * 0.08;
    if (b > 0.3) {
      const ra = clamp((b - 0.3) / 0.5, 0, 1);
      ctx.save();
      ctx.beginPath(); tentRim(ctx, w, cx, cy, R, 0, 0.16, 0, np, true); ctx.closePath(); ctx.clip();
      for (let i = 0; i < nrib; i += 2) {
        const t0 = i * TAU / nrib, t1 = (i + 1) * TAU / nrib;
        ctx.beginPath(); ctx.moveTo(ax, ay);
        ctx.lineTo(cx + Math.cos(t0) * R * 1.05 * ra + (ax - cx) * (1 - ra), cy + Math.sin(t0) * R * 1.05 * ra + (ay - cy) * (1 - ra));
        ctx.lineTo(cx + Math.cos(t1) * R * 1.05 * ra + (ax - cx) * (1 - ra), cy + Math.sin(t1) * R * 1.05 * ra + (ay - cy) * (1 - ra)); ctx.closePath();
        ctx.fillStyle = rgba(70, 64, 120, 0.1 * A * ra); ctx.fill();
      }
      ctx.restore();
    }
    // apex cap (second silk tier)
    ctx.beginPath(); ctx.arc(ax, ay, R * 0.34, 0, TAU);
    ctx.fillStyle = rgba(246, 249, 255, 0.2 * A); ctx.fill(); ctx.lineWidth = 1.1 * px; ctx.strokeStyle = rgba(248, 251, 255, 0.6 * A); ctx.stroke();
    ctx.beginPath(); ctx.arc(ax, ay, R * 0.68, 0, TAU); ctx.lineWidth = 0.8 * px; ctx.strokeStyle = rgba(240, 248, 255, 0.28 * A); ctx.stroke();
    // ribs
    if (b > 0.3) {
      const ra = clamp((b - 0.3) / 0.5, 0, 1);
      ctx.beginPath();
      for (let i = 0; i < nrib; i++) {
        if (!keep(w.ribRnd[i], integ)) continue;
        const th = i * TAU / nrib, ex = cx + Math.cos(th) * R * 0.98, ey = cy + Math.sin(th) * R * 0.98;
        const mx = ax + (ex - ax) * 0.5 + Math.cos(th + 1.57) * R * 0.07, my = ay + (ey - ay) * 0.5 + Math.sin(th + 1.57) * R * 0.07;
        ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, ax + (ex - ax) * ra, ay + (ey - ay) * ra);
      }
      ctx.lineWidth = 0.8 * px; ctx.strokeStyle = rgba(246, 250, 255, 0.5 * A); ctx.stroke();
    }
    // scalloped rim with glow
    ctx.beginPath(); tentRim(ctx, w, cx, cy, R, 0, 0.16, 0, np, true); ctx.closePath();
    strokeSilk(ctx, A, 1.5, 3.4, 3.0, 0.9, 0.16, 0.12);
    // pegs + guy lines to the ground
    if (b > 0.35) {
      const ra = clamp((b - 0.35) / 0.5, 0, 1);
      ctx.beginPath();
      for (let i = 0; i < np; i++) { const th = w.sta[i], x0 = cx + Math.cos(th) * R * 0.99, y0 = cy + Math.sin(th) * R * 0.99, l = w.stl[i] * ra; ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(th) * l, y0 + Math.sin(th) * l); }
      ctx.lineWidth = 1.0 * px; ctx.strokeStyle = rgba(244, 250, 255, 0.65 * A); ctx.stroke();
      ctx.fillStyle = rgba(244, 250, 255, 0.8 * A); ctx.beginPath();
      for (let i = 0; i < np; i++) { const th = w.sta[i], l = R * 0.99 + w.stl[i] * ra, x0 = cx + Math.cos(th) * l, y0 = cy + Math.sin(th) * l; ctx.moveTo(x0 + 1.5 * px, y0); ctx.arc(x0, y0, 1.5 * px, 0, TAU); }
      ctx.fill();
      // doorway arch
      const dx = cx + Math.cos(w.ent) * R * 0.8, dy = cy + Math.sin(w.ent) * R * 0.8, dr = R * 0.2;
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(w.ent); ctx.scale(dr * 0.75, dr * 1.05); ctx.globalAlpha = A * ra; ctx.fillStyle = GRAD.hole; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.ellipse(dx, dy, dr * 0.75, dr * 1.05, w.ent, 0, TAU); ctx.lineWidth = 1.3 * px; ctx.strokeStyle = rgba(248, 251, 255, 0.8 * A * ra); ctx.stroke();
      // specular crescent
      ctx.save(); ctx.translate(cx - R * 0.28, cy - R * 0.34); ctx.rotate(-0.6); ctx.scale(R * 0.46, R * 0.26); ctx.globalAlpha = 0.6 * A; ctx.fillStyle = GRAD.spec; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
  // translucent canopy over the player when the player is inside a retreat (drawn above PLAYER layer)
  function drawCanopy(ctx) {
    const P = Game.player; if (!P || !webs.list.length) return;
    const w = webs.sheltered(P.x, P.y); if (!w) return;
    refreshEnv(); T = Game.time.real; const cam = Game.camera; V.z = cam.zoom || 1; V.px = 1 / V.z; V.lod = V.z < 0.85 ? 0 : (V.z < 1.1 ? 1 : 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; grads(ctx); prepSway(w);
    drawRetreat(ctx, w, 0.6 * (0.55 + 0.45 * Math.min(1, w.integrity * 1.4)), w.integrity, false, true);
  }

  // ----------------------------------------------------- wraps, fx, ghost
  function drawWraps(ctx) {
    const L = webs.list, px = V.px; let any = false;
    ctx.beginPath();
    for (let i = 0; i < L.length; i++) {
      const w = L[i]; if (w.dead || !w.tm.length) continue;
      for (let k = 0; k < w.tm.length; k++) {
        const c = w.tm[k].c; if (!c || c.x < V.x0 || c.x > V.x1 || c.y < V.y0 || c.y > V.y1) continue;
        const r = (c.radius || 3), j = w.vib * 0.9 * Math.sin(T * 31 + k), cx = c.x + j * 0.4, cy = c.y;
        any = true;
        for (let q = 0; q < 3; q++) {
          const a = q * 1.05 + T * 0.4 * (q % 2 ? -1 : 1) + w.seed % 3, rx = r * (1.25 + q * 0.18) + 1.2 * px, ry = r * (0.8 + q * 0.12) + 0.8 * px;
          ctx.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * rx); ctx.ellipse(cx, cy, rx, ry, a, 0, TAU);
        }
        // tension strands from the prey out to the web
        const ox = w.type === 'line' ? w.nx : Math.cos(w.seed), oy = w.type === 'line' ? w.ny : Math.sin(w.seed);
        for (let q = 0; q < 5; q++) {
          const a = q * 1.256 + w.seed % 2, l = r * 2.2 + 7 + 6 * ((q * 7) % 3) + j;
          ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
        }
      }
    }
    if (!any) return;
    ctx.lineWidth = 0.9 * px; ctx.strokeStyle = 'rgba(244,250,255,0.78)'; ctx.stroke();
    if (V.lod > 0) { ctx.lineWidth = 2.6 * px; ctx.strokeStyle = 'rgba(150,205,255,0.14)'; ctx.stroke(); }
  }

  function drawFx(ctx) {
    const fx = webs.fx; if (!fx.length) return; const px = V.px;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i], p = f.t / f.life;
      if (f.x < V.x0 || f.x > V.x1 || f.y < V.y0 || f.y > V.y1) continue;
      if (f.k === 'ring') {
        const R = f.size * (0.5 + 0.6 * U.smooth(p));
        ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, TAU); ctx.lineWidth = 1.4 * px; ctx.strokeStyle = rgba(220, 240, 255, 0.45 * (1 - p)); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(240, 248, 255, 0.8 * (1 - p)); ctx.beginPath(); ctx.arc(f.x, f.y, f.s * px, 0, TAU); ctx.fill();
      }
    }
  }

  function drawGhost(ctx) {
    const g = webs._ghost, ok = webs._ghostOk, px = V.px, pulse = 0.75 + 0.25 * Math.sin(T * 6);
    g.vib = 0; g.vx = g.x; g.vy = g.y;
    if (!ok) {
      ctx.save(); drawWeb(ctx, g, 0.16, true); ctx.restore();
    } else drawWeb(ctx, g, 0.2 + 0.1 * pulse, true);
    const col = ok ? '170,235,255' : '255,130,110';
    ctx.setLineDash([6 * px, 5 * px]); ctx.lineDashOffset = -T * 14 * px;
    ctx.lineWidth = 1.3 * px; ctx.strokeStyle = 'rgba(' + col + ',' + (0.55 * pulse).toFixed(3) + ')';
    ctx.beginPath();
    if (g.type === 'orb' || g.type === 'retreat') ctx.arc(g.x, g.y, g.r, 0, TAU);
    else if (g.type === 'sheet') ctx.ellipse(g.x, g.y, g.rx, g.ry, g.rot, 0, TAU);
    else { ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); }
    ctx.stroke(); ctx.setLineDash([]);
    // anchor markers
    ctx.lineWidth = 1.4 * px;
    const marks = [];
    if (g.type === 'line') { marks.push(g.anchorA, g.anchorB); } else if (g.type === 'orb') { for (let q = 0; q < g.guys.length; q++) if (g.guys[q].an) marks.push(g.guys[q].an); }
    for (let q = 0; q < marks.length; q++) { const a = marks[q]; if (!a) continue; ctx.beginPath(); ctx.arc(a.x, a.y, (3.5 + 1.5 * Math.sin(T * 5 + q)) * px, 0, TAU); ctx.strokeStyle = 'rgba(' + col + ',0.9)'; ctx.stroke(); }
    if (g.type === 'line' && !g.anchoredBoth) { ctx.beginPath(); ctx.arc(g.x2, g.y2, 3 * px, 0, TAU); ctx.strokeStyle = 'rgba(' + col + ',0.5)'; ctx.stroke(); }
  }

  // ---------------------------------------------------------------- Territory: saving
  // A web is saved as its placement (position, size, angle, seed) plus its condition; the strand geometry is rebuilt from the seed, so a restored
  // web looks the same as the one that was saved. Trapped prey is not saved (the population is respawned on load).
  const rd = (v, n) => { const k = Math.pow(10, n || 0); return Math.round(v * k) / k; };
  webs.serialize = function () {
    const out = [];
    for (let i = 0; i < webs.list.length; i++) {
      const w = webs.list[i]; if (w.dying || w.dead) continue;
      const r = { id: w.id, type: w.type, seed: w.seed, integrity: rd(w.integrity, 3), age: rd(w.age, 1), build: rd(w.build, 2), heirloom: !!w.heirloom, owner: w.owner };
      if (w.type === 'line') { r.x1 = rd(w.x1, 1); r.y1 = rd(w.y1, 1); r.x2 = rd(w.x2, 1); r.y2 = rd(w.y2, 1); r.sag = rd(w.sag, 2); r.ab = w.anchoredBoth ? 1 : 0; }
      else { r.x = rd(w.x, 1); r.y = rd(w.y, 1); r.r = rd(w.r, 1); r.rot = rd(w.rot || 0, 3); if (w.type === 'sheet') { r.rx = rd(w.rx, 1); r.ry = rd(w.ry, 1); } }
      out.push(r);
    }
    return { list: out, selected: webs.selected };
  };
  function restoreWeb(r) {
    if (!r || !TYPE[r.type]) return null;
    const n = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
    const w = blankWeb(r.type);
    if (n(r.id, 0) > 0) w.id = r.id; else w.id = nextId++;
    w.seed = (n(r.seed, 1) >>> 0) || 1;
    const rng = U.mulberry32(w.seed), wd = Game.world, canA = wd && typeof wd.nearestAnchor === 'function';
    if (r.type === 'line') {
      w.x1 = n(r.x1, 0); w.y1 = n(r.y1, 0); w.x2 = n(r.x2, 0); w.y2 = n(r.y2, 0);
      w.anchoredBoth = !!r.ab;
      if (canA) { w.anchorA = wd.nearestAnchor(w.x1, w.y1, 3); w.anchorB = w.anchoredBoth ? wd.nearestAnchor(w.x2, w.y2, 3) : null; }
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy) || 1;
      let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; }
      w.nx = nx; w.ny = ny; w.len = L; w.sag = n(r.sag, L * 0.04);
      w.x = (w.x1 + w.x2) / 2; w.y = (w.y1 + w.y2) / 2; w.r = L / 2 + 12;
      const nb = Math.max(3, Math.floor(L / 15));
      w.bt = new Float32Array(nb); w.bs = new Float32Array(nb); w.bsp = new Float32Array(nb);
      for (let i = 0; i < nb; i++) { w.bt[i] = (i + 0.5 + (rng() - 0.5) * 0.6) / nb; w.bs[i] = 0.7 + rng() * 0.8; w.bsp[i] = rng(); }
      const m = w.sag + 14;
      w.bx0 = Math.min(w.x1, w.x2) - m; w.bx1 = Math.max(w.x1, w.x2) + m; w.by0 = Math.min(w.y1, w.y2) - m; w.by1 = Math.max(w.y1, w.y2) + m;
    } else {
      w.x = n(r.x, 0); w.y = n(r.y, 0); w.r = Math.max(10, n(r.r, 60)); w.rot = n(r.rot, 0);
      if (r.type === 'sheet') { w.rx = Math.max(10, n(r.rx, w.r)); w.ry = Math.max(10, n(r.ry, w.rx * 0.62)); w.r = w.rx; geomSheet(w, rng); }
      else if (r.type === 'orb') geomOrb(w, rng, w.rot);
      else geomRetreat(w, rng, w.rot);
    }
    w.integrity = Math.max(0.02, Math.min(1, n(r.integrity, 1))); w.age = Math.max(0, n(r.age, 0)); w.heirloom = !!r.heirloom;
    w.build = Math.max(0, Math.min(1, n(r.build, 1))); w.placed = w.build >= 1; w.buildDur = TYPE[r.type].build;
    w.born = now() - w.age; w.owner = r.owner || 'player';
    return w;
  }
  webs.deserialize = function (d) {
    if (!d || typeof d !== 'object') return;
    webs.list.length = 0;
    const L = Array.isArray(d.list) ? d.list : [];
    let maxId = 0;
    for (let i = 0; i < L.length; i++) {
      let w = null;
      try { w = restoreWeb(L[i]); } catch (e) { Game.reportError('webs.restore', e); }
      if (w) { webs.list.push(w); if (w.id > maxId) maxId = w.id; }
    }
    nextId = Math.max(nextId, maxId + 1);
    if (d.selected && TYPE[d.selected] && webs.unlocked(d.selected)) webs.selected = d.selected;
  };

  Game.register('webs', webs);
})();
