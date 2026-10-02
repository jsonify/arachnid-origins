/* ============================================================================
 * Arachnid Origins -- world.js   (module `world`, priority 10)
 * Terrain, zones, obstacles, resources, shelters, anchors, day/night, weather,
 * fog-of-war grid and every environmental draw layer.  All art is procedural.
 *
 * Architecture notes
 *  - Everything static (ground, leaf litter, bark, soil, rocks, twigs, shelters,
 *    canopy shadows) is baked lazily into chunked offscreen canvases (CH x CH
 *    world px, two resolution tiers) and blitted per frame (culled).
 *  - Sprites (leaves, flowers, ferns, bark flaps, dew, nectar ...) are
 *    pre-rendered once in init() and reused.
 *  - Dynamic layers (grass sway, dew glints, canopy fade, weather, night tint)
 *    are drawn per frame, culled to the camera view, with no per-frame
 *    allocation in the hot paths.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util;
  const W = C.WORLD_W, H = C.WORLD_H;
  const PI = Math.PI, TAU = PI * 2;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, floor = Math.floor, ceil = Math.ceil, sqrt = Math.sqrt;
  const min = Math.min, max = Math.max, pow = Math.pow, atan2 = Math.atan2, hypot = Math.hypot;
  const clamp = U.clamp, lerp = U.lerp;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const SEED = 90417;
  const now = () => (root.performance && root.performance.now) ? root.performance.now() : Date.now();

  // ------------------------------------------------------------ canvas helpers
  function mk(w, h) {
    try { const c = U.makeCanvas(max(1, ceil(w)), max(1, ceil(h))); return c || null; } catch (e) { return null; }
  }
  function ctxOf(c) { try { return c ? c.getContext('2d') : null; } catch (e) { return null; } }

  // --------------------------------------------------------------- color helpers
  const cl255 = (v) => v < 0 ? 0 : (v > 255 ? 255 : v | 0);
  const css = (c, a) => a === undefined ? 'rgb(' + cl255(c[0]) + ',' + cl255(c[1]) + ',' + cl255(c[2]) + ')' : 'rgba(' + cl255(c[0]) + ',' + cl255(c[1]) + ',' + cl255(c[2]) + ',' + (a < 0 ? 0 : (a > 1 ? 1 : +a.toFixed(3))) + ')';
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mulc = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

  // ------------------------------------------------------------------- noise
  function fbm(x, y, seed, oct) {
    let a = 0, amp = 0.5, f = 1, sum = 0;
    for (let i = 0; i < oct; i++) { a += amp * U.noise2(x * f, y * f, seed + i * 17); sum += amp; amp *= 0.5; f *= 2.03; }
    return a / sum;
  }
  const hsh = (a, b, s) => U.hash2(a | 0, b | 0, s | 0);

  // ----------------------------------------------------------- zone geometry
  // Zones are vertical bands; the *visual* boundary is wobbly and blended.
  function bnd1(y) { return 2400 + (U.noise2(y * 0.0021, 3.7, 11) - 0.5) * 200 + (U.noise2(y * 0.011, 9.1, 12) - 0.5) * 60; }
  function bnd2(y) { return 4200 + (U.noise2(y * 0.0019, 7.3, 13) - 0.5) * 200 + (U.noise2(y * 0.012, 2.9, 14) - 0.5) * 60; }
  // weights (litter, bark, garden) -> out[0..2]
  function zoneW(x, y, out) {
    const t1 = sstep(-120, 120, x - bnd1(y)), t2 = sstep(-120, 120, x - bnd2(y));
    out[0] = 1 - t1; out[1] = t1 - t2; out[2] = t2; return out;
  }
  const _zw = [0, 0, 0];
  function zoneIdAt(x, y) { return x < 2400 ? 0 : (x < 4200 ? 1 : 2); }

  // ------------------------------------------------------ ground "field" model
  // A cheap analytic height/colour model evaluated at low resolution per chunk
  // and upscaled smoothly: gives continuous, lit, zone-blended base colour.
  function hBark(x, y) {
    const wx = x + 46 * (fbm(x * 0.0045, y * 0.0013, 31, 2) - 0.5) * 2;
    const warp = 2.6 * fbm(wx * 0.012, y * 0.0017, 32, 2);
    const r = pow(abs(sin(wx * 0.047 + warp)), 0.5);
    const cross = pow(abs(sin((wx * 0.5 + y * 0.1) * 0.05 + 3 * fbm(wx * 0.01, y * 0.004, 34, 2))), 0.5);
    return r * (0.74 + 0.26 * cross) + 0.14 * fbm(x * 0.05, y * 0.013, 33, 2);
  }
  function hSoil(x, y) { return fbm(x * 0.07, y * 0.07, 22, 2) * 0.6 + fbm(x * 0.02, y * 0.02, 23, 2) * 0.4; }

  const COL = {
    soilDark: [27, 19, 12], soilLite: [66, 47, 29],
    furrow: [26, 20, 17], plateau: [108, 90, 72], barkWarm: [120, 92, 66],
    lichen: [138, 150, 122], moss: [46, 78, 34],
    gSoil: [44, 35, 22], gGreen: [58, 96, 38], gGreenLite: [86, 130, 52], gDark: [34, 58, 26],
  };
  // Per-sample colour. Heights (and their gradients) come from per-chunk grids so each
  // is evaluated once; zone boundaries are evaluated once per row (b1,b2).
  function fieldSample(x, y, b1, b2, hB, hbx, hby, hS, hsx, hsy, out) {
    const t1 = sstep(-120, 120, x - b1), t2 = sstep(-120, 120, x - b2);
    const wl = 1 - t1, wb = t1 - t2, wg = t2;
    let r = 0, g = 0, b = 0;
    if (wl > 0.002) {
      const n = fbm(x * 0.011, y * 0.011, 21, 3), n2 = U.noise2(x * 0.035, y * 0.035, 24);
      const lam = (0.5 * hsx + 0.6 * hsy) * 7 + 0.62;
      const sh = 0.55 + 0.75 * lam / sqrt(1 + 49 * (hsx * hsx + hsy * hsy));
      const wet = sstep(0.55, 0.8, U.noise2(x * 0.006, y * 0.006, 25));
      const k = mixc(mixc(COL.soilDark, COL.soilLite, n * 0.9 + n2 * 0.25), [18, 12, 8], wet * 0.55);
      r += wl * k[0] * sh; g += wl * k[1] * sh; b += wl * k[2] * sh;
    }
    if (wb > 0.002) {
      const K = 5.5, lam = (0.5 * hbx + 0.6 * hby) * K + 0.62;
      const sh = 0.32 + 1.05 * lam / sqrt(1 + K * K * (hbx * hbx + hby * hby));
      const hh = pow(clamp(hB, 0, 1.1), 1.25);
      let k = mixc(COL.furrow, COL.plateau, clamp(hh, 0, 1));
      const warm = U.noise2(x * 0.004, y * 0.004, 35);
      k = mixc(k, COL.barkWarm, clamp((warm - 0.35) * 1.4, 0, 0.7) * hh * 0.7);
      const fib = 0.86 + 0.28 * U.noise2(x * 0.30, y * 0.018, 36);
      const ln = fbm(x * 0.007, y * 0.006, 40, 2) + (U.noise2(x * 0.09, y * 0.09, 41) - 0.5) * 0.14;
      const lm = sstep(0.60, 0.68, ln) * sstep(0.42, 0.70, hh);
      const mn = fbm(x * 0.0065, y * 0.0072, 42, 2) + (U.noise2(x * 0.11, y * 0.11, 43) - 0.5) * 0.16;
      const mm = sstep(0.58, 0.66, mn) * (1 - sstep(0.30, 0.62, hh) * 0.65);
      if (lm > 0.01) k = mixc(k, COL.lichen, lm * 0.7);
      if (mm > 0.01) k = mixc(k, mixc(COL.moss, [70, 108, 44], U.noise2(x * 0.2, y * 0.2, 44)), mm * 0.85);
      r += wb * k[0] * sh * fib; g += wb * k[1] * sh * fib; b += wb * k[2] * sh * fib;
    }
    if (wg > 0.002) {
      const gn = sstep(0.34, 0.62, fbm(x * 0.0075, y * 0.0075, 51, 2));
      const gn2 = fbm(x * 0.03, y * 0.03, 52, 2);
      const lam = (0.5 * hsx + 0.6 * hsy) * 6 + 0.62;
      const sh = 0.6 + 0.7 * lam / sqrt(1 + 36 * (hsx * hsx + hsy * hsy));
      let k = mixc(COL.gSoil, mixc(COL.gDark, COL.gGreen, gn2), gn);
      k = mixc(k, COL.gGreenLite, sstep(0.55, 0.85, gn * 0.55 + gn2 * 0.6) * 0.5);
      r += wg * k[0] * sh; g += wg * k[1] * sh; b += wg * k[2] * sh;
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  // soft tileable grain texture (overlay blended onto each chunk)
  let GRAIN = null;
  function makeGrain() {
    const cv = mk(128, 128); if (!cv) return null; const g = ctxOf(cv); if (!g) return null;
    const id = g.createImageData(128, 128), d = id.data, rn = U.mulberry32(77);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      // tileable value noise via wrapped hashing
      const a = rn(), v = 128 + (a - 0.5) * 70 + (hsh(x >> 2, y >> 2, 5) - 0.5) * 36;
      d[i] = d[i + 1] = d[i + 2] = clamp(v, 0, 255); d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0); return cv;
  }

  // ============================================================================
  // SPRITES (pre-rendered once)
  // ============================================================================
  const SP = { leaf: {}, flower: [], petal: [], fern: [], flap: [], fan: [], moss: [], clover: [], dew: [], nectar: [], glow: {}, star: null, blob: null, fog: null, dapple: [], dapple2: [] };
  const PPW = 3, LREF = 160;   // leaf sprite: PPW px per world px, LREF world px long at scale 1

  const LEAF_COLORS = {
    rust:      { base: [150, 78, 36],  hi: [208, 124, 54],  lo: [78, 38, 18],   vein: [226, 170, 98] },
    ochre:     { base: [188, 142, 60], hi: [236, 200, 100], lo: [104, 74, 30],  vein: [248, 228, 152] },
    brown:     { base: [112, 78, 46],  hi: [160, 120, 76],  lo: [52, 36, 20],   vein: [194, 156, 108] },
    olive:     { base: [124, 124, 50], hi: [180, 172, 78],  lo: [62, 62, 24],   vein: [216, 212, 132] },
    dark:      { base: [66, 50, 33],   hi: [98, 76, 50],    lo: [32, 24, 15],   vein: [124, 100, 72] },
    red:       { base: [150, 54, 34],  hi: [208, 88, 50],   lo: [74, 24, 16],   vein: [234, 142, 102] },
    gold:      { base: [208, 164, 60], hi: [248, 218, 108], lo: [124, 90, 30],  vein: [255, 242, 172] },
    green:     { base: [66, 130, 52],  hi: [122, 188, 82],  lo: [28, 70, 30],   vein: [192, 228, 142] },
    deepgreen: { base: [38, 96, 48],   hi: [84, 150, 70],   lo: [18, 54, 28],   vein: [148, 200, 120] },
    lime:      { base: [112, 162, 52], hi: [172, 216, 92],  lo: [56, 100, 30],  vein: [222, 242, 152] },
  };

  function leafProfile(shape) {
    switch (shape) {
      case 0: return u => 0.25 * pow(sin(PI * pow(u, 0.8)), 0.8) * (0.56 + 0.44 * pow(abs(sin(PI * (u * 4.4 + 0.3))), 0.5)); // oak, lobed
      case 1: return u => 0.30 * pow(sin(PI * pow(u, 0.9)), 0.7) * (0.30 + 0.70 * pow(abs(cos(PI * (u * 3.0 - 0.2))), 1.7));    // pointed lobes
      case 2: return u => 0.205 * pow(sin(PI * pow(u, 0.85)), 0.9) * (0.95 + 0.07 * (((u * 27) % 1) - 0.5));                    // serrated oval
      case 3: return u => 0.085 * pow(sin(PI * pow(u, 0.7)), 0.8);                                                              // lanceolate
      default: return u => 0.33 * pow(sin(PI * pow(u, 0.55)), 0.95);                                                            // broad ovate
    }
  }

  // blurred black silhouette (for soft shadows / AO), 1/4 resolution
  function silhouette(cv) {
    const w1 = max(2, ceil(cv.width / 2)), h1 = max(2, ceil(cv.height / 2));
    const a = mk(w1, h1), ga = ctxOf(a); if (!ga) return null;
    ga.drawImage(cv, 0, 0, w1, h1);
    const w2 = max(2, ceil(w1 / 2)), h2 = max(2, ceil(h1 / 2));
    const b = mk(w2, h2), gb = ctxOf(b); if (!gb) return null;
    gb.drawImage(a, 0, 0, w2, h2);
    gb.globalCompositeOperation = 'source-in'; gb.fillStyle = '#000'; gb.fillRect(0, 0, w2, h2);
    return b;
  }

  function blobPath(g, cx, cy, r, rn, pts, jag) {
    g.beginPath();
    const off = rn() * TAU;
    for (let i = 0; i < pts; i++) { const a = off + i * TAU / pts, rr = r * (1 - jag + rn() * jag * 2); g.lineTo(cx + cos(a) * rr, cy + sin(a) * rr); }
    g.closePath();
  }

  function makeLeaf(shape, ck, seed) {
    const rn = U.mulberry32(seed), col = LEAF_COLORS[ck], prof = leafProfile(shape);
    const L = LREF * PPW, pad = 38;
    const bend = (rn() - 0.5) * (shape === 3 ? 0.26 : 0.16), asym = (rn() - 0.5) * 0.12;
    let mhw = 0; for (let i = 0; i <= 60; i++) mhw = max(mhw, prof(i / 60));
    const hh = mhw * L * (1 + abs(asym)) + abs(bend) * L * 0.14;
    const w = ceil(L + pad * 2), h = ceil(hh * 2 + pad * 2);
    const cv = mk(w, h), g = ctxOf(cv); if (!g) return null;
    g.translate(w / 2, h / 2);
    const X = u => (u - 0.5) * L, Y = u => bend * L * ((u - 0.5) * (u - 0.5) - 0.06);
    const top = u => Y(u) - prof(u) * L * (1 + asym), bot = u => Y(u) + prof(u) * L * (1 - asym);
    const N = 76;
    const outline = () => { g.beginPath(); for (let i = 0; i <= N; i++) { const u = i / N; g.lineTo(X(u), top(u)); } for (let i = N; i >= 0; i--) { const u = i / N; g.lineTo(X(u), bot(u)); } g.closePath(); };
    // petiole
    g.lineCap = 'round'; g.strokeStyle = css(mulc(col.base, 0.8)); g.lineWidth = 7;
    g.beginPath(); g.moveTo(X(0.0), Y(0.0)); g.quadraticCurveTo(X(0) - 18, Y(0) + 5 * (rn() - 0.5) * 2, X(0) - 33, Y(0) + (rn() - 0.5) * 16); g.stroke();
    g.strokeStyle = css(col.hi, 0.5); g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(X(0.0), Y(0.0) - 1.5); g.quadraticCurveTo(X(0) - 18, Y(0) - 1, X(0) - 33, Y(0) - 1); g.stroke();
    // body gradient across the width (one half lit, the other in curl-shade)
    const gr = g.createLinearGradient(0, -mhw * L, 0, mhw * L);
    gr.addColorStop(0, css(col.lo)); gr.addColorStop(0.18, css(col.base)); gr.addColorStop(0.42, css(col.hi));
    gr.addColorStop(0.5, css(mulc(col.base, 0.84))); gr.addColorStop(0.62, css(col.base));
    gr.addColorStop(0.92, css(mulc(col.lo, 1.15))); gr.addColorStop(1, css(col.lo));
    outline(); g.fillStyle = gr; g.fill();

    g.save(); outline(); g.clip();
    // soft blotches
    for (let i = 0; i < 18; i++) {
      const bx = (rn() - 0.5) * L, by = (rn() - 0.5) * mhw * 2 * L, br = 26 + rn() * 80, cc = rn() < 0.5 ? col.hi : col.lo;
      const gg = g.createRadialGradient(bx, by, 0, bx, by, br); gg.addColorStop(0, css(cc, 0.24)); gg.addColorStop(1, css(cc, 0));
      g.fillStyle = gg; g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // fibres following the vein direction
    g.lineWidth = 1.2;
    for (let i = 0; i < 170; i++) {
      const u = 0.05 + rn() * 0.9, sg = rn() < 0.5 ? -1 : 1, py = Y(u) + sg * rn() * prof(u) * L * 0.95, px = X(u), a = 0.85 + (rn() - 0.5) * 0.4, ln = 10 + rn() * 26;
      g.strokeStyle = css(rn() < 0.5 ? col.vein : col.lo, 0.05 + rn() * 0.08);
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + cos(a) * ln, py + sg * sin(a) * ln); g.stroke();
    }
    // tip browning / decay
    const tipU = rn() < 0.5 ? 0.92 : 0.1;
    const tg = g.createRadialGradient(X(tipU), Y(tipU), 0, X(tipU), Y(tipU), 120 + rn() * 90);
    tg.addColorStop(0, css(mulc(col.lo, 0.8), ck === 'dark' ? 0.35 : 0.5)); tg.addColorStop(1, css(col.lo, 0));
    g.fillStyle = tg; g.fillRect(-w, -h, w * 2, h * 2);
    const spots = ck === 'dark' ? 46 : (ck === 'brown' ? 22 : 10);
    for (let i = 0; i < spots; i++) { const u = 0.1 + rn() * 0.8, sg = rn() < 0.5 ? -1 : 1, sx = X(u), sy = Y(u) + sg * rn() * prof(u) * L * 0.85, sr = 2 + rn() * 7; g.fillStyle = css(mulc(col.lo, 0.6), 0.25 + rn() * 0.25); g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill(); }
    // veins
    g.lineCap = 'round';
    const nv = shape === 3 ? 15 : (shape === 0 || shape === 1 ? 7 : 9);
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass === 0 ? css(col.lo, 0.35) : css(col.vein, 0.62);
      g.lineWidth = pass === 0 ? 4 : 2.6;
      const oy = pass === 0 ? 2.2 : 0;
      for (let k = 0; k < nv; k++) for (let s = 0; s < 2; s++) {
        const sg = s === 0 ? -1 : 1, u0 = 0.09 + 0.8 * k / nv + (shape === 3 ? 0 : (s * 0.02)), u1 = min(0.97, u0 + (shape === 3 ? 0.07 : 0.15));
        const sideM = sg < 0 ? (1 + asym) : (1 - asym);
        const ex = X(u1), ey = Y(u1) + sg * prof(u1) * L * sideM * (shape === 3 ? 0.8 : 0.86);
        const cx = X(u0 + 0.07), cy = Y(u0 + 0.07) + sg * prof(u0 + 0.07) * L * 0.28;
        g.beginPath(); g.moveTo(X(u0), Y(u0) + oy); g.quadraticCurveTo(cx, cy + oy, ex, ey + oy); g.stroke();
        // fine branching veinlets
        if (pass === 1 && shape !== 3) {
          g.lineWidth = 1.3; g.strokeStyle = css(col.vein, 0.28);
          for (let t = 0.3; t < 0.95; t += 0.2) {
            const px = (1 - t) * (1 - t) * X(u0) + 2 * (1 - t) * t * cx + t * t * ex, py = (1 - t) * (1 - t) * Y(u0) + 2 * (1 - t) * t * cy + t * t * ey;
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + 22, py + sg * 16); g.moveTo(px, py); g.lineTo(px + 6, py - sg * 20); g.stroke();
          }
          g.lineWidth = 2.6; g.strokeStyle = css(col.vein, 0.62);
        }
      }
    }
    // midrib (tapered polygon)
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass === 0 ? css(col.lo, 0.45) : css(col.vein, 0.9);
      const oy = pass === 0 ? 2.5 : 0, wm = u => (shape === 3 ? 3.2 : 6.2) * (1 - u * 0.78) + 1;
      g.beginPath();
      for (let u = 0; u <= 0.975; u += 0.025) g.lineTo(X(u), Y(u) - wm(u) * (pass === 0 ? 1.4 : 1) + oy);
      for (let u = 0.975; u >= 0; u -= 0.025) g.lineTo(X(u), Y(u) + wm(u) * (pass === 0 ? 1.4 : 1) + oy);
      g.closePath(); g.fill();
    }
    // upper-left rim light
    g.translate(2.5, 3); outline(); g.translate(-2.5, -3);
    g.strokeStyle = css(col.hi, 0.35); g.lineWidth = 3.4; g.stroke();
    g.restore();
    // crisp outline
    outline(); g.strokeStyle = css(mulc(col.lo, 0.7), 0.7); g.lineWidth = 2.4; g.lineJoin = 'round'; g.stroke();

    // chewed holes / lace
    const holes = ck === 'dark' ? 3 + floor(rn() * 4) : (rn() < 0.4 ? 1 + floor(rn() * 2) : 0);
    for (let i = 0; i < holes; i++) {
      const u = 0.2 + rn() * 0.6, sg = rn() < 0.5 ? -1 : 1, hx = X(u), hy = Y(u) + sg * rn() * prof(u) * L * 0.55, hr = 10 + rn() * (ck === 'dark' ? 34 : 22);
      const hs = rn() * 1e5;
      g.globalCompositeOperation = 'source-atop';
      const rg = g.createRadialGradient(hx, hy, hr * 0.6, hx, hy, hr * 1.5); rg.addColorStop(0, css(col.lo, 0.8)); rg.addColorStop(1, css(col.lo, 0));
      g.fillStyle = rg; g.fillRect(hx - hr * 2, hy - hr * 2, hr * 4, hr * 4);
      g.globalCompositeOperation = 'destination-out';
      blobPath(g, hx, hy, hr, U.mulberry32(hs), 11, 0.28); g.fillStyle = '#000'; g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    return { c: cv, w, h, sh: silhouette(cv), L: LREF, shape, ck };
  }

  // ------------------------------------------------------------------ flowers
  function petalShape(g, len, wid, style) {
    g.beginPath(); g.moveTo(0, 0);
    if (style === 'point') { g.bezierCurveTo(len * 0.22, -wid * 1.05, len * 0.7, -wid * 0.85, len, 0); g.bezierCurveTo(len * 0.7, wid * 0.85, len * 0.22, wid * 1.05, 0, 0); }
    else if (style === 'notch') { g.bezierCurveTo(len * 0.2, -wid * 1.0, len * 0.8, -wid * 1.3, len, -wid * 0.55); g.quadraticCurveTo(len * 0.95, -wid * 0.1, len * 0.88, 0); g.quadraticCurveTo(len * 0.95, wid * 0.1, len, wid * 0.55); g.bezierCurveTo(len * 0.8, wid * 1.3, len * 0.2, wid * 1.0, 0, 0); }
    else if (style === 'strap') { g.bezierCurveTo(len * 0.1, -wid, len * 0.9, -wid * 1.05, len, -wid * 0.3); g.quadraticCurveTo(len * 1.03, 0, len, wid * 0.3); g.bezierCurveTo(len * 0.9, wid * 1.05, len * 0.1, wid, 0, 0); }
    else { g.bezierCurveTo(len * 0.12, -wid * 0.95, len * 0.78, -wid * 1.18, len, -wid * 0.18); g.quadraticCurveTo(len * 1.04, 0, len, wid * 0.18); g.bezierCurveTo(len * 0.78, wid * 1.18, len * 0.12, wid * 0.95, 0, 0); }
    g.closePath();
  }
  function drawPetal(g, len, wid, style, c0, c1, o) {
    o = o || {};
    g.save();
    if (o.shadow !== false) { g.shadowColor = 'rgba(20,10,20,0.42)'; g.shadowBlur = o.blur || 12; g.shadowOffsetX = 3; g.shadowOffsetY = 5; }
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, css(c0)); gr.addColorStop(o.mid || 0.55, css(mixc(c0, c1, 0.7))); gr.addColorStop(1, css(c1));
    petalShape(g, len, wid, style); g.fillStyle = gr; g.fill();
    g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
    g.clip();
    // across-width light/dark (cupped petal)
    const g2 = g.createLinearGradient(0, -wid, 0, wid);
    g2.addColorStop(0, 'rgba(255,255,255,0.22)'); g2.addColorStop(0.45, 'rgba(255,255,255,0.0)'); g2.addColorStop(0.55, 'rgba(0,0,0,0.0)'); g2.addColorStop(1, 'rgba(0,0,0,0.20)');
    g.fillStyle = g2; g.fillRect(-2, -wid * 1.4, len + 4, wid * 2.8);
    // creases
    const nc = o.creases == null ? 4 : o.creases;
    g.lineWidth = 1.4;
    for (let i = 0; i < nc; i++) {
      const t = nc === 1 ? 0 : (i / (nc - 1) - 0.5) * 1.5;
      g.strokeStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.moveTo(len * 0.04, 0); g.quadraticCurveTo(len * 0.5, t * wid * 0.55, len * 0.92, t * wid * 0.62); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(len * 0.04, 1.5); g.quadraticCurveTo(len * 0.5, t * wid * 0.55 + 1.5, len * 0.92, t * wid * 0.62 + 1.5); g.stroke();
    }
    if (o.base) { const bg = g.createRadialGradient(0, 0, 0, 0, 0, len * 0.38); bg.addColorStop(0, css(o.base, 0.8)); bg.addColorStop(1, css(o.base, 0)); g.fillStyle = bg; g.fillRect(-4, -wid, len * 0.4, wid * 2); }
    g.restore();
  }
  function flowerCenter(g, type, rn) {
    const dots = (r, n, cA, cB, dr) => { for (let i = 0; i < n; i++) { const a = i * 2.39996, d = r * sqrt((i + 0.5) / n); g.fillStyle = css(i % 2 ? cA : cB, 0.95); g.beginPath(); g.arc(cos(a) * d, sin(a) * d, dr, 0, TAU); g.fill(); } };
    const disc = (r, c0, c1, c2) => { const gr = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r); gr.addColorStop(0, css(c0)); gr.addColorStop(0.7, css(c1)); gr.addColorStop(1, css(c2)); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); };
    g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 10; g.shadowOffsetX = 2; g.shadowOffsetY = 4;
    if (type === 0 || type === 3) { disc(type === 0 ? 54 : 42, [255, 214, 70], [236, 168, 24], [170, 100, 10]); g.shadowColor = 'rgba(0,0,0,0)'; dots(type === 0 ? 52 : 40, 90, [190, 120, 14], [255, 232, 110], 3.2); }
    else if (type === 1) {
      disc(40, [60, 50, 60], [34, 26, 36], [14, 10, 14]); g.shadowColor = 'rgba(0,0,0,0)';
      for (let i = 0; i < 46; i++) { const a = i / 46 * TAU + rn() * 0.1, l1 = 44 + rn() * 26; g.strokeStyle = 'rgba(30,20,30,0.85)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cos(a) * 24, sin(a) * 24); g.lineTo(cos(a) * l1, sin(a) * l1); g.stroke(); g.fillStyle = 'rgba(20,14,22,1)'; g.beginPath(); g.arc(cos(a) * l1, sin(a) * l1, 3.2, 0, TAU); g.fill(); g.fillStyle = 'rgba(190,200,120,0.9)'; g.beginPath(); g.arc(cos(a) * l1 - 0.8, sin(a) * l1 - 0.8, 1.3, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(120,150,70,0.95)'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, r = i % 2 ? 7 : 16; g.lineTo(cos(a) * r, sin(a) * r); } g.closePath(); g.fill();
    }
    else if (type === 2) { disc(32, [255, 226, 90], [238, 170, 30], [150, 90, 10]); g.shadowColor = 'rgba(0,0,0,0)'; dots(26, 44, [170, 100, 10], [255, 240, 140], 2.6); }
    else if (type === 4) { disc(62, [140, 84, 40], [88, 52, 22], [42, 24, 10]); g.shadowColor = 'rgba(0,0,0,0)'; dots(58, 150, [60, 34, 14], [200, 150, 60], 3.4); }
    else if (type === 5) { disc(30, [255, 255, 240], [250, 238, 190], [210, 190, 120]); g.shadowColor = 'rgba(0,0,0,0)'; g.fillStyle = 'rgba(255,230,90,0.95)'; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill(); }
    else if (type === 6) { disc(34, [255, 190, 50], [230, 120, 10], [150, 70, 6]); g.shadowColor = 'rgba(0,0,0,0)'; dots(30, 50, [150, 70, 6], [255, 214, 80], 3); }
    else { g.shadowColor = 'rgba(0,0,0,0)'; disc(22, [255, 240, 150], [240, 200, 70], [180, 130, 40]); for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + rn() * 0.12, l1 = 34 + rn() * 14; g.strokeStyle = 'rgba(255,225,230,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cos(a) * 14, sin(a) * 14); g.lineTo(cos(a) * l1, sin(a) * l1); g.stroke(); g.fillStyle = 'rgba(255,214,60,1)'; g.beginPath(); g.arc(cos(a) * l1, sin(a) * l1, 3.4, 0, TAU); g.fill(); } }
    g.restore();
  }
  const FLOWER_SIZE = 760, FPPW = 2.2;
  function makeFlower(type, seed) {
    const rn = U.mulberry32(seed), S = FLOWER_SIZE, cv = mk(S, S), g = ctxOf(cv); if (!g) return null;
    const R = (cb) => { g.save(); g.translate(S / 2, S / 2); cb(); g.restore(); };
    const ring = (n, off, len, wid, style, c0, c1, o) => {
      for (let i = 0; i < n; i++) {
        const a = off + i * TAU / n + (rn() - 0.5) * 0.08, l = len * (0.94 + rn() * 0.1);
        g.save(); g.translate(S / 2, S / 2); g.rotate(a); drawPetal(g, l, wid, style, c0, c1, o); g.restore();
      }
    };
    switch (type) {
      case 0: // daisy
        ring(22, 0.07, 240, 21, 'strap', [214, 210, 180], [244, 242, 232], { creases: 2 });
        ring(22, 0.0, 255, 23, 'strap', [238, 232, 200], [255, 255, 252], { creases: 3 });
        break;
      case 1: // poppy
        ring(4, 0.4, 250, 175, 'round', [70, 8, 12], [236, 50, 40], { creases: 7, mid: 0.4, blur: 16 });
        ring(4, 1.2, 240, 170, 'round', [64, 6, 10], [250, 70, 52], { creases: 7, mid: 0.4, blur: 16 });
        break;
      case 2: // cosmos
        ring(8, 0.2, 250, 92, 'notch', [188, 30, 104], [252, 168, 212], { creases: 5, mid: 0.6 });
        break;
      case 3: // aster
        ring(30, 0.05, 245, 13, 'strap', [140, 90, 200], [206, 178, 244], { creases: 1, blur: 6 });
        ring(30, 0.1, 225, 13, 'strap', [128, 78, 188], [190, 160, 236], { creases: 1, blur: 6 });
        break;
      case 4: // coreopsis
        ring(14, 0.1, 255, 52, 'point', [214, 124, 8], [255, 224, 66], { creases: 5, mid: 0.5 });
        break;
      case 5: // periwinkle
        ring(5, 0.2, 230, 118, 'round', [250, 250, 255], [88, 98, 224], { creases: 5, mid: 0.38 });
        break;
      case 6: // marigold
        ring(16, 0.1, 190, 46, 'round', [240, 120, 8], [255, 176, 28], { creases: 3 });
        ring(14, 0.3, 150, 42, 'round', [236, 110, 8], [255, 190, 40], { creases: 3 });
        ring(12, 0.5, 110, 36, 'round', [220, 100, 6], [255, 200, 50], { creases: 2 });
        break;
      default: // blossom
        ring(5, 0.3, 235, 124, 'round', [255, 246, 248], [255, 190, 212], { creases: 4, mid: 0.5, base: [255, 150, 170] });
    }
    R(() => flowerCenter(g, type, rn));
    return { c: cv, w: S, h: S, sh: silhouette(cv), kind: 'flower', type };
  }

  // ------------------------------------------------------------ petals (ground)
  function makePetal(style, c0, c1, seed) {
    const cv = mk(150, 100), g = ctxOf(cv); if (!g) return null; U.mulberry32(seed);
    g.translate(14, 50); drawPetal(g, 120, 40, style, c0, c1, { creases: 3, blur: 5 });
    return { c: cv, w: 150, h: 100, sh: silhouette(cv) };
  }

  // -------------------------------------------------------------------- fern
  function makeFern(seed) {
    const rn = U.mulberry32(seed), L = 520, Wd = 340, cv = mk(L + 40, Wd), g = ctxOf(cv); if (!g) return null;
    g.translate(20, Wd / 2);
    const curve = (rn() - 0.5) * 70, rx = u => u * L, ry = u => curve * u * u;
    // rachis
    g.lineCap = 'round';
    g.strokeStyle = 'rgb(46,78,34)'; g.lineWidth = 7; g.beginPath(); for (let u = 0; u <= 1.001; u += 0.05) g.lineTo(rx(u), ry(u)); g.stroke();
    const np = 30;
    for (let i = 0; i < np; i++) {
      const u = 0.06 + 0.92 * i / np, pl = (30 + 150 * sin(PI * pow(u, 0.75)) * (1 - u * 0.45)) * (0.9 + rn() * 0.2);
      for (let s = -1; s <= 1; s += 2) {
        const px = rx(u), py = ry(u), a = s * (0.75 + 0.35 * u) + (rn() - 0.5) * 0.12;
        g.save(); g.translate(px, py); g.rotate(a);
        const gr = g.createLinearGradient(0, 0, pl, 0); gr.addColorStop(0, 'rgb(34,78,34)'); gr.addColorStop(0.6, 'rgb(72,134,52)'); gr.addColorStop(1, 'rgb(120,176,80)');
        g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 5; g.shadowOffsetX = 2; g.shadowOffsetY = 3;
        g.beginPath(); g.moveTo(0, 0);
        const nl = 7;
        for (let k = 1; k <= nl; k++) { const t = k / nl; g.lineTo(pl * t, -pl * 0.2 * sin(PI * pow(t, 0.8)) * (k % 2 ? 1 : 0.8)); }
        for (let k = nl; k >= 1; k--) { const t = k / nl; g.lineTo(pl * t, pl * 0.2 * sin(PI * pow(t, 0.8)) * (k % 2 ? 1 : 0.8)); }
        g.closePath(); g.fillStyle = gr; g.fill();
        g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
        g.strokeStyle = 'rgba(190,230,140,0.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(pl * 0.95, 0); g.stroke();
        g.restore();
      }
    }
    g.strokeStyle = 'rgba(160,210,120,0.55)'; g.lineWidth = 2; g.beginPath(); for (let u = 0; u <= 1.001; u += 0.05) g.lineTo(rx(u), ry(u) - 2); g.stroke();
    return { c: cv, w: L + 40, h: Wd, sh: silhouette(cv), ox: 20 };
  }

  // ---------------------------------------------------------------- bark flap
  function makeFlap(seed) {
    const rn = U.mulberry32(seed), w = 330, h = 470, cv = mk(w, h), g = ctxOf(cv); if (!g) return null;
    const pts = []; const n = 30, cx = w / 2, cy = h / 2;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n, ex = 0.40 + 0.04 * sin(a * 3 + seed), ey = 0.46;
      const jag = 1 - 0.1 + rn() * 0.12 - (i % 2 ? 0.05 : 0);
      pts.push([cx + cos(a) * w * ex * jag * (1 + 0.1 * sin(a * 2 + seed)), cy + sin(a) * h * ey * jag]);
    }
    const poly = () => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); };
    poly();
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgb(122,98,76)'); gr.addColorStop(0.5, 'rgb(92,72,56)'); gr.addColorStop(1, 'rgb(56,42,32)');
    g.fillStyle = gr; g.fill();
    g.save(); poly(); g.clip();
    // strata
    for (let i = 0; i < 46; i++) {
      const x0 = rn() * w, wob = 6 + rn() * 14; g.strokeStyle = rn() < 0.6 ? 'rgba(20,12,8,0.30)' : 'rgba(170,140,108,0.22)'; g.lineWidth = 1 + rn() * 2.4;
      g.beginPath(); g.moveTo(x0, -10); for (let y = 0; y <= h; y += 24) g.lineTo(x0 + sin(y * 0.03 + i) * wob, y); g.stroke();
    }
    // lichen + moss speckle
    for (let i = 0; i < 7; i++) { const bx = rn() * w, by = rn() * h, br = 14 + rn() * 30, lg = g.createRadialGradient(bx, by, 0, bx, by, br); const c = rn() < 0.5 ? [150, 160, 128] : [60, 96, 44]; lg.addColorStop(0, css(c, 0.7)); lg.addColorStop(1, css(c, 0)); g.fillStyle = lg; g.fillRect(bx - br, by - br, br * 2, br * 2); }
    // lifted lip: lighter strip on the left edge, dark under-edge right/bottom
    g.translate(8, 10); poly(); g.translate(-8, -10);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 14; g.stroke();
    g.restore();
    poly(); g.strokeStyle = 'rgba(18,12,8,0.85)'; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
    g.save(); poly(); g.clip(); g.translate(-3, -3); poly(); g.strokeStyle = 'rgba(206,176,140,0.5)'; g.lineWidth = 3; g.stroke(); g.restore();
    return { c: cv, w, h, sh: silhouette(cv) };
  }

  // ---------------------------------------------------------------- grass fan
  function makeFan(seed, pal) {
    const rn = U.mulberry32(seed), S = 440, cv = mk(S, S), g = ctxOf(cv); if (!g) return null;
    g.translate(S / 2, S / 2);
    const nb = 20;
    const bl = [];
    for (let i = 0; i < nb; i++) bl.push({ a: i * TAU / nb + (rn() - 0.5) * 0.5, l: 90 + rn() * 90, w: 13 + rn() * 8, c: 0.4 + rn() * 0.9 });
    bl.sort((p, q) => p.l - q.l);
    bl.forEach((b) => {
      g.save(); g.rotate(b.a);
      const gr = g.createLinearGradient(0, 0, b.l, 0); gr.addColorStop(0, css(pal[0])); gr.addColorStop(0.5, css(pal[1])); gr.addColorStop(1, css(pal[2]));
      const bendY = b.c * b.l * 0.42;
      const edge = (s) => { const pts = []; for (let t = 0; t <= 1.001; t += 0.1) { const x = b.l * t, y = bendY * t * t, ww = b.w * pow(1 - t, 0.85) * (0.55 + 0.45 * (1 - t)); pts.push([x, y + s * ww]); } return pts; };
      g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 6; g.shadowOffsetX = 3; g.shadowOffsetY = 5;
      g.beginPath(); edge(-1).forEach(p => g.lineTo(p[0], p[1])); edge(1).reverse().forEach(p => g.lineTo(p[0], p[1])); g.closePath(); g.fillStyle = gr; g.fill();
      g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
      g.strokeStyle = css(pal[3], 0.5); g.lineWidth = 1.4; g.beginPath(); for (let t = 0; t <= 1.001; t += 0.1) g.lineTo(b.l * t, bendY * t * t); g.stroke();
      g.restore();
    });
    return { c: cv, w: S, h: S, sh: silhouette(cv) };
  }

  // --------------------------------------------------------------------- moss
  function makeMoss(seed, pal) {
    const rn = U.mulberry32(seed), S = 300, cv = mk(S, S), g = ctxOf(cv); if (!g) return null;
    g.translate(S / 2, S / 2);
    const rg = g.createRadialGradient(-20, -24, 6, 0, 0, 140); rg.addColorStop(0, css(pal[1])); rg.addColorStop(0.7, css(pal[0])); rg.addColorStop(1, css(pal[0], 0));
    g.fillStyle = rg; blobPath(g, 0, 0, 132, rn, 22, 0.14); g.fill();
    g.lineCap = 'round';
    for (let i = 0; i < 1100; i++) {
      const a = rn() * TAU, d = sqrt(rn()) * 128, x = cos(a) * d, y = sin(a) * d, ang = a + (rn() - 0.5) * 1.4, l = 6 + rn() * 12;
      const t = clamp(1 - d / 130 + (rn() - 0.5) * 0.3 + (x + y < 0 ? 0.12 : -0.05), 0, 1);
      g.strokeStyle = css(mixc(pal[0], pal[2], t), 0.6 + rn() * 0.4); g.lineWidth = 1.2 + rn() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + cos(ang) * l, y + sin(ang) * l); g.stroke();
    }
    return { c: cv, w: S, h: S, sh: silhouette(cv) };
  }

  // ------------------------------------------------------------------- clover
  function makeClover(seed) {
    const rn = U.mulberry32(seed), S = 150, cv = mk(S, S), g = ctxOf(cv); if (!g) return null;
    g.translate(S / 2, S / 2);
    const base = [[40, 104, 44], [52, 120, 50], [70, 128, 46]][seed % 3];
    for (let i = 0; i < 3; i++) {
      g.save(); g.rotate(i * TAU / 3 + rn() * 0.3);
      g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 4; g.shadowOffsetX = 2; g.shadowOffsetY = 3;
      const gr = g.createRadialGradient(34, 0, 3, 34, 0, 38); gr.addColorStop(0, css(mixc(base, [190, 230, 130], 0.35))); gr.addColorStop(1, css(mulc(base, 0.62)));
      g.beginPath(); g.moveTo(6, 0); g.bezierCurveTo(14, -30, 62, -34, 62, -4); g.bezierCurveTo(62, 6, 54, 4, 52, 0); g.bezierCurveTo(54, -4, 62, 4, 62, 6); g.bezierCurveTo(62, 34, 14, 30, 6, 0); g.closePath();
      g.fillStyle = gr; g.fill(); g.shadowColor = 'rgba(0,0,0,0)';
      g.strokeStyle = 'rgba(224,240,200,0.75)'; g.lineWidth = 3; g.beginPath(); g.moveTo(14, -12); g.quadraticCurveTo(36, 0, 14, 12); g.stroke();
      g.strokeStyle = 'rgba(20,50,20,0.4)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(8, 0); g.lineTo(58, 0); g.stroke();
      g.restore();
    }
    return { c: cv, w: S, h: S, sh: silhouette(cv) };
  }

  // -------------------------------------------------------- dew / nectar / fx
  function makeDew(tint) {
    const S = 160, cv = mk(S, S), g = ctxOf(cv); if (!g) return null; const c = S / 2, r = 50;
    // contact shadow
    let sg = g.createRadialGradient(c + 8, c + 12, 4, c + 8, c + 12, r + 14); sg.addColorStop(0, 'rgba(10,8,4,0.38)'); sg.addColorStop(0.7, 'rgba(10,8,4,0.18)'); sg.addColorStop(1, 'rgba(10,8,4,0)');
    g.fillStyle = sg; g.fillRect(0, 0, S, S);
    // body
    const bg = g.createRadialGradient(c, c, r * 0.2, c, c, r);
    bg.addColorStop(0, css(mixc([210, 235, 250], tint, 0.4), 0.10)); bg.addColorStop(0.75, css(mixc([190, 225, 245], tint, 0.4), 0.22)); bg.addColorStop(1, css(mixc([235, 250, 255], tint, 0.3), 0.55));
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
    // upper-left dark refraction crescent
    g.save(); g.beginPath(); g.arc(c, c, r - 1, 0, TAU); g.clip();
    const dg = g.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c - r * 0.1, c - r * 0.1, r * 1.1); dg.addColorStop(0, 'rgba(40,70,90,0.22)'); dg.addColorStop(0.6, 'rgba(40,70,90,0.05)'); dg.addColorStop(1, 'rgba(30,50,60,0)');
    g.fillStyle = dg; g.fillRect(0, 0, S, S);
    // lower-right caustic (focused light)
    const cg = g.createRadialGradient(c + r * 0.38, c + r * 0.42, 1, c + r * 0.38, c + r * 0.42, r * 0.7); cg.addColorStop(0, 'rgba(255,255,245,0.85)'); cg.addColorStop(0.5, 'rgba(235,250,255,0.28)'); cg.addColorStop(1, 'rgba(235,250,255,0)');
    g.fillStyle = cg; g.fillRect(0, 0, S, S);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, r - 1, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(20,40,50,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.arc(c, c, r + 0.5, 0.6, 2.2); g.stroke();
    // speculars
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(c - r * 0.38, c - r * 0.42, r * 0.2, r * 0.12, -0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(c + r * 0.15, c - r * 0.55, r * 0.06, 0, TAU); g.fill();
    return { c: cv, w: S, h: S, r };
  }
  function makeNectar(seed) {
    const S = 180, cv = mk(S, S), g = ctxOf(cv); if (!g) return null; const c = S / 2, r = 50;
    const ag = g.createRadialGradient(c, c, r * 0.6, c, c, r * 1.8); ag.addColorStop(0, 'rgba(255,190,60,0.4)'); ag.addColorStop(1, 'rgba(255,190,60,0)');
    g.fillStyle = ag; g.fillRect(0, 0, S, S);
    let sg = g.createRadialGradient(c + 8, c + 12, 4, c + 8, c + 12, r + 12); sg.addColorStop(0, 'rgba(40,18,0,0.35)'); sg.addColorStop(1, 'rgba(40,18,0,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(c + 8, c + 12, r + 12, 0, TAU); g.fill();
    const bg = g.createRadialGradient(c - r * 0.2, c - r * 0.25, r * 0.1, c, c, r); bg.addColorStop(0, 'rgb(255,232,120)'); bg.addColorStop(0.55, 'rgb(244,172,40)'); bg.addColorStop(1, 'rgb(168,86,10)');
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(c, c, r - 1, 0, TAU); g.clip();
    const cg = g.createRadialGradient(c + r * 0.4, c + r * 0.45, 1, c + r * 0.4, c + r * 0.45, r * 0.75); cg.addColorStop(0, 'rgba(255,250,190,0.95)'); cg.addColorStop(1, 'rgba(255,230,120,0)');
    g.fillStyle = cg; g.fillRect(0, 0, S, S);
    const dg = g.createRadialGradient(c - r * 0.5, c - r * 0.55, 2, c - r * 0.3, c - r * 0.3, r * 1.1); dg.addColorStop(0, 'rgba(110,50,0,0.35)'); dg.addColorStop(1, 'rgba(110,50,0,0)');
    g.fillStyle = dg; g.fillRect(0, 0, S, S);
    g.restore();
    g.strokeStyle = 'rgba(130,60,6,0.7)'; g.lineWidth = 2.2; g.beginPath(); g.arc(c, c, r - 0.5, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.96)'; g.beginPath(); g.ellipse(c - r * 0.36, c - r * 0.42, r * 0.22, r * 0.13, -0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.beginPath(); g.arc(c + r * 0.2, c - r * 0.55, r * 0.07, 0, TAU); g.fill();
    return { c: cv, w: S, h: S, r };
  }
  function makeGlow(rgb) {
    const S = 128, cv = mk(S, S), g = ctxOf(cv); if (!g) return null;
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, css(rgb, 1)); gr.addColorStop(0.18, css(rgb, 0.6)); gr.addColorStop(0.5, css(rgb, 0.18)); gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, S, S); return cv;
  }
  function makeStar() {
    const S = 96, cv = mk(S, S), g = ctxOf(cv); if (!g) return null; const c = S / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, 14); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.moveTo(c, 2); g.quadraticCurveTo(c + 2.5, c - 2.5, S - 2, c); g.quadraticCurveTo(c + 2.5, c + 2.5, c, S - 2); g.quadraticCurveTo(c - 2.5, c + 2.5, 2, c); g.quadraticCurveTo(c - 2.5, c - 2.5, c, 2); g.closePath(); g.fill();
    return cv;
  }
  function makeBlob() {
    const S = 128, cv = mk(S, S), g = ctxOf(cv); if (!g) return null;
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.72)'); gr.addColorStop(0.85, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S); return cv;
  }
  // tileable soft cloud / fog texture
  function makeCloudTile(S, seed, blobs, alpha, rgb, rmin, rmax) {
    const cv = mk(S, S), g = ctxOf(cv); if (!g) return null; const rn = U.mulberry32(seed);
    for (let i = 0; i < blobs; i++) {
      const x = rn() * S, y = rn() * S, r = rmin + rn() * (rmax - rmin), a = alpha * (0.5 + rn() * 0.7);
      for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
        const px = x + ox, py = y + oy; if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
        const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, css(rgb, a)); gr.addColorStop(0.5, css(rgb, a * 0.45)); gr.addColorStop(1, css(rgb, 0));
        g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
    return cv;
  }

  function buildSprites() {
    const shapesLitter = [0, 1, 2, 3, 4], colsLitter = ['rust', 'ochre', 'brown', 'olive', 'dark', 'red', 'gold'];
    let si = 0;
    shapesLitter.forEach(sh => colsLitter.forEach(ck => { SP.leaf[sh + ck] = makeLeaf(sh, ck, SEED + 31 * (++si)); }));
    [0, 2, 3, 4].forEach(sh => ['green', 'deepgreen', 'lime'].forEach(ck => { SP.leaf[sh + ck] = makeLeaf(sh, ck, SEED + 31 * (++si)); }));
    for (let i = 0; i < 8; i++) SP.flower.push(makeFlower(i, SEED + 700 + i));
    const petalCols = [[[222, 70, 120], [252, 170, 200]], [[240, 240, 235], [255, 255, 255]], [[240, 190, 30], [255, 232, 100]], [[140, 100, 210], [210, 190, 245]], [[236, 120, 40], [255, 190, 100]], [[200, 30, 40], [240, 90, 80]]];
    petalCols.forEach((p, i) => { SP.petal.push(makePetal('round', p[0], p[1], i)); SP.petal.push(makePetal('point', p[0], p[1], i + 20)); });
    for (let i = 0; i < 3; i++) SP.fern.push(makeFern(SEED + 900 + i));
    for (let i = 0; i < 3; i++) SP.flap.push(makeFlap(SEED + 1000 + i));
    const pals = [[[34, 74, 30], [70, 130, 48], [150, 196, 90], [200, 236, 150]], [[30, 66, 34], [58, 112, 52], [118, 172, 88], [180, 220, 140]], [[60, 80, 30], [122, 140, 56], [196, 190, 96], [236, 226, 160]], [[84, 66, 30], [146, 118, 56], [206, 176, 96], [238, 214, 150]]];
    pals.forEach((p, i) => SP.fan.push(makeFan(SEED + 1100 + i, p)));
    const mp = [[[28, 62, 26], [58, 104, 40], [120, 170, 70]], [[36, 76, 30], [74, 124, 46], [150, 190, 84]], [[52, 80, 28], [106, 132, 50], [176, 190, 92]], [[24, 50, 28], [46, 88, 42], [96, 140, 66]]];
    mp.forEach((p, i) => SP.moss.push(makeMoss(SEED + 1200 + i, p)));
    for (let i = 0; i < 3; i++) SP.clover.push(makeClover(i));
    SP.dew = [makeDew([210, 235, 255]), makeDew([190, 240, 215]), makeDew([255, 232, 200])];
    SP.nectar = [makeNectar(1), makeNectar(2)];
    SP.glow = { white: makeGlow([255, 255, 255]), gold: makeGlow([255, 214, 120]), cool: makeGlow([160, 196, 255]), green: makeGlow([200, 255, 150]), warm: makeGlow([255, 170, 90]) };
    SP.star = makeStar(); SP.blob = makeBlob();
    SP.fog = makeCloudTile(512, 5, 34, 0.5, [226, 232, 236], 60, 150);
    SP.dapple = makeCloudTile(512, 9, 18, 0.55, [255, 238, 190], 40, 110);
    SP.dapple2 = makeCloudTile(512, 12, 18, 0.5, [150, 180, 255], 40, 110);
  }

  // ============================================================================
  // WORLD DATA + DETERMINISTIC GENERATION
  // ============================================================================
  const CH = 400, PAD = 4, CCOLS = 16, CROWS = 9;
  const PPWK = { leaf: PPW, flower: FPPW, fern: 3, flap: 3, fan: 3, moss: 2.6, clover: 4, petal: 2.6 };

  function makeGrid(cell) { const cols = ceil(W / cell) + 2, rows = ceil(H / cell) + 2; return { cell, cols, rows, a: new Array(cols * rows) }; }
  function gAdd(gr, o) { const cx = clamp(floor(o.x / gr.cell), 0, gr.cols - 1), cy = clamp(floor(o.y / gr.cell), 0, gr.rows - 1), i = cy * gr.cols + cx; (gr.a[i] || (gr.a[i] = [])).push(o); }

  const D = {
    built: false,
    items: [], buckets: [],
    obstacles: [], obsGrid: null, maxObsR: 0,
    anchors: [], anchorGrid: null,
    shelters: [], resources: [], resGrid: null,
    canopy: [], canopyGrid: null, maxCanopyR: 0,
    tufts: [], tuftGrid: null,
    flowers: [], spawn: [[], [], []],
    minimap: null,
  };

  function addItem(it) { D.items.push(it); return it; }
  function addObstacle(x, y, r, type) { const o = { x, y, r, type }; D.obstacles.push(o); gAdd(D.obsGrid, o); if (r > D.maxObsR) D.maxObsR = r; return o; }
  function addAnchor(x, y, type) { if (x < 8 || y < 8 || x > W - 8 || y > H - 8) return; const a = { x, y, type }; D.anchors.push(a); gAdd(D.anchorGrid, a); }
  function freeAt(x, y, rad) {
    const gr = D.obsGrid, R = rad + 80, c0 = max(0, floor((x - R) / gr.cell)), c1 = min(gr.cols - 1, floor((x + R) / gr.cell)), r0 = max(0, floor((y - R) / gr.cell)), r1 = min(gr.rows - 1, floor((y + R) / gr.cell));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
      for (let i = 0; i < l.length; i++) { const o = l[i], dx = o.x - x, dy = o.y - y, rr = o.r + rad; if (dx * dx + dy * dy < rr * rr) return false; }
    }
    return true;
  }
  const _w3 = [0, 0, 0];
  function wz(x, y) { return zoneW(x, y, _w3); }
  const SPAWN = C.SPAWN;
  function nearSpawn(x, y, r) { return hypot(x - SPAWN.x, y - SPAWN.y) < r; }

  function leafSprite(shape, ck) { return SP.leaf[shape + ck]; }

  function generate() {
    const rn = U.mulberry32(SEED);
    const R = (a, b) => a + rn() * (b - a);
    const pick = (arr) => arr[floor(rn() * arr.length)];
    const wpick = (arr) => { let t = 0; for (const a of arr) t += a[1]; let r = rn() * t; for (const a of arr) { r -= a[1]; if (r <= 0) return a[0]; } return arr[0][0]; };
    D.obsGrid = makeGrid(96); D.anchorGrid = makeGrid(128);
    const shapeW = [[0, 30], [1, 14], [2, 26], [3, 12], [4, 18]];

    // ------------------------------------------------------------ litter ground cover
    const leafLayer = (attempts, z, colW, scLo, scHi, dim, xmax, bound) => {
      for (let i = 0; i < attempts; i++) {
        const x = R(-40, xmax), y = R(-40, H + 40); const w = wz(x, y);
        const acc = w[0] + (x < 3100 ? w[1] * bound : 0);
        if (rn() > acc) continue;
        const sh = wpick(shapeW), ck = wpick(colW), sc = R(scLo, scHi);
        addItem({ k: 'leaf', x, y, rot: R(0, TAU), sc, flip: rn() < 0.5, spr: leafSprite(sh, ck), z: z + rn() * 0.4, dim: dim * (0.6 + rn() * 0.8), br: LREF * sc * 0.62 + 10 });
      }
    };
    leafLayer(1900, 1.0, [['dark', 40], ['brown', 36], ['olive', 4], ['rust', 14], ['ochre', 4]], 0.5, 1.0, 0.6, 2900, 0.3);
    leafLayer(1900, 2.0, [['brown', 28], ['ochre', 16], ['rust', 24], ['red', 10], ['olive', 5], ['dark', 14], ['gold', 3]], 0.5, 1.08, 0.3, 2900, 0.25);
    leafLayer(780, 3.2, [['ochre', 22], ['gold', 12], ['red', 18], ['rust', 26], ['olive', 6], ['brown', 16]], 0.5, 0.95, 0.06, 2800, 0.18);

    // pine-needle / dry-grass clusters
    for (let i = 0; i < 130; i++) { const x = R(0, 2800), y = R(0, H), w = wz(x, y); if (rn() > w[0] + w[1] * 0.2) continue; addItem({ k: 'needles', x, y, rot: R(0, TAU), n: 5 + floor(rn() * 9), len: R(40, 90), seed: floor(rn() * 1e6), z: 1.6, br: 100 }); }
    // moss mats on the ground
    for (let i = 0; i < 70; i++) {
      const x = R(0, 4500), y = R(0, H), w = wz(x, y); const acc = w[0] * 0.4 + w[1] * 0.8 + w[2] * 0.3; if (rn() > acc) continue;
      const sc = R(0.35, 0.9); addItem({ k: 'sprite', spr: SP.moss[floor(rn() * 4)], ppw: PPWK.moss, x, y, rot: R(0, TAU), sc, z: 0.8, a: 0.9, br: 160 * sc + 12 });
    }

    // ------------------------------------------------------------------ bark zone
    let n = 0;
    for (let t = 0; t < 700 && n < 54; t++) {
      const x = R(2540, 4070), y = R(100, 3500), w = R(32, 58), h = R(110, 230), ang = R(-0.22, 0.22);
      if (nearSpawn(x, y, 400)) continue;
      const r = w * 0.5, cnt = max(2, floor(h / (r * 1.1))), pts = []; let ok = true;
      for (let i = 0; i < cnt; i++) { const s = (i / (cnt - 1) - 0.5) * (h - 2 * r), px = x + sin(ang) * s * -1, py = y + cos(ang) * s; pts.push([px, py]); if (!freeAt(px, py, r + 75)) { ok = false; break; } }
      if (!ok) continue;
      pts.forEach(p => addObstacle(p[0], p[1], r * 0.92, 'bark'));
      addItem({ k: 'plate', x, y, w, h, ang, seed: floor(rn() * 1e6), z: 2.2, br: h * 0.62 + 16 });
      addAnchor(pts[0][0], pts[0][1] - r, 'bark'); addAnchor(pts[cnt - 1][0], pts[cnt - 1][1] + r, 'bark');
      n++;
    }
    for (let i = 0; i < 190; i++) {
      const x = R(2200, 4400), y = R(-20, H + 20), w = wz(x, y); if (rn() > w[1] * 1.1 + (x < 2400 ? 0.1 : 0)) continue;
      const pts = [[x, y]]; let px = x, py = y, dx = 0;
      const seg = 7 + floor(rn() * 7);
      for (let s = 0; s < seg; s++) { dx = dx * 0.6 + R(-12, 12); px += dx; py += R(24, 44); pts.push([px, py]); }
      addItem({ k: 'crack', pts, w: R(1.6, 4.6), x: (x + px) / 2, y: (y + py) / 2, br: hypot(px - x, py - y) / 2 + 40, z: 0.4 });
    }
    n = 0;
    for (let t = 0; t < 200 && n < 46; t++) {
      const x = R(2480, 4130), y = R(60, H - 60), r = R(16, 50);
      const solid = n < 12 && r < 38 && freeAt(x, y, r * 0.7 + 70) && !nearSpawn(x, y, 400);
      if (solid) { addObstacle(x, y, r * 0.66, 'knot'); addAnchor(x + r * 0.7, y, 'bark'); }
      addItem({ k: 'knot', x, y, r, seed: floor(rn() * 1e6), z: 1.2, br: r * 1.3 + 14, solid }); n++;
    }
    for (let i = 0; i < 150; i++) {
      const x = R(2300, 4300), y = R(0, H), w = wz(x, y); if (rn() > w[1]) continue;
      addItem({ k: 'lichen', x, y, r: R(10, 44), seed: floor(rn() * 1e6), type: wpick([[0, 4], [1, 3], [2, 2]]), z: 1.4, br: 60 });
    }
    for (let i = 0; i < 560; i++) { const x = R(2300, 4400), y = R(0, H), w = wz(x, y); if (rn() > w[1]) continue; addItem({ k: 'flake', x, y, r: R(3.5, 9), rot: R(0, TAU), seed: floor(rn() * 1e6), z: 0.5, br: 14 }); }
    for (let i = 0; i < 16; i++) { const x = R(2600, 4000), y = R(100, H - 100); addItem({ k: 'shelf', x, y, r: R(8, 16), rot: R(0, TAU), seed: floor(rn() * 1e6), z: 2.4, br: 30 }); }

    // ----------------------------------------------------------------- twigs
    const twigCounts = [[0, 2650, 70], [2700, 4100, 8], [4300, 6300, 15]];
    twigCounts.forEach(([xa, xb, cnt]) => {
      let made = 0;
      for (let t = 0; t < 600 && made < cnt; t++) {
        const x = R(xa, xb), y = R(60, H - 60), len = R(130, 430), wd = R(6, 14); let ang = R(0, TAU);
        if (nearSpawn(x, y, 180)) continue;
        const pts = [{ x, y, w: wd }]; let px = x, py = y, ok = true; const steps = floor(len / 22);
        for (let s = 1; s <= steps; s++) { ang += R(-0.12, 0.12); px += cos(ang) * 22; py += sin(ang) * 22; if (px < 20 || px > W - 20 || py < 20 || py > H - 20 || !freeAt(px, py, wd * 0.5 + 55)) { ok = false; break; } pts.push({ x: px, y: py, w: wd * (1 - 0.35 * s / steps) }); }
        if (!ok || pts.length < 4) continue;
        const br = [];
        const nb = 1 + floor(rn() * 3);
        for (let b = 0; b < nb; b++) {
          const k = 2 + floor(rn() * (pts.length - 3)), p = pts[k], side = rn() < 0.5 ? -1 : 1; let ba = atan2(pts[k + 1].y - p.y, pts[k + 1].x - p.x) + side * R(0.45, 0.85);
          const bl = R(30, 90), bp = [{ x: p.x, y: p.y, w: p.w * 0.55 }]; let bx = p.x, by = p.y; const bs = floor(bl / 14);
          for (let s = 1; s <= bs; s++) { ba += R(-0.15, 0.15); bx += cos(ba) * 14; by += sin(ba) * 14; bp.push({ x: bx, y: by, w: max(1.6, p.w * 0.55 * (1 - s / (bs + 0.5))) }); }
          br.push(bp); addAnchor(bx, by, 'twig');
        }
        for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], r = max(3.2, a.w * 0.5 + 1), st = max(1, floor(hypot(b.x - a.x, b.y - a.y) / (r * 1.1))); for (let s = 0; s < st; s++) addObstacle(lerp(a.x, b.x, s / st), lerp(a.y, b.y, s / st), r, 'twig'); }
        addObstacle(pts[pts.length - 1].x, pts[pts.length - 1].y, max(3.2, pts[pts.length - 1].w * 0.5 + 1), 'twig');
        addAnchor(pts[0].x, pts[0].y, 'twig'); addAnchor(pts[pts.length - 1].x, pts[pts.length - 1].y, 'twig');
        const cx = pts[floor(pts.length / 2)];
        addItem({ k: 'twig', pts, br, x: cx.x, y: cx.y, seed: floor(rn() * 1e6), z: 2.5, brad: len * 0.6 + 100, moss: rn() < 0.35, pal: floor(rn() * 3) });
        made++;
      }
    });

    // ------------------------------------------------------------------ rocks etc.
    const rockPlace = (xa, xb, cnt, rlo, rhi, tries) => {
      let made = 0;
      for (let t = 0; t < (tries || 400) && made < cnt; t++) {
        const x = R(xa, xb), y = R(80, H - 80), r = R(rlo, rhi);
        if (nearSpawn(x, y, 260) || !freeAt(x, y, r + 55)) continue;
        addObstacle(x, y, r * 0.9, 'rock'); addAnchor(x + r * 0.8, y - r * 0.3, 'rock'); if (r > 16) addAnchor(x - r * 0.7, y + r * 0.5, 'rock');
        addItem({ k: 'rock', x, y, r, seed: floor(rn() * 1e6), pal: floor(rn() * 4), z: 2.6, br: r * 1.6 + 16, moss: rn() < 0.5 }); made++;
      }
    };
    rockPlace(100, 2300, 30, 9, 30); rockPlace(2500, 4100, 8, 8, 20); rockPlace(4300, 6300, 22, 9, 26);
    const smallPlace = (kind, xa, xb, cnt, rlo, rhi, ob, z) => {
      let made = 0;
      for (let t = 0; t < 300 && made < cnt; t++) {
        const x = R(xa, xb), y = R(80, H - 80), r = R(rlo, rhi);
        if (nearSpawn(x, y, 200) || !freeAt(x, y, r + 45)) continue;
        if (ob) { addObstacle(x, y, r * ob, kind); if (r > 12) addAnchor(x + r, y, 'rock'); }
        addItem({ k: kind, x, y, r, rot: R(0, TAU), seed: floor(rn() * 1e6), pal: floor(rn() * 3), z: z || 3.1, br: r * 2.2 + 12 }); made++;
      }
    };
    smallPlace('acorn', 100, 2800, 14, 9, 12, 0.9);
    smallPlace('shell', 150, 2300, 4, 20, 26, 0.85); smallPlace('shell', 4400, 6200, 3, 18, 24, 0.85);
    smallPlace('mushroom', 100, 2500, 9, 8, 16, 0.55); smallPlace('mushroom', 2600, 3900, 3, 7, 12, 0.5); smallPlace('mushroom', 4400, 6200, 4, 9, 14, 0.55);

    // ------------------------------------------------------------------ garden
    const flowerSpots = [];
    for (let t = 0; t < 1400 && flowerSpots.length < 56; t++) {
      const x = R(4400, 6300), y = R(140, H - 140), r = R(12, 20);
      if (flowerSpots.some(f => hypot(f.x - x, f.y - y) < 210) || !freeAt(x, y, r + 60)) continue;
      flowerSpots.push({ x, y, r });
    }
    flowerSpots.forEach((f, i) => {
      addObstacle(f.x, f.y, f.r, 'stem');
      for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.4; addAnchor(f.x + cos(a) * (f.r + 2), f.y + sin(a) * (f.r + 2), 'stem'); }
      addItem({ k: 'stem', x: f.x, y: f.y, r: f.r, seed: floor(rn() * 1e6), z: 2.7, br: 150, leaves: 4 + floor(rn() * 3) });
      const type = i % 8 === 7 ? floor(rn() * 8) : (floor(rn() * 8)), sc = R(0.58, 1.0), lx = R(-28, 28), ly = R(-28, 28);
      D.flowers.push({ x: f.x, y: f.y, cx: f.x + lx, cy: f.y + ly, type, sc });
    });
    // low plants with broad leaves
    let sp = 0;
    for (let t = 0; t < 600 && sp < 44; t++) {
      const x = R(4350, 6320), y = R(120, H - 120), r = R(7, 11);
      if (!freeAt(x, y, r + 50) || flowerSpots.some(f => hypot(f.x - x, f.y - y) < 80)) continue;
      addObstacle(x, y, r, 'stem'); addAnchor(x + r, y, 'stem');
      addItem({ k: 'stem', x, y, r, seed: floor(rn() * 1e6), z: 2.7, br: 140, leaves: 5 + floor(rn() * 3), small: true }); sp++;
    }
    // grass tufts: baked + dynamic
    for (let i = 0; i < 800; i++) {
      const x = R(4000, W), y = R(0, H), w = wz(x, y); if (rn() > w[2] * 0.95) continue;
      const sc = R(0.28, 0.52); addItem({ k: 'sprite', spr: SP.fan[floor(rn() * 3)], ppw: PPWK.fan, x, y, rot: R(0, TAU), sc, z: 2.8, a: 1, br: 220 * sc + 10, shadow: true });
    }
    for (let i = 0; i < 380; i++) {
      const x = R(4100, W), y = R(0, H), w = wz(x, y); if (rn() > w[2] * 0.9) continue;
      const dry = x < 4500 ? 3 : floor(rn() * 3), tf = { x, y, sc: R(0.34, 0.66), v: dry, ph: R(0, TAU), rot: R(0, TAU) };
      D.tufts.push(tf);
    }
    D.tuftGrid = makeGrid(256); D.tufts.forEach(tf => gAdd(D.tuftGrid, tf));
    D.tufts.forEach((tf, i) => { if (i % 5 === 0) addAnchor(tf.x, tf.y, 'grass'); });
    // fallen green leaves, petals, clover, mulch, pebbles
    const gcols = [['green', 30], ['deepgreen', 22], ['lime', 16], ['olive', 10], ['brown', 14], ['gold', 8]];
    for (let i = 0; i < 520; i++) { const x = R(4000, W), y = R(0, H), w = wz(x, y); if (rn() > w[2]) continue; const ck = wpick(gcols), sh = ck === 'green' || ck === 'deepgreen' || ck === 'lime' ? pick([0, 2, 3, 4]) : pick([0, 2, 4]), sc = R(0.34, 0.8); addItem({ k: 'leaf', x, y, rot: R(0, TAU), sc, flip: rn() < 0.5, spr: leafSprite(sh, ck), z: 1.4 + rn() * 1.4, dim: 0.06, br: LREF * sc * 0.62 + 10 }); }
    for (let i = 0; i < 620; i++) { const x = R(4000, W), y = R(0, H), w = wz(x, y); if (rn() > w[2]) continue; const sc = R(0.42, 0.9); addItem({ k: 'sprite', spr: SP.petal[floor(rn() * SP.petal.length)], ppw: PPWK.petal, x, y, rot: R(0, TAU), sc, z: 3.0 + rn() * 0.4, a: 1, br: 70 * sc + 8, shadow: true }); }
    for (let i = 0; i < 110; i++) { const x = R(4000, W), y = R(0, H), w = wz(x, y); if (rn() > w[2]) continue; const sc = R(0.45, 0.8); addItem({ k: 'sprite', spr: SP.clover[floor(rn() * 3)], ppw: PPWK.clover, x, y, rot: R(0, TAU), sc, z: 1.8, a: 1, br: 60 * sc + 8, shadow: true }); }
    for (let i = 0; i < 190; i++) { const x = R(4000, W), y = R(0, H), w = wz(x, y); if (rn() > w[2]) continue; addItem({ k: 'chip', x, y, rot: R(0, TAU), l: R(14, 36), wd: R(6, 11), seed: floor(rn() * 1e6), z: 2.1, br: 30 }); }
    for (let i = 0; i < 300; i++) { const x = R(0, W), y = R(0, H), w = wz(x, y); if (rn() > w[2] * 0.9 + w[0] * 0.45 + w[1] * 0.3) continue; addItem({ k: 'pebble', x, y, r: R(2.4, 6.5), seed: floor(rn() * 1e6), z: 1.9, br: 12 }); }

    // ----------------------------------------------------------- shelters
    genShelters(R, rn, pick);
    // ----------------------------------------------------------- canopy
    genCanopy(R, rn, pick, wpick);
    // ----------------------------------------------------------- resources
    genResources(R, rn);
    // ----------------------------------------------------------- spawn hints
    genSpawn(R, rn);
    bucketItems();
  }

  // ------------------------------------------------------------------ shelters
  const SHELTER_INFO = {
    crevice: { r: [24, 32], safety: 0.85 }, leaf: { r: [30, 40], safety: 0.7 }, bark: { r: [28, 38], safety: 0.8 },
    petal: { r: [30, 38], safety: 0.65 }, hollow: { r: [30, 42], safety: 0.9 },
  };
  function genShelters(R, rn, pick) {
    let id = 0;
    const add = (type, x, y, egg, seed) => {
      const inf = SHELTER_INFO[type], r = R(inf.r[0], inf.r[1]);
      const s = { id: 'sh' + (id++), type, x, y, r, safety: egg ? min(1, inf.safety + 0.08) : inf.safety, eggSite: !!egg, seed: floor(rn() * 1e6), rot: R(0, TAU) };
      D.shelters.push(s); return s;
    };
    const place = (xa, xb, type, egg, ya, yb) => {
      const inf = SHELTER_INFO[type];
      for (let t = 0; t < 500; t++) {
        const x = R(xa, xb), y = R(ya || 220, yb || H - 220);
        if (nearSpawn(x, y, 260) || !freeAt(x, y, inf.r[1] + 34)) continue;
        if (D.shelters.some(s => hypot(s.x - x, s.y - y) < 250)) continue;
        return add(type, x, y, egg);
      }
      return null;
    };
    // guaranteed first shelter near the hatch point
    for (let t = 0; t < 200; t++) { const a = R(-0.7, 0.7), d = R(150, 230), x = SPAWN.x + cos(a) * d, y = SPAWN.y + sin(a) * d; if (freeAt(x, y, 74)) { add('leaf', x, y, false); break; } }
    // litter
    place(500, 2200, 'crevice'); place(400, 2200, 'crevice'); place(500, 2250, 'leaf'); place(500, 2250, 'leaf'); place(900, 2250, 'hollow', true);
    // bark
    ['crevice', 'crevice', 'crevice', 'crevice', 'bark', 'bark', 'bark'].forEach(t => place(2560, 4060, t));
    place(2600, 4050, 'hollow'); place(2600, 4050, 'hollow', true);
    // garden
    ['petal', 'petal', 'petal', 'leaf', 'leaf'].forEach(t => place(4450, 6250, t, true));
    ['petal', 'leaf', 'crevice', 'crevice', 'hollow'].forEach(t => place(4450, 6250, t, false));
    D.shelters.forEach(s => {
      addItem({ k: 'shelter', s, x: s.x, y: s.y, z: 2.0, br: s.r * 2.6 + 30 });
      addAnchor(s.x + s.r * 1.1, s.y, s.type === 'petal' ? 'petal' : (s.type === 'leaf' ? 'leaf' : 'bark'));
    });
  }

  // ------------------------------------------------------------------- canopy
  function addCanopy(c) {
    c.a = 1; c.ta = 1; c.ph = c.ph == null ? Math.random() * TAU : c.ph; c.sway = 0;
    D.canopy.push(c); if (c.cr > D.maxCanopyR) D.maxCanopyR = c.cr;
    // baked ground shadow under the piece (light from upper-left)
    addItem({ k: 'cshadow', x: c.x + c.cr * 0.22, y: c.y + c.cr * 0.3, r: c.cr * (c.flat ? 1.55 : 1.25), rot: c.rot, asp: c.asp || 1, a: c.sha == null ? 0.42 : c.sha, z: 2.9, br: c.cr * 1.9 + 20 });
    return c;
  }
  function genCanopy(R, rn, pick, wpick) {
    const placed = [];
    const okSpot = (x, y, cr, sep) => {
      if (x < 40 || y < 40 || x > W - 40 || y > H - 40) return false;
      if (hypot(x - SPAWN.x, y - SPAWN.y) < cr + 120) return false;
      for (const p of placed) if (hypot(p.x - x, p.y - y) < (p.cr + cr) * sep) return false;
      return true;
    };
    const mkLeafC = (x, y, sh, ck, sc, z) => { const rot = R(0, TAU), cr = LREF * sc * 0.36; const c = { k: 'leaf', x, y, cr, spr: leafSprite(sh, ck), ppw: PPW, sc, rot, z, asp: 0.55, flat: true }; placed.push(c); return addCanopy(c); };
    // litter: big curled leaves, ferns
    let n = 0;
    for (let t = 0; t < 600 && n < 50; t++) {
      const x = R(80, 2450), y = R(80, H - 80), sc = R(1.3, 2.1), cr = LREF * sc * 0.36; if (!okSpot(x, y, cr, 0.8)) continue;
      mkLeafC(x, y, wpick([[0, 3], [1, 2], [2, 3], [4, 2]]), wpick([['rust', 4], ['ochre', 3], ['brown', 4], ['olive', 2], ['red', 2], ['gold', 1]]), sc, 10 + rn()); n++;
    }
    n = 0;
    for (let t = 0; t < 300 && n < 14; t++) {
      const x = R(80, 2400), y = R(80, H - 80), sc = R(1.0, 1.45), cr = 520 / 3 * sc * 0.3; if (!okSpot(x, y, cr, 0.8)) continue;
      const c = { k: 'fern', x, y, cr, spr: SP.fern[floor(rn() * 3)], ppw: 3, sc, rot: R(0, TAU), z: 11 + rn(), asp: 0.5, flat: true }; placed.push(c); addCanopy(c); n++;
    }
    // bark: peeled flaps, moss mats, caught leaves
    n = 0;
    for (let t = 0; t < 600 && n < 34; t++) {
      const x = R(2520, 4080), y = R(80, H - 80), sc = R(0.9, 1.5), cr = 157 * sc * 0.34; if (!okSpot(x, y, cr, 0.8)) continue;
      const c = { k: 'flap', x, y, cr, spr: SP.flap[floor(rn() * 3)], ppw: 3, sc, rot: R(-0.35, 0.35) + (rn() < 0.5 ? 0 : PI), z: 10 + rn(), asp: 0.6, flat: true, sha: 0.55 }; placed.push(c); addCanopy(c); n++;
    }
    n = 0;
    for (let t = 0; t < 400 && n < 22; t++) {
      const x = R(2480, 4120), y = R(80, H - 80), sc = R(0.7, 1.15), cr = 300 / 2.6 * sc * 0.4; if (!okSpot(x, y, cr, 0.7)) continue;
      const c = { k: 'moss', x, y, cr, spr: SP.moss[floor(rn() * 4)], ppw: 2.6, sc, rot: R(0, TAU), z: 9 + rn(), sha: 0.35 }; placed.push(c); addCanopy(c); n++;
    }
    n = 0;
    for (let t = 0; t < 300 && n < 10; t++) {
      const x = R(2450, 4150), y = R(80, H - 80), sc = R(1.1, 1.6), cr = LREF * sc * 0.36; if (!okSpot(x, y, cr, 0.8)) continue;
      mkLeafC(x, y, pick([0, 2, 4]), pick(['brown', 'dark', 'rust']), sc, 10 + rn()); n++;
    }
    // garden: flowers, broad leaves, grass fans, ferns
    D.flowers.forEach(f => {
      const spr = SP.flower[f.type]; if (!spr) return;
      const cr = FLOWER_SIZE / FPPW * f.sc * 0.4;
      const c = { k: 'flower', x: f.cx, y: f.cy, cr, spr, ppw: FPPW, sc: f.sc, rot: R(0, TAU), z: 20 + f.sc, sha: 0.5, swayAmp: 0.025 }; placed.push(c); addCanopy(c);
    });
    n = 0;
    for (let t = 0; t < 800 && n < 42; t++) {
      const x = R(4300, 6350), y = R(80, H - 80), sc = R(1.4, 2.2), cr = LREF * sc * 0.36; if (!okSpot(x, y, cr, 0.6)) continue;
      const c = mkLeafC(x, y, wpick([[0, 2], [2, 3], [3, 1], [4, 3]]), wpick([['green', 4], ['deepgreen', 4], ['lime', 3]]), sc, 8 + rn()); c.swayAmp = 0.02; n++;
    }
    n = 0;
    for (let t = 0; t < 500 && n < 26; t++) {
      const x = R(4300, 6350), y = R(80, H - 80), sc = R(0.9, 1.5), cr = 440 / 3 * sc * 0.36; if (!okSpot(x, y, cr, 0.6)) continue;
      const c = { k: 'fan', x, y, cr, spr: SP.fan[floor(rn() * 3)], ppw: 3, sc, rot: R(0, TAU), z: 12 + rn(), sha: 0.3, swayAmp: 0.04 }; placed.push(c); addCanopy(c); n++;
    }
    n = 0;
    for (let t = 0; t < 300 && n < 8; t++) {
      const x = R(4300, 6350), y = R(80, H - 80), sc = R(1.0, 1.4), cr = 520 / 3 * sc * 0.3; if (!okSpot(x, y, cr, 0.7)) continue;
      const c = { k: 'fern', x, y, cr, spr: SP.fern[floor(rn() * 3)], ppw: 3, sc, rot: R(0, TAU), z: 11 + rn(), asp: 0.5, flat: true, swayAmp: 0.03 }; placed.push(c); addCanopy(c); n++;
    }
    // shelter overhangs (leaf / bark / petal shelters get a canopy that hides the entrance)
    D.shelters.forEach(s => {
      if (s.type === 'leaf') {
        const sc = s.r / 20, ang = s.rot; const c = { k: 'leaf', x: s.x + cos(ang) * s.r * 0.55, y: s.y + sin(ang) * s.r * 0.55, cr: s.r * 1.25, spr: leafSprite(s.x > 4200 ? 4 : 0, s.x > 4200 ? 'green' : 'brown'), ppw: PPW, sc: sc * 1.15, rot: ang + PI, z: 14, asp: 0.7, flat: true, sha: 0.5 }; addCanopy(c);
      } else if (s.type === 'bark') {
        const c = { k: 'flap', x: s.x + 8, y: s.y - s.r * 0.4, cr: s.r * 1.05, spr: SP.flap[s.seed % 3], ppw: 3, sc: s.r / 36, rot: R(-0.4, 0.4), z: 14, asp: 0.6, flat: true, sha: 0.55 }; addCanopy(c);
      } else if (s.type === 'petal') {
        const ang = s.rot, c = { k: 'petal', x: s.x + cos(ang) * s.r * 0.5, y: s.y + sin(ang) * s.r * 0.5, cr: s.r * 1.25, spr: SP.petal[(s.seed % 6) * 2], ppw: PPWK.petal, sc: s.r / 22, rot: ang + PI, z: 14, asp: 0.7, flat: true, sha: 0.4, swayAmp: 0.02 }; addCanopy(c);
      }
    });
    D.canopyGrid = makeGrid(400); D.canopy.forEach(c => gAdd(D.canopyGrid, c));
  }

  // ------------------------------------------------------------------ resources
  function genResources(R, rn) {
    D.resGrid = makeGrid(160);
    let id = 0;
    const tooClose = (x, y, d) => { const gr = D.resGrid, cx = floor(x / gr.cell), cy = floor(y / gr.cell); for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) { const l = gr.a[j * gr.cols + i]; if (l) for (const o of l) if (hypot(o.x - x, o.y - y) < d) return true; } return false; };
    const put = (type, x, y) => {
      if (x < 40 || y < 40 || x > W - 40 || y > H - 40) return false;
      const r = type === 'dew' ? R(7, 11) : R(7, 10);
      if (!freeAt(x, y, r + 4) || tooClose(x, y, 64)) return false;
      const max = type === 'dew' ? floor(R(18, 32)) : floor(R(10, 16));
      const res = { id: 'r' + (id++), type, x, y, r, amount: max, max, regen: type === 'dew' ? R(0.28, 0.45) : R(0.1, 0.16), tint: floor(rn() * 3), ph: R(0, TAU), v: floor(rn() * 2) };
      D.resources.push(res); gAdd(D.resGrid, res); return true;
    };
    // a few drops within sight of the hatch point
    [[70, -40], [118, 60], [-90, 96], [210, 20], [-30, -150]].forEach(o => put('dew', SPAWN.x + o[0], SPAWN.y + o[1]));
    const fill = (type, xa, xb, cnt) => { let m = 0; for (let t = 0; t < cnt * 40 && m < cnt; t++) if (put(type, R(xa, xb), R(60, H - 60))) m++; };
    fill('dew', 60, 2380, 82); fill('dew', 2420, 4180, 62); fill('dew', 4220, 6340, 88);
    fill('nectar', 80, 2380, 6); fill('nectar', 2450, 4150, 9);
    // garden nectar sits at the rim of flowers (visible even when the bloom is faded)
    let m = 0;
    for (let t = 0; t < 900 && m < 30; t++) { const f = D.flowers[floor(rn() * D.flowers.length)]; if (!f) break; const a = R(0, TAU), d = FLOWER_SIZE / FPPW * f.sc * R(0.3, 0.46); if (put('nectar', f.cx + cos(a) * d, f.cy + sin(a) * d)) m++; }
  }

  // ------------------------------------------------------------ spawn hints
  function genSpawn(R, rn) {
    for (let z = 0; z < 3; z++) {
      const xa = z === 0 ? 40 : (z === 1 ? 2420 : 4220), xb = z === 0 ? 2380 : (z === 1 ? 4180 : 6360);
      let tries = 0;
      while (D.spawn[z].length < 240 && tries++ < 5000) {
        const x = R(xa, xb), y = R(60, H - 60);
        if (!freeAt(x, y, 26) || nearSpawn(x, y, 200)) continue;
        const ex = exposureAt(x, y);
        const tag = { open: ex > 0.85, cover: ex < 0.55, flower: false, nest: false, bark: z === 1 };
        for (const f of D.flowers) if (abs(f.x - x) < 170 && abs(f.y - y) < 170 && hypot(f.x - x, f.y - y) < 170) { tag.flower = true; break; }
        const gr = D.obsGrid, cx = floor(x / gr.cell), cy = floor(y / gr.cell);
        outer: for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) { const l = gr.a[j * gr.cols + i]; if (l) for (const o of l) if ((o.type === 'twig' || o.type === 'bark' || o.type === 'rock') && hypot(o.x - x, o.y - y) < 120) { tag.nest = true; break outer; } }
        D.spawn[z].push({ x, y, tag });
      }
    }
  }

  // ------------------------------------------------------------ exposure
  const ZONE_EXPO = [0.95, 0.9, 1.0];
  function exposureAt(x, y) {
    const zi = zoneIdAt(x, y); let base = ZONE_EXPO[zi], cover = 0;
    const gr = D.canopyGrid; if (gr) {
      const R = D.maxCanopyR, c0 = max(0, floor((x - R) / gr.cell)), c1 = min(gr.cols - 1, floor((x + R) / gr.cell)), r0 = max(0, floor((y - R) / gr.cell)), r1 = min(gr.rows - 1, floor((y + R) / gr.cell));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
        for (let i = 0; i < l.length; i++) { const c = l[i], d = hypot(x - c.x, y - c.y); if (d < c.cr) { const cv = 1 - sstep(c.cr * 0.55, c.cr, d); if (cv > cover) cover = cv; } }
      }
    }
    let e = base - cover * (base - 0.04);
    return e < 0 ? 0 : e;
  }

  // ------------------------------------------------------- chunk bucketing
  function bucketItems() {
    D.buckets = new Array(CCOLS * CROWS);
    for (const it of D.items) {
      const br = (it.brad || it.br || 20) + PAD + 2;
      const c0 = max(0, floor((it.x - br) / CH)), c1 = min(CCOLS - 1, floor((it.x + br) / CH)), r0 = max(0, floor((it.y - br) / CH)), r1 = min(CROWS - 1, floor((it.y + br) / CH));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const i = cy * CCOLS + cx; (D.buckets[i] || (D.buckets[i] = [])).push(it); }
    }
    D.buckets.forEach(b => b && b.sort((a, c) => a.z - c.z));
  }

  // ============================================================================
  // CHUNK RENDERING (static terrain baked into offscreen canvases)
  // ============================================================================
  const TIERS = [{ S: 2.2, fs: 6, grain: 0.42, detail: true }, { S: 0.8, fs: 14, grain: 0.0, detail: false }];

  function xf(g, S, ox, oy, x, y, rot, sx, sy) {
    const c = cos(rot), s = sin(rot);
    g.setTransform(c * sx * S, s * sx * S, -s * sy * S, c * sy * S, (x - ox) * S, (y - oy) * S);
  }
  const ROCK_PAL = [
    { hi: [176, 172, 160], base: [122, 118, 108], lo: [54, 52, 50] },
    { hi: [188, 166, 144], base: [132, 112, 94], lo: [62, 50, 42] },
    { hi: [128, 130, 140], base: [78, 80, 90], lo: [30, 30, 38] },
    { hi: [206, 176, 166], base: [152, 122, 114], lo: [74, 56, 52] },
  ];
  const TWIG_PAL = [
    { lo: [44, 30, 20], base: [92, 66, 44], hi: [150, 118, 84] },
    { lo: [52, 42, 34], base: [104, 88, 72], hi: [168, 150, 128] },
    { lo: [40, 26, 16], base: [80, 54, 34], hi: [132, 98, 66] },
  ];

  const DRAW = {};
  DRAW.leaf = (g, it, S, ox, oy) => {
    const sp = it.spr; if (!sp) return;
    const k = it.sc / PPW, f = it.flip ? -1 : 1, so = 1.4 + it.z * 1.1;
    g.globalAlpha = 0.55; xf(g, S, ox, oy, it.x + so * 0.7, it.y + so * 1.05, it.rot, k, k * f); g.drawImage(sp.sh, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    g.globalAlpha = 1; xf(g, S, ox, oy, it.x, it.y, it.rot, k, k * f); g.drawImage(sp.c, -sp.w / 2, -sp.h / 2);
  };
  DRAW.sprite = (g, it, S, ox, oy) => {
    const sp = it.spr; if (!sp) return; const k = it.sc / it.ppw;
    if (it.shadow && sp.sh) { g.globalAlpha = 0.5; xf(g, S, ox, oy, it.x + 1.8, it.y + 2.6, it.rot, k, k); g.drawImage(sp.sh, -sp.w / 2, -sp.h / 2, sp.w, sp.h); }
    g.globalAlpha = it.a == null ? 1 : it.a; xf(g, S, ox, oy, it.x, it.y, it.rot, k, k); g.drawImage(sp.c, -sp.w / 2, -sp.h / 2); g.globalAlpha = 1;
  };
  DRAW.cshadow = (g, it, S, ox, oy) => {
    g.globalAlpha = it.a; xf(g, S, ox, oy, it.x, it.y, it.rot, it.r / 64, it.r * it.asp / 64); g.drawImage(SP.blob, -64, -64); g.globalAlpha = 1;
  };
  DRAW.needles = (g, it, S, ox, oy) => {
    const rn = U.mulberry32(it.seed); xf(g, S, ox, oy, it.x, it.y, it.rot, 1, 1);
    g.lineCap = 'round';
    for (let pass = 0; pass < 3; pass++) {
      g.beginPath();
      const r2 = U.mulberry32(it.seed);
      for (let i = 0; i < it.n; i++) {
        const a = (r2() - 0.5) * 1.4, l = it.len * (0.7 + r2() * 0.5), bx = (r2() - 0.5) * 16, by = (r2() - 0.5) * 16, o = pass === 0 ? 2.2 : 0;
        for (let k = -1; k <= 1; k += 2) { g.moveTo(bx + o, by + o * 1.3); g.quadraticCurveTo(bx + cos(a + k * 0.03) * l * 0.5 + o, by + sin(a + k * 0.03) * l * 0.5 + k * 1.5 + o, bx + cos(a + k * 0.05) * l + o, by + sin(a + k * 0.05) * l + o * 1.3); }
      }
      if (pass === 0) { g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2.2; } else if (pass === 1) { g.strokeStyle = 'rgb(128,88,42)'; g.lineWidth = 1.7; } else { g.strokeStyle = 'rgba(214,170,96,0.55)'; g.lineWidth = 0.7; }
      g.stroke();
    }
  };
  DRAW.crack = (g, it, S, ox, oy) => {
    const p = it.pts; g.lineCap = 'round'; g.lineJoin = 'round';
    const path = (dx, dy) => { g.beginPath(); g.moveTo(p[0][0] + dx, p[0][1] + dy); for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(p[i][0] + dx, p[i][1] + dy, (p[i][0] + p[i + 1][0]) / 2 + dx, (p[i][1] + p[i + 1][1]) / 2 + dy); g.lineTo(p[p.length - 1][0] + dx, p[p.length - 1][1] + dy); };
    path(0, 0); g.strokeStyle = 'rgba(8,5,3,0.16)'; g.lineWidth = it.w * 3.0; g.stroke();
    path(0, 0); g.strokeStyle = 'rgba(8,5,3,0.32)'; g.lineWidth = it.w * 1.8; g.stroke();
    path(0, 0); g.strokeStyle = 'rgb(9,6,4)'; g.lineWidth = it.w; g.stroke();
    path(it.w * 0.9, it.w * 0.7); g.strokeStyle = 'rgba(150,124,98,0.22)'; g.lineWidth = max(0.8, it.w * 0.28); g.stroke();
  };
  DRAW.twig = (g, it, S, ox, oy, lod) => {
    const pal = TWIG_PAL[it.pal]; g.lineCap = 'round'; g.lineJoin = 'round';
    const run = (pts, pass) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], w = (a.w + b.w) * 0.5; g.beginPath();
        if (pass === 0) { g.moveTo(a.x + 4, a.y + 6); g.lineTo(b.x + 4, b.y + 6); g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = w * 1.25; }
        else if (pass === 1) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.strokeStyle = css(pal.lo); g.lineWidth = w; }
        else if (pass === 2) { g.moveTo(a.x - w * 0.05, a.y - w * 0.07); g.lineTo(b.x - w * 0.05, b.y - w * 0.07); g.strokeStyle = css(pal.base); g.lineWidth = w * 0.78; }
        else { g.moveTo(a.x - w * 0.17, a.y - w * 0.22); g.lineTo(b.x - w * 0.17, b.y - w * 0.22); g.strokeStyle = css(pal.hi, 0.75); g.lineWidth = w * 0.28; }
        g.stroke();
      }
    };
    for (let pass = 0; pass < 4; pass++) { run(it.pts, pass); it.br.forEach(b => run(b, pass)); }
    if (lod !== false) {
      const rn = U.mulberry32(it.seed), p = it.pts;
      for (let i = 1; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1], ang = atan2(b.y - a.y, b.x - a.x), nx = -sin(ang), ny = cos(ang);
        if (rn() < 0.7) { g.strokeStyle = 'rgba(20,12,6,0.4)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(a.x + nx * a.w * 0.5, a.y + ny * a.w * 0.5); g.lineTo(a.x - nx * a.w * 0.5, a.y - ny * a.w * 0.5); g.stroke(); }
        if (rn() < 0.5) { g.fillStyle = 'rgba(214,196,160,0.55)'; g.beginPath(); g.ellipse(a.x + nx * a.w * R2(rn, 0.3), a.y + ny * a.w * R2(rn, 0.3), 1.6, 0.8, ang, 0, TAU); g.fill(); }
      }
      // cut ends
      [p[0], p[p.length - 1]].forEach((e, k) => {
        const o = k ? p[p.length - 2] : p[1], ang = atan2(e.y - o.y, e.x - o.x), r = e.w * 0.5;
        g.save(); g.translate(e.x, e.y); g.rotate(ang); g.scale(0.55, 1);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgb(206,176,128)'); gr.addColorStop(1, 'rgb(130,96,60)');
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(70,40,20,0.5)'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); g.arc(0, 0, r * 0.3, 0, TAU); g.stroke(); g.restore();
      });
      if (it.moss) for (let i = 0; i < 3; i++) { const q = p[1 + floor(rn() * (p.length - 2))], sc = 0.09 + rn() * 0.08; xf(g, S, ox, oy, q.x, q.y, rn() * TAU, sc / 2.6, sc / 2.6); g.drawImage(SP.moss[i % 4].c, -150, -150); }
    }
  };
  function R2(rn, a) { return (rn() - 0.5) * 2 * a; }
  DRAW.rock = (g, it, S, ox, oy, lod) => {
    const rn = U.mulberry32(it.seed), r = it.r, pal = ROCK_PAL[it.pal], n = 15, pts = [];
    for (let i = 0; i < n; i++) { const a = i * TAU / n, rr = r * (0.84 + rn() * 0.24); pts.push([it.x + cos(a) * rr * 1.06, it.y + sin(a) * rr * 0.94]); }
    const poly = (dx, dy) => { g.beginPath(); for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2 + dx, my = (p[1] + q[1]) / 2 + dy; if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(p[0] + dx, p[1] + dy, mx, my); } const p0 = pts[0], q0 = pts[1]; g.quadraticCurveTo(p0[0] + dx, p0[1] + dy, (p0[0] + q0[0]) / 2 + dx, (p0[1] + q0[1]) / 2 + dy); g.closePath(); };
    g.save();
    for (let k = 0; k < 3; k++) { poly(r * (0.18 + k * 0.1), r * (0.26 + k * 0.14)); g.fillStyle = 'rgba(0,0,0,' + (0.2 - k * 0.05) + ')'; g.fill(); }
    poly(0, 0);
    const gr = g.createRadialGradient(it.x - r * 0.4, it.y - r * 0.45, r * 0.1, it.x, it.y, r * 1.25);
    gr.addColorStop(0, css(pal.hi)); gr.addColorStop(0.45, css(pal.base)); gr.addColorStop(1, css(pal.lo));
    g.fillStyle = gr; g.fill(); g.clip();
    if (lod !== false) {
      for (let i = 0; i < r * 2.2; i++) { const a = rn() * TAU, d = sqrt(rn()) * r; g.fillStyle = rn() < 0.5 ? css(pal.lo, 0.35) : css(pal.hi, 0.35); g.beginPath(); g.arc(it.x + cos(a) * d, it.y + sin(a) * d, 0.5 + rn() * 1.4, 0, TAU); g.fill(); }
      g.strokeStyle = css(pal.lo, 0.5); g.lineWidth = 0.9;
      for (let i = 0; i < 2; i++) { let cx = it.x + (rn() - 0.5) * r, cy = it.y + (rn() - 0.5) * r; g.beginPath(); g.moveTo(cx, cy); for (let s = 0; s < 4; s++) { cx += (rn() - 0.4) * r * 0.4; cy += (rn() - 0.2) * r * 0.35; g.lineTo(cx, cy); } g.stroke(); }
    }
    const sg = g.createLinearGradient(it.x - r, it.y - r, it.x + r, it.y + r); sg.addColorStop(0.45, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = sg; g.fillRect(it.x - r * 1.3, it.y - r * 1.3, r * 2.6, r * 2.6);
    g.restore(); g.save(); poly(0, 0); g.lineWidth = 1.1; g.strokeStyle = css(pal.lo, 0.7); g.stroke(); g.clip(); poly(-1, -1.3); g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1.6; g.stroke(); g.restore();
    if (it.moss && lod !== false) { const sc = r * 0.019; xf(g, S, ox, oy, it.x - r * 0.35, it.y - r * 0.25, rn() * TAU, sc, sc); g.globalAlpha = 0.9; g.drawImage(SP.moss[1].c, -150, -150); g.globalAlpha = 1; }
  };
  DRAW.mushroom = (g, it, S, ox, oy) => {
    const r = it.r, rn = U.mulberry32(it.seed), pal = [[[222, 196, 156], [150, 108, 68], [96, 66, 40]], [[250, 246, 238], [206, 196, 180], [150, 140, 126]], [[226, 72, 48], [170, 36, 28], [100, 20, 16]]][it.pal];
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(it.x + r * 0.35, it.y + r * 0.5, r * 1.05, r * 0.9, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(it.x - r * 0.3, it.y - r * 0.35, r * 0.1, it.x, it.y, r);
    gr.addColorStop(0, css(pal[0])); gr.addColorStop(0.75, css(pal[1])); gr.addColorStop(1, css(pal[2]));
    g.fillStyle = gr; g.beginPath(); g.ellipse(it.x, it.y, r, r * 0.94, it.rot, 0, TAU); g.fill();
    g.strokeStyle = css(pal[2], 0.7); g.lineWidth = 0.9; g.stroke();
    if (it.pal === 2) { g.fillStyle = 'rgba(255,255,248,0.92)'; for (let i = 0; i < 9; i++) { const a = rn() * TAU, d = sqrt(rn()) * r * 0.75; g.beginPath(); g.arc(it.x + cos(a) * d, it.y + sin(a) * d, r * (0.08 + rn() * 0.1), 0, TAU); g.fill(); } }
    else { g.strokeStyle = css(pal[2], 0.22); g.lineWidth = 0.7; for (let i = 0; i < 18; i++) { const a = i * TAU / 18; g.beginPath(); g.moveTo(it.x + cos(a) * r * 0.2, it.y + sin(a) * r * 0.2); g.lineTo(it.x + cos(a) * r * 0.92, it.y + sin(a) * r * 0.88); g.stroke(); } }
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(it.x - r * 0.35, it.y - r * 0.4, r * 0.28, r * 0.15, -0.7, 0, TAU); g.fill();
    g.restore();
  };
  DRAW.acorn = (g, it, S, ox, oy) => {
    const r = it.r; xf(g, S, ox, oy, it.x, it.y, it.rot, 1, 1);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(3, 5, r * 1.3, r * 0.85, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, 1, 0, 0, r * 1.2); gr.addColorStop(0, 'rgb(214,150,76)'); gr.addColorStop(0.6, 'rgb(150,90,36)'); gr.addColorStop(1, 'rgb(86,48,18)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(r * 0.25, 0, r * 1.15, r * 0.82, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60,30,10,0.35)'; g.lineWidth = 0.8; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(r * 0.0, i * r * 0.2); g.quadraticCurveTo(r * 0.7, i * r * 0.2 * 0.9, r * 1.3, i * r * 0.08); g.stroke(); }
    const cg = g.createRadialGradient(-r * 0.7, -r * 0.2, 1, -r * 0.55, 0, r * 0.95); cg.addColorStop(0, 'rgb(150,118,72)'); cg.addColorStop(1, 'rgb(76,56,30)');
    g.fillStyle = cg; g.beginPath(); g.ellipse(-r * 0.55, 0, r * 0.78, r * 0.86, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(40,26,12,0.55)'; for (let a = 0; a < 20; a++) { const aa = a * 2.4, d = r * 0.7 * sqrt((a + 1) / 20); g.beginPath(); g.arc(-r * 0.55 + cos(aa) * d * 0.9, sin(aa) * d, r * 0.07, 0, TAU); g.fill(); }
    g.fillStyle = 'rgb(80,54,28)'; g.beginPath(); g.arc(-r * 1.28, 0, r * 0.17, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,240,200,0.45)'; g.beginPath(); g.ellipse(r * 0.55, -r * 0.4, r * 0.22, r * 0.1, -0.2, 0, TAU); g.fill();
  };
  DRAW.shell = (g, it, S, ox, oy) => {
    const r = it.r; xf(g, S, ox, oy, it.x, it.y, it.rot, 1, 1);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(4, 6, r * 1.05, r * 1.0, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.1); gr.addColorStop(0, 'rgb(236,214,170)'); gr.addColorStop(0.6, 'rgb(190,150,98)'); gr.addColorStop(1, 'rgb(108,76,44)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) { g.strokeStyle = pass ? 'rgba(255,240,206,0.5)' : 'rgba(84,52,24,0.75)'; g.lineWidth = r * (pass ? 0.07 : 0.14); g.beginPath(); for (let t = 0; t < 14; t += 0.2) { const rr = r * (0.97 - t * 0.065) , a = t * 1.0; const x = cos(a) * rr - (pass ? 0.8 : 0), y = sin(a) * rr - (pass ? 0.8 : 0); t === 0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-r * 0.4, -r * 0.5, r * 0.25, r * 0.12, -0.7, 0, TAU); g.fill();
  };
  DRAW.chip = (g, it, S, ox, oy) => {
    xf(g, S, ox, oy, it.x, it.y, it.rot, 1, 1); const l = it.l, w = it.wd, rn = U.mulberry32(it.seed);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-l / 2 + 2, -w / 2 + 3, l, w);
    const gr = g.createLinearGradient(0, -w / 2, 0, w / 2); gr.addColorStop(0, 'rgb(150,106,66)'); gr.addColorStop(1, 'rgb(86,56,32)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(-l / 2, -w * 0.4); g.lineTo(l / 2 - 3, -w / 2); g.lineTo(l / 2, w * 0.1); g.lineTo(l / 2 - 5, w / 2); g.lineTo(-l / 2 + 2, w * 0.45); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(50,28,12,0.5)'; g.lineWidth = 0.7; for (let i = 0; i < 3; i++) { const y = (i - 1) * w * 0.25; g.beginPath(); g.moveTo(-l / 2 + 2, y); g.lineTo(l / 2 - 3, y + (rn() - 0.5) * 2); g.stroke(); }
  };
  DRAW.pebble = (g, it, S, ox, oy) => {
    const r = it.r, pal = [[184, 178, 166], [150, 130, 108], [118, 118, 124]][it.seed % 3];
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(it.x + r * 0.4, it.y + r * 0.6, r * 1.05, r * 0.85, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(it.x - r * 0.35, it.y - r * 0.4, 0.2, it.x, it.y, r * 1.1); gr.addColorStop(0, css(mulc(pal, 1.2))); gr.addColorStop(1, css(mulc(pal, 0.45)));
    g.fillStyle = gr; g.beginPath(); g.ellipse(it.x, it.y, r, r * 0.86, it.seed % 6, 0, TAU); g.fill();
  };
  DRAW.flake = (g, it, S, ox, oy) => {
    const r = it.r, rn = U.mulberry32(it.seed); xf(g, S, ox, oy, it.x, it.y, it.rot, 1, 1);
    const pts = []; for (let i = 0; i < 5; i++) { const a = i * TAU / 5, rr = r * (0.6 + rn() * 0.6); pts.push([cos(a) * rr * 1.4, sin(a) * rr]); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0] + 1.6, p[1] + 2.2) : g.moveTo(p[0] + 1.6, p[1] + 2.2)); g.closePath(); g.fill();
    g.fillStyle = css(mulc([108, 88, 68], 0.8 + rn() * 0.5)); g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(210,180,146,0.4)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(pts[4][0], pts[4][1]); g.lineTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.stroke();
  };
  DRAW.shelf = (g, it, S, ox, oy) => {
    const r = it.r; xf(g, S, ox, oy, it.x, it.y, it.rot, 1, 1);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(2, 3, r * 1.05, -PI, 0); g.closePath(); g.fill();
    const cols = [[222, 204, 168], [176, 136, 92], [128, 90, 58], [196, 170, 130], [92, 64, 42]];
    for (let i = cols.length - 1; i >= 0; i--) { g.fillStyle = css(cols[i]); g.beginPath(); g.arc(0, 0, r * (0.25 + 0.15 * (i + 1)) * 1.07, -PI, 0); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(255,240,210,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, 0, r * 0.98, -PI * 0.95, -PI * 0.1); g.stroke();
  };
  DRAW.knot = (g, it, S, ox, oy, lod) => {
    const r = it.r, rn = U.mulberry32(it.seed); g.save();
    if (it.solid) { g.fillStyle = 'rgba(0,0,0,0.32)'; g.beginPath(); g.ellipse(it.x + r * 0.2, it.y + r * 0.28, r * 1.1, r * 1.0, 0, 0, TAU); g.fill(); }
    const rings = 7;
    for (let i = rings; i >= 0; i--) {
      const rr = r * (0.18 + 0.82 * i / rings); g.beginPath();
      for (let k = 0; k <= 24; k++) { const a = k / 24 * TAU, w = 1 + 0.12 * sin(a * 3 + i) + 0.08 * sin(a * 5 + it.seed); const x = it.x + cos(a) * rr * w * 0.92, y = it.y + sin(a) * rr * w * 1.08; k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath(); const t = i / rings;
      g.fillStyle = css(mixc([34, 24, 18], [112, 92, 72], (i % 2 ? 0.55 : 0.78) * t + 0.12)); g.fill();
      g.strokeStyle = 'rgba(14,9,6,0.45)'; g.lineWidth = 0.9; g.stroke();
    }
    const gr = g.createRadialGradient(it.x, it.y, 0, it.x, it.y, r * 0.32); gr.addColorStop(0, 'rgba(8,5,3,0.9)'); gr.addColorStop(1, 'rgba(8,5,3,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(it.x, it.y, r * 0.35, 0, TAU); g.fill();
    // lit upper-left rim, dark lower-right
    const lg = g.createLinearGradient(it.x - r, it.y - r, it.x + r, it.y + r); lg.addColorStop(0, 'rgba(255,230,190,0.22)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = lg; g.beginPath(); g.arc(it.x, it.y, r * 1.05, 0, TAU); g.fill();
    g.restore();
  };
  DRAW.lichen = (g, it, S, ox, oy, lod) => {
    const r = it.r, rn = U.mulberry32(it.seed), pal = [[[150, 164, 128], [196, 206, 164], [96, 116, 84]], [[222, 148, 40], [250, 196, 80], [160, 90, 20]], [[212, 208, 190], [240, 238, 224], [140, 136, 122]]][it.type];
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.25)'; blobPath(g, it.x + 1.5, it.y + 2, r * 1.04, rn, 18, 0.18); g.fill();
    for (let ring = 0; ring < 3; ring++) {
      const rr = r * (1 - ring * 0.28), nlobe = 12 + ring * 4; g.beginPath();
      for (let k = 0; k < nlobe * 2; k++) { const a = k * PI / nlobe, rad = rr * ((k % 2) ? 0.82 : 1.0) * (0.92 + rn() * 0.14); const x = it.x + cos(a) * rad, y = it.y + sin(a) * rad; k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath(); g.fillStyle = css(mixc(pal[ring === 0 ? 0 : 1], pal[2], ring * 0.2), ring === 0 ? 0.88 : 0.72); g.fill();
      g.strokeStyle = css(pal[2], 0.45); g.lineWidth = 0.8; g.stroke();
    }
    if (lod !== false) { g.fillStyle = css(pal[2], 0.6); for (let i = 0; i < r * 1.4; i++) { const a = rn() * TAU, d = sqrt(rn()) * r * 0.8; g.beginPath(); g.arc(it.x + cos(a) * d, it.y + sin(a) * d, 0.6 + rn() * 1.1, 0, TAU); g.fill(); } }
    g.restore();
  };
  DRAW.plate = (g, it, S, ox, oy, lod) => {
    const rn = U.mulberry32(it.seed), w = it.w, h = it.h, c = cos(it.ang), s = sin(it.ang);
    const L = (lx, ly) => [it.x + lx * c - ly * s, it.y + lx * s + ly * c];
    const pts = [];
    const top = 4 + floor(rn() * 3), side = 5;
    for (let i = 0; i <= top; i++) pts.push(L(-w / 2 + w * i / top, -h / 2 + (rn() - 0.3) * w * 0.35));
    for (let i = 1; i < side; i++) pts.push(L(w / 2 + (rn() - 0.5) * w * 0.14, -h / 2 + h * i / side));
    for (let i = top; i >= 0; i--) pts.push(L(-w / 2 + w * i / top, h / 2 + (rn() - 0.7) * w * 0.35));
    for (let i = side - 1; i > 0; i--) pts.push(L(-w / 2 + (rn() - 0.5) * w * 0.14, -h / 2 + h * i / side));
    const poly = (dx, dy) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0] + dx, p[1] + dy) : g.moveTo(p[0] + dx, p[1] + dy)); g.closePath(); };
    g.save();
    for (let k = 0; k < 4; k++) { poly(3 + k * 2.6, 5 + k * 3.6); g.fillStyle = 'rgba(0,0,0,' + (0.22 - k * 0.04) + ')'; g.fill(); }
    poly(0, 0); const a0 = L(-w / 2, 0), a1 = L(w / 2, 0);
    const gr = g.createLinearGradient(a0[0], a0[1], a1[0], a1[1]); gr.addColorStop(0, 'rgb(142,116,90)'); gr.addColorStop(0.45, 'rgb(98,78,60)'); gr.addColorStop(1, 'rgb(58,44,34)');
    g.fillStyle = gr; g.fill(); g.clip();
    g.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) { const lx = -w / 2 + w * (i + 0.5) / 9 + (rn() - 0.5) * 3; g.strokeStyle = rn() < 0.7 ? 'rgba(14,8,5,0.42)' : 'rgba(190,160,126,0.22)'; g.beginPath(); let p = L(lx, -h / 2 - 4); g.moveTo(p[0], p[1]); for (let y = -h / 2; y <= h / 2 + 4; y += 14) { p = L(lx + sin(y * 0.09 + i) * 2.2, y); g.lineTo(p[0], p[1]); } g.stroke(); }
    // lighter top-edge (cut thickness)
    const tg = g.createLinearGradient(...L(0, -h / 2), ...L(0, -h / 2 + w * 0.5)); tg.addColorStop(0, 'rgba(210,178,140,0.5)'); tg.addColorStop(1, 'rgba(210,178,140,0)');
    g.fillStyle = tg; poly(0, 0); g.fill();
    g.restore();
    g.save(); poly(0, 0); g.lineJoin = 'round'; g.strokeStyle = 'rgba(14,9,6,0.85)'; g.lineWidth = 1.8; g.stroke(); g.clip(); poly(-1.6, -2); g.strokeStyle = 'rgba(214,184,148,0.55)'; g.lineWidth = 2.2; g.stroke(); poly(2, 2.4); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2.6; g.stroke(); g.restore();
    if (lod !== false && rn() < 0.6) { const sc = 0.1 + rn() * 0.08, q = L((rn() - 0.5) * w * 0.4, (rn() - 0.5) * h * 0.6); xf(g, S, ox, oy, q[0], q[1], rn() * TAU, sc / 2.6, sc / 2.6); g.globalAlpha = 0.9; g.drawImage(SP.moss[floor(rn() * 4)].c, -150, -150); g.globalAlpha = 1; }
  };
  DRAW.stem = (g, it, S, ox, oy, lod) => {
    const rn = U.mulberry32(it.seed), r = it.r, n = it.leaves;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + rn() * 0.6, sc = it.small ? 0.5 + rn() * 0.4 : 0.55 + rn() * 0.45, spr = leafSprite(3 + (rn() < 0.5 ? 1 : 0), rn() < 0.5 ? 'deepgreen' : 'green'), d = LREF * sc * 0.5 + r * 0.5;
      DRAW.leaf(g, { spr, x: it.x + cos(a) * d, y: it.y + sin(a) * d, rot: a, sc, flip: rn() < 0.5, z: 1.8 + rn() * 0.3, dim: 0.0 }, S, ox, oy);
    }
    g.setTransform(S, 0, 0, S, -ox * S, -oy * S);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(it.x + r * 0.35, it.y + r * 0.5, r * 1.25, r * 1.1, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(it.x - r * 0.35, it.y - r * 0.4, r * 0.1, it.x, it.y, r * 1.05); gr.addColorStop(0, 'rgb(164,206,106)'); gr.addColorStop(0.5, 'rgb(76,132,56)'); gr.addColorStop(1, 'rgb(24,58,28)');
    g.fillStyle = gr; g.beginPath(); g.arc(it.x, it.y, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(10,36,14,0.5)'; g.lineWidth = 1; g.beginPath(); g.arc(it.x, it.y, r * 0.58, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,230,0.35)'; g.beginPath(); g.ellipse(it.x - r * 0.35, it.y - r * 0.4, r * 0.25, r * 0.13, -0.7, 0, TAU); g.fill();
  };

  // ------------------------------------------------------------ shelter art
  DRAW.shelter = (g, it, S, ox, oy, lod) => {
    const s = it.s, r = s.r, rn = U.mulberry32(s.seed), zi = zoneIdAt(s.x, s.y);
    const lip = zi === 1 ? [112, 92, 72] : (zi === 2 ? [84, 66, 40] : [78, 58, 36]);
    g.save();
    // soft contact darkness
    const dk = (rx, ry, a, rot) => { xf(g, S, ox, oy, s.x, s.y, rot || 0, rx / 64, ry / 64); g.globalAlpha = a; g.drawImage(SP.blob, -64, -64); g.globalAlpha = 1; };
    if (s.type === 'crevice' || s.type === 'bark') {
      const rot = s.rot, rx = r * (s.type === 'bark' ? 1.25 : 1.35), ry = r * (s.type === 'bark' ? 0.48 : 0.55);
      dk(rx * 1.55, ry * 1.9, 0.5, rot);
      xf(g, S, ox, oy, s.x, s.y, rot, 1, 1);
      // raised lips
      g.fillStyle = css(mulc(lip, 0.55)); g.beginPath(); g.ellipse(0, 1.5, rx * 1.1, ry * 1.25, 0, 0, TAU); g.fill();
      g.fillStyle = css(lip); g.beginPath(); g.ellipse(-1.5, -2, rx * 1.05, ry * 1.12, 0, PI * 0.95, PI * 2.1); g.fill();
      const gr = g.createRadialGradient(-rx * 0.2, -ry * 0.3, 1, 0, 0, rx); gr.addColorStop(0, 'rgb(2,1,1)'); gr.addColorStop(0.7, 'rgb(14,9,6)'); gr.addColorStop(1, 'rgb(40,28,18)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.stroke();
      g.strokeStyle = 'rgba(230,200,160,0.35)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(0, 0, rx * 1.04, ry * 1.1, 0, PI * 0.15, PI * 0.9); g.stroke();
    } else if (s.type === 'hollow') {
      dk(r * 3.0, r * 3.0, 0.5, 0); xf(g, S, ox, oy, s.x, s.y, 0, 1, 1);
      const wood = zi === 2 ? [96, 76, 50] : [108, 84, 60];
      for (let i = 5; i >= 0; i--) {
        const rr = r * (0.7 + i * 0.13); g.beginPath();
        for (let k = 0; k <= 24; k++) { const a = k / 24 * TAU, w = 1 + 0.07 * sin(a * 3 + i + s.seed) + 0.04 * sin(a * 7); const x = cos(a) * rr * w, y = sin(a) * rr * w; k ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.closePath(); g.fillStyle = css(mulc(wood, 0.55 + 0.1 * (5 - i) + (i % 2) * 0.06)); g.fill(); g.strokeStyle = 'rgba(16,10,6,0.5)'; g.lineWidth = 0.9; g.stroke();
      }
      const gr = g.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r * 0.82); gr.addColorStop(0, 'rgb(1,1,1)'); gr.addColorStop(0.75, 'rgb(10,7,4)'); gr.addColorStop(1, 'rgb(34,24,14)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 0.78, 0, TAU); g.fill();
      const lg = g.createLinearGradient(-r, -r, r, r); lg.addColorStop(0, 'rgba(255,224,180,0.3)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = lg; g.beginPath(); g.arc(0, 0, r * 1.5, 0, TAU); g.arc(0, 0, r * 0.78, 0, TAU, true); g.fill();
      if (lod !== false) { xf(g, S, ox, oy, s.x + r * 0.9, s.y - r * 0.6, s.seed % 6, 0.2 / 2.6 * r / 30, 0.2 / 2.6 * r / 30); g.drawImage(SP.moss[2].c, -150, -150); }
    } else if (s.type === 'leaf') {
      dk(r * 3.0, r * 2.3, 0.6, s.rot); dk(r * 1.7, r * 1.3, 0.55, s.rot);
    } else { // petal
      dk(r * 2.8, r * 2.2, 0.5, s.rot); dk(r * 1.5, r * 1.2, 0.4, s.rot);
    }
    g.restore();
    if (s.eggSite) {
      xf(g, S, ox, oy, s.x, s.y, 0, 1, 1);
      const gr = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.7); gr.addColorStop(0, 'rgba(255,240,200,0.0)'); gr.addColorStop(0.55, 'rgba(255,240,200,0.14)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 1.7, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(250,246,236,0.38)'; g.lineWidth = 0.8;
      for (let i = 0; i < 22; i++) { const a = rn() * TAU, a2 = a + (rn() - 0.5) * 1.2, r1 = r * (0.8 + rn() * 0.2), r2 = r * (1.2 + rn() * 0.6); g.beginPath(); g.moveTo(cos(a) * r1, sin(a) * r1); g.quadraticCurveTo(cos((a + a2) / 2) * r2 * 0.9, sin((a + a2) / 2) * r2 * 0.9, cos(a2) * r2, sin(a2) * r2); g.stroke(); }
    }
  };

  // ------------------------------------------------------------- chunk pass
  // Chunks are baked by resumable jobs so that prefetching can be spread over many
  // frames (a few ms each) and never causes a visible hitch.
  const fieldScratch = {};
  function chunkJob(cx, cy, tier) {
    const T = TIERS[tier], ox = cx * CH - PAD, oy = cy * CH - PAD, ow = CH + 2 * PAD;
    const pw = ceil(ow * T.S), cv = mk(pw, pw), g = ctxOf(cv); if (!g) return null;
    const S = pw / ow; g.setTransform(S, 0, 0, S, -ox * S, -oy * S);
    return { cx, cy, tier, T, cv, g, S, ox, oy, ow, phase: 0, idx: 0, list: D.buckets[cy * CCOLS + cx] || null, last: 0 };
  }
  function jobField(J) {
    const g = J.g, T = J.T, ox = J.ox, oy = J.oy, ow = J.ow;
    const fs = T.fs, n = ceil(ow / fs) + 2, x0 = ox - fs, y0 = oy - fs;
    let sc = fieldScratch[n]; if (!sc) { const c2 = mk(n, n); sc = fieldScratch[n] = { c: c2, g: ctxOf(c2) }; }
    const id = sc.g.createImageData(n, n), d = id.data, col = [0, 0, 0];
    const m = n + 2, needBark = x0 < 4500 && x0 + n * fs > 2200, needSoil = x0 < 2700 || x0 + n * fs > 3900;
    const hB = needBark ? new Float32Array(m * m) : null, hS = needSoil ? new Float32Array(m * m) : null;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const wx = x0 + (i - 0.5) * fs, wy = y0 + (j - 0.5) * fs;
      if (hB) hB[j * m + i] = hBark(wx, wy);
      if (hS) hS[j * m + i] = hSoil(wx, wy);
    }
    const inv = 1 / (2 * fs);
    for (let j = 0; j < n; j++) {
      const wy = y0 + (j + 0.5) * fs, b1 = bnd1(wy), b2 = bnd2(wy);
      for (let i = 0; i < n; i++) {
        const gi = (j + 1) * m + (i + 1);
        let hb = 0, hbx = 0, hby = 0, hs = 0, hsx = 0, hsy = 0;
        if (hB) { hb = hB[gi]; hbx = (hB[gi + 1] - hB[gi - 1]) * inv; hby = (hB[gi + m] - hB[gi - m]) * inv; }
        if (hS) { hs = hS[gi]; hsx = (hS[gi + 1] - hS[gi - 1]) * inv; hsy = (hS[gi + m] - hS[gi - m]) * inv; }
        fieldSample(x0 + (i + 0.5) * fs, wy, b1, b2, hb, hbx, hby, hs, hsx, hsy, col);
        const k = (j * n + i) * 4; d[k] = cl255(col[0]); d[k + 1] = cl255(col[1]); d[k + 2] = cl255(col[2]); d[k + 3] = 255;
      }
    }
    sc.g.putImageData(id, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(sc.c, x0, y0, n * fs, n * fs);
  }
  function jobDetail(J) {
    const g = J.g, T = J.T, ox = J.ox, oy = J.oy, ow = J.ow;
    if (GRAIN && T.grain > 0) {
      g.globalCompositeOperation = 'overlay'; g.globalAlpha = T.grain;
      for (let ty = floor(oy / 128) * 128; ty < oy + ow; ty += 128) for (let tx = floor(ox / 128) * 128; tx < ox + ow; tx += 128) g.drawImage(GRAIN, tx, ty, 128, 128);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    }
    if (!T.detail) return;
    const CS = 15;
    for (let cj = floor(oy / CS); cj <= floor((oy + ow) / CS); cj++) for (let ci = floor(ox / CS); ci <= floor((ox + ow) / CS); ci++) {
      const h = hsh(ci, cj, 81); if (h > 0.62) continue;
      const px = ci * CS + hsh(ci, cj, 82) * CS, py = cj * CS + hsh(ci, cj, 83) * CS, rr = 0.5 + pow(hsh(ci, cj, 84), 2) * 2.1, kind = hsh(ci, cj, 85);
      const t1 = sstep(-120, 120, px - 2400), t2 = sstep(-120, 120, px - 4200);
      let c;
      if (t1 - t2 > 0.5) c = kind < 0.55 ? 'rgba(14,10,7,0.5)' : (kind < 0.85 ? 'rgba(170,148,120,0.32)' : 'rgba(96,80,58,0.5)');
      else if (t2 > 0.5) c = kind < 0.5 ? 'rgba(26,18,10,0.55)' : (kind < 0.75 ? 'rgba(170,160,140,0.35)' : (kind < 0.9 ? 'rgba(110,160,70,0.45)' : 'rgba(210,190,120,0.3)'));
      else c = kind < 0.5 ? 'rgba(12,8,5,0.55)' : (kind < 0.78 ? 'rgba(140,118,90,0.33)' : 'rgba(92,66,38,0.55)');
      g.fillStyle = c;
      if (rr > 1.3) { g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill(); } else g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    }
  }
  // advance a job until `deadline` (ms timestamp); returns true when finished
  // Test-only: forces software canvases to rasterise pending ops so job cost is measured honestly.
  let FLUSH = false; function flush(J) { try { J.g.getImageData(0, 0, 1, 1); } catch (e) {} }
  function jobStep(J, deadline) {
    const g = J.g, S = J.S, T = J.T;
    if (J.phase === 0) { jobField(J); J.phase = 1; if (FLUSH) flush(J); if (now() > deadline) return false; }
    if (J.phase === 1) { jobDetail(J); J.phase = 2; if (FLUSH) flush(J); if (now() > deadline) return false; }
    if (J.phase === 2) {
      const list = J.list;
      if (list) {
        while (J.idx < list.length) {
          const it = list[J.idx++], fn = DRAW[it.k];
          if (!fn) continue;
          if (!T.detail && (it.k === 'pebble' || it.k === 'flake' || it.k === 'chip' || it.k === 'needles')) continue;
          g.setTransform(S, 0, 0, S, -J.ox * S, -J.oy * S);
          fn(g, it, S, J.ox, J.oy, T.detail ? undefined : false);
          g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
          if ((J.idx & 3) === 0) { if (FLUSH) flush(J); if (now() > deadline) return false; }
        }
      }
      J.phase = 3; g.setTransform(1, 0, 0, 1, 0, 0); J.list = null;
    }
    return true;
  }
  function renderChunk(cx, cy, tier) {
    const J = chunkJob(cx, cy, tier); if (!J) return null;
    jobStep(J, Infinity); return J;
  }

  // ============================================================================
  // CHUNK CACHE + TERRAIN DRAWER
  // ============================================================================
  const CC = [new Map(), new Map()], CAPS = [30, 110];
  let frameNo = 0;
  const cam = Game.camera;
  function viewRect() {
    const z = cam.zoom || 1, hw = C.VIEW_W / 2 / z, hh = C.VIEW_H / 2 / z;
    return { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
  }
  function evict(tier) {
    const m = CC[tier], cap = CAPS[tier];
    while (m.size > cap) {
      let wk = null, wl = 1e18;
      for (const [k, v] of m) if (v.last < wl) { wl = v.last; wk = k; }
      if (wk === null || wl >= frameNo - 1) break;
      m.delete(wk);
    }
  }
  function chunkMake(cx, cy, tier) {
    let r = null;
    try { r = renderChunk(cx, cy, tier); } catch (e) { Game.reportError('world.renderChunk', e); }
    if (r) { r.last = frameNo; CC[tier].set(cy * CCOLS + cx, r); evict(tier); }
    return r;
  }
  function drawFallback(g, cx, cy) {
    const x = cx * CH, y = cy * CH;
    if (D.minimap) { const k = D.minimap.width / W; g.drawImage(D.minimap, x * k, y * k, CH * k, CH * k, x, y, CH, CH); }
    else { g.fillStyle = '#3a2c1c'; g.fillRect(x, y, CH, CH); }
  }
  let curJob = null;
  const _missing = [], _urgent = [];
  function drawTerrain(g) {
    frameNo++;
    const t0 = now(), z = cam.zoom, tier = z >= 0.95 ? 0 : 1, v = viewRect();
    g.imageSmoothingEnabled = true;
    const c0 = max(0, floor((v.x0 - PAD) / CH)), c1 = min(CCOLS - 1, floor((v.x1 + PAD) / CH)), r0 = max(0, floor((v.y0 - PAD) / CH)), r1 = min(CROWS - 1, floor((v.y1 + PAD) / CH));
    _missing.length = 0; _urgent.length = 0;
    const m = CC[tier], mo = CC[1 - tier];
    g.fillStyle = '#241a10'; g.fillRect(max(0, v.x0), max(0, v.y0), min(W, v.x1) - max(0, v.x0), min(H, v.y1) - max(0, v.y0));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const key = cy * CCOLS + cx, ch = m.get(key);
      if (ch) { ch.last = frameNo; g.drawImage(ch.cv, ch.ox, ch.oy, ch.ow, ch.ow); }
      else {
        const fb = mo.get(key);
        if (fb) { fb.last = frameNo; g.drawImage(fb.cv, fb.ox, fb.oy, fb.ow, fb.ow); _missing.push(cx, cy); }
        else { drawFallback(g, cx, cy); _urgent.push(cx, cy); }
      }
    }
    // chunks with no stand-in at all are baked immediately (nearest first, time-boxed)
    let made = 0; const tU = now();
    while (_urgent.length && (made < 1 || now() - t0 < 12)) {
      let bi = 0, bd = 1e18;
      for (let i = 0; i < _urgent.length; i += 2) { const d = hypot((_urgent[i] + 0.5) * CH - cam.x, (_urgent[i + 1] + 0.5) * CH - cam.y); if (d < bd) { bd = d; bi = i; } }
      const cx = _urgent[bi], cy = _urgent[bi + 1]; _urgent.splice(bi, 2);
      if (curJob && curJob.cx === cx && curJob.cy === cy && curJob.tier === tier) { jobStep(curJob, Infinity); const J = curJob; curJob = null; J.last = frameNo; m.set(cy * CCOLS + cx, J); evict(tier); g.drawImage(J.cv, J.ox, J.oy, J.ow, J.ow); made++; continue; }
      const ch = chunkMake(cx, cy, tier); made++;
      if (ch) g.drawImage(ch.cv, ch.ox, ch.oy, ch.ow, ch.ow);
    }
    const tJ = now(); world.stats.urgentMs = tJ - tU; world.stats.urgent = made;
    // background baking: visible-with-stand-in first, then the ring around the view
    try {
      if (!curJob) {
        let bcx = -1, bcy = -1, bd = 1e18;
        for (let i = 0; i < _missing.length; i += 2) { const d = hypot((_missing[i] + 0.5) * CH - cam.x, (_missing[i + 1] + 0.5) * CH - cam.y) - 5000; if (d < bd) { bd = d; bcx = _missing[i]; bcy = _missing[i + 1]; } }
        if (bcx < 0 && m.size < CAPS[tier] - 3) {
          const lead = 0.5; // look a little ahead of the camera's motion
          const px = cam.x + (cam.x - lastCam.x) * 30 * lead, py = cam.y + (cam.y - lastCam.y) * 30 * lead;
          for (let cy = max(0, r0 - 1); cy <= min(CROWS - 1, r1 + 1); cy++) for (let cx = max(0, c0 - 1); cx <= min(CCOLS - 1, c1 + 1); cx++) {
            if (m.has(cy * CCOLS + cx)) continue;
            const d = hypot((cx + 0.5) * CH - px, (cy + 0.5) * CH - py); if (d < bd) { bd = d; bcx = cx; bcy = cy; }
          }
        }
        if (bcx >= 0) curJob = chunkJob(bcx, bcy, tier);
      }
      if (curJob) {
        const urgent = _missing.length > 0;
        if (jobStep(curJob, now() + (urgent ? 7 : 3.5))) { const J = curJob; curJob = null; J.last = frameNo; CC[J.tier].set(J.cy * CCOLS + J.cx, J); evict(J.tier); }
      }
    } catch (e) { curJob = null; Game.reportError('world.prefetch', e); }
    world.stats.jobMs = now() - tJ; world.stats.blitMs = tU - t0; world.stats.missing = _missing.length / 2;
    lastCam.x = cam.x; lastCam.y = cam.y;
  }
  const lastCam = { x: 0, y: 0 };

  // ============================================================================
  // DYNAMIC LAYERS
  // ============================================================================
  const world = {
    name: 'world', priority: 10,
    width: W, height: H,
    time01: 0.02, dayCount: 0, light: 1, phase: 'day',
    weather: { type: 'clear', intensity: 0, windX: 0.12, windY: 0.04 },
    obstacles: D.obstacles, resources: D.resources, shelters: D.shelters, anchors: D.anchors,
    explored: null, exploredCell: 64, exploredCols: ceil(W / 64), exploredRows: ceil(H / 64),
    sun: 1, night: 0, wet: 0, stats: { urgentMs: 0, jobMs: 0, blitMs: 0, urgent: 0, missing: 0 },
    fx: { rain: 0, drizzle: 0, fog: 0, wind: 0, flash: 0 },
  };
  world.explored = new Uint8Array(world.exploredCols * world.exploredRows);
  let canvasOK = false;

  function focusPos() {
    const t = cam.target || Game.player;
    if (t && typeof t.x === 'number' && isFinite(t.x)) return t;
    return cam;
  }

  // ---- time of day
  function sunElev(t) { return sin(TAU * t); }
  function computeLight() {
    const t = world.time01, s = sunElev(t);
    const sun = sstep(-0.2, 0.38, s);
    world.sun = sun; world.night = 1 - sun;
    let phase;
    if (s > 0.38) phase = 'day'; else if (s < -0.2) phase = 'night';
    else phase = cos(TAU * t) > 0 ? 'dawn' : 'dusk';
    const fx = world.fx;
    const clouds = clamp(fx.rain * 0.38 + fx.drizzle * 0.2 + fx.fog * 0.16, 0, 0.45);
    world.light = clamp(0.08 + 0.92 * sun * (1 - clouds), 0.08, 1);
    if (phase !== world.phase) { const prev = world.phase; world.phase = phase; if (prev) Game.emit('day:phase', { phase }); }
  }
  world.isNight = () => world.phase === 'night';

  // ---- weather
  const WSPEC = { drizzle: [0.35, 0.65], rain: [0.62, 1.0], wind: [0.5, 1.0], fog: [0.55, 1.0] };
  const wS = { phase: 'gap', timer: 70, target: 0, thunder: 20, pending: [], lastType: 'clear', ang: 0.35 };
  function setWeatherType(type) {
    const w = world.weather; if (w.type === type) return;
    const prev = w.type; w.type = type; wS.lastType = prev === 'clear' ? wS.lastType : prev;
    Game.emit('weather:change', { weather: type, prev });
  }
  function chooseWeather() {
    const day1 = world.dayCount >= 1, ph = world.phase, opts = [];
    opts.push(['wind', 20]);
    opts.push(['fog', (ph === 'dawn' || ph === 'night') ? 26 : 12]);
    if (day1) { opts.push(['rain', 24]); opts.push(['drizzle', 26]); }
    let tot = 0; opts.forEach(o => { if (o[0] === wS.lastType) o[1] *= 0.3; tot += o[1]; });
    let r = Math.random() * tot; for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
    return 'wind';
  }
  function updateWeather(dt) {
    const w = world.weather;
    wS.timer -= dt;
    if (wS.phase === 'gap') {
      if (wS.timer <= 0) { const type = chooseWeather(), sp = WSPEC[type]; w.intensity = 0; setWeatherType(type); wS.target = U.rand(sp[0], sp[1]); wS.phase = 'in'; }
    } else if (wS.phase === 'in') {
      w.intensity = min(wS.target, w.intensity + dt * 0.07);
      if (w.intensity >= wS.target) { wS.phase = 'hold'; wS.timer = U.rand(50, 130); }
    } else if (wS.phase === 'hold') {
      if (wS.timer <= 0) wS.phase = 'out';
    } else {
      w.intensity = max(0, w.intensity - dt * 0.09);
      if (w.intensity <= 0) { setWeatherType('clear'); wS.phase = 'gap'; wS.timer = U.rand(55, 140); }
    }
    const fx = world.fx, k = 1 - Math.exp(-dt * 1.2);
    for (const key of ['rain', 'drizzle', 'fog', 'wind']) { const tgt = w.type === key ? w.intensity : 0; fx[key] += (tgt - fx[key]) * k; if (fx[key] < 0.002 && tgt === 0) fx[key] = 0; }
    // wind vector: slowly wandering direction, breeze always present
    const tt = Game.time.t; wS.ang = 0.35 + sin(tt * 0.05) * 0.9 + sin(tt * 0.13 + 1) * 0.35;
    const str = 0.12 + 0.07 * sin(tt * 0.31) + fx.wind * 0.78 + fx.rain * 0.16 + fx.drizzle * 0.05;
    w.windX = cos(wS.ang) * str; w.windY = sin(wS.ang) * str * 0.6;
    world.wet += ((fx.rain + fx.drizzle * 0.5 > 0.1 ? 1 : 0) - world.wet) * (fx.rain + fx.drizzle * 0.5 > 0.1 ? dt * 0.06 : dt * 0.012);
    // thunder & lightning
    if (w.type === 'rain' && w.intensity > 0.55) {
      wS.thunder -= dt;
      if (wS.thunder <= 0) { wS.thunder = U.rand(16, 42); fx.flash = 1; wS.pending.push(tt + U.rand(0.25, 1.8)); }
    }
    for (let i = wS.pending.length - 1; i >= 0; i--) if (tt >= wS.pending[i]) { wS.pending.splice(i, 1); Game.emit('sfx', { name: 'thunder', vol: U.rand(0.7, 1.0) }); }
    if (fx.flash > 0) fx.flash = max(0, fx.flash - dt * 2.8);
  }

  // ---- resources
  function updateResources(dt) {
    const rainMul = 1 + world.fx.rain * 2.5 + world.fx.drizzle, dew = 0.55 + 1.4 * world.night + (world.phase === 'dawn' ? 0.8 : 0);
    const res = D.resources;
    for (let i = 0; i < res.length; i++) {
      const r = res[i]; if (r.amount >= r.max) continue;
      r.amount = min(r.max, r.amount + r.regen * dt * (r.type === 'dew' ? dew * rainMul : 1 + world.sun * 0.4));
    }
  }

  // ---- canopy fade
  const fading = [];
  function updateCanopy(dt) {
    const f = focusPos(), px = f.x, py = f.y, gr = D.canopyGrid; if (!gr) return;
    const R = D.maxCanopyR, c0 = max(0, floor((px - R) / gr.cell)), c1 = min(gr.cols - 1, floor((px + R) / gr.cell)), r0 = max(0, floor((py - R) / gr.cell)), r1 = min(gr.rows - 1, floor((py + R) / gr.cell));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i], d = hypot(px - c.x, py - c.y), under = d < c.cr * 1.05;
        c.ta = under ? 0.2 + 0.5 * sstep(c.cr * 0.7, c.cr * 1.05, d) : 1;
        if (c.ta < 1 && !c.inList) { c.inList = true; fading.push(c); }
      }
    }
    const k = 1 - Math.exp(-dt * 6);
    for (let i = fading.length - 1; i >= 0; i--) {
      const c = fading[i];
      // pieces no longer near the player drift back to 1
      if (hypot(px - c.x, py - c.y) > c.cr * 1.05) c.ta = 1;
      c.a += (c.ta - c.a) * k;
      if (c.ta === 1 && c.a > 0.995) { c.a = 1; c.inList = false; fading.splice(i, 1); }
    }
  }

  // ---- explored / zone tracking
  let lastZone = null, expFrame = 0;
  world.markExplored = (x, y, radius) => {
    const cs = world.exploredCell, cols = world.exploredCols, rows = world.exploredRows, e = world.explored;
    const r = radius || 200, c0 = max(0, floor((x - r) / cs)), c1 = min(cols - 1, floor((x + r) / cs)), r0 = max(0, floor((y - r) / cs)), r1 = min(rows - 1, floor((y + r) / cs)), r2 = r * r;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const dx = (cx + 0.5) * cs - x, dy = (cy + 0.5) * cs - y; if (dx * dx + dy * dy <= r2 + cs * cs * 0.5) e[cy * cols + cx] = 255;
    }
  };
  world.isExplored = (x, y) => { const cs = world.exploredCell; const cx = floor(x / cs), cy = floor(y / cs); return cx >= 0 && cy >= 0 && cx < world.exploredCols && cy < world.exploredRows && world.explored[cy * world.exploredCols + cx] > 0; };

  // ---- public geometry API
  world.zoneAt = (x, y) => C.ZONES[zoneIdAt(x, y)];
  world.exposure = (x, y) => { let e = exposureAt(x, y); if (e > 0.06 && world.shelterAt(x, y)) e = 0.06; return e; };
  world.shelterAt = (x, y) => {
    const l = D.shelters; for (let i = 0; i < l.length; i++) { const s = l[i], dx = x - s.x, dy = y - s.y; if (dx * dx + dy * dy <= s.r * s.r) return s; } return null;
  };
  world.resolve = (x, y, r) => {
    r = r || 0;
    x = clamp(x, r, W - r); y = clamp(y, r, H - r);
    const gr = D.obsGrid; if (!gr) return { x, y };
    const reach = r + D.maxObsR, cs = gr.cell;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      const c0 = max(0, floor((x - reach) / cs)), c1 = min(gr.cols - 1, floor((x + reach) / cs)), r0 = max(0, floor((y - reach) / cs)), r1 = min(gr.rows - 1, floor((y + reach) / cs));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const o = l[i], dx = x - o.x, dy = y - o.y, rr = o.r + r, d2 = dx * dx + dy * dy;
          if (d2 < rr * rr) {
            const d = sqrt(d2);
            if (d < 1e-4) { x += rr; } else { const p = (rr - d) + 0.02; x += dx / d * p; y += dy / d * p; }
            moved = true;
          }
        }
      }
      x = clamp(x, r, W - r); y = clamp(y, r, H - r);
      if (!moved) break;
    }
    return { x, y };
  };
  world.consumeResource = (res, amount) => { if (!res) return 0; const t = min(max(0, amount || 0), res.amount); res.amount -= t; return t; };
  world.nearestResource = (x, y, type, maxDist) => {
    const md = maxDist == null ? 1e9 : maxDist, md2 = md * md; let best = null, bd = md2;
    const l = D.resources;
    for (let i = 0; i < l.length; i++) { const r = l[i]; if (r.amount < 0.5 || (type && r.type !== type)) continue; const dx = r.x - x, dy = r.y - y, d2 = dx * dx + dy * dy; if (d2 <= bd) { bd = d2; best = r; } }
    return best;
  };
  world.nearestAnchor = (x, y, maxDist) => {
    const gr = D.anchorGrid; if (!gr) return null;
    const md = maxDist == null ? 160 : maxDist, cs = gr.cell, c0 = max(0, floor((x - md) / cs)), c1 = min(gr.cols - 1, floor((x + md) / cs)), r0 = max(0, floor((y - md) / cs)), r1 = min(gr.rows - 1, floor((y + md) / cs));
    let best = null, bd = md * md;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const l = gr.a[cy * gr.cols + cx]; if (!l) continue; for (let i = 0; i < l.length; i++) { const a = l[i], dx = a.x - x, dy = a.y - y, d2 = dx * dx + dy * dy; if (d2 <= bd) { bd = d2; best = a; } } }
    return best;
  };
  // kind: 'flying' | 'ground' | 'flower' | 'nest' | 'open' | 'cover' | 'bark' | undefined (all)
  world.spawnPoints = (zoneId, kind) => {
    const zi = zoneId === 'litter' ? 0 : (zoneId === 'bark' ? 1 : (zoneId === 'garden' ? 2 : -1));
    const src = zi >= 0 ? D.spawn[zi] : D.spawn[0].concat(D.spawn[1], D.spawn[2]);
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const p = src[i], t = p.tag;
      if (kind === 'flower' ? !t.flower : kind === 'nest' ? !t.nest : kind === 'open' ? !t.open : kind === 'cover' ? !t.cover : kind === 'bark' ? !t.bark : false) continue;
      out.push({ x: p.x, y: p.y });
    }
    if (kind === 'flying' && zi === 2) { // flyers favour flower patches
      const f = []; for (let i = 0; i < src.length; i++) if (src[i].tag.flower) f.push({ x: src[i].x, y: src[i].y });
      if (f.length > 12) return f;
    }
    if (!out.length && src.length) for (let i = 0; i < src.length; i++) out.push({ x: src[i].x, y: src[i].y });
    return out;
  };
  world.drawMinimapTerrain = (g, x, y, w, h) => {
    if (D.minimap) { g.save(); g.imageSmoothingEnabled = true; g.drawImage(D.minimap, x, y, w, h); g.restore(); }
    else { g.fillStyle = '#3a2c1c'; g.fillRect(x, y, w, h); }
  };
  world.randomFreePoint = (zoneId) => { const l = world.spawnPoints(zoneId); return l.length ? l[floor(Math.random() * l.length)] : { x: SPAWN.x, y: SPAWN.y }; };

  // ---------------------------------------------------------------- ground layer
  function drawGround(g) {
    const t = Game.time.real, v = viewRect(), gr = D.tuftGrid; if (!gr) return;
    const wind = hypot(world.weather.windX, world.weather.windY);
    const c0 = max(0, floor((v.x0 - 100) / gr.cell)), c1 = min(gr.cols - 1, floor((v.x1 + 100) / gr.cell)), r0 = max(0, floor((v.y0 - 100) / gr.cell)), r1 = min(gr.rows - 1, floor((v.y1 + 100) / gr.cell));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const tf = l[i]; if (tf.x < v.x0 - 80 || tf.x > v.x1 + 80 || tf.y < v.y0 - 80 || tf.y > v.y1 + 80) continue;
        const sp = SP.fan[tf.v]; if (!sp) continue;
        const sw = sin(t * (1.1 + wind * 1.5) + tf.ph + tf.x * 0.004) * (0.06 + wind * 0.22), k = tf.sc / 3;
        g.save(); g.translate(tf.x, tf.y); g.rotate(tf.rot + sw); g.scale(k * (1 + sw * 0.1), k);
        g.globalAlpha = 0.28; g.drawImage(sp.sh, -sp.w / 2 + 5, -sp.h / 2 + 8, sp.w, sp.h);
        g.globalAlpha = 1; g.drawImage(sp.c, -sp.w / 2, -sp.h / 2); g.restore();
      }
    }
  }

  // ------------------------------------------------------------ resources layer
  function drawResources(g) {
    const t = Game.time.real, v = viewRect(), gr = D.resGrid; if (!gr) return;
    const sun = world.sun, night = world.night, dawn = world.phase === 'dawn' ? 1 : 0;
    const c0 = max(0, floor((v.x0 - 30) / gr.cell)), c1 = min(gr.cols - 1, floor((v.x1 + 30) / gr.cell)), r0 = max(0, floor((v.y0 - 30) / gr.cell)), r1 = min(gr.rows - 1, floor((v.y1 + 30) / gr.cell));
    for (let pass = 0; pass < 2; pass++) {
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const r = l[i]; if (r.x < v.x0 - 30 || r.x > v.x1 + 30 || r.y < v.y0 - 30 || r.y > v.y1 + 30) continue;
          const frac = r.amount / r.max, isD = r.type === 'dew';
          if (pass === 0) {
            const spr = isD ? SP.dew[r.tint] : SP.nectar[r.v]; if (!spr) continue;
            const rd = r.r * (0.38 + 0.62 * frac) * (isD ? 1 : 1.0), sz = rd * (spr.w / spr.r);
            g.globalAlpha = frac < 0.05 ? 0.25 : 1;
            const bob = isD ? 0 : sin(t * 1.6 + r.ph) * 0.4;
            g.drawImage(spr.c, r.x - sz / 2, r.y - sz / 2 + bob, sz, sz); g.globalAlpha = 1;
          } else if (frac > 0.08) {
            g.globalCompositeOperation = 'lighter';
            if (!isD) {
              const pulse = 0.5 + 0.5 * sin(t * 1.8 + r.ph), a = (0.18 + 0.12 * pulse + night * 0.3) * min(1, frac * 2);
              g.globalAlpha = a; const gs = r.r * 5.2; g.drawImage(SP.glow.gold, r.x - gs / 2, r.y - gs / 2, gs, gs);
            } else if (night > 0.5) { g.globalAlpha = 0.1 * night; const gs = r.r * 4; g.drawImage(SP.glow.cool, r.x - gs / 2, r.y - gs / 2, gs, gs); }
            // glint: sharp twinkle, stronger in sun / at dawn
            const ph = sin(t * (isD ? 1.35 : 1.7) + r.ph * 3.1), gl = ph > 0.86 ? (ph - 0.86) / 0.14 : 0;
            const gA = gl * (0.35 + 0.65 * (sun * 0.6 + dawn * 0.5) + (isD ? 0 : 0.3)) * min(1, frac * 2.5);
            if (gA > 0.02) { g.globalAlpha = min(1, gA); const ss = r.r * (2.6 + gl * 1.8); g.drawImage(SP.star, r.x - r.r * 0.3 - ss / 2, r.y - r.r * 0.4 - ss / 2, ss, ss); }
            g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ shelter fx layer
  function drawShelterFx(g) {
    const t = Game.time.real, v = viewRect(), f = focusPos(), P = Game.player, adult = P && P.stage >= 4;
    const l = D.shelters;
    for (let i = 0; i < l.length; i++) {
      const s = l[i]; if (s.x < v.x0 - 120 || s.x > v.x1 + 120 || s.y < v.y0 - 120 || s.y > v.y1 + 120) continue;
      const d = hypot(f.x - s.x, f.y - s.y);
      if (s.eggSite && (adult || d < 320)) {
        const k = adult ? 1 : 0.5, pulse = 0.5 + 0.5 * sin(t * 1.9 + i);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (0.16 + 0.12 * pulse) * k; const gs = s.r * 4.2; g.drawImage(SP.glow.gold, s.x - gs / 2, s.y - gs / 2, gs, gs);
        if (adult) { for (let n = 0; n < 5; n++) { const a = t * 0.6 + n * 1.26 + i, rr = s.r * (1.0 + 0.35 * sin(t + n)); const sa = 0.5 + 0.5 * sin(t * 3 + n * 2); g.globalAlpha = 0.5 * sa; const ss = 7 + 4 * sa; g.drawImage(SP.star, s.x + cos(a) * rr - ss / 2, s.y + sin(a) * rr * 0.8 - ss / 2, ss, ss); } }
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      } else if (d < 260 && d > s.r * 0.6) {
        // gentle invitation: faint breathing rim light so shelters read as destinations
        const a = (1 - d / 260) * (0.14 + 0.08 * sin(t * 1.7 + i));
        g.globalAlpha = a; g.strokeStyle = '#f2e6c8'; g.lineWidth = 1.2; g.beginPath(); g.arc(s.x, s.y, s.r * (1.0 + 0.04 * sin(t * 1.7 + i)), 0, TAU); g.stroke(); g.globalAlpha = 1;
      }
    }
  }

  // ------------------------------------------------------------------ canopy layer
  const _vis = [];
  function drawCanopy(g) {
    const t = Game.time.real, v = viewRect(), gr = D.canopyGrid; if (!gr) return;
    const R = D.maxCanopyR + 80, c0 = max(0, floor((v.x0 - R) / gr.cell)), c1 = min(gr.cols - 1, floor((v.x1 + R) / gr.cell)), r0 = max(0, floor((v.y0 - R) / gr.cell)), r1 = min(gr.rows - 1, floor((v.y1 + R) / gr.cell));
    _vis.length = 0;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const l = gr.a[cy * gr.cols + cx]; if (!l) continue;
      for (let i = 0; i < l.length; i++) { const c = l[i], rr = c.cr * 1.7 + 40; if (c.x + rr < v.x0 || c.x - rr > v.x1 || c.y + rr < v.y0 || c.y - rr > v.y1) continue; _vis.push(c); }
    }
    _vis.sort((a, b) => a.z - b.z);
    const wind = hypot(world.weather.windX, world.weather.windY);
    for (let i = 0; i < _vis.length; i++) {
      const c = _vis[i], sp = c.spr; if (!sp || c.a < 0.015) continue;
      const k = c.sc / c.ppw, sw = c.swayAmp ? sin(t * 0.8 + c.ph + c.x * 0.003) * c.swayAmp * (0.7 + wind * 3) : 0;
      g.save(); g.translate(c.x, c.y); g.rotate(c.rot + sw); g.scale(k, k);
      g.globalAlpha = c.a;
      g.drawImage(sp.c, -sp.w / 2, -sp.h / 2);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ weather (world space)
  function hash1(i, s) { return U.hash2(i, s, 7); }
  function drawWeatherWorld(g) {
    const t = Game.time.real, v = viewRect(), fx = world.fx;
    const vw = v.x1 - v.x0, vh = v.y1 - v.y0, rainAmt = fx.rain + fx.drizzle * 0.6;
    // rain ripples / splashes on the ground
    if (rainAmt > 0.04) {
      const n = floor(46 * rainAmt), life = 0.7; g.lineWidth = 0.9 / max(0.5, cam.zoom * 0.5);
      for (let i = 0; i < n; i++) {
        const u = t / life + i * 0.6180339, cyc = floor(u), fr = u - cyc;
        const x = v.x0 + hash1(i, cyc) * vw, y = v.y0 + hash1(i + 91, cyc) * vh, r = (2 + fr * 11) * (0.7 + hash1(i, cyc + 5) * 0.7);
        const a = (1 - fr) * (1 - fr) * 0.55 * min(1, rainAmt + 0.2);
        g.strokeStyle = 'rgba(214,228,244,' + a.toFixed(3) + ')'; g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, 0, TAU); g.stroke();
        if (fr < 0.3) { g.fillStyle = 'rgba(230,240,252,' + ((0.3 - fr) * 2).toFixed(3) + ')'; for (let k = 0; k < 3; k++) { const a2 = k * 2.1 + i, d = fr * 22; g.fillRect(x + cos(a2) * d, y + sin(a2) * d * 0.6 - fr * 14 * (1 - fr), 0.9, 0.9); } }
      }
    }
    // fireflies at night (garden mostly, a few in the leaf litter)
    const night = world.night * (1 - clamp(fx.rain * 1.2, 0, 1));
    if (night > 0.3) {
      g.globalCompositeOperation = 'lighter';
      const cs = 230, ci0 = floor((v.x0 - 80) / cs), ci1 = floor((v.x1 + 80) / cs), cj0 = floor((v.y0 - 80) / cs), cj1 = floor((v.y1 + 80) / cs);
      for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
        const h = hsh(ci, cj, 301), zx = (ci + 0.5) * cs, p = zx > 4200 ? 0.6 : (zx > 2400 ? 0.12 : 0.22); if (h > p) continue;
        const ph = hsh(ci, cj, 302) * TAU, x = (ci + hsh(ci, cj, 303)) * cs + sin(t * 0.31 + ph) * 60 + sin(t * 0.77 + ph * 2) * 18, y = (cj + hsh(ci, cj, 304)) * cs + cos(t * 0.27 + ph) * 50 + sin(t * 0.9 + ph) * 14;
        const b = pow(max(0, sin(t * (1.1 + h) + ph * 3)), 2.5) * night; if (b < 0.02) continue;
        g.globalAlpha = b * 0.9; const s1 = 34; g.drawImage(SP.glow.green, x - s1 / 2, y - s1 / 2, s1, s1);
        g.globalAlpha = min(1, b * 1.3); const s2 = 5; g.drawImage(SP.glow.white, x - s2 / 2, y - s2 / 2, s2, s2);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
  }

  // ------------------------------------------------------------ weather (screen space)
  const NR = 420, RX = new Float32Array(NR), RY = new Float32Array(NR), RS = new Float32Array(NR), RL = new Float32Array(NR);
  (function () { const rn = U.mulberry32(5150); for (let i = 0; i < NR; i++) { RX[i] = rn(); RY[i] = rn(); RS[i] = 0.75 + rn() * 0.5; RL[i] = 0.6 + rn() * 0.9; } })();
  const NM = 46; const MX = [], MY = [], MP = [], MZ = [];
  (function () { const rn = U.mulberry32(777); for (let i = 0; i < NM; i++) { MX.push(rn()); MY.push(rn()); MP.push(rn() * TAU); MZ.push(0.4 + rn() * 0.9); } })();
  function drawRain(g, amt, drizzle) {
    const t = Game.time.real, w = world.weather, W2 = C.VIEW_W + 120, H2 = C.VIEW_H + 120;
    const n = floor(NR * (drizzle ? 0.55 : 1) * min(1, amt + 0.1)), spd = drizzle ? 620 : 1050, sx = (w.windX * 420 + 28), len = drizzle ? 0.014 : 0.024;
    for (let layer = 0; layer < 2; layer++) {
      g.beginPath();
      const i0 = layer === 0 ? 0 : floor(n * 0.5), i1 = layer === 0 ? floor(n * 0.5) : n, sm = layer === 0 ? 0.75 : 1.2;
      for (let i = i0; i < i1; i++) {
        const v = RS[i] * sm, x = ((RX[i] * W2 + t * sx * v) % W2 + W2) % W2 - 60, y = ((RY[i] * H2 + t * spd * v) % H2) - 60, l = len * RL[i] * sm;
        g.moveTo(x, y); g.lineTo(x - sx * l * 0.6, y - spd * l);
      }
      g.strokeStyle = layer === 0 ? 'rgba(190,205,226,' + (0.28 * amt + 0.06).toFixed(3) + ')' : 'rgba(214,228,246,' + (0.5 * amt + 0.08).toFixed(3) + ')';
      g.lineWidth = layer === 0 ? 0.9 : 1.5; g.lineCap = 'round'; g.stroke();
    }
  }
  function drawWindMotes(g, amt) {
    const t = Game.time.real, w = world.weather, spd = hypot(w.windX, w.windY), W2 = C.VIEW_W + 200, ang = atan2(w.windY, w.windX);
    const n = floor(NM * min(1, amt * 1.3 + 0.1));
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const v = MZ[i] * (260 + spd * 900), x = ((MX[i] * W2 + t * v * cos(ang)) % W2 + W2) % W2 - 100, y = ((MY[i] * (C.VIEW_H + 160) + t * v * sin(ang) * 0.7 + sin(t * 1.3 + MP[i]) * 40) % (C.VIEW_H + 160) + C.VIEW_H + 160) % (C.VIEW_H + 160) - 80;
      const l = (10 + 26 * MZ[i]) * (0.4 + amt);
      g.strokeStyle = i % 5 === 0 ? 'rgba(206,170,98,' + (0.5 * amt).toFixed(3) + ')' : 'rgba(236,236,226,' + (0.26 * amt).toFixed(3) + ')';
      g.lineWidth = i % 5 === 0 ? 2.2 : 1.1;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - cos(ang) * l * 0.5, y - sin(ang) * l * 0.5 + sin(t * 4 + MP[i]) * 3, x - cos(ang) * l, y - sin(ang) * l); g.stroke();
    }
    // a few tumbling leaves in strong wind
    if (amt > 0.45) {
      const nl = floor((amt - 0.4) * 9), keys = ['0brown', '2ochre', '4rust', '2olive'];
      for (let i = 0; i < nl; i++) {
        const sp = SP.leaf[keys[i % 4]]; if (!sp) continue;
        const v = 420 + i * 70 + spd * 500, x = (((i * 211 + t * v * cos(ang)) % W2) + W2) % W2 - 100, y = ((i * 97 + 80 + t * v * sin(ang) * 0.5 + sin(t * 1.7 + i) * 70) % (C.VIEW_H + 120) + C.VIEW_H + 120) % (C.VIEW_H + 120) - 60;
        g.save(); g.translate(x, y); g.rotate(t * (1.5 + i * 0.4) + i); g.scale(0.07, 0.07 * cos(t * 2.1 + i)); g.globalAlpha = 0.85; g.drawImage(sp.c, -sp.w / 2, -sp.h / 2); g.restore();
      }
    }
  }
  function drawMotes(g) {
    // pollen / dust floating in sunlit air (screen space, gentle parallax with the camera)
    const t = Game.time.real, f = focusPos(), zi = zoneIdAt(f.x, f.y), a = world.sun * (1 - world.fx.rain) * (1 - world.fx.fog * 0.6);
    if (a < 0.1) return;
    g.globalCompositeOperation = 'lighter';
    const col = zi === 2 ? SP.glow.gold : SP.glow.warm, n = zi === 2 ? 30 : 18;
    for (let i = 0; i < n; i++) {
      const z = MZ[i], x = ((MX[i] * 1500 + t * 9 * z - cam.x * cam.zoom * 0.25 * z) % 1500 + 1500) % 1500 - 110, y = ((MY[i] * 840 + t * 4 * z + sin(t * 0.5 + MP[i]) * 30 - cam.y * cam.zoom * 0.25 * z) % 840 + 840) % 840 - 60;
      const tw = 0.5 + 0.5 * sin(t * 1.2 + MP[i] * 3), s = (6 + 9 * z) * (zi === 2 ? 1 : 0.8);
      g.globalAlpha = a * (0.16 + 0.18 * tw) * z; g.drawImage(col, x - s / 2, y - s / 2, s, s);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function drawFog(g, amt) {
    const t = Game.time.real, w = world.weather, tile = SP.fog; if (!tile) return;
    g.fillStyle = 'rgba(206,214,218,' + (0.2 * amt).toFixed(3) + ')'; g.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
    for (let layer = 0; layer < 2; layer++) {
      const sz = layer ? 900 : 1300, par = layer ? 0.42 : 0.2, ox = -(((cam.x * cam.zoom * par + t * (14 + 30 * hypot(w.windX, w.windY)) * (layer ? 1.5 : 1)) % sz) + sz) % sz, oy = -((cam.y * cam.zoom * par + t * 4 * (layer + 1)) % sz + sz) % sz;
      g.globalAlpha = amt * (layer ? 0.5 : 0.62);
      for (let x = ox - sz; x < C.VIEW_W; x += sz) for (let y = oy - sz; y < C.VIEW_H; y += sz) g.drawImage(tile, x - 1, y - 1, sz + 2, sz + 2);
    }
    g.globalAlpha = 1;
    // denser at the edges, clearer around the spider
    const gr = g.createRadialGradient(C.VIEW_W / 2, C.VIEW_H / 2, 120, C.VIEW_W / 2, C.VIEW_H / 2, 760);
    gr.addColorStop(0, 'rgba(210,218,222,0)'); gr.addColorStop(1, 'rgba(210,218,222,' + (0.38 * amt).toFixed(3) + ')');
    g.fillStyle = gr; g.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
  }
  function drawWeatherScreen(g) {
    const fx = world.fx;
    if (fx.fog > 0.01) drawFog(g, fx.fog);
    if (fx.drizzle > 0.01) drawRain(g, fx.drizzle, true);
    if (fx.rain > 0.01) { drawRain(g, fx.rain, false); g.fillStyle = 'rgba(40,56,80,' + (0.18 * fx.rain).toFixed(3) + ')'; g.fillRect(0, 0, C.VIEW_W, C.VIEW_H); }
    if (fx.wind > 0.02) drawWindMotes(g, fx.wind); else if (hypot(world.weather.windX, world.weather.windY) > 0.16) drawWindMotes(g, 0.12);
    drawMotes(g);
  }

  // ------------------------------------------------------------ day / night tint
  let VIGN = null;
  function makeVignette() {
    const cv = mk(320, 180), g = ctxOf(cv); if (!g) return null;
    const gr = g.createRadialGradient(160, 90, 40, 160, 90, 190); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = gr; g.fillRect(0, 0, 320, 180); return cv;
  }
  const NIGHT_C = [84, 104, 170], DAY_C = [255, 253, 246], WARM = [255, 150, 96];
  function drawDarkness(g) {
    const VW = C.VIEW_W, VH = C.VIEW_H, t = Game.time.real, sun = world.sun, night = world.night, fx = world.fx;
    // 1. multiply ambient colour
    let col = mixc(NIGHT_C, DAY_C, sun);
    const warmth = sin(PI * sun) * (world.phase === 'dusk' ? 0.8 : 0.66);
    col = mixc(col, WARM, warmth * (1 - fx.rain * 0.5));
    const grey = clamp(fx.rain * 0.6 + fx.drizzle * 0.38 + world.wet * 0.1, 0, 0.7);
    if (grey > 0) col = mixc(col, [176 * (0.4 + sun * 0.6) + 20, 190 * (0.4 + sun * 0.6) + 22, 214 * (0.4 + sun * 0.6) + 26], grey * sun + grey * 0.3 * night);
    if (col[0] < 249 || col[1] < 249 || col[2] < 249) { g.globalCompositeOperation = 'multiply'; g.fillStyle = css(col); g.fillRect(0, 0, VW, VH); g.globalCompositeOperation = 'source-over'; }
    // 2. lift the deepest shadows at night so the world stays readable
    if (night > 0.05) { g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(' + floor(14 * night) + ',' + floor(22 * night) + ',' + floor(44 * night) + ',1)'; g.fillRect(0, 0, VW, VH); g.globalCompositeOperation = 'source-over'; }
    // 3. light shafts / moon dapples (additive, parallaxed)
    const dA = sun * (1 - fx.rain * 0.9) * (1 - fx.fog * 0.5) * (1 - fx.drizzle * 0.4), mA = night * (1 - fx.rain * 0.8) * 0.55;
    const tile = dA > 0.05 ? SP.dapple : (mA > 0.05 ? SP.dapple2 : null);
    if (tile) {
      g.globalCompositeOperation = 'lighter';
      for (let layer = 0; layer < 2; layer++) {
        const sz = layer ? 760 : 1100, par = layer ? 0.5 : 0.28, ox = -(((cam.x * cam.zoom * par + t * (6 + 4 * layer)) % sz) + sz) % sz, oy = -(((cam.y * cam.zoom * par + t * (3 + layer * 3)) % sz) + sz) % sz;
        g.globalAlpha = (dA > 0.05 ? dA * 0.2 : mA * 0.16) * (layer ? 0.7 : 1) * (0.88 + 0.12 * sin(t * 0.4 + layer * 2));
        for (let x = ox - sz; x < VW; x += sz) for (let y = oy - sz; y < VH; y += sz) g.drawImage(tile, x - 1, y - 1, sz + 2, sz + 2);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // 4. moonlit pool around the spider at night
    if (night > 0.2 && SP.glow.cool) {
      const f = focusPos(), p = cam.worldToScreen(f.x, f.y);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.34 * night * (1 - fx.rain * 0.4);
      const s = 1000; g.drawImage(SP.glow.cool, p.x - s / 2, p.y - s / 2, s, s); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // 5. vignette
    if (VIGN) { g.globalAlpha = 0.32 + 0.38 * night + 0.1 * fx.rain; g.drawImage(VIGN, 0, 0, VW, VH); g.globalAlpha = 1; }
    // 6. lightning
    if (fx.flash > 0.01) { g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(200,215,255,' + (pow(fx.flash, 1.6) * 0.5).toFixed(3) + ')'; g.fillRect(0, 0, VW, VH); g.globalCompositeOperation = 'source-over'; }
  }

  // ============================================================================
  // MINIMAP TERRAIN (also the blurry stand-in while a chunk is still baking)
  // ============================================================================
  const FLOWER_DOT = [[255, 255, 255], [226, 44, 40], [240, 100, 170], [176, 130, 224], [250, 212, 50], [100, 112, 232], [250, 150, 30], [255, 214, 228]];
  function buildMinimap() {
    const MW = 480, MH = 270, cv = mk(MW, MH), g = ctxOf(cv); if (!g) return;
    const id = g.createImageData(MW, MH), d = id.data, sc = W / MW, zw = [0, 0, 0];
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const x = (i + 0.5) * sc, y = (j + 0.5) * sc; zoneW(x, y, zw);
      let r = 0, gg = 0, b = 0;
      if (zw[0] > 0.002) { const n = fbm(x * 0.012, y * 0.012, 61, 2), n2 = U.noise2(x * 0.09, y * 0.09, 62); const k = mixc([62, 44, 26], [128, 90, 48], n * 0.8 + n2 * 0.3); r += zw[0] * k[0]; gg += zw[0] * k[1]; b += zw[0] * k[2]; }
      if (zw[1] > 0.002) { const h = clamp(hBark(x, y), 0, 1.1), k0 = mixc([40, 31, 25], [126, 104, 84], clamp(h, 0, 1)), ln = fbm(x * 0.007, y * 0.006, 40, 3), mn = fbm(x * 0.0065, y * 0.0072, 42, 3); let k = mixc(k0, COL.lichen, sstep(0.6, 0.68, ln) * 0.6); k = mixc(k, [58, 96, 42], sstep(0.58, 0.66, mn) * 0.7); r += zw[1] * k[0]; gg += zw[1] * k[1]; b += zw[1] * k[2]; }
      if (zw[2] > 0.002) { const n = fbm(x * 0.008, y * 0.008, 51, 3), k = mixc([50, 78, 34], [104, 150, 62], n); r += zw[2] * k[0]; gg += zw[2] * k[1]; b += zw[2] * k[2]; }
      const o = (j * MW + i) * 4; d[o] = cl255(r); d[o + 1] = cl255(gg); d[o + 2] = cl255(b); d[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const k = MW / W; g.save(); g.scale(k, k);
    // leaves-as-confetti in the litter, twigs, rocks, flowers
    const rn = U.mulberry32(4242);
    for (const it of D.items) {
      if (it.k === 'leaf' && it.x < 2500 && it.z > 2 && rn() < 0.12) { g.fillStyle = css(LEAF_COLORS[it.spr ? it.spr.ck : 'brown'].base, 0.55); g.beginPath(); g.ellipse(it.x, it.y, LREF * it.sc * 0.4, LREF * it.sc * 0.18, it.rot, 0, TAU); g.fill(); }
      else if (it.k === 'twig') { g.strokeStyle = 'rgba(70,48,30,0.9)'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); it.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); }
      else if (it.k === 'rock') { g.fillStyle = 'rgba(140,136,128,0.9)'; g.beginPath(); g.arc(it.x, it.y, it.r * 1.1 + 6, 0, TAU); g.fill(); }
      else if (it.k === 'plate') { g.fillStyle = 'rgba(150,126,100,0.75)'; g.save(); g.translate(it.x, it.y); g.rotate(it.ang); g.fillRect(-it.w / 2 - 4, -it.h / 2, it.w + 8, it.h); g.restore(); }
    }
    D.flowers.forEach(f => { const c = FLOWER_DOT[f.type]; g.fillStyle = css(c, 0.28); g.beginPath(); g.arc(f.cx, f.cy, 66 * f.sc + 14, 0, TAU); g.fill(); g.fillStyle = css(c, 0.95); g.beginPath(); g.arc(f.cx, f.cy, 38 * f.sc + 14, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,220,80,0.95)'; g.beginPath(); g.arc(f.cx, f.cy, 15, 0, TAU); g.fill(); });
    g.restore();
    D.minimap = cv;
  }

  // ============================================================================
  // MODULE LIFECYCLE
  // ============================================================================
  let drawersAdded = false;
  world.init = function () {
    if (D.built) return;
    const t0 = now();
    canvasOK = !!mk(2, 2);
    if (canvasOK) {
      try { GRAIN = makeGrain(); VIGN = makeVignette(); buildSprites(); } catch (e) { Game.reportError('world.sprites', e); }
    }
    try { generate(); } catch (e) { Game.reportError('world.generate', e); }
    if (canvasOK) { try { buildMinimap(); } catch (e) { Game.reportError('world.minimap', e); } }
    D.built = true;
    if (!drawersAdded) {
      drawersAdded = true;
      if (canvasOK) {
        Game.addDrawer(Game.LAYER.BACKGROUND, drawTerrain);
        Game.addDrawer(Game.LAYER.GROUND, drawGround);
        Game.addDrawer(Game.LAYER.RESOURCES, drawResources);
        Game.addDrawer(Game.LAYER.SHELTER, drawShelterFx);
        Game.addDrawer(Game.LAYER.CANOPY, drawCanopy);
        Game.addDrawer(Game.LAYER.WEATHER, drawWeatherWorld);
        Game.addScreenDrawer(Game.LAYER.WEATHER, drawWeatherScreen);
        Game.addScreenDrawer(Game.LAYER.DARKNESS, drawDarkness);
      }
      Game.on('scene:change', (e) => { if (e && e.to === 'title') { world.time01 = 0.2; computeLight(); } });
    }
    // bake the chunks around the hatch point so the first frames never pop
    if (canvasOK) {
      try {
        const sx = floor(SPAWN.x / CH), sy = floor(SPAWN.y / CH);
        for (let cy = max(0, sy - 1); cy <= min(CROWS - 1, sy + 1); cy++) for (let cx = max(0, sx - 0); cx <= min(CCOLS - 1, sx + 1); cx++) chunkMake(cx, cy, 0);
      } catch (e) { Game.reportError('world.pregen', e); }
    }
    world.buildMs = now() - t0;
  };

  world.reset = function () {
    if (!D.built) world.init();
    world.time01 = 0.02; world.dayCount = 0; world.phase = null;
    const w = world.weather; w.type = 'clear'; w.intensity = 0; w.windX = 0.12; w.windY = 0.04;
    wS.phase = 'gap'; wS.timer = U.rand(60, 90); wS.thunder = 20; wS.pending.length = 0; wS.lastType = 'clear';
    const fx = world.fx; fx.rain = fx.drizzle = fx.fog = fx.wind = fx.flash = 0; world.wet = 0;
    D.resources.forEach(r => { r.amount = r.max; });
    D.canopy.forEach(c => { c.a = 1; c.ta = 1; c.inList = false; }); fading.length = 0;
    world.explored.fill(0);
    lastZone = null; expFrame = 0;
    world.markExplored(SPAWN.x, SPAWN.y, 320);
    computeLight();
  };

  world.update = function (dt) {
    world.time01 += dt / C.DAY_LENGTH;
    if (world.time01 >= 1) { world.time01 -= 1; world.dayCount++; }
    updateWeather(dt);
    computeLight();
    updateResources(dt);
    updateCanopy(dt);
    const f = focusPos();
    // zone tracking with hysteresis so the banner doesn't flicker on the border
    const zi = zoneIdAt(f.x, f.y), zs = ['litter', 'bark', 'garden'];
    if (lastZone === null) { lastZone = zi; Game.emit('zone:enter', { zone: zs[zi] }); }
    else if (zi !== lastZone) {
      const bnd = zi > lastZone ? [2400, 4200][lastZone] + 36 : [2400, 4200][zi] - 36;
      if ((zi > lastZone && f.x >= bnd) || (zi < lastZone && f.x <= bnd) || abs(zi - lastZone) > 1) { lastZone = zi; Game.emit('zone:enter', { zone: zs[zi] }); }
    }
    if ((expFrame++ & 3) === 0) { const P = Game.player, st = P && P.stage ? P.stage : 0; world.markExplored(f.x, f.y, 250 + st * 60); }
  };

  // Debug / test helper (also handy for other modules' tests): jump the clock or force weather.
  world.setTime = (t01) => { world.time01 = ((t01 % 1) + 1) % 1; computeLight(); };
  world.forceWeather = (type, intensity) => {
    const w = world.weather; setWeatherType(type); w.intensity = type === 'clear' ? 0 : (intensity == null ? 0.8 : intensity);
    wS.phase = type === 'clear' ? 'gap' : 'hold'; wS.timer = type === 'clear' ? 120 : 1e9;
    const fx = world.fx; fx.rain = fx.drizzle = fx.fog = fx.wind = 0; if (type !== 'clear') fx[type] = w.intensity; computeLight();
  };
  world._dbg = { D, SP, CC, renderChunk, chunkMake, wS, setFlush: (b) => { FLUSH = !!b; } };

  Game.register('world', world);
})();
