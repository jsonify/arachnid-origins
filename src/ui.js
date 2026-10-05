/* ============================================================================
 * Arachnid Origins  --  ui.js   (module `ui`, priority 100, alwaysUpdate)
 * Title, HUD, pause, molting, codex, game over, victory, science overlay.
 * Everything is drawn in code; nothing here ever throws at load time.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util, W = C.VIEW_W, H = C.VIEW_H;
  const clamp = U.clamp, lerp = U.lerp, smooth = U.smooth;

  // ------------------------------------------------------------------ theme
  const COL = {
    amber: '#f2b45a', amberHi: '#ffd58a', amberDim: '#a8742f', amberDeep: '#6b4a1f',
    text: '#f4ebdc', text2: '#c9b99f', text3: '#8d7f6b',
    panel: 'rgba(17,12,8,0.86)', panelSoft: 'rgba(17,12,8,0.62)', panelHi: 'rgba(36,26,16,0.92)',
    line: 'rgba(255,205,130,0.22)', lineSoft: 'rgba(255,205,130,0.10)',
    bad: '#e5604d', good: '#9bd65c', info: '#6fc9c0',
    hp: '#e0584c', hunger: '#e9863d', water: '#4eb3e6', energy: '#9bd65c', silk: '#d9d4ef', growth: '#f2b45a',
    prey: '#8fd35f', predator: '#e5604d', spider: '#b78cf0', neutral: '#c9b99f', resource: '#6fb36f', player: '#f2b45a',
  };
  const SERIF = 'Georgia, "Times New Roman", serif';
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const CAT_COL = { anatomy: '#6fc9c0', behavior: '#e8a860', ecosystem: '#8fd35f', lifecycle: '#d99bd6', silk: '#cfd6f2', adaptation: '#f0cf62' };
  const CAT_NAME = { anatomy: 'Anatomy', behavior: 'Behavior', ecosystem: 'Ecosystem', lifecycle: 'Life Cycle', silk: 'Silk & Webs', adaptation: 'Adaptation' };

  // ----------------------------------------------------------- tiny helpers
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const P = () => Game.player || null;
  const real = () => Game.time.real;
  const sfx = (name) => Game.emit('sfx', { name });
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; };
  const titleize = (id) => String(id).replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
  const inRect = (x, y, r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const stageName = (i) => (C.STAGES[i] && C.STAGES[i].name) || 'Spider';
  const KINDS = () => (Game.creatures && Game.creatures.KINDS) || null;

  function setFont(ctx, size, weight, fam, italic) { ctx.font = (italic ? 'italic ' : '') + (weight || 400) + ' ' + size + 'px ' + (fam || SANS); }

  // single line of text. o: size weight font italic color align base alpha shadow
  function txt(ctx, s, x, y, o) {
    o = o || {};
    setFont(ctx, o.size || 16, o.weight, o.font, o.italic);
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    const ga = ctx.globalAlpha; if (o.alpha != null) ctx.globalAlpha = ga * o.alpha;
    if (o.shadow) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(s, x + 1, y + 1.5); }
    ctx.fillStyle = o.color || COL.text; ctx.fillText(s, x, y);
    ctx.globalAlpha = ga;
  }
  function measure(ctx, s, size, weight, fam, italic) { setFont(ctx, size, weight, fam, italic); return ctx.measureText(s).width; }

  // text spaced out letter by letter (titles)
  function spaced(ctx, s, cx, y, spacing, o) {
    o = o || {}; setFont(ctx, o.size || 20, o.weight, o.font, o.italic);
    let total = 0; const ws = []; for (let i = 0; i < s.length; i++) { const w = ctx.measureText(s[i]).width; ws.push(w); total += w + (i < s.length - 1 ? spacing : 0); }
    let x = o.align === 'left' ? cx : (o.align === 'right' ? cx - total : cx - total / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = o.base || 'alphabetic';
    for (let i = 0; i < s.length; i++) { ctx.fillStyle = o.color || COL.text; ctx.fillText(s[i], x, y); x += ws[i] + spacing; }
    return total;
  }

  // ellipsize a single line to a pixel width
  function fit(ctx, s, maxW, size, weight, fam, italic) {
    setFont(ctx, size, weight, fam, italic);
    if (ctx.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
    return s.slice(0, lo).replace(/\s+$/, '') + '…';
  }

  // greedy word wrap with cache. Returns array of lines.
  const wrapCache = new Map();
  function wrap(ctx, s, maxW, size, weight, fam, italic) {
    s = String(s == null ? '' : s);
    const key = size + '|' + (weight || 400) + '|' + (fam || '') + '|' + (italic ? 1 : 0) + '|' + Math.round(maxW) + '|' + s;
    const hit = wrapCache.get(key); if (hit) return hit;
    setFont(ctx, size, weight, fam, italic);
    const out = [];
    const paras = s.split('\n');
    for (let pi = 0; pi < paras.length; pi++) {
      const words = paras[pi].split(/\s+/).filter(w => w.length);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (let wi = 0; wi < words.length; wi++) {
        let w = words[wi];
        // break words that are wider than the box
        while (ctx.measureText(w).width > maxW && w.length > 1) {
          let k = w.length - 1; while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width <= maxW) line = test; else { if (line) out.push(line); line = w; }
      }
      if (line) out.push(line);
    }
    if (wrapCache.size > 800) wrapCache.clear();
    wrapCache.set(key, out);
    return out;
  }
  // draw wrapped paragraph; returns bottom y. o: size weight font italic color lh maxLines align alpha
  function para(ctx, s, x, y, maxW, o) {
    o = o || {}; const size = o.size || 15, lh = o.lh || Math.round(size * 1.42);
    let lines = wrap(ctx, s, maxW, size, o.weight, o.font, o.italic);
    if (o.maxLines && lines.length > o.maxLines) {
      lines = lines.slice(0, o.maxLines);
      lines[o.maxLines - 1] = fit(ctx, lines[o.maxLines - 1] + ' …', maxW, size, o.weight, o.font, o.italic);
    }
    const ax = o.align === 'center' ? x + maxW / 2 : x;
    for (let i = 0; i < lines.length; i++) txt(ctx, lines[i], ax, y + size + i * lh - 2, { size, weight: o.weight, font: o.font, italic: o.italic, color: o.color || COL.text2, align: o.align === 'center' ? 'center' : 'left', alpha: o.alpha, shadow: o.shadow });
    return y + lines.length * lh;
  }
  const paraH = (ctx, s, maxW, o) => { o = o || {}; const size = o.size || 15, lh = o.lh || Math.round(size * 1.42); let n = wrap(ctx, s, maxW, size, o.weight, o.font, o.italic).length; if (o.maxLines) n = Math.min(n, o.maxLines); return n * lh; };

  // rounded-rect path
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function panel(ctx, x, y, w, h, o) {
    o = o || {}; const r = o.r == null ? 12 : o.r;
    rr(ctx, x, y, w, h, r); ctx.fillStyle = o.fill || COL.panel; ctx.fill();
    if (!o.flat) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,224,170,0.07)'); g.addColorStop(0.5, 'rgba(255,224,170,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.16)'); rr(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill(); }
    ctx.lineWidth = o.bw || 1; ctx.strokeStyle = o.border || COL.line; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
    if (o.accent) { ctx.fillStyle = o.accent; rr(ctx, x + 1, y + 8, 3, h - 16, 1.5); ctx.fill(); }
  }
  function chip(ctx, s, x, y, color, o) {
    o = o || {}; const size = o.size || 11, h = o.h || size + 9;
    const w = measure(ctx, s, size, 600) + 14;
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = o.fill || U.rgba(color.length === 7 ? color : '#c9b99f', 0.16); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = U.rgba(color.length === 7 ? color : '#c9b99f', 0.5); rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2); ctx.stroke();
    txt(ctx, s, x + w / 2, y + h / 2 + 0.5, { size, weight: 600, color, align: 'center', base: 'middle' });
    return w;
  }
  function keycap(ctx, label, x, y, o) {
    o = o || {}; const h = o.h || 22, size = o.size || Math.round(h * 0.54);
    const w = Math.max(h, measure(ctx, label, size, 700) + 14);
    rr(ctx, x, y + 1, w, h, 5); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    rr(ctx, x, y, w, h - 1, 5); const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,245,225,0.20)'); g.addColorStop(1, 'rgba(255,245,225,0.08)'); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = o.color ? o.color : 'rgba(255,230,190,0.45)'; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 2, 5); ctx.stroke();
    txt(ctx, label, x + w / 2, y + (h - 1) / 2 + 0.5, { size, weight: 700, color: o.textColor || COL.amberHi, align: 'center', base: 'middle' });
    return w;
  }
  function bar(ctx, x, y, w, h, f, color, o) {
    o = o || {}; f = clamp(f, 0, 1);
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    if (f > 0.001) {
      const fw = Math.max(h, w * f);
      ctx.save(); rr(ctx, x, y, w, h, h / 2); ctx.clip();
      const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, o.light || color); g.addColorStop(1, color);
      ctx.fillStyle = g; rr(ctx, x, y, fw, h, h / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y + 1, fw, Math.max(1, h * 0.28));
      ctx.restore();
    }
    ctx.lineWidth = 1; ctx.strokeStyle = o.border || 'rgba(255,255,255,0.14)'; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2); ctx.stroke();
  }

  // ------------------------------------------------------------------ icons
  // All icons are authored in a 24x24 box centred on (0,0) and scaled to `s` px.
  function icon(ctx, name, x, y, s, color, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24);
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    switch (name) {
      case 'heart':
        ctx.beginPath(); ctx.moveTo(0, 9); ctx.bezierCurveTo(-14, -1, -8, -11, 0, -4); ctx.bezierCurveTo(8, -11, 14, -1, 0, 9); ctx.fill(); break;
      case 'bug':
        ctx.beginPath(); ctx.ellipse(0, 2.5, 5.5, 7.5, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -6, 3.6, 0, 7); ctx.fill();
        ctx.lineWidth = 1.7; ctx.beginPath();
        for (let i = -1; i <= 1; i++) { const yy = 1 + i * 4.6; ctx.moveTo(-4.5, yy); ctx.lineTo(-10.5, yy + i * 3 - 2); ctx.moveTo(4.5, yy); ctx.lineTo(10.5, yy + i * 3 - 2); }
        ctx.stroke(); break;
      case 'drop':
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.bezierCurveTo(8, -1, 9.5, 3.5, 5.5, 8); ctx.bezierCurveTo(2.5, 11.5, -2.5, 11.5, -5.5, 8); ctx.bezierCurveTo(-9.5, 3.5, -8, -1, 0, -11); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-2.6, 3.6, 1.6, 3, 0.4, 0, 7); ctx.fill(); break;
      case 'bolt':
        ctx.beginPath(); ctx.moveTo(3.5, -11.5); ctx.lineTo(-6.5, 2); ctx.lineTo(-1, 2); ctx.lineTo(-3.5, 11.5); ctx.lineTo(6.5, -3); ctx.lineTo(1, -3); ctx.closePath(); ctx.fill(); break;
      case 'silk':
        ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 10.5, Math.sin(a) * 10.5); }
        ctx.stroke();
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3 - Math.PI / 2, r = k * 3.5; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke(); }
        break;
      case 'growth':
        ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-7, 2); ctx.lineTo(0, -5); ctx.lineTo(7, 2); ctx.moveTo(-7, 9); ctx.lineTo(0, 2); ctx.lineTo(7, 9); ctx.stroke(); break;
      case 'lock':
        ctx.beginPath(); rr(ctx, -7, -1, 14, 11, 2.5); ctx.fill();
        ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke(); break;
      case 'check':
        ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(-8, 1); ctx.lineTo(-2.5, 7); ctx.lineTo(8.5, -7); ctx.stroke(); break;
      case 'eye':
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.quadraticCurveTo(0, -11, 11, 0); ctx.quadraticCurveTo(0, 11, -11, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, 7); ctx.fill(); break;
      case 'book':
        ctx.beginPath(); ctx.moveTo(-11, -7); ctx.quadraticCurveTo(-5, -9, 0, -5); ctx.quadraticCurveTo(5, -9, 11, -7); ctx.lineTo(11, 8); ctx.quadraticCurveTo(5, 6, 0, 10); ctx.quadraticCurveTo(-5, 6, -11, 8); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 10); ctx.stroke(); break;
      case 'sun':
        ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, 7); ctx.fill(); ctx.lineWidth = 2;
        ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 11.2, Math.sin(a) * 11.2); } ctx.stroke(); break;
      case 'moon':
        ctx.beginPath(); ctx.arc(0, 0, 9, 0.55, Math.PI * 2 - 0.55); ctx.arc(4.6, -1.6, 7.4, Math.PI * 2 - 1.0, 1.0, true); ctx.closePath(); ctx.fill(); break;
      case 'cloud':
        ctx.beginPath(); ctx.arc(-4.5, 2, 4.8, Math.PI * 0.5, Math.PI * 1.5); ctx.arc(-0.5, -3, 6, Math.PI, Math.PI * 1.9); ctx.arc(5.5, 1.2, 5, Math.PI * 1.5, Math.PI * 0.5); ctx.closePath(); ctx.fill(); break;
      case 'rain':
        icon(ctx, 'cloud', 0, -3, 24, color); ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(-5, 8); ctx.lineTo(-7, 12); ctx.moveTo(0, 8); ctx.lineTo(-2, 12); ctx.moveTo(5, 8); ctx.lineTo(3, 12); ctx.stroke(); break;
      case 'wind':
        ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-11, -4); ctx.lineTo(4, -4); ctx.arc(4, -7, 3, Math.PI / 2, -Math.PI * 0.9, true);
        ctx.moveTo(-11, 2); ctx.lineTo(8, 2); ctx.arc(8, 5, 3, -Math.PI / 2, Math.PI * 0.9);
        ctx.moveTo(-11, 8); ctx.lineTo(0, 8); ctx.stroke(); break;
      case 'fog':
        ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(10, -6); ctx.moveTo(-7, -1); ctx.lineTo(11, -1); ctx.moveTo(-10, 4); ctx.lineTo(8, 4); ctx.moveTo(-6, 9); ctx.lineTo(9, 9); ctx.stroke(); break;
      case 'star':
        ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.6 : 11; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); break;
      case 'chevrons': // speed
        ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(-1, 0); ctx.lineTo(-9, 8); ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.stroke(); break;
      case 'leaf':
        ctx.beginPath(); ctx.moveTo(-9, 9); ctx.bezierCurveTo(-11, -4, 0, -11, 10, -10); ctx.bezierCurveTo(11, 0, 4, 11, -9, 9); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-8, 8); ctx.lineTo(5, -5); ctx.stroke(); break;
      case 'fang':
        ctx.beginPath(); ctx.moveTo(-8, -9); ctx.quadraticCurveTo(-8, 4, -1, 11); ctx.quadraticCurveTo(0, 2, 2, -9); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(3, -9); ctx.quadraticCurveTo(3, 3, 9, 8); ctx.quadraticCurveTo(10, 0, 9, -9); ctx.closePath(); ctx.globalAlpha = 0.6; ctx.fill(); break;
      case 'shield':
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, -7); ctx.lineTo(8, 3); ctx.quadraticCurveTo(6, 9, 0, 12); ctx.quadraticCurveTo(-6, 9, -8, 3); ctx.lineTo(-9, -7); ctx.closePath(); ctx.fill(); break;
      case 'waves':
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, 7); ctx.fill();
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(0, 0, 3 + k * 3, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 3 + k * 3, Math.PI - 0.8, Math.PI + 0.8); ctx.stroke(); }
        break;
      case 'flame':
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.bezierCurveTo(8, -4, 9, 3, 5, 8); ctx.bezierCurveTo(3, 11, -3, 11, -5, 8); ctx.bezierCurveTo(-9, 3, -5, -3, -2, -5); ctx.bezierCurveTo(-2, -2, 0, -3, 0, -12); ctx.fill(); break;
      case 'bone': // generic
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill(); break;
      case 'spiderling':
        spiderGlyph(ctx, 0, 0, 12, 0, { color: color, noGlow: true }); break;
      case 'arrow':
        ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(9, 0); ctx.lineTo(-9, 6); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill(); break;
      case 'x':
        ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke(); break;
      default: ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  const UPGRADE_ICON = { speed: 'chevrons', silk: 'silk', camo: 'leaf', venom: 'fang', carapace: 'shield', vibration: 'waves', metabolism: 'flame' };
  const WEB_ICON_ORDER = ['line', 'sheet', 'orb', 'retreat'];

  // a little top-down spider (used for the title, victory scene, fallbacks)
  function spiderGlyph(ctx, x, y, s, t, o) {
    o = o || {}; const col = o.color || '#1c1511';
    ctx.save(); ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot);
    if (!o.noGlow && !o.flat) { const g = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 2.4); g.addColorStop(0, 'rgba(242,180,90,0.22)'); g.addColorStop(1, 'rgba(242,180,90,0)'); ctx.fillStyle = g; ctx.fillRect(-s * 2.4, -s * 2.4, s * 4.8, s * 4.8); }
    ctx.strokeStyle = o.legColor || col; ctx.lineWidth = Math.max(1.2, s * 0.13); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const base = -0.75 + i * 0.5, wob = Math.sin((t || 0) * 2 + i * 1.7 + side) * 0.07;
        const a1 = base * side * 0.9 + wob;
        const ax = side * s * 0.35, ay = -s * 0.28 + i * s * 0.2;
        const kx = ax + side * Math.cos(a1 - 0.5 * side * 0.1) * s * (1.0 - Math.abs(i - 1.5) * 0.08), ky = ay + (i - 1.5) * s * 0.55 - s * 0.55;
        const tx = kx + side * s * (0.75 + (i === 1 || i === 2 ? 0.15 : 0)), ty = ky + (i - 1.5) * s * 0.65 + s * 0.45 + wob * s;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ky); ctx.lineTo(tx, ty); ctx.stroke();
      }
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0, s * 0.72, s * 0.62, s * 0.82, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -s * 0.16, s * 0.42, s * 0.5, 0, 0, 7); ctx.fill();
    if (!o.flat) {
      ctx.fillStyle = o.mark || 'rgba(242,180,90,0.55)';
      ctx.beginPath(); ctx.ellipse(0, s * 0.7, s * 0.2, s * 0.45, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,210,0.85)';
      for (let i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.arc(i * s * 0.14, -s * 0.5, Math.max(0.8, s * 0.07), 0, 7); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.ellipse(-s * 0.18, s * 0.5, s * 0.14, s * 0.4, 0.2, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------- creature / web portraits
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const kindColor = (k, id) => (k && k.color && /^#[0-9a-f]{6}$/i.test(k.color)) ? k.color : ({ prey: '#8fb86a', predator: '#c9604d', spider: '#a58ad8', neutral: '#b9a78a' }[(k && k.role)] || '#b9a78a');

  function fallbackGlyph(ctx, id, x, y, size, o) {
    o = o || {}; const K = KINDS(), k = K && K[id], r = hashStr(String(id));
    const s = size * 0.5, sil = !!o.silhouette, col = sil ? '#17110c' : kindColor(k, id);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.5 + r * 0.3);
    if ((k && k.role === 'spider') || /spider/i.test(String(id))) {
      spiderGlyph(ctx, 0, -s * 0.05, s * 0.66, 0, { color: col, legColor: col, flat: sil, noGlow: true, mark: 'rgba(255,255,255,0.35)' });
      ctx.restore(); return;
    }
    const flying = !!(k && k.flying);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.07); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) { ctx.moveTo(-s * 0.22, i * s * 0.28); ctx.lineTo(-s * 0.62, i * s * 0.5 + (i ? i * s * 0.1 : 0)); ctx.moveTo(s * 0.22, i * s * 0.28); ctx.lineTo(s * 0.62, i * s * 0.5 + (i ? i * s * 0.1 : 0)); }
    ctx.moveTo(-s * 0.08, -s * 0.62); ctx.lineTo(-s * 0.28, -s * 0.98); ctx.moveTo(s * 0.08, -s * 0.62); ctx.lineTo(s * 0.28, -s * 0.98);
    ctx.stroke();
    if (flying) { ctx.fillStyle = sil ? '#17110c' : 'rgba(220,235,255,0.55)'; for (let i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.ellipse(i * s * 0.55, -s * 0.05, s * 0.28, s * 0.62, i * 0.45, 0, 7); ctx.fill(); } }
    ctx.fillStyle = col;
    const bw = s * (0.34 + r * 0.16), bl = s * (0.55 + r * 0.2);
    ctx.beginPath(); ctx.ellipse(0, s * 0.28, bw, bl, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -s * 0.42, s * 0.24, s * 0.26, 0, 0, 7); ctx.fill();
    if (!sil) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(-bw * 0.35, s * 0.18, bw * 0.28, bl * 0.55, 0.1, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-bw * 0.9, s * 0.2, bw * 1.8, Math.max(1, s * 0.05)); ctx.fillRect(-bw * 0.8, s * 0.42, bw * 1.6, Math.max(1, s * 0.05)); }
    ctx.restore();
  }
  const silCache = {};
  function drawKind(ctx, id, x, y, size, o) {
    o = o || {}; const cr = Game.creatures;
    const useReal = cr && typeof cr.drawKindIcon === 'function' && !ui._iconBroken;
    if (!useReal) return fallbackGlyph(ctx, id, x, y, size, o);
    try {
      if (o.silhouette) {
        const key = id + '|' + Math.round(size); let c = silCache[key];
        if (!c) {
          c = U.makeCanvas(Math.ceil(size * 1.6), Math.ceil(size * 1.6));
          if (!c) return fallbackGlyph(ctx, id, x, y, size, o);
          const g = c.getContext('2d'); g.save(); cr.drawKindIcon(g, id, c.width / 2, c.height / 2, size, { silhouette: true }); g.restore();
          g.globalCompositeOperation = 'source-in'; g.fillStyle = '#17110c'; g.fillRect(0, 0, c.width, c.height);
          silCache[key] = c;
        }
        ctx.drawImage(c, x - c.width / 2, y - c.height / 2);
        return;
      }
      ctx.save(); cr.drawKindIcon(ctx, id, x, y, size, { silhouette: false }); ctx.restore();
    } catch (e) { ui._iconBroken = true; Game.reportError('ui.drawKind', e); fallbackGlyph(ctx, id, x, y, size, o); }
  }

  // small web-type glyphs for the hotbar
  function webGlyph(ctx, type, x, y, s, color) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, s * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const r = s * 0.46;
    if (type === 'line') {
      ctx.beginPath(); ctx.moveTo(-r, r * 0.6); ctx.quadraticCurveTo(0, r * 0.1, r, -r * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r, r * 0.6, s * 0.07, 0, 7); ctx.arc(r, -r * 0.6, s * 0.07, 0, 7); ctx.fill();
    } else if (type === 'sheet') {
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.15); ctx.lineTo(0, -r * 0.65); ctx.lineTo(r, -r * 0.15); ctx.lineTo(r * 0.6, r * 0.55); ctx.lineTo(-r * 0.6, r * 0.55); ctx.closePath(); ctx.stroke();
      ctx.lineWidth *= 0.6; ctx.beginPath(); for (let i = -2; i <= 2; i++) { ctx.moveTo(i * r * 0.3, -r * 0.55 + Math.abs(i) * r * 0.1); ctx.lineTo(i * r * 0.22, r * 0.5); } ctx.moveTo(-r * 0.85, r * 0.1); ctx.lineTo(r * 0.85, r * 0.1); ctx.stroke();
    } else if (type === 'orb') {
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
      ctx.lineWidth *= 0.7;
      for (let k = 1; k <= 3; k++) { ctx.beginPath(); for (let i = 0; i <= 8; i++) { const a = i * Math.PI / 4, rr2 = r * k / 3.2; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr2, Math.sin(a) * rr2); } ctx.stroke(); }
    } else { // retreat: little silk tent
      ctx.beginPath(); ctx.moveTo(-r, r * 0.65); ctx.quadraticCurveTo(-r * 0.9, -r * 0.5, 0, -r * 0.8); ctx.quadraticCurveTo(r * 0.9, -r * 0.5, r, r * 0.65); ctx.closePath(); ctx.stroke();
      ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.ellipse(0, r * 0.25, r * 0.28, r * 0.3, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------- minimap fog
  const fog = { cv: null, g: null, img: null, gw: 0, gh: 0, t: -9, ok: false };
  function exploredAt(ex, cell, gw, cx, cy, twoD, fn) {
    if (fn) return fn(cx * cell + cell / 2, cy * cell + cell / 2) ? 1 : 0;
    return twoD ? (ex[cy] && ex[cy][cx] ? 1 : 0) : (ex[cy * gw + cx] ? 1 : 0);
  }
  function refreshFog() {
    const w = Game.world; fog.t = real();
    if (!w || !w.explored) { fog.ok = false; return; }
    const fn = typeof w.exploredCell === 'function' ? w.exploredCell : null;
    const cell = (typeof w.exploredCell === 'number' && w.exploredCell) || 64;
    const gw = Math.ceil(C.WORLD_W / cell), gh = Math.ceil(C.WORLD_H / cell);
    if (!fog.cv || fog.gw !== gw || fog.gh !== gh) {
      fog.cv = U.makeCanvas(gw, gh); if (!fog.cv) { fog.ok = false; return; }
      fog.g = fog.cv.getContext('2d'); fog.img = fog.g.createImageData(gw, gh); fog.gw = gw; fog.gh = gh;
    }
    const ex = w.explored, twoD = ex.length && typeof ex[0] === 'object', d = fog.img.data;
    for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
      const i = (cy * gw + cx) * 4, v = exploredAt(ex, cell, gw, cx, cy, twoD, fn);
      d[i] = 9; d[i + 1] = 7; d[i + 2] = 5; d[i + 3] = v ? 0 : 232;
    }
    fog.g.putImageData(fog.img, 0, 0); fog.ok = true;
  }

  // --------------------------------------------------------------- the module
  const ui = {
    priority: 100, alwaysUpdate: true,
    sub: null,                 // title/pause sub-panels: settings | howto | credits | confirmQuit
    idx: {},                   // focus index per menu key
    enterT: 0,                 // real-time the current scene was entered
    mapBig: false,
    toasts: [], banners: [], flash: 0, hint: { text: '', t0: 0, shownAt: 0, last: '' },
    stageCard: null, prompt: null, picked: null,
    molt: { offers: [], t0: 0, chosen: -1 },
    codex: { tab: 0, bsel: 0, bscroll: 0, cat: 0, escroll: 0, part: 0, fsel: 0 },
    death: { cause: null },
    drift: { x: 3000, y: 1800 },
    dragging: null,
    _rep: {}, _sliderT: 0, _promptT: 0, _pickT: 0,
    layers: {},
  };

  // ----------------------------------------------------------------- input
  function repeat(name, dt) {
    const I = Game.input, st = ui._rep[name] || (ui._rep[name] = { t: 0, on: false });
    if (I.pressed(name)) { st.t = 0.38; st.on = true; return true; }
    if (I.down(name) && st.on) { st.t -= dt; if (st.t <= 0) { st.t = 0.07; return true; } } else st.on = false;
    return false;
  }
  function readNav(dt) {
    const I = Game.input, m = I.mouse;
    return {
      up: repeat('menuUp', dt), down: repeat('menuDown', dt), left: repeat('menuLeft', dt), right: repeat('menuRight', dt),
      confirm: I.pressed('confirm'), back: I.pressed('back'), tabNext: I.pressed('tabNext'), tabPrev: I.pressed('tabPrev'),
      codex: I.pressed('codex'), pause: I.pressed('pause'),
      click: !!m.pressed, mx: m.x, my: m.y, moved: !!m.moved, wheel: m.wheel || 0, mdown: !!m.down,
    };
  }
  function setIdx(key, v, n) {
    v = ((v % n) + n) % n;
    if (ui.idx[key] !== v) { ui.idx[key] = v; sfx('ui_hover'); }
    return v;
  }
  // keyboard + mouse over a vertical list of rects. Returns the activated index or -1.
  function listInput(key, rects, nav, opts) {
    opts = opts || {};
    const n = rects.length; if (!n) return -1;
    if (ui.idx[key] == null) ui.idx[key] = 0;
    let i = ui.idx[key];
    if (nav.up) i = setIdx(key, i - 1, n);
    if (nav.down) i = setIdx(key, i + 1, n);
    if (opts.horizontal) { if (nav.left) i = setIdx(key, i - 1, n); if (nav.right) i = setIdx(key, i + 1, n); }
    if (nav.moved) for (let k = 0; k < n; k++) if (inRect(nav.mx, nav.my, rects[k])) { if (k !== i) i = setIdx(key, k, n); break; }
    if (nav.click) for (let k = 0; k < n; k++) if (inRect(nav.mx, nav.my, rects[k])) { ui.idx[key] = k; return k; }
    if (nav.confirm) return i;
    return -1;
  }
  const listRects = (n, cx, y, w, h, gap) => { const r = []; for (let i = 0; i < n; i++) r.push({ x: cx - w / 2, y: y + i * (h + gap), w, h }); return r; };

  function drawButton(ctx, r, label, focus, o) {
    o = o || {}; const t = real();
    const dis = o.disabled;
    ctx.save();
    if (focus && !dis) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      rr(ctx, r.x, r.y, r.w, r.h, 10);
      const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0); g.addColorStop(0, 'rgba(242,180,90,0.30)'); g.addColorStop(0.5, 'rgba(242,180,90,0.16)'); g.addColorStop(1, 'rgba(242,180,90,0.30)');
      ctx.fillStyle = 'rgba(30,21,12,0.92)'; ctx.fill(); rr(ctx, r.x, r.y, r.w, r.h, 10); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,205,130,' + (0.75 + 0.2 * pulse) + ')'; rr(ctx, r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5, 10); ctx.stroke();
      // side diamonds
      ctx.fillStyle = COL.amberHi;
      for (let s = -1; s <= 1; s += 2) { const dx = r.x + r.w / 2 + s * (r.w / 2 - 18); ctx.beginPath(); ctx.moveTo(dx, r.y + r.h / 2 - 4); ctx.lineTo(dx + 4, r.y + r.h / 2); ctx.lineTo(dx, r.y + r.h / 2 + 4); ctx.lineTo(dx - 4, r.y + r.h / 2); ctx.closePath(); ctx.fill(); }
    } else {
      rr(ctx, r.x, r.y, r.w, r.h, 10); ctx.fillStyle = dis ? 'rgba(14,10,7,0.6)' : 'rgba(18,13,9,0.78)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = COL.line; rr(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10); ctx.stroke();
    }
    txt(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 1, { size: o.size || 18, weight: focus ? 700 : 600, color: dis ? COL.text3 : (focus ? COL.amberHi : COL.text), align: 'center', base: 'middle' });
    if (o.sub) txt(ctx, o.sub, r.x + r.w - 14, r.y + r.h / 2 + 1, { size: 12, color: COL.text3, align: 'right', base: 'middle' });
    ctx.restore();
  }

  // ------------------------------------------------------------- toasts etc.
  function pushToast(t) { t.t0 = real(); t.dur = t.dur || 5.5; ui.toasts.push(t); if (ui.toasts.length > 3) ui.toasts.shift(); }
  function pushBanner(b) { b.t0 = null; b.dur = b.dur || 4; ui.banners.push(b); if (ui.banners.length > 3) ui.banners.shift(); }
  const ZONE_SUB = { litter: 'Where the forest floor recycles itself', bark: 'A vertical world of ridges and crevices', garden: 'Nectar, petals and wings' };
  const PHASE_BANNER = { night: ['Night falls', 'Some creatures sleep, others wake'], dawn: ['Dawn', 'Dew beads on every thread'], dusk: ['Dusk', 'Light fades; the hunt changes'] };

  // measuring context (so layout code can wrap text outside of drawing)
  let _mctx = null;
  function mctx() {
    if (_mctx) return _mctx;
    const c = U.makeCanvas(4, 4); _mctx = c && c.getContext ? c.getContext('2d') : Game.ctx;
    return _mctx;
  }

  // ------------------------------------------------------------- menu data
  const TITLE_ITEMS = [
    { id: 'new', label: 'New Game' }, { id: 'settings', label: 'Settings' }, { id: 'howto', label: 'How to Play' },
    { id: 'bestiary', label: 'Bestiary' }, { id: 'credits', label: 'Credits' },
  ];
  const PAUSE_ITEMS = [
    { id: 'resume', label: 'Resume' }, { id: 'settings', label: 'Settings' }, { id: 'howto', label: 'How to Play' },
    { id: 'bestiary', label: 'Bestiary & Codex' }, { id: 'quit', label: 'Quit to Title' },
  ];
  const SETTINGS_ROWS = [
    { key: 'master', label: 'Master volume', type: 'slider' },
    { key: 'music', label: 'Music', type: 'slider' },
    { key: 'sfx', label: 'Sound effects', type: 'slider' },
    { key: 'muted', label: 'Mute all audio', type: 'toggle' },
    { key: 'screenShake', label: 'Screen shake', type: 'toggle' },
    { key: 'mouseAim', label: 'Mouse aim (FPS controls)', type: 'toggle', desc: 'Face the cursor; WASD strafes' },
    { key: 'keyGuide', label: 'Key guide panel', type: 'toggle', desc: 'H in game' },
    { key: 'science', label: 'Science Mode', type: 'toggle', desc: 'F in game' },
    { key: 'hints', label: 'Gameplay hints', type: 'toggle' },
  ];

  const titleRects = () => listRects(TITLE_ITEMS.length, W / 2, 312, 330, 48, 11);
  const pauseRects = () => listRects(PAUSE_ITEMS.length, W / 2, 262, 340, 50, 11);
  function settingsLayout() {
    const w = 660, rowH = 44, gap = 6, h = 84 + SETTINGS_ROWS.length * (rowH + gap) + 92, x = (W - w) / 2, y = Math.round((H - h) / 2);
    const rows = SETTINGS_ROWS.map((def, i) => {
      const r = { x: x + 28, y: y + 78 + i * (rowH + gap), w: w - 56, h: rowH };
      return { def, r, track: { x: r.x + 270, y: r.y + rowH / 2 - 6, w: 250, h: 12 }, sw: { x: r.x + r.w - 54, y: r.y + rowH / 2 - 14, w: 52, h: 28 } };
    });
    const back = { x: W / 2 - 110, y: y + h - 78, w: 220, h: 44 };
    return { x, y, w, h, rows, back };
  }
  function modeLayout() {
    const b = { x: (W - 840) / 2, y: 110, w: 840, h: 500 }, n = C.MODES.length, cw = 372, ch = 300, gap = 36, x0 = b.x + (b.w - (n * cw + (n - 1) * gap)) / 2;
    return { b, cards: C.MODES.map((m, i) => ({ x: x0 + i * (cw + gap), y: b.y + 84, w: cw, h: ch })) };
  }
  const subBackRect = (py, ph) => ({ x: W / 2 - 110, y: py + ph - 62, w: 220, h: 44 });
  const confirmRects = () => [{ x: W / 2 - 250, y: 392, w: 240, h: 48 }, { x: W / 2 + 10, y: 392, w: 240, h: 48 }];
  const endRects = (y) => [{ x: W / 2 - 250, y, w: 240, h: 52 }, { x: W / 2 + 10, y, w: 240, h: 52 }];

  // ------------------------------------------------------------ module hooks
  ui.init = function () {
    if (ui._inited) return; ui._inited = true;
    Game.on('scene:change', (d) => onSceneChange(d));
    Game.on('game:new', () => {
      const z = safe(() => Game.world.zoneAt(P().x, P().y), null) || C.ZONES[0];
      pushBanner({ title: z.name, sub: ZONE_SUB[z.id] || '', kind: 'zone' });
    });
    Game.on('fact:unlock', (d) => {
      const f = safe(() => Game.edu.fact(d.id), null);
      pushToast({ kind: 'fact', title: (d && d.title) || (f && f.title) || 'New fact', cat: (f && f.category) || 'anatomy', dur: 6 });
    });
    Game.on('objective:complete', (d) => {
      const o = safe(() => Game.edu.objectives.find(x => x.id === d.id), null);
      pushToast({ kind: 'obj', title: 'Objective complete', sub: o ? o.text : '', reward: o && o.reward ? o.reward.growth : 0, dur: 4.5 });
    });
    Game.on('objective:new', (d) => { ui.newObj = ui.newObj || {}; ui.newObj[d.id] = real(); });
    Game.on('player:damaged', (d) => {
      const p = P(); const mh = (p && p.maxHp) || 50;
      ui.flash = clamp(0.35 + ((d && d.amount) || 1) / mh * 2.5, 0.35, 1);
      ui.flashT = real();
    });
    Game.on('zone:enter', (d) => {
      const z = C.ZONES.find(zz => zz.id === (d && d.zone)); if (!z) return;
      pushBanner({ title: z.name, sub: ZONE_SUB[z.id] || '', kind: 'zone' });
    });
    Game.on('day:phase', (d) => {
      const b = PHASE_BANNER[d && d.phase]; if (!b || Game.time.t < 3) return;
      pushBanner({ title: b[0], sub: b[1], kind: 'phase', dur: 3.2 });
    });
    Game.on('stage:change', (d) => {
      if (!d || !(d.stage > 0)) return;
      ui.stageCard = { stage: d.stage, t0: real(), dur: 11 };
    });
    Game.on('player:died', (d) => { ui.death.cause = d && d.cause; });
    Game.on('player:downed', () => { pushBanner({ title: 'You are down', sub: 'A sibling rushes to your side...', kind: 'kin', dur: 2.2 }); });
    Game.on('player:revived', (d) => {
      const n = (d && d.left) || 0;
      ui.banners = ui.banners.filter(b => b.kind !== 'kin');   // replaces "You are down" at once instead of queueing behind it
      pushBanner({ title: 'A sibling gave its life', sub: n > 0 ? n + (n === 1 ? ' sibling' : ' siblings') + ' left to watch over you' : 'No siblings are left to save you again', kind: 'kin', dur: 4.5 });
    });
    Game.on('molt:start', (d) => { ui.moltInfo = d || null; });
    Game.addScreenDrawer(Game.LAYER.HUD, drawHUDLayer);
    Game.addScreenDrawer(Game.LAYER.MENU, drawMenuLayer);
    Game.addScreenDrawer(Game.LAYER.OVERLAY, drawOverlayLayer);
  };

  ui.reset = function () {
    ui.toasts = []; ui.banners = []; ui.flash = 0; ui.stageCard = null; ui.prompt = null; ui.picked = null; ui.newObj = {};
    ui.hint = { text: '', t0: 0, shownAt: 0, last: '' }; ui.sub = null; ui.idx = {}; ui.death = { cause: null }; ui.dragging = null;
    fog.t = -9; ui.molt = { offers: [], t0: 0, chosen: -1, stamp: -1 };
  };

  function onSceneChange(d) {
    ui.enterT = real(); ui.sub = null; ui.dragging = null;
    // keep the menu cursor when hopping between a menu and the codex
    const keep = {}; if ((d.from === 'codex' && (d.to === 'paused' || d.to === 'title')) || (d.to === 'codex' && (d.from === 'paused' || d.from === 'title'))) { if (ui.idx.pause != null) keep.pause = ui.idx.pause; if (ui.idx.title != null) keep.title = ui.idx.title; }
    ui.idx = keep;
    if (d.to === 'codex') { ui.codex.bscroll = 0; ui.codex.escroll = 0; }
    if (d.to === 'gameover') {
      if (!ui.death.cause) ui.death.cause = safe(() => P().deathCause, null);
      ui.final = snapshotStats();
    }
    if (d.to === 'victory') ui.final = snapshotStats();
    if (d.to === 'title') { Game.camera.targetZoom = 1.25; }
  }

  function snapshotStats() {
    const E = Game.edu, es = (E && E.stats) || {}, gs = Game.state.stats || {}, p = P() || {};
    const mx = (a, b) => Math.max(a || 0, b || 0);
    return {
      time: Game.time.t, stage: p.stage || 0,
      days: mx(safe(() => Game.world.dayCount, 0), Math.floor(Game.time.t / C.DAY_LENGTH)),
      eaten: mx(es.ate, gs.eaten), webs: mx(es.spun, gs.webs), trapped: mx(es.trapped, gs.trapped),
      molts: mx(es.molts, gs.moltCount), objectives: es.objectives || 0, dist: es.dist || 0,
      facts: safe(() => E.counts().unlocked, 0), factsTotal: safe(() => E.counts().total, 0),
      runFacts: safe(() => E.recent.length, 0), stageTimes: (E && E.stageTimes && E.stageTimes.slice()) || [],
    };
  }

  // =================================================================== update
  ui.update = function (dt) {
    const scene = Game.state.scene, I = Game.input;
    ui.scene = scene;
    const nav = readNav(dt);
    if (ui.flash > 0) ui.flash = Math.max(0, ui.flash - dt * 1.6);
    // the title camera drifts on its own target; everything else follows the player
    const cam = Game.camera;
    if (scene === 'title') {
      const t = real() * 0.02, d = ui.drift;
      d.x = 3200 + Math.sin(t) * 2500 + Math.sin(t * 2.3 + 1) * 280; d.y = 1800 + Math.sin(t * 0.77 + 1) * 850 + Math.sin(t * 1.9) * 120;
      if (cam.target !== d) cam.target = d;
    } else if (cam.target === ui.drift) cam.target = Game.player || null;

    switch (scene) {
      case 'title': updateTitle(nav); break;
      case 'playing': updatePlaying(nav, dt); break;
      case 'paused': updatePaused(nav, dt); break;
      case 'molting': updateMolting(nav); break;
      case 'codex': updateCodex(nav, dt); break;
      case 'gameover': updateEnd(nav, 'gameover'); break;
      case 'victory': updateEnd(nav, 'victory'); break;
      default: break;
    }
  };

  function updateTitle(nav) {
    if (ui.sub) return updateSub(nav, 'title');
    const act = listInput('title', titleRects(), nav);
    if (act < 0) return;
    sfx('ui_click');
    const id = TITLE_ITEMS[act].id;
    if (id === 'new') { ui.sub = 'mode'; ui.idx.mode = Math.max(0, C.MODES.findIndex(m => m.id === Game.settings.mode)); }   // choose a mode first; the last choice is highlighted
    else if (id === 'bestiary') { ui.codex.tab = 0; Game.setScene('codex'); }
    else { ui.sub = id; ui.idx[id] = 0; }
  }

  function updatePaused(nav, dt) {
    if (ui.sub) return updateSub(nav, 'paused');
    if (nav.back || nav.pause) { sfx('ui_back'); Game.resume(); return; }
    const act = listInput('pause', pauseRects(), nav);
    if (act < 0) return;
    const id = PAUSE_ITEMS[act].id; sfx(id === 'resume' ? 'ui_back' : 'ui_click');
    if (id === 'resume') Game.resume();
    else if (id === 'bestiary') { Game.setScene('codex'); }
    else if (id === 'quit') { ui.sub = 'confirmQuit'; ui.idx.confirmQuit = 1; }
    else { ui.sub = id; ui.idx[id] = 0; }
  }

  // settings / how-to / credits / confirm quit panels (shared by title and pause)
  function updateSub(nav, owner) {
    const sub = ui.sub;
    if (sub === 'confirmQuit') {
      if (nav.back || nav.pause) { sfx('ui_back'); ui.sub = null; return; }
      const act = listInput('confirmQuit', confirmRects(), nav, { horizontal: true });
      if (act === 0) { sfx('ui_click'); ui.sub = null; Game.toTitle(); } else if (act === 1) { sfx('ui_back'); ui.sub = null; }
      return;
    }
    if (nav.back || (owner === 'paused' && nav.pause)) { sfx('ui_back'); ui.sub = null; return; }
    if (sub === 'settings') return updateSettings(nav);
    if (sub === 'mode') return updateMode(nav);
    // howto / credits: a single Back button
    const pl = subPanelBox(sub), br = subBackRect(pl.y, pl.h);
    if (nav.confirm || (nav.click && inRect(nav.mx, nav.my, br))) { sfx('ui_back'); ui.sub = null; }
  }

  // New Game -> pick a mode (cards side by side; arrows / mouse to choose, Enter / click to begin)
  function startGame(mode) {
    ui.sub = null;
    if (Game.settings.mode !== mode) setSetting('mode', mode);   // remembered for next time and for Try Again
    Game.newGame(mode);
  }
  function updateMode(nav) {
    const L = modeLayout(), n = L.cards.length, key = 'mode';
    if (ui.idx[key] == null) ui.idx[key] = 0;
    let i = ui.idx[key];
    if (nav.left || nav.up) i = setIdx(key, i - 1, n);
    if (nav.right || nav.down) i = setIdx(key, i + 1, n);
    if (nav.moved) for (let k = 0; k < n; k++) if (inRect(nav.mx, nav.my, L.cards[k]) && k !== i) i = setIdx(key, k, n);
    if (nav.click) {
      if (inRect(nav.mx, nav.my, subBackRect(L.b.y, L.b.h))) { sfx('ui_back'); ui.sub = null; return; }
      for (let k = 0; k < n; k++) if (inRect(nav.mx, nav.my, L.cards[k])) { ui.idx[key] = k; sfx('ui_click'); startGame(C.MODES[k].id); return; }
    }
    if (nav.confirm) { sfx('ui_click'); startGame(C.MODES[i].id); }
  }

  function setSetting(key, v) {
    if (Game.settings[key] === v) return;
    Game.settings[key] = v; if (Game.saveSettings) Game.saveSettings();
    if (key === 'muted' && Game.audio && Game.audio.setMuted) safe(() => Game.audio.setMuted(v));
  }
  function updateSettings(nav) {
    const L = settingsLayout(), n = SETTINGS_ROWS.length + 1, key = 'settings';
    if (ui.idx[key] == null) ui.idx[key] = 0;
    let i = ui.idx[key];
    const s = Game.settings;
    // dragging a slider
    if (ui.dragging) {
      if (!nav.mdown) ui.dragging = null;
      else {
        const row = L.rows.find(r => r.def.key === ui.dragging);
        if (row) { const v = Math.round(clamp((nav.mx - row.track.x) / row.track.w, 0, 1) * 100) / 100; if (v !== s[row.def.key]) { setSetting(row.def.key, v); tickSlider(); } }
      }
      return;
    }
    if (nav.up) i = setIdx(key, i - 1, n);
    if (nav.down) i = setIdx(key, i + 1, n);
    if (nav.moved) {
      for (let k = 0; k < L.rows.length; k++) if (inRect(nav.mx, nav.my, L.rows[k].r)) { if (k !== i) i = setIdx(key, k, n); }
      if (inRect(nav.mx, nav.my, L.back) && i !== n - 1) i = setIdx(key, n - 1, n);
    }
    if (i < L.rows.length) {
      const row = L.rows[i], def = row.def;
      if (def.type === 'slider') {
        let dv = 0; if (nav.left) dv = -0.05; if (nav.right) dv = 0.05;
        if (dv) { setSetting(def.key, Math.round(clamp((s[def.key] || 0) + dv, 0, 1) * 100) / 100); tickSlider(); }
      } else if (nav.left || nav.right) { setSetting(def.key, !s[def.key]); sfx('ui_click'); }
      if (nav.confirm && def.type === 'toggle') { setSetting(def.key, !s[def.key]); sfx('ui_click'); }
    } else if (nav.confirm) { sfx('ui_back'); ui.sub = null; return; }
    if (nav.click) {
      for (let k = 0; k < L.rows.length; k++) {
        const row = L.rows[k];
        if (row.def.type === 'slider') {
          const hit = { x: row.track.x - 10, y: row.r.y, w: row.track.w + 20, h: row.r.h };
          if (inRect(nav.mx, nav.my, hit)) { ui.idx[key] = k; ui.dragging = row.def.key; setSetting(row.def.key, Math.round(clamp((nav.mx - row.track.x) / row.track.w, 0, 1) * 100) / 100); tickSlider(); return; }
        } else if (inRect(nav.mx, nav.my, row.r)) { ui.idx[key] = k; setSetting(row.def.key, !s[row.def.key]); sfx('ui_click'); return; }
      }
      if (inRect(nav.mx, nav.my, L.back)) { sfx('ui_back'); ui.sub = null; }
    }
  }
  function tickSlider() { if (real() - ui._sliderT > 0.07) { ui._sliderT = real(); sfx('ui_hover'); } }

  // ---------------------------------------------------------------- playing
  function updatePlaying(nav, dt) {
    const I = Game.input;
    if (nav.pause) { sfx('ui_click'); Game.pause(); return; }
    if (nav.codex) { sfx('ui_click'); Game.setScene('codex'); return; }
    if (I.pressed('map')) { ui.mapBig = !ui.mapBig; sfx('ui_click'); }
    if (I.pressed('guide')) { setSetting('keyGuide', !Game.settings.keyGuide); sfx('ui_click'); }
    if (I.pressed('science')) { setSetting('science', !Game.settings.science); sfx('ui_click'); }
    if (real() - fog.t > 0.4) refreshFog();
    ui._promptT -= dt; if (ui._promptT <= 0) { ui._promptT = 0.1; ui.prompt = computePrompt(); }
    ui._pickT -= dt; if (ui._pickT <= 0) { ui._pickT = 0.08; ui.picked = Game.settings.science ? pickEntity() : null; }
    updateHint();
  }

  function updateHint() {
    const h = ui.hint, now = real();
    if (!Game.settings.hints || Game.time.t > 420) { h.text = ''; return; }
    const tip = safe(() => Game.edu.tip(), '') || '';
    if (tip !== h.last) {
      // keep the current tip on screen for a minimum time before swapping
      if (!h.text || now - h.shownAt > 5 || !tip) { h.last = tip; h.text = tip; h.shownAt = now; h.t0 = now; }
    }
  }

  // ---------------------------------------------------------------- molting
  function fallbackOffers() {
    const lv = safe(() => P().upgrades, {}) || {}; const out = [];
    C.UPGRADES.forEach(u => { if ((lv[u.id] || 0) < u.max && out.length < 3) out.push(u.id); });
    return out;
  }
  function beginMolt() {
    const info = ui.moltInfo, p = P();
    let offers = (info && Array.isArray(info.offers) && info.offers.length) ? info.offers : (p && Array.isArray(p.offers) && p.offers.length ? p.offers : null);
    if (!offers) offers = safe(() => p.offerUpgrades(), null);
    if (!Array.isArray(offers) || !offers.length) offers = fallbackOffers();
    offers = offers.slice(0, 3);
    // molt:start reports the stage being molted INTO
    const into = (info && typeof info.stage === 'number') ? info.stage : Math.min(C.STAGES.length - 1, ((p && p.stage) || 0) + 1);
    ui.molt = { offers, t0: real(), chosen: -1, stamp: ui.enterT, into };
    ui.idx.molt = Math.min(1, offers.length - 1);
  }
  const moltCardRects = (n) => {
    const cw = 296, gap = 28, total = Math.max(1, n) * cw + (Math.max(1, n) - 1) * gap, x0 = (W - total) / 2;
    const r = []; for (let i = 0; i < Math.max(1, n); i++) r.push({ x: x0 + i * (cw + gap), y: 128, w: cw, h: 296 }); return r;
  };
  function chooseUpgrade(i) {
    const m = ui.molt; if (m.chosen >= 0) return;
    m.chosen = i; sfx('ui_click');
    const id = m.offers[i], pl = P();
    try {
      if (pl && pl.chooseUpgrade) {
        let ok = pl.chooseUpgrade(id);
        if (ok === false && Game.state.scene === 'molting') { // refused (e.g. maxed): offer any other legal upgrade
          const alt = fallbackOffers().concat(m.offers); for (let k = 0; k < alt.length && ok === false; k++) if (alt[k] !== id) ok = pl.chooseUpgrade(alt[k]);
        }
      }
    } catch (e) { Game.reportError('ui.chooseUpgrade', e); }
    if (Game.state.scene === 'molting') Game.setScene('playing');
  }
  function updateMolting(nav) {
    if (ui.molt.stamp !== ui.enterT) beginMolt();
    const m = ui.molt, rects = moltCardRects(m.offers.length), I = Game.input;
    if (real() - m.t0 < 0.8) return; // input lock so a Space-mash can't pick by accident
    const key = 'molt';
    for (let i = 0; i < m.offers.length; i++) if (I.keyPressed('Digit' + (i + 1)) || I.keyPressed('Numpad' + (i + 1))) { ui.idx[key] = i; chooseUpgrade(i); return; }
    const act = listInput(key, rects.slice(0, Math.max(1, m.offers.length)), nav, { horizontal: true });
    // up/down shouldn't wrap weirdly: listInput handles up/down as +-1 too, which is fine here
    if (act >= 0) chooseUpgrade(Math.min(act, m.offers.length - 1));
  }

  // ----------------------------------------------------------- game over etc.
  function updateEnd(nav, which) {
    const lock = real() - ui.enterT < (which === 'victory' ? 1.4 : 0.9);
    const rects = endRects(which === 'victory' ? 626 : (gameoverLayout().py + gameoverLayout().btnY));
    if (lock) return;
    const I = Game.input;
    if (which === 'gameover' && I.keyPressed('KeyR')) { sfx('ui_click'); Game.newGame(); return; }
    const act = listInput(which, rects, nav, { horizontal: true });
    if (act === 0) { sfx('ui_click'); Game.newGame(); } else if (act === 1) { sfx('ui_back'); Game.toTitle(); }
  }

  // ------------------------------------------------- interaction prompts
  function computePrompt() {
    const p = P(), w = Game.world; if (!p || p.dead || p.reviving || p.molting || !w) return null;
    const pr = p.radius || 8;
    // adult goals first
    const cr = Game.creatures;
    if (p.stage === 4 && p.mate) {
      const mate = cr && cr.mate;
      if (mate && !p.mate.courted && Math.hypot(mate.x - p.x, mate.y - p.y) < pr + (mate.radius || 12) + 70) {
        return (p.hunger > 35) ? { key: 'E', text: 'Court mate' } : { key: '!', text: 'Too hungry to court (need > 35% food)', warn: true };
      }
      if (p.mate.courted && !p.mate.laid && w.shelters) {
        for (let i = 0; i < w.shelters.length; i++) { const s = w.shelters[i]; if (s.eggSite && Math.hypot(s.x - p.x, s.y - p.y) < s.r + pr + 12) return { key: 'E', text: 'Lay egg sac' }; }
      }
    }
    if (w.nearestResource) {
      const dew = w.nearestResource(p.x, p.y, 'dew', pr + 18);
      if (dew && p.hydration < 98) return { key: 'E', text: 'Drink dew' };
      const nec = w.nearestResource(p.x, p.y, 'nectar', pr + 18);
      if (nec && p.hunger < 98) return { key: 'E', text: 'Sip nectar' };
    }
    if (w.shelterAt) {
      const inside = w.shelterAt(p.x, p.y);
      if (inside) return p.energy < 70 ? { key: 'R', text: 'Rest here', soft: true } : null;
      if (w.shelters) {
        let best = null, bd = 1e9;
        for (let i = 0; i < w.shelters.length; i++) { const s = w.shelters[i], d = Math.hypot(s.x - p.x, s.y - p.y) - s.r; if (d < bd) { bd = d; best = s; } }
        if (best && bd < pr + 14) return { key: 'E', text: 'Hide in shelter' };
      }
    }
    return null;
  }

  // what is the cursor pointing at (Science Mode)
  function pickEntity() {
    const m = Game.input.mouse, p = P(), cam = Game.camera; if (!p) return null;
    const wx = m.wx, wy = m.wy, tol = 14 / (cam.zoom || 1);
    let best = null, bd = 1e9;
    const cr = Game.creatures;
    if (cr && cr.list) for (let i = 0; i < cr.list.length; i++) {
      const c = cr.list[i]; if (!c || c.state === 'dead') continue;
      const d = Math.hypot(c.x - wx, c.y - wy) - (c.radius || 6);
      if (d < tol && d < bd) { bd = d; best = { type: 'creature', e: c, x: c.x, y: c.y, r: c.radius || 6 }; }
    }
    if (best) return best;
    if (Math.hypot(p.x - wx, p.y - wy) < (p.radius || 6) + tol) return { type: 'player', e: p, x: p.x, y: p.y, r: p.radius || 6 };
    const webs = Game.webs;
    if (webs && webs.nearestWeb) { const w = webs.nearestWeb(wx, wy, tol * 1.5); if (w) return { type: 'web', e: w, x: w.x != null ? w.x : (w.x1 + w.x2) / 2, y: w.y != null ? w.y : (w.y1 + w.y2) / 2, r: w.r || 20 }; }
    const wd = Game.world;
    if (wd && wd.nearestResource) { const r = wd.nearestResource(wx, wy, undefined, tol * 1.5 + 6); if (r) return { type: 'resource', e: r, x: r.x, y: r.y, r: r.r || 8 }; }
    if (wd && wd.shelters) for (let i = 0; i < wd.shelters.length; i++) { const s = wd.shelters[i]; if (Math.hypot(s.x - wx, s.y - wy) < s.r) return { type: 'shelter', e: s, x: s.x, y: s.y, r: s.r }; }
    return null;
  }

  // ================================================================ CODEX
  const CODEX = { x: 40, y: 36, w: 1200, h: 648 };
  const CODEX_TABS = ['Bestiary', 'Encyclopedia', 'Anatomy', 'Food Web'];
  const CONTENT = { x: 60, y: 100, w: 1160, h: 568 };
  const ROLE_ORDER = { prey: 0, neutral: 1, predator: 2, spider: 3 };

  function codexTabRects() {
    const ws = [190, 212, 150, 150], r = []; let x = CODEX.x + 22;
    for (let i = 0; i < 4; i++) { r.push({ x, y: CODEX.y + 14, w: ws[i], h: 38 }); x += ws[i] + 8; }
    return r;
  }
  function kindInfo(id) {
    const K = KINDS(); if (K && K[id]) return K[id];
    return { id, name: titleize(id), role: 'prey', diet: [] };
  }
  function bestiaryIds() {
    const K = KINDS(); let ids;
    if (K) ids = Object.keys(K);
    else ids = safe(() => Game.edu.foodWeb().nodes.filter(n => n.type === 'creature').map(n => n.id), []);
    return ids.map((id, i) => ({ id, i, o: ROLE_ORDER[(kindInfo(id).role) || 'prey'] != null ? ROLE_ORDER[kindInfo(id).role] : 1 })).sort((a, b) => a.o - b.o || a.i - b.i).map(x => x.id);
  }
  const isSeen = (id) => !!safe(() => Game.edu.hasSeen(id), false) || !!safe(() => Game.creatures.visibleKinds.has(id), false);
  const BEST = { x: 60, y: 128, cols: 6, cw: 104, ch: 116, gap: 10, vw: 674, vh: 540 };
  const BEST_DETAIL = { x: 764, y: 100, w: 456, h: 568 };
  function bestiaryGrid() {
    const ids = bestiaryIds(), rows = Math.ceil(ids.length / BEST.cols);
    const contentH = rows * (BEST.ch + BEST.gap) - BEST.gap, maxScroll = Math.max(0, contentH - BEST.vh);
    const sc = clamp(ui.codex.bscroll, 0, maxScroll);
    const cards = ids.map((id, i) => ({ id, x: BEST.x + (i % BEST.cols) * (BEST.cw + BEST.gap), y: BEST.y + Math.floor(i / BEST.cols) * (BEST.ch + BEST.gap) - sc, w: BEST.cw, h: BEST.ch }));
    return { ids, cards, maxScroll, scroll: sc, rows };
  }

  // encyclopedia
  const ENCY_COLS = { x: 326, y: 100, w: 894, h: 568, colW: 420, gap: 14 };
  const encyCache = {};
  function encyBase(cat) {
    const E = Game.edu; if (!E) return { cards: [], total: 0 };
    const cats = ['all'].concat(E.CATEGORIES.map(c => c.id));
    const cid = cats[cat] || 'all', key = cid + '|' + E.unlocked.size + '|' + E.FACTS.length;
    if (encyCache[key]) return encyCache[key];
    const g = mctx(), list = E.factsByCategory(cid === 'all' ? null : cid).map((f, i) => ({ f, i, u: E.unlocked.has(f.id) ? 0 : 1 })).sort((a, b) => a.u - b.u || a.i - b.i).map(x => x.f), colH = [0, 0], cards = [];
    const tw = ENCY_COLS.colW - 36;
    list.forEach(f => {
      const un = E.unlocked.has(f.id);
      const bodyH = un ? paraH(g, f.text, tw, { size: 14, lh: 19 }) : paraH(g, f.hint ? 'Hint: ' + f.hint : 'Not discovered yet.', tw, { size: 13, lh: 18 });
      const h = 14 + 24 + 6 + bodyH + 16;
      const col = colH[0] <= colH[1] ? 0 : 1;
      cards.push({ f, un, col, y: colH[col], h, x: ENCY_COLS.x + col * (ENCY_COLS.colW + ENCY_COLS.gap) });
      colH[col] += h + 12;
    });
    const res = { cards, total: Math.max(colH[0], colH[1]) };
    for (const k in encyCache) delete encyCache[k]; encyCache[key] = res;
    return res;
  }
  const encyCatRects = () => { const r = []; for (let i = 0; i < 7; i++) r.push({ x: 60, y: 100 + i * 58, w: 250, h: 52 }); return r; };
  const encyMaxScroll = () => Math.max(0, encyBase(ui.codex.cat).total - ENCY_COLS.h);

  // anatomy
  const ANAT = { dx: 90, dy: 108, S: 500, listX: 640, listW: 580, detail: { x: 640, y: 356, w: 580, h: 312 } };
  const anatPartPos = (p) => ({ x: ANAT.dx + p.x * ANAT.S, y: ANAT.dy + p.y * ANAT.S });
  const anatChipRects = (n) => { const r = []; for (let i = 0; i < n; i++) r.push({ x: ANAT.listX + (i % 2) * 295, y: 100 + Math.floor(i / 2) * 42, w: 285, h: 34 }); return r; };

  // food web
  const FWB = { x: 60, y: 100, w: 860, h: 568 }, FWI = { x: 934, y: 100, w: 286, h: 568 };
  function webLayout() {
    const E = Game.edu; if (!E) return null;
    const fw = E.foodWeb(), key = fw.nodes.length + '/' + fw.edges.length + '/' + fw.nodes.map(n => n.id).join(',');
    if (ui._fw && ui._fw.key === key) return ui._fw;
    const nodes = fw.nodes, maxL = Math.max(1, nodes.reduce((m, n) => Math.max(m, n.level), 0));
    const byLevel = []; for (let l = 0; l <= maxL; l++) byLevel.push([]);
    nodes.forEach(n => byLevel[n.level].push(n));
    const idx = {}; byLevel.forEach(lv => lv.forEach((n, i) => { idx[n.id] = i / Math.max(1, lv.length); }));
    const nb = {}; nodes.forEach(n => nb[n.id] = []);
    fw.edges.forEach(e => { if (!e.risk) { nb[e.from].push(e.to); nb[e.to].push(e.from); } });
    for (let pass = 0; pass < 4; pass++) {
      byLevel.forEach(lv => {
        lv.forEach(n => { const a = nb[n.id]; n._b = a.length ? a.reduce((s, id) => s + idx[id], 0) / a.length : idx[n.id]; });
        lv.sort((a, b) => a._b - b._b); lv.forEach((n, i) => { idx[n.id] = i / Math.max(1, lv.length); });
      });
    }
    const usableH = FWB.h - 150, pos = {}, order = [];
    for (let l = maxL; l >= 0; l--) {
      const lv = byLevel[l], y = FWB.y + 64 + (maxL - l) * (usableH / maxL);
      lv.forEach((n, i) => { pos[n.id] = { x: FWB.x + 60 + (FWB.w - 120) * (i + 0.5) / lv.length, y }; order.push(n.id); });
    }
    const L = { key, nodes, edges: fw.edges, pos, order, maxL, byId: {} };
    nodes.forEach(n => L.byId[n.id] = n);
    ui._fw = L; return L;
  }

  function closeCodex() {
    sfx('ui_back');
    const prev = Game.state.prevScene;
    Game.setScene(prev === 'paused' || prev === 'title' ? prev : 'playing');
  }

  function updateCodex(nav, dt) {
    const cx = ui.codex;
    if (nav.back || nav.codex) return closeCodex();
    if (nav.tabNext) { cx.tab = (cx.tab + 1) % 4; sfx('ui_hover'); }
    if (nav.tabPrev) { cx.tab = (cx.tab + 3) % 4; sfx('ui_hover'); }
    if (nav.click) { const tr = codexTabRects(); for (let i = 0; i < tr.length; i++) if (inRect(nav.mx, nav.my, tr[i]) && cx.tab !== i) { cx.tab = i; sfx('ui_click'); } }
    if (cx.tab === 0) updateBestiary(nav);
    else if (cx.tab === 1) updateEncy(nav);
    else if (cx.tab === 2) updateAnat(nav);
    else updateWeb(nav);
  }
  function updateBestiary(nav) {
    const cx = ui.codex, G = bestiaryGrid(), n = G.ids.length; if (!n) return;
    let s = clamp(cx.bsel, 0, n - 1); const old = s;
    if (nav.left) s = Math.max(0, s - 1);
    if (nav.right) s = Math.min(n - 1, s + 1);
    if (nav.up && s - BEST.cols >= 0) s -= BEST.cols;
    if (nav.down && s + BEST.cols < n) s += BEST.cols;
    if (nav.wheel) cx.bscroll = clamp(cx.bscroll + nav.wheel * 70, 0, G.maxScroll);
    if (nav.moved || nav.click) {
      for (let i = 0; i < G.cards.length; i++) { const c = G.cards[i]; if (c.y + c.h > BEST.y && c.y < BEST.y + BEST.vh && inRect(nav.mx, nav.my, c)) { s = i; break; } }
    }
    if (s !== old) sfx('ui_hover');
    cx.bsel = s;
    // keep selection in view when navigating by keyboard
    if (nav.left || nav.right || nav.up || nav.down) {
      const top = Math.floor(s / BEST.cols) * (BEST.ch + BEST.gap);
      if (top < cx.bscroll) cx.bscroll = top; else if (top + BEST.ch > cx.bscroll + BEST.vh) cx.bscroll = top + BEST.ch - BEST.vh;
    }
    cx.bscroll = clamp(cx.bscroll, 0, G.maxScroll);
  }
  function updateEncy(nav) {
    const cx = ui.codex, max = encyMaxScroll();
    if (nav.left) { cx.cat = (cx.cat + 6) % 7; cx.escroll = 0; sfx('ui_hover'); }
    if (nav.right) { cx.cat = (cx.cat + 1) % 7; cx.escroll = 0; sfx('ui_hover'); }
    if (nav.click) { const cr = encyCatRects(); for (let i = 0; i < cr.length; i++) if (inRect(nav.mx, nav.my, cr[i]) && cx.cat !== i) { cx.cat = i; cx.escroll = 0; sfx('ui_click'); } }
    if (nav.up) cx.escroll -= 80;
    if (nav.down) cx.escroll += 80;
    if (nav.wheel) cx.escroll += nav.wheel * 90;
    cx.escroll = clamp(cx.escroll, 0, encyMaxScroll());
  }
  function updateAnat(nav) {
    const cx = ui.codex, parts = safe(() => Game.edu.ANATOMY.parts, []), n = parts.length; if (!n) return;
    let s = clamp(cx.part, 0, n - 1); const old = s;
    if (nav.left || nav.up) s = (s + n - 1) % n;
    if (nav.right || nav.down) s = (s + 1) % n;
    if (nav.moved || nav.click) {
      parts.forEach((p, i) => { const q = anatPartPos(p); if (Math.hypot(nav.mx - q.x, nav.my - q.y) < 15) s = i; });
      anatChipRects(n).forEach((r, i) => { if (inRect(nav.mx, nav.my, r)) s = i; });
    }
    if (s !== old) sfx('ui_hover');
    cx.part = s;
  }
  function updateWeb(nav) {
    const cx = ui.codex, L = webLayout(); if (!L) return;
    let s = clamp(cx.fsel, 0, L.order.length - 1); const old = s;
    if (nav.left || nav.up) s = (s + L.order.length - 1) % L.order.length;
    if (nav.right || nav.down) s = (s + 1) % L.order.length;
    if (nav.moved || nav.click) L.order.forEach((id, i) => { const p = L.pos[id]; if (Math.hypot(nav.mx - p.x, nav.my - p.y) < 24) s = i; });
    if (s !== old) sfx('ui_hover');
    cx.fsel = s;
  }

  // ===================================================================== HUD
  function drawHUDLayer(ctx) {
    const sc = Game.state.scene;
    if (sc !== 'playing' && sc !== 'paused') return;
    const p = P();
    hudVignettes(ctx, p);
    if (p) { hudStats(ctx, p); hudHotbar(ctx, p); if (Game.settings.keyGuide) hudKeyGuide(ctx); }
    hudObjectives(ctx);
    hudMinimap(ctx, p);
    hudClock(ctx);
    const cardH = hudStageCard(ctx);
    hudBanner(ctx, cardH);
    if (p && sc === 'playing') { hudMateArrow(ctx, p); hudAlarms(ctx, p); hudPrompt(ctx, p); hudTip(ctx); }
    hudToasts(ctx);
  }

  function hudVignettes(ctx, p) {
    const t = real(), pulse = 0.5 + 0.5 * Math.sin(t * 5);
    let a = 0, rgb = '210,30,20';
    if (ui.flash > 0) a = Math.max(a, ui.flash * 0.6);
    if (p && p.maxHp && p.hp / p.maxHp < 0.3 && !p.dead && !p.reviving) a = Math.max(a, 0.10 + 0.14 * pulse * (1 - p.hp / (p.maxHp * 0.3)) + 0.05);
    const danger = (Game.state && Game.state.danger) || 0;
    if (danger > 0.35) a = Math.max(a, (danger - 0.3) * 0.22 * (0.7 + 0.3 * pulse));
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(' + rgb + ',0)'); g.addColorStop(1, 'rgba(' + rgb + ',' + clamp(a, 0, 0.7).toFixed(3) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // height of the top-left stats panel (Brood mode has the Siblings row); the key guide sits just below it
  const statsH = () => Game.state.mode === 'survival' ? 198 : 222;
  function hudKeyGuide(ctx) {
    const aim = !!Game.settings.mouseAim;
    const rows = [
      [['Mouse'], aim ? 'Aim / face direction' : null],
      [['W', 'S'], aim ? 'To / from cursor' : 'Move up / down'],
      [['A', 'D'], aim ? 'Strafe left / right' : 'Move left / right'],
      [['Shift'], 'Sprint'], [['Click'], 'Bite (or J)'], [['Space'], 'Spin web'],
      [['1', '2', '3', '4'], 'Select web'], [['E'], 'Interact'], [['R'], 'Rest'],
      [['B', 'M', 'F'], 'Codex / Map / Science'], [['H', 'Z', 'Esc'], 'Guide / Zoom / Pause'],
    ].filter(r => r[1]);
    const x = 16, y = 16 + statsH() + 12, w = 272, rh = 20, h = 32 + rows.length * rh;
    panel(ctx, x, y, w, h, { fill: COL.panelSoft });
    spaced(ctx, 'KEY GUIDE', x + 16, y + 21, 2, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    rows.forEach((r, i) => {
      const ry = y + 30 + i * rh; let kx = x + 16;
      r[0].forEach(k => { kx += keycap(ctx, k, kx, ry, { h: 18, size: 10 }) + 3; });
      txt(ctx, r[1], x + 108, ry + 9, { size: 13, color: COL.text, base: 'middle' });
    });
  }

  function hudStats(ctx, p) {
    const x = 16, y = 16, w = 272, h = statsH(), t = real();
    panel(ctx, x, y, w, h, { fill: COL.panelSoft });
    const st = p.stage || 0, last = st >= C.STAGES.length - 1;
    txt(ctx, stageName(st), x + 16, y + 29, { size: 19, weight: 700, font: SERIF, color: COL.amberHi });
    txt(ctx, 'Stage ' + (st + 1) + ' / ' + C.STAGES.length, x + w - 16, y + 28, { size: 11, color: COL.text3, align: 'right', weight: 600 });
    // growth
    const need = p.growthNeeded || (C.STAGES[st] && C.STAGES[st].growthNeeded) || 0;
    const gf = last ? 1 : (need > 0 ? clamp((p.growth || 0) / need, 0, 1) : 0);
    bar(ctx, x + 16, y + 40, w - 32, 14, gf, COL.growth, { light: '#ffe3a8' });
    txt(ctx, last ? 'Fully grown' : Math.floor(p.growth || 0) + ' / ' + need + ' growth', x + w / 2, y + 48, { size: 10, weight: 700, color: '#fff7e6', align: 'center', base: 'middle', shadow: true });
    if (!last && gf > 0.92) { ctx.save(); ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 6); ctx.fillStyle = '#fff'; rr(ctx, x + 16, y + 40, w - 32, 14, 7); ctx.fill(); ctx.restore(); }
    // meters
    const meters = [
      ['heart', 'Health', (p.hp || 0) / (p.maxHp || 1), COL.hp, Math.ceil(p.hp || 0)],
      ['bug', 'Hunger', (p.hunger || 0) / 100, COL.hunger, Math.round(p.hunger || 0)],
      ['drop', 'Hydration', (p.hydration || 0) / 100, COL.water, Math.round(p.hydration || 0)],
      ['bolt', 'Energy', (p.energy || 0) / 100, COL.energy, Math.round(p.energy || 0)],
      ['silk', 'Silk', (p.silk || 0) / (p.maxSilk || 1), COL.silk, Math.floor(p.silk || 0)],
    ];
    for (let i = 0; i < meters.length; i++) {
      const m = meters[i], ry = y + 74 + i * 25, f = clamp(m[2], 0, 1);
      const low = i < 4 && f < 0.25, pulse = low ? 0.5 + 0.5 * Math.sin(t * (f < 0.12 ? 10 : 6)) : 0;
      const col = low ? U.mixColor(m[3], '#ff4a3a', 0.4 + 0.4 * pulse) : m[3];
      icon(ctx, m[0], x + 28, ry + 6, 17 * (1 + 0.16 * pulse), low ? U.mixColor('#ffb0a0', '#ff4a3a', pulse) : m[3]);
      bar(ctx, x + 48, ry, w - 48 - 56, 12, f, col, { border: low ? 'rgba(255,90,70,' + (0.5 + 0.5 * pulse) + ')' : null });
      txt(ctx, String(m[4]) + (i === 4 ? '/' + Math.round(p.maxSilk || 0) : ''), x + w - 16, ry + 6.5, { size: 12, weight: 600, color: low ? '#ff9a8a' : COL.text2, align: 'right', base: 'middle' });
    }
    // siblings: each one still with you is a revive (Brood mode only)
    if (Game.state.mode !== 'survival') {
      const cr = Game.creatures, left = (cr && cr.siblings) | 0, slots = (cr && cr.siblingsMax) || 5, sy = y + 202;
      ctx.fillStyle = COL.lineSoft; ctx.fillRect(x + 16, sy - 9, w - 32, 1);
      txt(ctx, 'Siblings', x + 16, sy + 8, { size: 12, weight: 600, color: COL.text3, base: 'middle' });
      for (let i = 0; i < slots; i++) {
        const sx = x + 90 + i * 24;
        if (i < left) drawKind(ctx, 'kin', sx, sy + 8, 18);
        else { ctx.strokeStyle = 'rgba(180,160,130,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy + 8, 5.5, 0, 7); ctx.stroke(); }
      }
      txt(ctx, left + (left === 1 ? ' revive' : ' revives'), x + w - 16, sy + 8, { size: 12, weight: 600, color: left > 0 ? COL.amberHi : COL.text3, align: 'right', base: 'middle' });
    }
    // status chips
    let cx = x, cy = y + h + 8;
    if (p.moltTimer > 0) cx += chip(ctx, 'Soft shell ' + Math.ceil(p.moltTimer) + 's', cx, cy, '#e9c46a') + 6;
    if (p.resting) cx += chip(ctx, 'Resting', cx, cy, COL.good) + 6;
    else if (p.hidden) cx += chip(ctx, 'Hidden', cx, cy, COL.info) + 6;
    if (p.stateLabel === 'sprinting') cx += chip(ctx, 'Sprinting', cx, cy, COL.amber) + 6;
  }

  function hudHotbar(ctx, p) {
    const order = WEB_ICON_ORDER, sz = 60, gap = 8, total = order.length * sz + (order.length - 1) * gap;
    const x0 = Math.round((W - total) / 2), y = H - 16 - sz, st = p.stage || 0, t = real();
    const m = Game.input.mouse; let hoverType = null;
    for (let i = 0; i < order.length; i++) {
      const type = order[i], wt = C.WEB_TYPES[type]; if (!wt) continue;
      const x = x0 + i * (sz + gap), unlocked = st >= wt.stage, sel = !!(Game.webs && Game.webs.selected === type && unlocked);
      const afford = (p.silk || 0) >= wt.cost;
      panel(ctx, x, y, sz, sz, { fill: unlocked ? 'rgba(20,14,9,0.82)' : 'rgba(14,10,7,0.6)', r: 10, border: sel ? 'rgba(255,205,130,' + (0.8 + 0.2 * Math.sin(t * 4)) + ')' : COL.line, bw: sel ? 2 : 1 });
      if (sel) { ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = COL.amber; rr(ctx, x + 2, y + 2, sz - 4, sz - 4, 8); ctx.fill(); ctx.restore(); }
      if (unlocked) {
        webGlyph(ctx, type, x + sz / 2, y + sz / 2 - 2, 34, afford ? (sel ? COL.amberHi : COL.text) : 'rgba(200,170,150,0.5)');
        txt(ctx, String(wt.cost), x + sz - 6, y + sz - 6, { size: 11, weight: 700, color: afford ? COL.silk : COL.bad, align: 'right' });
      } else {
        icon(ctx, 'lock', x + sz / 2, y + sz / 2 - 6, 20, 'rgba(180,160,130,0.55)');
        txt(ctx, stageName(wt.stage), x + sz / 2, y + sz - 7, { size: 9, weight: 600, color: COL.text3, align: 'center' });
      }
      keycap(ctx, String(wt.key), x + 5, y + 5, { h: 16, size: 10 });
      if (inRect(m.x, m.y, { x, y, w: sz, h: sz })) hoverType = type;
    }
    const showType = hoverType || (Game.webs && Game.webs.selected && st >= (C.WEB_TYPES[Game.webs.selected] || { stage: 9 }).stage ? Game.webs.selected : null);
    if (showType) {
      const wt = C.WEB_TYPES[showType], locked = st < wt.stage;
      const label = wt.name + (locked ? '  (unlocks at ' + stageName(wt.stage) + ')' : '  •  ' + wt.cost + ' silk');
      const tw = Math.min(380, measure(ctx, label, 13, 600) + 22);
      if (hoverType) {
        const lines = wrap(ctx, wt.desc, 260, 12), bw = Math.max(tw, 280), bh = 38 + lines.length * 16;
        const bx = clamp(W / 2 - bw / 2, 8, W - bw - 8), by = y - bh - 10;
        panel(ctx, bx, by, bw, bh, { fill: COL.panelHi, r: 10 });
        txt(ctx, label, bx + bw / 2, by + 22, { size: 13, weight: 700, color: COL.amberHi, align: 'center' });
        for (let i = 0; i < lines.length; i++) txt(ctx, lines[i], bx + bw / 2, by + 40 + i * 16, { size: 12, color: COL.text2, align: 'center' });
      } else {
        txt(ctx, label, W / 2, y - 9, { size: 13, weight: 600, color: COL.amberHi, align: 'center', shadow: true });
      }
    }
  }

  function hudObjectives(ctx) {
    const E = Game.edu; if (!E || !E.objectives || !E.objectives.length) return;
    const x = W - 16 - 304, y = 16, w = 304, tw = w - 36 - 16, t = real();
    const items = E.objectives.slice(0, 3), laid = []; let cy = y + 38;
    for (let i = 0; i < items.length; i++) {
      const o = items[i], th = paraH(ctx, o.text, tw, { size: 14, lh: 18, maxLines: 2 });
      const h = th + 22 + 8; laid.push({ o, y: cy, th, h }); cy += h;
    }
    const total = cy - y + 6;
    panel(ctx, x, y, w, total, { fill: COL.panelSoft });
    spaced(ctx, 'OBJECTIVES', x + 18, y + 25, 2, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    for (let i = 0; i < laid.length; i++) {
      const L = laid[i], o = L.o, ty = L.y, done = o.done;
      const fresh = ui.newObj && ui.newObj[o.id] && t - ui.newObj[o.id] < 2.5;
      if (fresh) { ctx.save(); ctx.globalAlpha = 0.18 * (1 - (t - ui.newObj[o.id]) / 2.5); ctx.fillStyle = COL.amber; rr(ctx, x + 6, ty - 4, w - 12, L.h - 2, 8); ctx.fill(); ctx.restore(); }
      if (i > 0) { ctx.fillStyle = COL.lineSoft; ctx.fillRect(x + 16, ty - 8, w - 32, 1); }
      // checkbox
      const bx = x + 26, by = ty + 9;
      ctx.beginPath(); ctx.arc(bx, by, 8, 0, 7);
      if (done) { ctx.fillStyle = COL.good; ctx.fill(); icon(ctx, 'check', bx, by + 0.5, 12, '#173008'); }
      else { ctx.lineWidth = 1.6; ctx.strokeStyle = COL.amber; ctx.stroke(); }
      para(ctx, o.text, x + 44, ty, tw, { size: 14, lh: 18, color: done ? '#b4d99a' : COL.text, maxLines: 2 });
      const ry = ty + L.th + 6;
      const g = o.goal || 1;
      if (g > 1 && !done) {
        const bw = w - 44 - 16 - 118;
        bar(ctx, x + 44, ry, bw, 6, (o.progress || 0) / g, COL.amber, { light: COL.amberHi, border: 'rgba(255,255,255,0.08)' });
        const pv = o.unit === 's' ? Math.floor(o.progress) + '/' + g + 's' : Math.floor(o.progress) + '/' + g;
        txt(ctx, pv, x + 44 + bw + 8, ry + 6.5, { size: 11, weight: 600, color: COL.text2 });
      }
      const rw = o.reward && o.reward.growth;
      txt(ctx, done ? 'Complete' : (rw ? '+' + rw + ' growth' : ''), x + w - 16, ry + 6.5, { size: 11, weight: 700, color: done ? COL.good : COL.amberDim, align: 'right' });
    }
  }

  function hudClock(ctx) {
    const w = Game.world, x = Math.round(W / 2 - 112), y = 14, pw = 224, ph = 44;
    panel(ctx, x, y, pw, ph, { fill: COL.panelSoft, r: 22 });
    if (!w) return;
    const t01 = w.time01 || 0, phase = w.phase || (w.isNight && w.isNight() ? 'night' : 'day');
    const hour = ((6 + t01 * 24) % 24 + 24) % 24, hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    const night = phase === 'night', warm = phase === 'dawn' || phase === 'dusk';
    icon(ctx, night ? 'moon' : 'sun', x + 26, y + ph / 2, 22, night ? '#cfd8ff' : (warm ? '#ff9f5a' : '#ffd36a'));
    txt(ctx, 'Day ' + ((w.dayCount || 0) + 1) + '  ·  ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, x + 50, y + 19, { size: 14, weight: 700, color: COL.text });
    const wt = (w.weather && w.weather.type) || 'clear';
    const wname = { clear: 'Clear', drizzle: 'Drizzle', rain: 'Rain', wind: 'Windy', fog: 'Fog' }[wt] || titleize(wt);
    txt(ctx, titleize(phase) + ' · ' + wname, x + 50, y + 35, { size: 11, color: COL.text3, weight: 600 });
    const wi = { clear: null, drizzle: 'rain', rain: 'rain', wind: 'wind', fog: 'fog' }[wt];
    icon(ctx, wi || (night ? 'star' : 'cloud'), x + pw - 26, y + ph / 2, 20, wi ? '#8fc6e8' : 'rgba(200,190,170,0.35)');
  }

  function activeBanner() {
    const b = ui.banners[0]; if (!b) return null;
    if (b.t0 == null) b.t0 = real();
    if (real() - b.t0 > b.dur) { ui.banners.shift(); return activeBanner(); }
    return b;
  }
  function hudBanner(ctx, cardH) {
    const b = activeBanner(); if (!b) return;
    const age = real() - b.t0, a = clamp(Math.min(age / 0.5, (b.dur - age) / 0.9), 0, 1);
    const y = 112 + (cardH || 0), e = smooth(a);
    ctx.save(); ctx.globalAlpha = e;
    const g = ctx.createLinearGradient(W / 2 - 420, 0, W / 2 + 420, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(8,5,3,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(W / 2 - 420, y - 40, 840, 104);
    const title = b.title.toUpperCase();
    const tw = spaced(ctx, title, W / 2, y + 2 + (1 - e) * 6, b.kind === 'zone' ? 6 : 4, { size: b.kind === 'zone' ? 34 : 28, font: SERIF, weight: 700, color: COL.amberHi, align: 'center' });
    ctx.strokeStyle = 'rgba(255,205,130,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 - tw / 2 - 30, y + 20); ctx.lineTo(W / 2 - 8, y + 20); ctx.moveTo(W / 2 + 8, y + 20); ctx.lineTo(W / 2 + tw / 2 + 30, y + 20); ctx.stroke();
    ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.moveTo(W / 2, y + 15); ctx.lineTo(W / 2 + 4, y + 20); ctx.lineTo(W / 2, y + 25); ctx.lineTo(W / 2 - 4, y + 20); ctx.closePath(); ctx.fill();
    if (b.sub) txt(ctx, b.sub, W / 2, y + 46, { size: 14, italic: true, font: SERIF, color: COL.text2, align: 'center', shadow: true });
    ctx.restore();
  }

  function hudStageCard(ctx) {
    const c = ui.stageCard; if (!c) return 0;
    const age = real() - c.t0; if (age > c.dur) { ui.stageCard = null; return 0; }
    const lore = safe(() => Game.edu.STAGE_LORE[c.stage], null); if (!lore) { ui.stageCard = null; return 0; }
    const w = 600, tw = w - 48, sci = Game.settings.science && lore.scienceText;
    const bodyH = paraH(ctx, lore.text, tw, { size: 15, lh: 21 }), sciH = sci ? paraH(ctx, lore.scienceText, tw, { size: 13, lh: 18, italic: true }) + 14 : 0;
    const h = 22 + 22 + 34 + bodyH + sciH + 22, x = (W - w) / 2, y = 66;
    const a = clamp(Math.min(age / 0.5, (c.dur - age) / 1.2), 0, 1), e = smooth(a);
    ctx.save(); ctx.globalAlpha = e; ctx.translate(0, (1 - e) * -14);
    panel(ctx, x, y, w, h, { fill: COL.panelHi, border: 'rgba(255,205,130,0.4)', accent: COL.amber });
    spaced(ctx, 'STAGE ' + (c.stage + 1) + ' OF ' + C.STAGES.length, x + 26, y + 30, 2, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    txt(ctx, lore.title, x + 24, y + 62, { size: 28, font: SERIF, weight: 700, color: COL.amberHi });
    let by = para(ctx, lore.text, x + 24, y + 74, tw, { size: 15, lh: 21, color: COL.text });
    if (sci) { ctx.fillStyle = COL.lineSoft; ctx.fillRect(x + 24, by + 5, tw, 1); para(ctx, lore.scienceText, x + 24, by + 11, tw, { size: 13, lh: 18, italic: true, color: COL.info }); }
    ctx.restore();
    return h + 6;
  }

  function hudToasts(ctx) {
    const t = real(); let y = H - 16;
    for (let i = ui.toasts.length - 1; i >= 0; i--) {
      const q = ui.toasts[i], age = t - q.t0;
      if (age > q.dur) { ui.toasts.splice(i, 1); continue; }
    }
    // newest on the bottom, older ones stack upward
    for (let i = ui.toasts.length - 1; i >= 0; i--) {
      const q = ui.toasts[i], age = t - q.t0, w = 326, h = 62;
      const inA = smooth(clamp(age / 0.4, 0, 1)), outA = clamp((q.dur - age) / 0.5, 0, 1);
      const x = 16 - (1 - inA) * (w + 20), yy = y - h;
      ctx.save(); ctx.globalAlpha = outA;
      const accent = q.kind === 'fact' ? (CAT_COL[q.cat] || COL.amber) : COL.good;
      panel(ctx, x, yy, w, h, { fill: COL.panelHi, accent, border: U.rgba(accent, 0.45) });
      ctx.beginPath(); ctx.arc(x + 34, yy + h / 2, 17, 0, 7); ctx.fillStyle = U.rgba(accent, 0.18); ctx.fill();
      icon(ctx, q.kind === 'fact' ? 'book' : 'check', x + 34, yy + h / 2, 20, accent);
      const head = q.kind === 'fact' ? 'NEW FACT  ·  ' + (CAT_NAME[q.cat] || '').toUpperCase() : 'OBJECTIVE COMPLETE';
      txt(ctx, head, x + 62, yy + 20, { size: 10, weight: 700, color: accent });
      txt(ctx, fit(ctx, q.kind === 'fact' ? q.title : (q.sub || ''), w - 78 - (q.reward ? 70 : 0), 15, 700), x + 62, yy + 40, { size: 15, weight: 700, color: COL.text });
      if (q.kind === 'fact') txt(ctx, 'Press B to read it in the Codex', x + 62, yy + 55, { size: 11, color: COL.text3 });
      else if (q.reward) txt(ctx, '+' + q.reward + ' growth', x + w - 14, yy + 40, { size: 13, weight: 700, color: COL.amberHi, align: 'right' });
      ctx.restore();
      y = yy - 8;
    }
  }

  function hudPrompt(ctx, p) {
    const pr = ui.prompt; if (!pr) return;
    const sp = Game.camera.worldToScreen(p.x, p.y), cz = Game.camera.zoom || 1;
    const py = clamp(sp.y + (p.radius || 8) * cz + 38 + Math.sin(real() * 3) * 2, 40, H - 110), px = clamp(sp.x, 130, W - 130);
    ctx.save();
    const warn = pr.warn;
    const tw = measure(ctx, pr.text, 14, 600), kw = Math.max(26, measure(ctx, pr.key, 13, 700) + 14), w = kw + tw + 30;
    panel(ctx, px - w / 2, py - 18, w, 36, { fill: 'rgba(14,10,7,0.88)', r: 18, border: warn ? 'rgba(229,96,77,0.6)' : 'rgba(255,205,130,0.5)' });
    keycap(ctx, pr.key, px - w / 2 + 9, py - 11, { h: 22, size: 12, color: warn ? COL.bad : null, textColor: warn ? '#ffb0a0' : COL.amberHi });
    txt(ctx, pr.text, px - w / 2 + 9 + kw + 10, py + 1, { size: 14, weight: 600, color: warn ? '#ffb0a0' : COL.text, base: 'middle' });
    ctx.restore();
  }

  function hudMateArrow(ctx, p) {
    if (p.stage !== 4 || !p.mate || p.mate.laid) return;
    const cr = Game.creatures, mate = cr && cr.mate; let ang = null, dist = 0;
    if (!p.mate.courted && mate) { ang = Math.atan2(mate.y - p.y, mate.x - p.x); dist = Math.hypot(mate.x - p.x, mate.y - p.y); }
    else if (!p.mate.courted && p.mateHint && (p.mateHint.x || p.mateHint.y)) { ang = Math.atan2(p.mateHint.y, p.mateHint.x); dist = 999; }
    else if (p.mate.courted && Game.world && Game.world.shelters) {
      let best = null, bd = 1e9; Game.world.shelters.forEach(s => { if (s.eggSite) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { bd = d; best = s; } } });
      if (best) { ang = Math.atan2(best.y - p.y, best.x - p.x); dist = bd; }
    }
    if (ang == null || dist < 140) return;
    const sp = Game.camera.worldToScreen(p.x, p.y), r = 84 + Math.sin(real() * 4) * 3, t = real();
    const ax = sp.x + Math.cos(ang) * r, ay = sp.y + Math.sin(ang) * r;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
    const col = p.mate.courted ? '#9bd65c' : '#ff8fd0';
    ctx.globalAlpha = 0.65 + 0.3 * Math.sin(t * 4);
    ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-7, -9); ctx.lineTo(-3, 0); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (dist < 900) txt(ctx, Math.round(dist / 10) + '', ax + Math.cos(ang) * 20, ay + Math.sin(ang) * 20 + 4, { size: 11, weight: 700, color: col, align: 'center', shadow: true });
  }

  // sibling lookouts: a pulsing arrow at the screen edge toward a predator they have spotted that is off-screen
  function hudAlarms(ctx, p) {
    const cr = Game.creatures, al = cr && cr.alarms; if (!al || !al.length || p.dead) return;
    const cam = Game.camera, t = real(), pad = 46, K = KINDS();
    for (let i = 0; i < al.length; i++) {
      const a = al[i], sp = cam.worldToScreen(a.x, a.y);
      if (sp.x > pad && sp.x < W - pad && sp.y > pad && sp.y < H - pad) continue;   // already on screen: the siblings' own "!" says enough
      const dx = sp.x - W / 2, dy = sp.y - H / 2, ang = Math.atan2(dy, dx);
      const sc = Math.min((W / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (H / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
      const ax = W / 2 + dx * sc, ay = H / 2 + dy * sc, fade = clamp(a.life / 1.2, 0, 1), col = '#ff6a4a';
      ctx.save(); ctx.globalAlpha = fade * (0.7 + 0.3 * Math.sin(t * 9)); ctx.translate(ax, ay);
      ctx.fillStyle = 'rgba(20,10,5,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill();
      ctx.save(); ctx.rotate(ang); ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(25,8,4,0.85)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
      ctx.restore();
      const kd = K && K[a.kind], lx = clamp(ax, 70, W - 70), ly = ay + (ay < H / 2 ? 32 : -26);
      txt(ctx, kd ? kd.name : 'Predator', lx, ly, { size: 11, weight: 700, color: col, align: 'center', shadow: true, alpha: fade });
    }
  }

  function hudTip(ctx) {
    const h = ui.hint; if (!h.text || !Game.settings.hints) return;
    const age = real() - h.t0, a = smooth(clamp(age / 0.6, 0, 1));
    const maxW = 600, lines = wrap(ctx, h.text, maxW - 56, 14, 600), lh = 19;
    const w = Math.min(maxW, Math.max(...lines.map(l => measure(ctx, l, 14, 600))) + 56), hh = lines.length * lh + 22;
    const x = (W - w) / 2, y = H - 16 - 60 - 20 - hh - 12;
    ctx.save(); ctx.globalAlpha = a * 0.96;
    panel(ctx, x, y, w, hh, { fill: 'rgba(14,10,7,0.78)', r: 14, border: 'rgba(255,205,130,0.3)' });
    ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.arc(x + 20, y + hh / 2, 3.5, 0, 7); ctx.fill();
    for (let i = 0; i < lines.length; i++) txt(ctx, lines[i], x + 36, y + 22 + i * lh - 3 + (hh - 22 - lines.length * lh) / 2 + 3, { size: 14, weight: 600, color: COL.text });
    ctx.restore();
  }

  // ------------------------------------------------------------- minimap
  function hudMinimap(ctx, p) {
    const big = ui.mapBig, w = big ? 440 : 216, h = Math.round(w * C.WORLD_H / C.WORLD_W), x = W - 16 - w, y = H - 42 - h;
    ctx.save();
    panel(ctx, x - 6, y - 6, w + 12, h + 12 + 20, { fill: COL.panelSoft, r: 12 });
    ctx.beginPath(); rr(ctx, x, y, w, h, 6); ctx.clip();
    const wd = Game.world;
    if (wd && wd.drawMinimapTerrain) {
      try { ctx.save(); wd.drawMinimapTerrain(ctx, x, y, w, h); ctx.restore(); } catch (e) { Game.reportError('ui.minimapTerrain', e); }
    } else {
      C.ZONES.forEach(z => { ctx.fillStyle = z.color; ctx.fillRect(x + z.x0 / C.WORLD_W * w, y, (z.x1 - z.x0) / C.WORLD_W * w, h); });
    }
    // zone seams
    ctx.fillStyle = 'rgba(255,225,170,0.18)'; C.ZONES.forEach((z, i) => { if (i) ctx.fillRect(x + z.x0 / C.WORLD_W * w, y, 1, h); });
    // fog of war
    if (fog.ok && fog.cv) { ctx.imageSmoothingEnabled = true; ctx.drawImage(fog.cv, x, y, w, h); }
    const mx = (wx) => x + wx / C.WORLD_W * w, my = (wy) => y + wy / C.WORLD_H * h;
    const explored = (wx, wy) => { if (!fog.ok) return true; const wd2 = Game.world, cell = (typeof wd2.exploredCell === 'number' && wd2.exploredCell) || 64; const cx = Math.floor(wx / cell), cy = Math.floor(wy / cell); const ex = wd2.explored; const fn = typeof wd2.exploredCell === 'function' ? wd2.exploredCell : null; return !!exploredAt(ex, cell, fog.gw, cx, cy, ex.length && typeof ex[0] === 'object', fn); };
    // shelters that you have found
    if (wd && wd.shelters) {
      ctx.fillStyle = 'rgba(150,230,200,0.9)';
      for (let i = 0; i < wd.shelters.length && i < 300; i++) { const s = wd.shelters[i]; if (explored(s.x, s.y)) { ctx.beginPath(); ctx.arc(mx(s.x), my(s.y), big ? 2.4 : 1.7, 0, 7); ctx.fill(); } }
    }
    // camera window
    const v = Game.camera.view;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,240,210,0.55)'; ctx.strokeRect(mx(v.x0) + 0.5, my(v.y0) + 0.5, (v.x1 - v.x0) / C.WORLD_W * w, (v.y1 - v.y0) / C.WORLD_H * h);
    // mate
    const cr = Game.creatures, mate = cr && cr.mate;
    if (p && p.stage === 4 && mate && !(p.mate && p.mate.courted)) {
      const pul = 0.5 + 0.5 * Math.sin(real() * 5); ctx.fillStyle = 'rgba(255,143,208,' + (0.6 + 0.4 * pul) + ')';
      ctx.beginPath(); ctx.arc(mx(mate.x), my(mate.y), 3 + 2 * pul, 0, 7); ctx.fill();
    }
    // player
    if (p) {
      const px = mx(p.x), py = my(p.y), pul = 0.5 + 0.5 * Math.sin(real() * 4);
      ctx.fillStyle = 'rgba(242,180,90,' + (0.25 + 0.2 * pul) + ')'; ctx.beginPath(); ctx.arc(px, py, 6 + 2 * pul, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(px, py); ctx.rotate(p.angle || 0); ctx.fillStyle = '#fff2d0'; ctx.strokeStyle = '#2a1a08'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(4.5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-1.5, 0); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,205,130,0.3)'; rr(ctx, x - 0.5, y - 0.5, w + 1, h + 1, 6); ctx.stroke();
    const z = wd && p && wd.zoneAt ? safe(() => wd.zoneAt(p.x, p.y), null) : null;
    txt(ctx, z ? z.name : 'Map', x, y + h + 17, { size: 11, weight: 600, color: COL.text2 });
    keycap(ctx, 'M', x + w - 16, y + h + 4, { h: 16, size: 10 });
    txt(ctx, big ? 'shrink' : 'enlarge', x + w - 22, y + h + 17, { size: 10, color: COL.text3, align: 'right' });
    ctx.restore();
  }

  // =============================================================== MENU LAYER
  function drawMenuLayer(ctx) {
    const sc = Game.state.scene;
    if (sc === 'title') drawTitle(ctx);
    else if (sc === 'paused') drawPaused(ctx);
    else if (sc === 'molting') drawMolting(ctx);
    else if (sc === 'codex') drawCodex(ctx);
    else if (sc === 'gameover') drawGameOver(ctx);
    else if (sc === 'victory') drawVictory(ctx);
  }

  function dim(ctx, a, warm) {
    ctx.fillStyle = 'rgba(6,4,3,' + a + ')'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (warm) { const w = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.42, 520); w.addColorStop(0, 'rgba(242,180,90,' + warm + ')'); w.addColorStop(1, 'rgba(242,180,90,0)'); ctx.fillStyle = w; ctx.fillRect(0, 0, W, H); }
  }
  const fadeIn = (dur) => smooth(clamp((real() - ui.enterT) / (dur || 0.35), 0, 1));

  function drawWebCorner(ctx, cx, cy, sx, sy, scale, t) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sx * scale, sy * scale);
    ctx.strokeStyle = 'rgba(235,235,250,0.34)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    const R = 330, spokes = 7, sway = Math.sin(t * 0.6) * 0.012;
    ctx.beginPath(); for (let i = 0; i < spokes; i++) { const a = (i / (spokes - 1)) * Math.PI / 2 + sway; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); } ctx.stroke();
    ctx.lineWidth = 0.9;
    for (let k = 1; k <= 8; k++) {
      const r = k * 38 + (k % 2) * 3; ctx.beginPath(); let lx = 0, ly = 0;
      for (let i = 0; i < spokes; i++) {
        const a = (i / (spokes - 1)) * Math.PI / 2 + sway, rr2 = r * (1 - 0.05 * Math.sin(i * 1.7 + k)), px = Math.cos(a) * rr2, py = Math.sin(a) * rr2 + (i ? 0.045 * r : 0);
        if (i) ctx.quadraticCurveTo((px + lx) / 2, (py + ly) / 2 + 5 + k * 0.6, px, py); else ctx.moveTo(px, py);
        lx = px; ly = py;
      }
      ctx.stroke();
    }
    // dew
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let k = 2; k <= 7; k += 2) for (let i = 1; i < spokes - 1; i += 2) { const a = (i / (spokes - 1)) * Math.PI / 2 + sway; ctx.beginPath(); ctx.arc(Math.cos(a) * k * 38, Math.sin(a) * k * 38 + 2, 1.6 + 0.8 * Math.sin(t * 2 + k + i) * 0.5 + 0.4, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  // build version, small and muted (title: bottom-right corner; pause: under the Resume hint, clear of the minimap)
  function drawVersion(ctx, x, y, align) { txt(ctx, 'v' + (C.VERSION || '?'), x, y, { size: 12, color: COL.text3, align, weight: 600 }); }

  function drawTitle(ctx) {
    const t = real();
    // darken the drifting world so the title reads
    let g = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.18, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(6,4,2,0.30)'); g.addColorStop(1, 'rgba(4,3,2,0.86)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.35, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.6)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const a = fadeIn(0.8);
    ctx.save(); ctx.globalAlpha = a;
    drawWebCorner(ctx, 0, 0, 1, 1, 1.0, t); drawWebCorner(ctx, W, 0, -1, 1, 0.72, t + 2);
    if (ui.sub) { ctx.restore(); drawSub(ctx); return; }
    // hanging spider
    const hx = 1128, len = 150 + Math.sin(t * 0.7) * 26, sway = Math.sin(t * 0.9) * 5;
    ctx.strokeStyle = 'rgba(240,240,255,0.5)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx + sway, len); ctx.stroke();
    spiderGlyph(ctx, hx + sway, len + 22, 17, t, { color: '#16100b', legColor: '#1b140e', rot: Math.sin(t * 0.9) * 0.08 });
    // title
    const gt = ctx.createLinearGradient(0, 128, 0, 182); gt.addColorStop(0, '#fff4d6'); gt.addColorStop(1, '#f0a940');
    ctx.save(); ctx.shadowColor = 'rgba(242,180,90,' + (0.55 + 0.15 * Math.sin(t * 1.4)) + ')'; ctx.shadowBlur = 34;
    spaced(ctx, 'ARACHNID ORIGINS', W / 2, 176, 7, { size: 66, font: SERIF, weight: 700, color: gt, align: 'center' });
    ctx.restore();
    spaced(ctx, "THE SPIDER'S JOURNEY", W / 2, 218, 9, { size: 19, font: SERIF, weight: 400, color: COL.amber, align: 'center' });
    ctx.strokeStyle = 'rgba(255,205,130,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 - 190, 248); ctx.lineTo(W / 2 - 14, 248); ctx.moveTo(W / 2 + 14, 248); ctx.lineTo(W / 2 + 190, 248); ctx.stroke();
    ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.moveTo(W / 2, 242); ctx.lineTo(W / 2 + 6, 248); ctx.lineTo(W / 2, 254); ctx.lineTo(W / 2 - 6, 248); ctx.closePath(); ctx.fill();
    txt(ctx, 'From a speck in the leaf litter to the next generation', W / 2, 282, { size: 14, italic: true, font: SERIF, color: COL.text2, align: 'center', shadow: true });
    ctx.restore();

    const rects = titleRects(), foc = ui.idx.title || 0;
    ctx.save(); ctx.globalAlpha = a;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]; const sub = TITLE_ITEMS[i].id === 'bestiary' ? (safe(() => Game.edu.hasSeen && bestiaryIds().filter(isSeen).length + '/' + bestiaryIds().length, '') || '') : '';
      drawButton(ctx, r, TITLE_ITEMS[i].label, i === foc, { size: 19, sub });
    }
    // footer
    let fx = W / 2 - 230;
    fx += keycap(ctx, '↑', fx, H - 40, { h: 22 }) + 4; fx += keycap(ctx, '↓', fx, H - 40, { h: 22 }) + 8;
    txt(ctx, 'Navigate', fx, H - 24, { size: 13, color: COL.text3 }); fx += 90;
    fx += keycap(ctx, 'Enter', fx, H - 40, { h: 22 }) + 8;
    txt(ctx, 'Select', fx, H - 24, { size: 13, color: COL.text3 }); fx += 54;
    txt(ctx, '\u00b7   or use the mouse', fx, H - 24, { size: 13, color: COL.text3 });
    const E = Game.edu;
    if (E && E.counts) { const c = E.counts(); txt(ctx, 'Facts discovered  ' + c.unlocked + ' / ' + c.total, W - 24, H - 24, { size: 13, color: COL.text3, align: 'right', weight: 600 }); }
    txt(ctx, 'Discoveries are kept between journeys', 24, H - 24, { size: 12, color: COL.text3, italic: true, font: SERIF });
    drawVersion(ctx, W - 24, H - 46, 'right');
    ctx.restore();
  }

  // ------------------------------------------------------------ sub panels
  function subPanelBox(sub) {
    if (sub === 'settings') return settingsLayout();
    if (sub === 'mode') return modeLayout().b;
    if (sub === 'howto') return { x: (W - 900) / 2, y: 46, w: 900, h: 628 };
    return { x: (W - 680) / 2, y: 100, w: 680, h: 520 };
  }
  function drawSub(ctx) {
    const sub = ui.sub;
    dim(ctx, 0.5);
    if (sub === 'confirmQuit') return drawConfirmQuit(ctx);
    const b = subPanelBox(sub);
    panel(ctx, b.x, b.y, b.w, b.h, { fill: COL.panelHi, border: 'rgba(255,205,130,0.35)', r: 16 });
    const title = { settings: 'Settings', mode: 'Choose your journey', howto: 'How to Play', credits: 'Credits' }[sub];
    txt(ctx, title, W / 2, b.y + 48, { size: 30, font: SERIF, weight: 700, color: COL.amberHi, align: 'center' });
    ctx.strokeStyle = 'rgba(255,205,130,0.35)'; ctx.beginPath(); ctx.moveTo(b.x + 60, b.y + 62); ctx.lineTo(b.x + b.w - 60, b.y + 62); ctx.stroke();
    if (sub === 'settings') drawSettings(ctx, b);
    else if (sub === 'mode') drawMode(ctx, b);
    else if (sub === 'howto') drawHowTo(ctx, b);
    else drawCredits(ctx, b);
    if (sub !== 'settings') drawButton(ctx, subBackRect(b.y, b.h), 'Back', sub !== 'mode', { size: 17 });
  }

  function drawMode(ctx, b) {
    const L = modeLayout(), foc = ui.idx.mode || 0;
    L.cards.forEach((r, i) => {
      const m = C.MODES[i], f = i === foc, hard = m.id === 'survival', col = hard ? COL.bad : COL.amber;
      panel(ctx, r.x, r.y, r.w, r.h, { fill: f ? 'rgba(34,24,14,0.96)' : 'rgba(18,13,9,0.8)', border: f ? col : COL.line, bw: f ? 2 : 1, r: 14 });
      txt(ctx, m.name, r.x + 24, r.y + 46, { size: 30, font: SERIF, weight: 700, color: f ? COL.amberHi : COL.text });
      txt(ctx, m.tag.toUpperCase(), r.x + r.w - 24, r.y + 42, { size: 11, weight: 700, color: col, align: 'right' });
      // one life, plus a sibling icon per revive in Brood mode
      icon(ctx, 'heart', r.x + 38, r.y + 100, 26, COL.hp);
      if (!hard) { txt(ctx, '+', r.x + 66, r.y + 101, { size: 16, weight: 700, color: COL.text3, align: 'center', base: 'middle' }); for (let k = 0; k < 5; k++) drawKind(ctx, 'kin', r.x + 94 + k * 32, r.y + 100, 24); }
      para(ctx, m.blurb, r.x + 24, r.y + 134, r.w - 48, { size: 15, lh: 22, color: COL.text });
      txt(ctx, m.note, r.x + 24, r.y + r.h - 26, { size: 13, weight: 600, color: col });
    });
    txt(ctx, 'Left / Right to choose  \u00b7  Enter to begin  \u00b7  Esc to go back  \u00b7  your choice is remembered', W / 2, b.y + b.h - 86, { size: 12, color: COL.text3, align: 'center' });
  }

  function drawSettings(ctx, L) {
    const foc = ui.idx.settings || 0, s = Game.settings, t = real();
    L.rows.forEach((row, i) => {
      const r = row.r, f = i === foc, def = row.def;
      if (f) { rr(ctx, r.x - 6, r.y, r.w + 12, r.h, 10); ctx.fillStyle = 'rgba(242,180,90,0.10)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,205,130,0.45)'; ctx.lineWidth = 1; rr(ctx, r.x - 5.5, r.y + 0.5, r.w + 11, r.h - 1, 10); ctx.stroke(); }
      txt(ctx, def.label, r.x + 10, r.y + r.h / 2 + (def.desc ? -3 : 1), { size: 16, weight: f ? 700 : 500, color: f ? COL.amberHi : COL.text, base: 'middle' });
      if (def.desc) txt(ctx, def.desc, r.x + 10, r.y + r.h / 2 + 13, { size: 11, color: COL.text3, base: 'middle' });
      if (def.type === 'slider') {
        const v = clamp(s[def.key] == null ? 0 : s[def.key], 0, 1), tr = row.track;
        rr(ctx, tr.x, tr.y, tr.w, tr.h, 6); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
        if (v > 0) { const gr = ctx.createLinearGradient(tr.x, 0, tr.x + tr.w, 0); gr.addColorStop(0, COL.amberDim); gr.addColorStop(1, COL.amber); ctx.fillStyle = gr; rr(ctx, tr.x, tr.y, Math.max(12, tr.w * v), tr.h, 6); ctx.fill(); }
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; rr(ctx, tr.x + 0.5, tr.y + 0.5, tr.w - 1, tr.h - 1, 6); ctx.stroke();
        const kx = tr.x + tr.w * v; ctx.beginPath(); ctx.arc(kx, tr.y + tr.h / 2, f ? 10 : 8, 0, 7); ctx.fillStyle = '#fff1d4'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = COL.amber; ctx.stroke();
        txt(ctx, Math.round(v * 100) + '%', r.x + r.w - 6, r.y + r.h / 2 + 1, { size: 15, weight: 700, color: COL.text2, align: 'right', base: 'middle' });
      } else {
        const on = !!s[def.key], sw = row.sw;
        rr(ctx, sw.x, sw.y, sw.w, sw.h, sw.h / 2); ctx.fillStyle = on ? 'rgba(242,180,90,0.9)' : 'rgba(0,0,0,0.55)'; ctx.fill();
        ctx.strokeStyle = on ? COL.amberHi : 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; rr(ctx, sw.x + 0.5, sw.y + 0.5, sw.w - 1, sw.h - 1, sw.h / 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(sw.x + (on ? sw.w - 14 : 14), sw.y + sw.h / 2, 10, 0, 7); ctx.fillStyle = on ? '#2a1a08' : '#cbbca3'; ctx.fill();
        txt(ctx, on ? 'On' : 'Off', sw.x - 12, sw.y + sw.h / 2 + 1, { size: 14, weight: 600, color: on ? COL.amberHi : COL.text3, align: 'right', base: 'middle' });
      }
    });
    drawButton(ctx, L.back, 'Back', foc === SETTINGS_ROWS.length, { size: 17 });
    txt(ctx, '← → adjust   ·   ↑ ↓ select   ·   Esc back', W / 2, L.y + L.h - 16, { size: 11, color: COL.text3, align: 'center' });
  }

  const CONTROLS = [
    [['Mouse'], 'Aim: spider faces the cursor'], [['W', 'A', 'S', 'D'], 'Move / strafe (arrows too)'], [['Shift'], 'Sprint (uses energy)'], [['J'], 'Bite (or left click)'],
    [['E'], 'Drink, hide, court, lay eggs'], [['R'], 'Rest and recover'], [['Space'], 'Spin the selected web'],
    [['1', '2', '3', '4'], 'Choose web type'], [['Z'], 'Hold to zoom out'], [['M'], 'Enlarge the minimap'],
    [['B'], 'Codex: creatures and facts'], [['F'], 'Science Mode on / off'], [['Esc'], 'Pause (P works too)'],
  ];
  function drawHowTo(ctx, b) {
    const lx = b.x + 40, rx = b.x + 500, top = b.y + 86;
    spaced(ctx, 'CONTROLS', lx, top, 2, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    CONTROLS.forEach((c, i) => {
      const y = top + 14 + i * 36; let x = lx;
      c[0].forEach((k, ki) => { x += keycap(ctx, k, x, y, { h: 24 }) + 4; });
      txt(ctx, c[1], lx + 138, y + 13, { size: 14.5, color: COL.text, base: 'middle' });
    });
    spaced(ctx, 'YOUR JOURNEY', rx, top, 2, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    let y = para(ctx, 'You hatch as a speck in the leaf litter. Eat, drink and hide to survive. Fill your growth bar to molt, choose an adaptation, and grow through five stages. Reach adulthood, find a mate and lay your egg sac to complete the cycle.', rx, top + 12, 360, { size: 14.5, lh: 21, color: COL.text });
    y += 14; spaced(ctx, 'SURVIVAL TIPS', rx, y + 10, 2, { size: 11, weight: 700, color: COL.amberDim, align: 'left' }); y += 20;
    ['Predators track movement: hide in shelters, under leaves or in a silk retreat.', 'Rain hurts small spiders in the open, so find cover.', 'Webs let you catch prey far bigger than you can bite.', 'Molting leaves you soft for a while, so hide before you molt.', 'Every fact you discover is saved in the Codex (B).'].forEach(tp => {
      ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.arc(rx + 4, y + 11, 2.5, 0, 7); ctx.fill();
      y = para(ctx, tp, rx + 18, y, 342, { size: 14, lh: 20, color: COL.text2 }) + 4;
    });
  }
  function drawCredits(ctx, b) {
    let y = b.y + 100;
    txt(ctx, "Arachnid Origins: The Spider's Journey", W / 2, y + 8, { size: 22, font: SERIF, weight: 700, color: COL.text, align: 'center' }); y += 28;
    txt(ctx, 'A small game about growing up small.', W / 2, y + 12, { size: 15, italic: true, font: SERIF, color: COL.text2, align: 'center' }); y += 40;
    spiderGlyph(ctx, W / 2, y + 28, 15, real(), { color: '#16100b', legColor: '#1b140e' }); y += 84;
    y = para(ctx, 'Everything you see and hear is generated in code: all art is drawn procedurally on an HTML5 canvas and all sound is synthesised with the Web Audio API. There are no external images, sounds or libraries.', b.x + 60, y, b.w - 120, { size: 14.5, lh: 21, color: COL.text, align: 'center' }) + 14;
    y = para(ctx, "Facts are written from standard arachnology references such as R. F. Foelix's Biology of Spiders and the World Spider Catalog. Spiders are wonderfully varied, so the game describes typical spiders; details differ between species.", b.x + 60, y, b.w - 120, { size: 13.5, lh: 20, color: COL.text2, italic: true, font: SERIF, align: 'center' }) + 12;
    txt(ctx, 'Thanks for playing!', W / 2, y + 22, { size: 15, weight: 700, color: COL.amberHi, align: 'center' });
  }

  function drawConfirmQuit(ctx) {
    const w = 560, h = 240, x = (W - w) / 2, y = 300 - 60;
    panel(ctx, x, y, w, h, { fill: COL.panelHi, border: 'rgba(255,205,130,0.35)', r: 16 });
    txt(ctx, 'Quit to title?', W / 2, y + 56, { size: 28, font: SERIF, weight: 700, color: COL.amberHi, align: 'center' });
    para(ctx, 'Your current journey will be lost. Everything you have discovered in the Codex is kept.', x + 50, y + 74, w - 100, { size: 15, lh: 22, align: 'center', color: COL.text2 });
    const rects = confirmRects(), foc = ui.idx.confirmQuit == null ? 1 : ui.idx.confirmQuit;
    drawButton(ctx, rects[0], 'Quit', foc === 0, { size: 17 }); drawButton(ctx, rects[1], 'Keep Playing', foc === 1, { size: 17 });
  }

  // ----------------------------------------------------------------- pause
  function drawPaused(ctx) {
    const a = fadeIn(0.25);
    ctx.save(); ctx.globalAlpha = a; dim(ctx, 0.62);
    if (ui.sub) { drawSub(ctx); ctx.restore(); return; }
    txt(ctx, 'Paused', W / 2, 172, { size: 54, font: SERIF, weight: 700, color: COL.amberHi, align: 'center', shadow: true });
    const p = P(), E = Game.edu;
    const info = Game.modeInfo(Game.state.mode).name + ' mode  ·  ' + (p ? stageName(p.stage || 0) + '  ·  ' : '') + 'Survived ' + fmtTime(Game.time.t);
    txt(ctx, info, W / 2, 208, { size: 15, color: COL.text2, align: 'center', font: SERIF, italic: true });
    ctx.strokeStyle = 'rgba(255,205,130,0.4)'; ctx.beginPath(); ctx.moveTo(W / 2 - 120, 226); ctx.lineTo(W / 2 + 120, 226); ctx.stroke();
    const rects = pauseRects(), foc = ui.idx.pause || 0;
    PAUSE_ITEMS.forEach((it, i) => drawButton(ctx, rects[i], it.label, i === foc, { size: 18 }));
    let fx = W / 2 - 52; fx += keycap(ctx, 'Esc', fx, 590, { h: 22 }) + 8; txt(ctx, 'Resume', fx, 606, { size: 13, color: COL.text3 });
    drawVersion(ctx, W / 2, 634, 'center');
    ctx.restore();
  }

  // --------------------------------------------------------------- molting
  function drawMolting(ctx) {
    const m = ui.molt, age = real() - m.t0, t = real();
    dim(ctx, 0.8, 0.10 + 0.02 * Math.sin(t * 2));
    const hA = smooth(clamp(age / 0.6, 0, 1));
    ctx.save(); ctx.globalAlpha = hA;
    spaced(ctx, 'MOLTING', W / 2, 70, 12, { size: 38, font: SERIF, weight: 700, color: COL.amberHi, align: 'center' });
    txt(ctx, 'Your old skin splits open. Choose an adaptation to grow into.', W / 2, 100, { size: 15, italic: true, font: SERIF, color: COL.text2, align: 'center' });
    ctx.restore();
    const rects = moltCardRects(m.offers.length), foc = ui.idx.molt == null ? 0 : ui.idx.molt, lv = safe(() => P().upgrades, {}) || {};
    const locked = age < 0.8;
    for (let i = 0; i < rects.length; i++) {
      const id = m.offers[i], up = C.UPGRADES.find(u => u.id === id) || { id, name: id ? titleize(id) : 'Grow', desc: 'Molt without a new adaptation.', max: 0 };
      const delay = i * 0.12, ca = smooth(clamp((age - 0.15 - delay) / 0.4, 0, 1)), f = i === foc && !locked;
      const r = rects[i], lift = f ? -8 : 0, y = r.y + lift + (1 - ca) * 30;
      ctx.save(); ctx.globalAlpha = ca;
      if (f) { ctx.save(); ctx.shadowColor = 'rgba(242,180,90,0.55)'; ctx.shadowBlur = 28; panel(ctx, r.x, y, r.w, r.h, { fill: COL.panelHi, border: COL.amber, bw: 2, r: 16 }); ctx.restore(); }
      else panel(ctx, r.x, y, r.w, r.h, { fill: COL.panel, r: 16 });
      keycap(ctx, String(i + 1), r.x + 16, y + 16, { h: 24, size: 13 });
      const cx = r.x + r.w / 2, cy = y + 88;
      const gg = ctx.createRadialGradient(cx, cy, 6, cx, cy, 52); gg.addColorStop(0, f ? 'rgba(242,180,90,0.34)' : 'rgba(242,180,90,0.16)'); gg.addColorStop(1, 'rgba(242,180,90,0)'); ctx.fillStyle = gg; ctx.fillRect(cx - 54, cy - 54, 108, 108);
      ctx.beginPath(); ctx.arc(cx, cy, 36, 0, 7); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = f ? COL.amberHi : COL.amberDim; ctx.stroke();
      icon(ctx, UPGRADE_ICON[up.id] || 'star', cx, cy, 38, f ? COL.amberHi : COL.amber);
      txt(ctx, up.name, cx, y + 160, { size: 23, font: SERIF, weight: 700, color: f ? COL.amberHi : COL.text, align: 'center' });
      const cur = lv[up.id] || 0, max = up.max || 3;
      for (let k = 0; k < max; k++) { const px = cx + (k - (max - 1) / 2) * 20; ctx.beginPath(); ctx.arc(px, y + 182, 6, 0, 7); if (k < cur) { ctx.fillStyle = COL.amber; ctx.fill(); } else if (k === cur) { ctx.fillStyle = 'rgba(242,180,90,' + (0.35 + 0.35 * Math.sin(t * 4)) + ')'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = COL.amberHi; ctx.stroke(); } else { ctx.lineWidth = 1.5; ctx.strokeStyle = COL.amberDeep; ctx.stroke(); } }
      txt(ctx, max ? 'Level ' + cur + '  →  ' + Math.min(max, cur + 1) : '', cx, y + 208, { size: 12, weight: 600, color: COL.text3, align: 'center' });
      para(ctx, up.desc, r.x + 24, y + 224, r.w - 48, { size: 16, lh: 22, align: 'center', color: COL.text2, maxLines: 3 });
      if (f) txt(ctx, 'Press Enter or click to choose', cx, y + r.h - 14, { size: 11, weight: 600, color: COL.amberDim, align: 'center' });
      ctx.restore();
    }
    // adaptation overview
    const ox = 160, oy = 436, ow = 960, oh = 78;
    ctx.save(); ctx.globalAlpha = smooth(clamp((age - 0.5) / 0.5, 0, 1));
    panel(ctx, ox, oy, ow, oh, { fill: COL.panelSoft, r: 12 });
    spaced(ctx, 'YOUR ADAPTATIONS', ox + 18, oy + 22, 2, { size: 10, weight: 700, color: COL.amberDim, align: 'left' });
    const cw = (ow - 36) / C.UPGRADES.length;
    C.UPGRADES.forEach((u, i) => {
      const x = ox + 18 + i * cw, c = lv[u.id] || 0, offered = m.offers.indexOf(u.id) >= 0;
      icon(ctx, UPGRADE_ICON[u.id] || 'star', x + 14, oy + 50, 18, c ? COL.amber : (offered ? COL.amberDim : COL.text3));
      txt(ctx, fit(ctx, u.name, cw - 52, 11.5, 600), x + 32, oy + 47, { size: 11.5, weight: 600, color: c ? COL.text : COL.text3 });
      for (let k = 0; k < (u.max || 3); k++) { ctx.beginPath(); ctx.arc(x + 36 + k * 13, oy + 62, 3.6, 0, 7); if (k < c) { ctx.fillStyle = COL.amber; ctx.fill(); } else { ctx.lineWidth = 1.2; ctx.strokeStyle = COL.amberDeep; ctx.stroke(); } }
    });
    ctx.restore();
    // lore
    const next = Math.min(C.STAGES.length - 1, m.into == null ? 1 : m.into), lore = safe(() => Game.edu.STAGE_LORE[next], null);
    if (lore) {
      const ly = 528, lh = 168;
      ctx.save(); ctx.globalAlpha = smooth(clamp((age - 0.7) / 0.5, 0, 1));
      panel(ctx, ox, ly, ow, lh, { fill: COL.panelSoft, r: 12 });
      spaced(ctx, 'BECOMING', ox + 22, ly + 26, 2, { size: 10, weight: 700, color: COL.amberDim, align: 'left' });
      txt(ctx, lore.title, ox + 22, ly + 58, { size: 26, font: SERIF, weight: 700, color: COL.amberHi });
      para(ctx, lore.text, ox + 22, ly + 76, 430, { size: 14.5, lh: 20, color: COL.text, maxLines: 5 });
      ctx.fillStyle = COL.lineSoft; ctx.fillRect(ox + 480, ly + 18, 1, lh - 36);
      spaced(ctx, 'THE SCIENCE', ox + 506, ly + 26, 2, { size: 10, weight: 700, color: COL.info, align: 'left' });
      para(ctx, lore.scienceText, ox + 506, ly + 36, 432, { size: 13.5, lh: 19, italic: true, font: SERIF, color: COL.text2, maxLines: 7 });
      ctx.restore();
    }
    txt(ctx, locked ? '' : '1 2 3  or  ← → + Enter', W / 2, H - 10, { size: 11, color: COL.text3, align: 'center' });
  }

  // ================================================================== CODEX
  const roleColor = (role) => COL[role] || COL.neutral;
  const ROLE_LABEL = { prey: 'Prey', predator: 'Predator', spider: 'Spider', neutral: 'Neutral', resource: 'Resource', player: 'You' };

  function pips(ctx, x, y, n, max, color) {
    for (let i = 0; i < max; i++) { ctx.beginPath(); ctx.arc(x + i * 16 + 6, y, 5.5, 0, 7); if (i < n) { ctx.fillStyle = color; ctx.fill(); } else { ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke(); } }
  }

  function drawCodex(ctx) {
    const cx = ui.codex, a = fadeIn(0.25);
    ctx.save(); ctx.globalAlpha = a;
    dim(ctx, 0.84);
    panel(ctx, CODEX.x, CODEX.y, CODEX.w, CODEX.h, { fill: 'rgba(14,10,7,0.94)', border: 'rgba(255,205,130,0.3)', r: 18 });
    const E = Game.edu, ec = E ? E.counts() : { unlocked: 0, total: 0 };
    const ids = bestiaryIds(), seenN = ids.filter(isSeen).length;
    const labels = ['Bestiary  ' + seenN + '/' + ids.length, 'Encyclopedia  ' + ec.unlocked + '/' + ec.total, 'Anatomy', 'Food Web'];
    const tr = codexTabRects(), mouse = Game.input.mouse;
    for (let i = 0; i < 4; i++) {
      const r = tr[i], act = i === cx.tab, hov = inRect(mouse.x, mouse.y, r);
      if (act) { rr(ctx, r.x, r.y, r.w, r.h, 10); ctx.fillStyle = 'rgba(242,180,90,0.14)'; ctx.fill(); ctx.fillStyle = COL.amber; ctx.fillRect(r.x + 14, r.y + r.h - 3, r.w - 28, 3); }
      else if (hov) { rr(ctx, r.x, r.y, r.w, r.h, 10); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill(); }
      txt(ctx, labels[i], r.x + r.w / 2, r.y + r.h / 2 + 1, { size: 15, weight: act ? 700 : 600, color: act ? COL.amberHi : COL.text2, align: 'center', base: 'middle' });
    }
    // right side hints
    let hx = CODEX.x + CODEX.w - 22;
    txt(ctx, 'Close', hx, CODEX.y + 38, { size: 12, color: COL.text3, align: 'right' }); hx -= measure(ctx, 'Close', 12) + 8;
    hx -= keycap(ctx, 'Esc', hx - 30, CODEX.y + 26, { h: 22 }) + 6;
    txt(ctx, 'Tabs', hx - 4, CODEX.y + 38, { size: 12, color: COL.text3, align: 'right' }); hx -= measure(ctx, 'Tabs', 12) + 12;
    hx -= keycap(ctx, 'E', hx - 22, CODEX.y + 26, { h: 22 }) + 3; hx -= keycap(ctx, 'Q', hx - 22, CODEX.y + 26, { h: 22 }) + 3;
    ctx.fillStyle = COL.line; ctx.fillRect(CODEX.x + 20, CODEX.y + 62, CODEX.w - 40, 1);
    switch (cx.tab) { case 0: drawBestiary(ctx); break; case 1: drawEncy(ctx); break; case 2: drawAnatomy(ctx); break; default: drawFoodWeb(ctx); }
    ctx.restore();
  }

  // ------------------------------------------------------------- bestiary
  function drawBestiary(ctx) {
    const cx = ui.codex, G = bestiaryGrid(), t = real();
    if (!G.ids.length) { txt(ctx, 'No creature data available.', CONTENT.x + 20, CONTENT.y + 40, { size: 16, color: COL.text3 }); return; }
    cx.bsel = clamp(cx.bsel, 0, G.ids.length - 1);
    const seenN = G.ids.filter(isSeen).length;
    txt(ctx, 'Discovered ' + seenN + ' of ' + G.ids.length + ' creatures', BEST.x, 118, { size: 13, weight: 600, color: COL.text2 });
    txt(ctx, 'Creatures are catalogued the first time you see them.', BEST.x + BEST.vw, 118, { size: 12, italic: true, font: SERIF, color: COL.text3, align: 'right' });
    ctx.save(); ctx.beginPath(); ctx.rect(BEST.x - 6, BEST.y - 2, BEST.vw + 12, BEST.vh + 4); ctx.clip();
    G.cards.forEach((c, i) => {
      if (c.y + c.h < BEST.y - 4 || c.y > BEST.y + BEST.vh + 4) return;
      const k = kindInfo(c.id), seen = isSeen(c.id), sel = i === cx.bsel, rc = roleColor(k.role);
      if (sel) { ctx.save(); ctx.shadowColor = 'rgba(242,180,90,0.45)'; ctx.shadowBlur = 16; panel(ctx, c.x, c.y, c.w, c.h, { fill: COL.panelHi, border: COL.amber, bw: 2, r: 12 }); ctx.restore(); }
      else panel(ctx, c.x, c.y, c.w, c.h, { fill: seen ? 'rgba(30,22,14,0.9)' : 'rgba(18,13,9,0.9)', r: 12 });
      if (seen) { ctx.fillStyle = U.rgba(rc.length === 7 ? rc : '#c9b99f', 0.85); rr(ctx, c.x + 14, c.y + 5, c.w - 28, 3, 1.5); ctx.fill(); }
      ctx.beginPath(); ctx.arc(c.x + c.w / 2, c.y + 52, 36, 0, 7); const bg = ctx.createRadialGradient(c.x + c.w / 2, c.y + 44, 4, c.x + c.w / 2, c.y + 52, 38); bg.addColorStop(0, seen ? 'rgba(255,230,190,0.16)' : 'rgba(255,255,255,0.06)'); bg.addColorStop(1, 'rgba(0,0,0,0.30)'); ctx.fillStyle = bg; ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(c.x + c.w / 2, c.y + 52, 38, 0, 7); ctx.clip();
      drawKind(ctx, c.id, c.x + c.w / 2, c.y + 52, 54, { silhouette: !seen });
      ctx.restore();
      if (seen) {
        const nl = wrap(ctx, k.name || titleize(c.id), c.w - 10, 12, 600).slice(0, 2); if (nl.length === 2) nl[1] = fit(ctx, nl[1], c.w - 10, 12, 600);
        nl.forEach((l, li) => txt(ctx, l, c.x + c.w / 2, c.y + c.h - 14 - (nl.length - 1 - li) * 14, { size: 12, weight: 600, color: COL.text, align: 'center' }));
      } else txt(ctx, '???', c.x + c.w / 2, c.y + c.h - 16, { size: 12.5, weight: 600, color: COL.text3, align: 'center' });
    });
    ctx.restore();
    if (G.maxScroll > 0) {
      const tx = BEST.x + BEST.vw + 8, th = BEST.vh; rr(ctx, tx, BEST.y, 4, th, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      const hh = Math.max(30, th * th / (th + G.maxScroll)), hy = BEST.y + (th - hh) * (G.scroll / G.maxScroll); rr(ctx, tx, hy, 4, hh, 2); ctx.fillStyle = COL.amberDim; ctx.fill();
    }
    drawBestiaryDetail(ctx, G.ids[cx.bsel]);
  }

  function drawBestiaryDetail(ctx, id) {
    const R = BEST_DETAIL, k = kindInfo(id), seen = isSeen(id), K = KINDS() || {};
    panel(ctx, R.x, R.y, R.w, R.h, { fill: 'rgba(24,17,11,0.92)', r: 14 });
    const px = R.x + 20 + 64, py = R.y + 20 + 64;
    ctx.beginPath(); ctx.arc(px, py, 66, 0, 7); const bg = ctx.createRadialGradient(px, py - 14, 6, px, py, 68); bg.addColorStop(0, seen ? 'rgba(255,228,180,0.22)' : 'rgba(255,255,255,0.07)'); bg.addColorStop(1, 'rgba(0,0,0,0.38)'); ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = seen ? U.rgba(roleColor(k.role).length === 7 ? roleColor(k.role) : '#c9b99f', 0.6) : COL.lineSoft; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(px, py, 64, 0, 7); ctx.clip(); drawKind(ctx, id, px, py, 112, { silhouette: !seen }); ctx.restore();
    const x0 = R.x + 170, w0 = R.w - 170 - 20;
    if (!seen) {
      txt(ctx, 'Unknown creature', x0, R.y + 54, { size: 24, font: SERIF, weight: 700, color: COL.text3 });
      txt(ctx, 'Not yet encountered', x0, R.y + 78, { size: 14, italic: true, font: SERIF, color: COL.text3 });
      const hab = (k.habitat || []).map(h => (C.ZONES.find(z => z.id === h) || { name: titleize(h) }).name);
      let y = R.y + 170;
      y = para(ctx, 'Explore the world to find this creature. Once you spot it, its portrait and everything you can learn about it will appear here.', R.x + 24, y, R.w - 48, { size: 15, lh: 22, color: COL.text2 });
      if (hab.length) { y += 14; spaced(ctx, 'RUMORED HABITAT', R.x + 24, y + 10, 2, { size: 10, weight: 700, color: COL.amberDim, align: 'left' }); let cx2 = R.x + 24; hab.forEach(h => { cx2 += chip(ctx, h, cx2, y + 22, COL.amber) + 6; }); }
      return;
    }
    const nm = wrap(ctx, k.name || titleize(id), w0, 25, 700, SERIF);
    nm.slice(0, 2).forEach((l, i) => txt(ctx, l, x0, R.y + 44 + i * 28, { size: 25, font: SERIF, weight: 700, color: COL.amberHi }));
    let ly = R.y + 44 + (Math.min(2, nm.length) - 1) * 28 + 22;
    if (k.latin) txt(ctx, fit(ctx, k.latin, w0, 14, 400, SERIF, true), x0, ly, { size: 14, italic: true, font: SERIF, color: COL.amberDim });
    let cxp = x0, cyp = ly + 14;
    const rl = ROLE_LABEL[k.role] || titleize(k.role || 'creature');
    cxp += chip(ctx, rl, cxp, cyp, roleColor(k.role)) + 6;
    if (k.flying) cxp += chip(ctx, 'Flies', cxp, cyp, COL.info) + 6;
    if (k.nocturnal != null && cxp + 90 < x0 + w0) cxp += chip(ctx, k.nocturnal ? 'Nocturnal' : 'Daytime', cxp, cyp, k.nocturnal ? '#aab4ff' : '#ffd36a') + 6;
    // stats
    let y = R.y + 172;
    const row = (label, fn) => { txt(ctx, label, R.x + 24, y + 4, { size: 11, weight: 700, color: COL.text3 }); fn(R.x + 112); y += 28; };
    const maxD = Math.max(1, ...Object.keys(K).map(i => (K[i].danger || 0))), maxG = Math.max(1, ...Object.keys(K).map(i => ((K[i].value && K[i].value.growth) || 0)));
    row('HABITAT', (x) => { let xx = x; (k.habitat && k.habitat.length ? k.habitat : []).forEach(h => { const nmz = (C.ZONES.find(z => z.id === h) || { name: titleize(h) }).name; xx += chip(ctx, nmz, xx, y - 8, '#c9b99f') + 5; }); if (!(k.habitat && k.habitat.length)) txt(ctx, 'Unknown', x, y + 4, { size: 13, color: COL.text3 }); });
    row('EATS', (x) => { const d = (k.diet && k.diet.length) ? k.diet.map(titleize).join(', ') : 'Unknown'; txt(ctx, fit(ctx, d, R.w - 136, 13, 500), x, y + 4, { size: 13, color: COL.text }); });
    row('THREAT', (x) => { const n = k.danger ? clamp(Math.ceil(k.danger / maxD * 5), 1, 5) : 0; pips(ctx, x, y, n, 5, COL.bad); txt(ctx, n ? '' : 'Harmless', x + 92, y + 4, { size: 12, color: COL.text3 }); });
    row('NUTRITION', (x) => { const g = (k.value && k.value.growth) || 0; const n = (role => (role === 'prey' || role === 'neutral') && g > 0)(k.role) ? clamp(Math.ceil(g / maxG * 5), 1, 5) : 0; pips(ctx, x, y, n, 5, COL.good); if (!n) txt(ctx, 'Not food', x + 92, y + 4, { size: 12, color: COL.text3 }); });
    y += 4;
    ctx.fillStyle = COL.lineSoft; ctx.fillRect(R.x + 24, y - 6, R.w - 48, 1);
    const descMax = k.fact ? 4 : 7;
    y = para(ctx, k.description || 'No description recorded.', R.x + 24, y + 2, R.w - 48, { size: 14, lh: 20, color: COL.text2, maxLines: descMax });
    if (k.fact) {
      y += 10; const fh = paraH(ctx, k.fact, R.w - 48 - 28, { size: 13, lh: 18, italic: true, font: SERIF, maxLines: 5 }) + 34;
      const by = Math.min(y, R.y + R.h - fh - 14);
      panel(ctx, R.x + 24, by, R.w - 48, fh, { fill: 'rgba(242,180,90,0.08)', border: 'rgba(242,180,90,0.3)', r: 10, accent: COL.amber });
      spaced(ctx, 'DID YOU KNOW?', R.x + 42, by + 20, 2, { size: 10, weight: 700, color: COL.amber, align: 'left' });
      para(ctx, k.fact, R.x + 42, by + 28, R.w - 48 - 36, { size: 13, lh: 18, italic: true, font: SERIF, color: COL.text, maxLines: 5 });
    }
  }

  // ---------------------------------------------------------- encyclopedia
  function drawEncy(ctx) {
    const cx = ui.codex, E = Game.edu; if (!E) { txt(ctx, 'No education data.', CONTENT.x + 20, CONTENT.y + 40, { size: 16, color: COL.text3 }); return; }
    const cats = [{ id: 'all', name: 'All Facts', color: COL.amber }].concat(E.CATEGORIES.map(c => ({ id: c.id, name: c.name, color: c.color })));
    const rects = encyCatRects(), mouse = Game.input.mouse;
    cats.forEach((c, i) => {
      const r = rects[i], act = i === cx.cat, hov = inRect(mouse.x, mouse.y, r), n = E.counts(c.id === 'all' ? null : c.id);
      panel(ctx, r.x, r.y, r.w, r.h, { fill: act ? 'rgba(52,37,20,0.95)' : (hov ? 'rgba(34,25,16,0.9)' : 'rgba(22,16,11,0.9)'), border: act ? COL.amber : COL.lineSoft, bw: act ? 1.5 : 1, r: 10 });
      ctx.beginPath(); ctx.arc(r.x + 20, r.y + 22, 6, 0, 7); ctx.fillStyle = c.color; ctx.fill();
      txt(ctx, c.name, r.x + 36, r.y + 22, { size: 15, weight: act ? 700 : 600, color: act ? COL.amberHi : COL.text, base: 'middle' });
      txt(ctx, n.unlocked + '/' + n.total, r.x + r.w - 14, r.y + 22, { size: 13, weight: 600, color: COL.text2, align: 'right', base: 'middle' });
      bar(ctx, r.x + 36, r.y + 38, r.w - 36 - 14, 5, n.total ? n.unlocked / n.total : 0, c.color, { border: 'rgba(255,255,255,0.06)' });
    });
    // overall
    const all = E.counts(), oy = rects[6].y + rects[6].h + 16;
    txt(ctx, 'Discovered', 60, oy + 14, { size: 12, weight: 600, color: COL.text3 });
    txt(ctx, all.unlocked + ' / ' + all.total, 60, oy + 50, { size: 32, font: SERIF, weight: 700, color: COL.amberHi });
    para(ctx, 'Unlock facts by playing: eat, spin, molt and explore. Discoveries are saved between journeys.', 60, oy + 62, 250, { size: 12.5, lh: 17, italic: true, font: SERIF, color: COL.text3 });

    const B = encyBase(cx.cat), A = ENCY_COLS, sc = clamp(cx.escroll, 0, encyMaxScroll());
    ctx.save(); ctx.beginPath(); ctx.rect(A.x - 4, A.y - 2, A.w + 8, A.h + 4); ctx.clip();
    const tw = A.colW - 36;
    B.cards.forEach(c => {
      const y = A.y + c.y - sc; if (y + c.h < A.y - 4 || y > A.y + A.h + 4) return;
      const f = c.f, col = CAT_COL[f.category] || COL.amber, isNew = c.un && E.recent.indexOf(f.id) >= 0;
      panel(ctx, c.x, y, A.colW, c.h, { fill: c.un ? 'rgba(30,22,14,0.92)' : 'rgba(16,12,8,0.9)', accent: c.un ? col : 'rgba(255,255,255,0.1)', r: 12, border: c.un ? U.rgba(col, 0.28) : COL.lineSoft });
      if (c.un) {
        txt(ctx, fit(ctx, f.title, A.colW - 36 - 96, 16, 700), c.x + 20, y + 14 + 17, { size: 16, weight: 700, color: COL.text });
        txt(ctx, CAT_NAME[f.category] || '', c.x + A.colW - 16, y + 30, { size: 10, weight: 700, color: col, align: 'right' });
        if (isNew) chip(ctx, 'NEW', c.x + A.colW - 62, y + 36, COL.amber, { size: 9, h: 15 });
        para(ctx, f.text, c.x + 20, y + 14 + 24 + 4, tw, { size: 14, lh: 19, color: COL.text2 });
      } else {
        icon(ctx, 'lock', c.x + 28, y + 14 + 11, 16, COL.text3);
        txt(ctx, '???', c.x + 46, y + 14 + 17, { size: 16, weight: 700, color: COL.text3 });
        txt(ctx, CAT_NAME[f.category] || '', c.x + A.colW - 16, y + 30, { size: 10, weight: 700, color: U.rgba(col, 0.55), align: 'right' });
        para(ctx, f.hint ? 'Hint: ' + f.hint : 'Not discovered yet.', c.x + 20, y + 14 + 24 + 4, tw, { size: 13, lh: 18, color: COL.text3, italic: true, font: SERIF });
      }
    });
    ctx.restore();
    const max = encyMaxScroll();
    if (max > 0) {
      const tx = A.x + A.w - 6, th = A.h; rr(ctx, tx, A.y, 4, th, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      const hh = Math.max(30, th * th / (th + max)), hy = A.y + (th - hh) * (sc / max); rr(ctx, tx, hy, 4, hh, 2); ctx.fillStyle = COL.amberDim; ctx.fill();
    }
    if (!B.cards.length) txt(ctx, 'No facts in this category.', A.x + 20, A.y + 40, { size: 16, color: COL.text3 });
  }

  // -------------------------------------------------------------- anatomy
  const LEGS_R = [
    [[176, 92], [204, 60], [236, 36], [260, 38]],
    [[180, 104], [222, 76], [262, 78], [284, 104]],
    [[182, 118], [228, 114], [266, 130], [282, 162]],
    [[178, 134], [214, 154], [242, 186], [250, 224]],
  ];
  function drawAnatomySpider(ctx, S, selId, t) {
    const s = S / 300;
    ctx.save(); ctx.scale(s, s);
    // faint blueprint grid
    ctx.strokeStyle = 'rgba(255,205,130,0.05)'; ctx.lineWidth = 1 / s;
    for (let i = 0; i <= 300; i += 25) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke(); }
    const sel = (id) => selId === id;
    const body = '#2e2118', bodyHi = '#4a3626';
    // legs
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let side = -1; side <= 1; side += 2) {
      LEGS_R.forEach((pts, li) => {
        const P2 = pts.map(p => [side > 0 ? p[0] : 300 - p[0], p[1]]);
        ctx.strokeStyle = (sel('legs') ? '#6a4a2c' : body); ctx.lineWidth = 6.5; ctx.beginPath(); P2.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.stroke();
        ctx.strokeStyle = bodyHi; ctx.lineWidth = 2.4; ctx.beginPath(); P2.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1] - 0.8)); ctx.stroke();
        ctx.fillStyle = '#7a5a3a'; for (let j = 1; j < P2.length - 1; j++) { ctx.beginPath(); ctx.arc(P2[j][0], P2[j][1], 3.1, 0, 7); ctx.fill(); }
        // hairs
        ctx.strokeStyle = 'rgba(210,170,120,0.5)'; ctx.lineWidth = 0.8; ctx.beginPath();
        for (let j = 0; j < P2.length - 1; j++) for (let q = 0.2; q < 1; q += 0.3) { const x = P2[j][0] + (P2[j + 1][0] - P2[j][0]) * q, y = P2[j][1] + (P2[j + 1][1] - P2[j][1]) * q; ctx.moveTo(x, y); ctx.lineTo(x + 3 * side, y - 3); ctx.moveTo(x, y); ctx.lineTo(x + 3 * side, y + 3); }
        ctx.stroke();
        // claws
        const e = P2[P2.length - 1], pe = P2[P2.length - 2], ang = Math.atan2(e[1] - pe[1], e[0] - pe[0]);
        ctx.strokeStyle = sel('tarsus') ? COL.amberHi : '#8a6a48'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] + Math.cos(ang + 0.5) * 6, e[1] + Math.sin(ang + 0.5) * 6); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] + Math.cos(ang - 0.5) * 6, e[1] + Math.sin(ang - 0.5) * 6); ctx.stroke();
      });
    }
    // pedipalps
    for (let side = -1; side <= 1; side += 2) {
      const x = (v) => side > 0 ? v : 300 - v;
      ctx.strokeStyle = sel('pedipalps') ? '#8a5e30' : '#3a2a1e'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x(166), 78); ctx.lineTo(x(180), 58); ctx.lineTo(x(174), 42); ctx.stroke();
      ctx.fillStyle = sel('pedipalps') ? COL.amber : '#5a4030'; ctx.beginPath(); ctx.ellipse(x(173), 39, 4.5, 6, 0.1 * side, 0, 7); ctx.fill();
    }
    // abdomen
    const ag = ctx.createRadialGradient(140, 195, 8, 150, 212, 70); ag.addColorStop(0, sel('abdomen') ? '#6a4a2c' : '#4e3a28'); ag.addColorStop(1, '#241a12');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.ellipse(150, 212, 52, 66, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,130,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    // abdomen pattern
    ctx.strokeStyle = 'rgba(210,160,100,0.38)'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) { const yy = 190 + i * 15; ctx.beginPath(); ctx.moveTo(122 + i * 3, yy + 8); ctx.lineTo(150, yy); ctx.lineTo(178 - i * 3, yy + 8); ctx.stroke(); }
    // heart (dorsal tube)
    ctx.save(); ctx.globalAlpha = sel('heart') ? 0.95 : 0.4; ctx.strokeStyle = '#ff7f7f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(150, 166); ctx.lineTo(150, 226); ctx.stroke();
    ctx.strokeStyle = '#ffd2d2'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -t * 6; ctx.beginPath(); ctx.moveTo(150, 168); ctx.lineTo(150, 224); ctx.stroke(); ctx.restore();
    // book lungs + silk glands (hidden structures: dashed ghosts)
    ctx.save(); ctx.setLineDash([3, 3]);
    ctx.globalAlpha = sel('lungs') ? 1 : 0.5; ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = 1.6;
    for (let sd = -1; sd <= 1; sd += 2) { ctx.beginPath(); ctx.ellipse(150 + sd * 26, 178, 10, 14, sd * 0.2, 0, 7); ctx.stroke(); ctx.beginPath(); for (let q = -2; q <= 2; q++) { ctx.moveTo(150 + sd * 26 - 7, 178 + q * 4); ctx.lineTo(150 + sd * 26 + 7, 178 + q * 4); } ctx.stroke(); }
    ctx.globalAlpha = sel('glands') ? 1 : 0.5; ctx.strokeStyle = '#e8e2ff'; ctx.lineWidth = 1.6;
    for (let sd = -1; sd <= 1; sd += 2) { ctx.beginPath(); ctx.ellipse(150 + sd * 17, 248, 9, 12, sd * 0.3, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(150 + sd * 14, 258); ctx.lineTo(150 + sd * 5, 276); ctx.stroke(); }
    ctx.restore();
    // spinnerets
    ctx.fillStyle = sel('spinnerets') ? COL.amberHi : '#6a4e36'; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(150 + i * 6, 281 + Math.abs(i) * 1.5, 3.2, 6, 0, 0, 7); ctx.fill(); }
    // cephalothorax
    const cg = ctx.createRadialGradient(142, 100, 6, 150, 112, 52); cg.addColorStop(0, sel('cephalothorax') ? '#7a5636' : '#5a4230'); cg.addColorStop(1, '#2a1e15');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(150, 112, 38, 46, 0, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,200,130,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(150, 100); ctx.lineTo(150, 134); ctx.moveTo(150, 116); ctx.lineTo(128, 108); ctx.moveTo(150, 116); ctx.lineTo(172, 108); ctx.stroke();
    // pedicel
    ctx.fillStyle = '#2a1e15'; ctx.beginPath(); ctx.ellipse(150, 150, 9, 6, 0, 0, 7); ctx.fill();
    // chelicerae and fangs
    for (let sd = -1; sd <= 1; sd += 2) {
      ctx.fillStyle = sel('chelicerae') ? '#9a6a3a' : '#4a3424'; ctx.beginPath(); ctx.ellipse(150 + sd * 6, 66, 5.5, 9, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = sel('chelicerae') ? '#fff2d0' : '#d9c8a8'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(150 + sd * 6, 70); ctx.quadraticCurveTo(150 + sd * 7.5, 60, 150 + sd * 4, 52); ctx.stroke();
    }
    // eyes: two rows
    const eyes = [[142, 85, 4], [158, 85, 4], [135, 80, 3.2], [165, 80, 3.2], [145, 76, 2.4], [155, 76, 2.4], [138, 90, 2.4], [162, 90, 2.4]];
    eyes.forEach(e => { ctx.fillStyle = sel('eyes') ? '#fff0b8' : '#d8ecff'; ctx.beginPath(); ctx.arc(e[0], e[1], e[2], 0, 7); ctx.fill(); ctx.fillStyle = '#10151c'; ctx.beginPath(); ctx.arc(e[0], e[1], e[2] * 0.5, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(e[0] - e[2] * 0.25, e[1] - e[2] * 0.25, e[2] * 0.2, 0, 7); ctx.fill(); });
    // slit sensilla marks near leg joints
    ctx.strokeStyle = sel('slit') ? COL.amberHi : 'rgba(255,230,180,0.5)'; ctx.lineWidth = 1.6;
    for (let sd = -1; sd <= 1; sd += 2) { const x = (v) => sd > 0 ? v : 300 - v; [[228, 114], [222, 76], [214, 154]].forEach(p => { ctx.beginPath(); ctx.moveTo(x(p[0]) - 2.2, p[1] - 2); ctx.lineTo(x(p[0]) + 2.2, p[1] + 2); ctx.moveTo(x(p[0]) - 2.2, p[1] + 2); ctx.lineTo(x(p[0]) + 2.2, p[1] - 2); ctx.stroke(); }); }
    ctx.restore();
  }

  function drawAnatomy(ctx) {
    const cx = ui.codex, E = Game.edu, parts = E && E.ANATOMY ? E.ANATOMY.parts : [], t = real();
    const D = { x: 60, y: 100, w: 560, h: 568 };
    panel(ctx, D.x, D.y, D.w, D.h, { fill: 'rgba(22,16,11,0.92)', r: 14 });
    cx.part = clamp(cx.part, 0, Math.max(0, parts.length - 1));
    const selP = parts[cx.part];
    ctx.save(); ctx.translate(ANAT.dx, ANAT.dy); drawAnatomySpider(ctx, ANAT.S, selP && selP.id, t); ctx.restore();
    txt(ctx, 'Dorsal view · dashed structures are inside the body', D.x + D.w / 2, D.y + D.h - 14, { size: 11.5, italic: true, font: SERIF, color: COL.text3, align: 'center' });
    // markers
    parts.forEach((p, i) => {
      const q = anatPartPos(p), act = i === cx.part, pul = 0.5 + 0.5 * Math.sin(t * 4);
      if (act) { ctx.beginPath(); ctx.arc(q.x, q.y, 17 + 3 * pul, 0, 7); ctx.fillStyle = 'rgba(242,180,90,' + (0.18 + 0.12 * pul) + ')'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, 7); ctx.fillStyle = act ? COL.amber : 'rgba(14,10,7,0.92)'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = act ? '#fff0c8' : COL.amber; ctx.stroke();
      txt(ctx, String(i + 1), q.x, q.y + 0.5, { size: 11, weight: 700, color: act ? '#2a1a08' : COL.amberHi, align: 'center', base: 'middle' });
    });
    if (selP) { // floating label
      const q = anatPartPos(selP), tw = measure(ctx, selP.name, 13, 700) + 20, right = q.x < ANAT.dx + ANAT.S / 2;
      let lx = right ? q.x + 22 : q.x - 22 - tw; lx = clamp(lx, D.x + 8, D.x + D.w - tw - 8);
      panel(ctx, lx, q.y - 14, tw, 28, { fill: 'rgba(14,10,7,0.95)', border: COL.amber, r: 14 });
      txt(ctx, selP.name, lx + tw / 2, q.y + 0.5, { size: 13, weight: 700, color: COL.amberHi, align: 'center', base: 'middle' });
    }
    // list
    const rects = anatChipRects(parts.length);
    parts.forEach((p, i) => {
      const r = rects[i], act = i === cx.part;
      panel(ctx, r.x, r.y, r.w, r.h, { fill: act ? 'rgba(52,37,20,0.95)' : 'rgba(22,16,11,0.9)', border: act ? COL.amber : COL.lineSoft, r: 9 });
      ctx.beginPath(); ctx.arc(r.x + 19, r.y + r.h / 2, 10, 0, 7); ctx.fillStyle = act ? COL.amber : 'rgba(255,255,255,0.08)'; ctx.fill();
      txt(ctx, String(i + 1), r.x + 19, r.y + r.h / 2 + 0.5, { size: 11, weight: 700, color: act ? '#2a1a08' : COL.text2, align: 'center', base: 'middle' });
      txt(ctx, fit(ctx, p.name, r.w - 48, 13.5, 600), r.x + 38, r.y + r.h / 2 + 0.5, { size: 13.5, weight: act ? 700 : 500, color: act ? COL.amberHi : COL.text, base: 'middle' });
    });
    const B = ANAT.detail;
    panel(ctx, B.x, B.y, B.w, B.h, { fill: 'rgba(24,17,11,0.94)', r: 14, accent: COL.amber });
    if (selP) {
      spaced(ctx, 'PART ' + (cx.part + 1) + ' OF ' + parts.length, B.x + 26, B.y + 30, 2, { size: 10, weight: 700, color: COL.amberDim, align: 'left' });
      txt(ctx, fit(ctx, selP.name, B.w - 52, 28, 700, SERIF), B.x + 26, B.y + 66, { size: 28, font: SERIF, weight: 700, color: COL.amberHi });
      para(ctx, selP.text, B.x + 26, B.y + 82, B.w - 52, { size: 16, lh: 24, color: COL.text });
      if (/lungs|heart|glands/.test(selP.id)) txt(ctx, 'Hidden inside the body (dashed in the diagram).', B.x + 26, B.y + B.h - 42, { size: 12.5, italic: true, font: SERIF, color: COL.info });
    }
    txt(ctx, '\u2190 \u2192 browse parts, or hover the numbers', B.x + B.w / 2, B.y + B.h - 16, { size: 11, color: COL.text3, align: 'center' });
  }

  // ------------------------------------------------------------- food web
  const LEVEL_NAMES = ['Producers and decomposed matter', 'Plant-eaters and scavengers', 'Small predators', 'Larger predators', 'Top of the food web', 'Top of the food web'];
  function drawFoodWeb(ctx) {
    const cx = ui.codex, L = webLayout(), t = real();
    panel(ctx, FWB.x, FWB.y, FWB.w, FWB.h, { fill: 'rgba(22,16,11,0.92)', r: 14 });
    panel(ctx, FWI.x, FWI.y, FWI.w, FWI.h, { fill: 'rgba(24,17,11,0.94)', r: 14 });
    if (!L || !L.nodes.length) { txt(ctx, 'No ecosystem data.', FWB.x + 24, FWB.y + 44, { size: 16, color: COL.text3 }); return; }
    cx.fsel = clamp(cx.fsel, 0, L.order.length - 1);
    const selId = L.order[cx.fsel], R = 19;
    const nodeSeen = (n) => n.type !== 'creature' || isSeen(n.kind);
    // level bands
    for (let l = 0; l <= L.maxL; l++) {
      const y = FWB.y + 64 + (L.maxL - l) * ((FWB.h - 150) / L.maxL);
      ctx.fillStyle = l % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,205,130,0.025)'; ctx.fillRect(FWB.x + 8, y - 38, FWB.w - 16, (FWB.h - 150) / L.maxL);
      txt(ctx, (LEVEL_NAMES[l] || '').toUpperCase(), FWB.x + 18, y - 25, { size: 9.5, weight: 700, color: COL.text3 });
    }
    // edges
    const hi = (e) => e.from === selId || e.to === selId;
    const drawEdge = (e, pass) => {
      const a = L.pos[e.from], b = L.pos[e.to]; if (!a || !b) return;
      const h = hi(e); if ((pass === 1) !== h) return;
      if (e.risk && !h) return;
      const fa = L.byId[e.from], fb = L.byId[e.to];
      const known = nodeSeen(fa) && nodeSeen(fb);
      const x1 = a.x, y1 = a.y - R, x2 = b.x, y2 = b.y + R, dy = Math.max(30, (y1 - y2) * 0.5);
      const downEdge = y2 > y1; // risk edges can go down
      ctx.beginPath(); ctx.moveTo(x1, e.risk && downEdge ? a.y + R : y1);
      const ey1 = e.risk && downEdge ? a.y + R : y1, ey2 = e.risk && downEdge ? b.y - R : y2;
      ctx.bezierCurveTo(x1, ey1 + (ey2 > ey1 ? dy : -dy), x2, ey2 + (ey2 > ey1 ? -dy : dy), x2, ey2);
      const col = h ? (e.risk ? '#ff7a6a' : (e.to === selId ? COL.amberHi : '#8fe3a8')) : 'rgba(255,230,190,' + (known ? 0.16 : 0.07) + ')';
      ctx.strokeStyle = col; ctx.lineWidth = h ? 2 : 1.2; if (e.risk) ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      // arrow head
      ctx.save(); ctx.translate(x2, ey2); ctx.rotate(ey2 > ey1 ? Math.PI / 2 : -Math.PI / 2); ctx.fillStyle = h ? col : 'rgba(255,230,190,0.22)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -3.6); ctx.lineTo(-7, 3.6); ctx.closePath(); ctx.fill(); ctx.restore();
    };
    L.edges.forEach(e => drawEdge(e, 0)); L.edges.forEach(e => drawEdge(e, 1));
    // nodes
    L.nodes.forEach(n => {
      const p = L.pos[n.id], sel = n.id === selId, seen = nodeSeen(n), rc = n.type === 'resource' ? COL.resource : (n.type === 'player' ? COL.player : roleColor(n.role));
      ctx.save();
      if (sel) { ctx.beginPath(); ctx.arc(p.x, p.y, R + 7 + 2 * Math.sin(t * 4), 0, 7); ctx.fillStyle = 'rgba(242,180,90,0.2)'; ctx.fill(); }
      ctx.beginPath(); if (n.type === 'resource') rr(ctx, p.x - R * 0.9, p.y - R * 0.9, R * 1.8, R * 1.8, 7); else ctx.arc(p.x, p.y, R, 0, 7);
      ctx.fillStyle = 'rgba(16,12,8,0.95)'; ctx.fill(); ctx.lineWidth = sel ? 2.5 : 1.8; ctx.strokeStyle = seen ? rc : 'rgba(255,255,255,0.18)'; ctx.stroke();
      if (n.type === 'resource') icon(ctx, 'leaf', p.x, p.y, 20, COL.resource);
      else if (n.type === 'player') spiderGlyph(ctx, p.x, p.y + 1, 9, t, { color: COL.amber, legColor: COL.amber, flat: true, noGlow: true });
      else { ctx.beginPath(); ctx.arc(p.x, p.y, R - 2, 0, 7); ctx.clip(); drawKind(ctx, n.kind, p.x, p.y, 30, { silhouette: !seen }); }
      ctx.restore();
      const label = n.type === 'creature' && !seen ? '???' : n.name;
      txt(ctx, fit(ctx, label, 84, 11, sel ? 700 : 500), p.x, p.y + R + 14, { size: 11, weight: sel ? 700 : 500, color: sel ? COL.amberHi : (seen ? COL.text2 : COL.text3), align: 'center' });
    });
    // legend
    let lx = FWB.x + 18; const ly = FWB.y + FWB.h - 16;
    [['Prey', COL.prey], ['Predator', COL.predator], ['Spider', COL.spider], ['Neutral', COL.neutral], ['You', COL.player]].forEach(l => { ctx.beginPath(); ctx.arc(lx + 4, ly - 4, 4, 0, 7); ctx.fillStyle = l[1]; ctx.fill(); txt(ctx, l[0], lx + 14, ly, { size: 11, color: COL.text3 }); lx += 28 + measure(ctx, l[0], 11); });
    txt(ctx, 'Arrows point from the eaten to the eater', FWB.x + FWB.w - 18, ly, { size: 11, italic: true, font: SERIF, color: COL.text3, align: 'right' });
    // info panel
    const n = L.byId[selId], seen = nodeSeen(n); let y = FWI.y + 30;
    spaced(ctx, 'SELECTED', FWI.x + 20, y, 2, { size: 10, weight: 700, color: COL.amberDim, align: 'left' }); y += 30;
    txt(ctx, fit(ctx, seen ? n.name : 'Unknown creature', FWI.w - 40, 22, 700, SERIF), FWI.x + 20, y, { size: 22, font: SERIF, weight: 700, color: seen ? COL.amberHi : COL.text3 }); y += 12;
    chip(ctx, n.type === 'resource' ? 'Resource' : (ROLE_LABEL[n.role] || 'Creature'), FWI.x + 20, y, n.type === 'resource' ? COL.resource : (n.type === 'player' ? COL.player : roleColor(n.role))); y += 34;
    const eats = L.edges.filter(e => e.to === n.id && !e.risk).map(e => L.byId[e.from]), eatenBy = L.edges.filter(e => e.from === n.id && !e.risk).map(e => L.byId[e.to]);
    const risk = L.edges.filter(e => e.from === n.id && e.risk).map(e => L.byId[e.to]);
    const nm = (x) => nodeSeen(x) ? x.name : '???';
    const block = (title, list, col) => {
      spaced(ctx, title, FWI.x + 20, y + 10, 2, { size: 10, weight: 700, color: col, align: 'left' }); y += 18;
      const s = list.length ? list.map(nm).join(', ') : 'Nothing in the web';
      y = para(ctx, seen ? s : '???', FWI.x + 20, y, FWI.w - 40, { size: 13.5, lh: 19, color: list.length ? COL.text : COL.text3, maxLines: 6 }) + 12;
    };
    if (n.type === 'resource') block('EATEN BY', eatenBy, COL.amberDim);
    else { block('EATS', eats, COL.good); block(n.type === 'player' ? 'AT RISK FROM' : 'EATEN BY', n.type === 'player' ? risk : eatenBy, COL.bad); }
    if (n.type === 'player') para(ctx, 'You are both predator and prey. Every spider is.', FWI.x + 20, y, FWI.w - 40, { size: 12.5, lh: 18, italic: true, font: SERIF, color: COL.text3 });
    txt(ctx, '← → or hover to inspect', FWI.x + FWI.w / 2, FWI.y + FWI.h - 14, { size: 11, color: COL.text3, align: 'center' });
  }

  // ============================================================== GAME OVER
  function statCell(ctx, x, y, w, h, value, label, color) {
    panel(ctx, x, y, w, h, { fill: 'rgba(30,22,14,0.8)', r: 10, border: COL.lineSoft });
    const small = h < 60;
    txt(ctx, String(value), x + 16, y + (small ? 26 : 34), { size: small ? 22 : 26, font: SERIF, weight: 700, color: color || COL.amberHi });
    txt(ctx, label.toUpperCase(), x + 16, y + h - (small ? 9 : 12), { size: 10, weight: 700, color: COL.text3 });
  }
  function gameoverLayout() {
    const g = mctx(), D = (Game.edu && Game.edu.DEATH) || {}, cause = ui.death.cause || safe(() => P().deathCause, null), d = D[cause] || D.default || { title: 'Your journey ends', flavor: '', science: '' };
    const bw = 820, fh = paraH(g, d.flavor, bw - 140, { size: 17, lh: 25, italic: true, font: SERIF, maxLines: 3 });
    const sbh = 32 + paraH(g, d.science, bw - 80 - 52, { size: 14.5, lh: 21, maxLines: 5 }) + 20;
    const top = 0, flavorY = 166, boxY = flavorY + fh + 20, statsY = boxY + sbh + 18, btnY = statsY + 2 * 68 + 10 + 24, ph = btnY + 52 + 30;
    const py = Math.max(14, Math.round((H - ph) / 2));
    return { d, bw, fh, sbh, flavorY, boxY, statsY, btnY, ph, py };
  }
  function drawGameOver(ctx) {
    const a = fadeIn(0.9), F = ui.final || snapshotStats(), L = gameoverLayout(), d = L.d;
    ctx.save();
    dim(ctx, 0.55 + 0.25 * a);
    const rg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 700); rg.addColorStop(0, 'rgba(120,20,10,' + (0.16 * a) + ')'); rg.addColorStop(1, 'rgba(60,8,4,' + (0.35 * a) + ')'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    const bx = (W - L.bw) / 2, by = L.py, bw = L.bw;
    panel(ctx, bx, by, bw, L.ph, { fill: 'rgba(16,10,8,0.93)', border: 'rgba(229,96,77,0.4)', r: 18 });
    spaced(ctx, 'YOUR JOURNEY ENDS', W / 2, by + 44, 6, { size: 13, weight: 700, color: '#c98578', align: 'center' });
    txt(ctx, d.title, W / 2, by + 104, { size: 50, font: SERIF, weight: 700, color: '#ff9c8a', align: 'center', shadow: true });
    txt(ctx, 'Reached the ' + stageName(F.stage) + ' stage  \u00b7  survived ' + fmtTime(F.time) + '  \u00b7  ' + Game.modeInfo(Game.state.mode).name + ' mode', W / 2, by + 134, { size: 15, italic: true, font: SERIF, color: COL.text2, align: 'center' });
    ctx.fillStyle = 'rgba(229,96,77,0.35)'; ctx.fillRect(bx + 80, by + 152, bw - 160, 1);
    para(ctx, d.flavor, bx + 70, by + L.flavorY, bw - 140, { size: 17, lh: 25, italic: true, font: SERIF, color: COL.text, align: 'center', maxLines: 3 });
    const sy = by + L.boxY;
    panel(ctx, bx + 40, sy, bw - 80, L.sbh, { fill: 'rgba(111,201,192,0.07)', border: 'rgba(111,201,192,0.32)', r: 12, accent: COL.info });
    spaced(ctx, 'THE SCIENCE', bx + 66, sy + 26, 2, { size: 10.5, weight: 700, color: COL.info, align: 'left' });
    para(ctx, d.science, bx + 66, sy + 34, bw - 80 - 52, { size: 14.5, lh: 21, color: COL.text, maxLines: 5 });
    const cells = [[fmtTime(F.time), 'Time survived'], [stageName(F.stage), 'Stage reached'], [F.eaten, 'Creatures eaten'], [F.webs, 'Webs spun'], [F.molts, 'Molts'], [F.runFacts + (F.runFacts === 1 ? ' fact' : ' facts'), 'Discovered this run']];
    const cw = (bw - 80 - 28) / 3;
    cells.forEach((c, i) => statCell(ctx, bx + 40 + (i % 3) * (cw + 14), by + L.statsY + Math.floor(i / 3) * 78, cw, 68, c[0], c[1]));
    const rects = endRects(by + L.btnY), foc = ui.idx.gameover == null ? 0 : ui.idx.gameover, lock = real() - ui.enterT < 0.9;
    drawButton(ctx, rects[0], 'Try Again', foc === 0 && !lock, { size: 18, disabled: lock });
    drawButton(ctx, rects[1], 'Title Screen', foc === 1 && !lock, { size: 18, disabled: lock });
    ctx.restore();
  }

  // ================================================================ VICTORY
  function drawEggSacScene(ctx, x, y, w, h, t) {
    ctx.save(); rr(ctx, x, y, w, h, 14); ctx.clip();
    let g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#1b2433'); g.addColorStop(0.6, '#2a2a32'); g.addColorStop(1, '#2b2118'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // soft moon glow
    g = ctx.createRadialGradient(x + w * 0.78, y + h * 0.2, 4, x + w * 0.78, y + h * 0.2, 150); g.addColorStop(0, 'rgba(210,225,255,0.35)'); g.addColorStop(1, 'rgba(210,225,255,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // out-of-focus leaves
    for (let i = 0; i < 7; i++) { const lx = x + (i * 97 % w), ly = y + 20 + (i * 53 % 120); ctx.fillStyle = 'rgba(40,70,48,' + (0.18 + (i % 3) * 0.05) + ')'; ctx.beginPath(); ctx.ellipse(lx, ly, 60 + (i % 3) * 18, 22 + (i % 2) * 10, (i * 0.7) - 0.4, 0, 7); ctx.fill(); }
    // bark ridge
    ctx.fillStyle = '#3a2b1d'; ctx.beginPath(); ctx.moveTo(x, y + h * 0.78); ctx.quadraticCurveTo(x + w * 0.4, y + h * 0.66, x + w, y + h * 0.82); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(x + i * w / 8, y + h); ctx.quadraticCurveTo(x + i * w / 8 + 18, y + h * 0.88, x + i * w / 8 - 6, y + h * 0.8 + (i % 3) * 7); ctx.stroke(); }
    // silk strands to anchors
    const sx = x + w * 0.5, sy = y + h * 0.58;
    ctx.strokeStyle = 'rgba(240,240,255,0.5)'; ctx.lineWidth = 1;
    [[x + 30, y + 30], [x + w - 40, y + 40], [x + 60, y + h * 0.8], [x + w - 70, y + h * 0.78], [x + w * 0.5, y + 8]].forEach(p => { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + p[0]) / 2 + 6, (sy + p[1]) / 2 + 10, p[0], p[1]); ctx.stroke(); });
    // egg sac
    const pul = 1 + 0.025 * Math.sin(t * 2.2), R = 50 * pul;
    g = ctx.createRadialGradient(sx, sy, 6, sx, sy, R * 2.6); g.addColorStop(0, 'rgba(255,240,200,0.45)'); g.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g; ctx.fillRect(sx - R * 3, sy - R * 3, R * 6, R * 6);
    g = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.35, 4, sx, sy, R); g.addColorStop(0, '#fffaf0'); g.addColorStop(0.7, '#e8dcc4'); g.addColorStop(1, '#b8a888'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy, R, R * 0.92, 0, 0, 7); ctx.fill();
    // silk fibres on the sac
    ctx.strokeStyle = 'rgba(120,100,70,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) { const a0 = i * 0.45 + 0.2; ctx.beginPath(); ctx.ellipse(sx, sy, R * (0.94 - (i % 5) * 0.03), R * 0.88, a0, 0, 2.2 + (i % 4) * 0.4); ctx.stroke(); }
    // glowing eggs inside
    for (let i = 0; i < 22; i++) { const a = i * 2.399, rd = Math.sqrt(i / 22) * R * 0.62, ex = sx + Math.cos(a) * rd, ey = sy + Math.sin(a) * rd * 0.9, tw = 0.5 + 0.5 * Math.sin(t * 2 + i); ctx.fillStyle = 'rgba(255,200,120,' + (0.35 + 0.35 * tw) + ')'; ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, 7); ctx.fill(); }
    // mother spider keeping watch
    spiderGlyph(ctx, x + w * 0.22, y + h * 0.7 + Math.sin(t * 1.3) * 1.5, 15, t, { color: '#120d09', legColor: '#17110b', rot: 0.6 });
    // rising motes
    for (let i = 0; i < 18; i++) { const px = x + ((i * 61 + Math.sin(t * 0.4 + i) * 20) % w + w) % w, py = y + h - ((t * 14 + i * 37) % (h + 20)), al = 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2 + i)); ctx.fillStyle = 'rgba(255,225,160,' + al + ')'; ctx.beginPath(); ctx.arc(px, py, 1.4 + (i % 3) * 0.5, 0, 7); ctx.fill(); }
    ctx.restore();
    ctx.lineWidth = 1; ctx.strokeStyle = COL.line; rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14); ctx.stroke();
  }

  function drawVictory(ctx) {
    const a = fadeIn(1.1), t = real(), F = ui.final || snapshotStats();
    ctx.save();
    dim(ctx, 0.55 + 0.25 * a, 0.14 * a);
    ctx.globalAlpha = a;
    spaced(ctx, 'A NEW GENERATION', W / 2, 78, 10, { size: 44, font: SERIF, weight: 700, color: COL.amberHi, align: 'center' });
    txt(ctx, 'Your egg sac is hidden and safe. The cycle begins again.', W / 2, 112, { size: 16, italic: true, font: SERIF, color: COL.text2, align: 'center' });
    drawEggSacScene(ctx, 80, 138, 520, 306, t);
    // stats
    const sx = 630, sy = 138, sw = 570;
    panel(ctx, sx, sy, sw, 306, { fill: 'rgba(20,14,9,0.88)', r: 14 });
    spaced(ctx, 'YOUR JOURNEY', sx + 24, sy + 30, 3, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    const cells = [[fmtTime(F.time), 'Time survived'], [F.days + 1, 'Days lived'], [F.eaten, 'Creatures eaten'], [F.webs, 'Webs spun'], [F.trapped, 'Prey trapped'], [F.molts, 'Molts'], [F.objectives, 'Objectives done'], [F.facts + '/' + F.factsTotal, 'Facts discovered']];
    const cw = (sw - 48 - 14) / 2;
    cells.forEach((c, i) => statCell(ctx, sx + 24 + (i % 2) * (cw + 14), sy + 46 + Math.floor(i / 2) * 62, cw, 54, c[0], c[1]));
    // life cycle
    const lx = 80, ly = 462, lw = 1120, lh = 148;
    panel(ctx, lx, ly, lw, lh, { fill: 'rgba(20,14,9,0.88)', r: 14 });
    spaced(ctx, 'THE LIFE CYCLE', lx + 24, ly + 28, 3, { size: 11, weight: 700, color: COL.amberDim, align: 'left' });
    const names = ['Egg', 'Hatchling', 'Spiderling', 'Juvenile', 'Sub-adult', 'Adult', 'Egg sac'];
    const n = names.length, x0 = lx + 90, x1 = lx + lw - 90, cy = ly + 76;
    ctx.strokeStyle = 'rgba(255,205,130,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([2, 6]); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * i / (n - 1), glow = 0.5 + 0.5 * Math.sin(t * 2 - i * 0.7);
      ctx.beginPath(); ctx.arc(x, cy, 28, 0, 7); ctx.fillStyle = 'rgba(30,22,14,0.95)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = COL.amber; ctx.globalAlpha = a * (0.6 + 0.4 * glow); ctx.stroke(); ctx.globalAlpha = a;
      if (i === 0 || i === n - 1) { ctx.fillStyle = i === 0 ? '#efe3c8' : '#fff4d8'; ctx.beginPath(); ctx.ellipse(x, cy, i === 0 ? 7 : 11, i === 0 ? 9 : 10, 0, 0, 7); ctx.fill(); if (i === n - 1) { ctx.fillStyle = 'rgba(255,190,100,0.7)'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 1.9) * 5, cy + Math.sin(k * 1.9) * 5, 1.5, 0, 7); ctx.fill(); } } }
      else spiderGlyph(ctx, x, cy + 1, 3.5 + (i - 1) * 2.1, t, { color: COL.amber, legColor: COL.amber, flat: true, noGlow: true });
      txt(ctx, names[i], x, cy + 46, { size: 13, weight: 700, color: COL.text, align: 'center' });
      const tm = (i >= 1 && i <= 4) ? F.stageTimes[i - 1] : null;
      if (tm != null && tm > 0) txt(ctx, fmtTime(tm), x, cy + 62, { size: 11, color: COL.text3, align: 'center' });
      else if (i === 5) txt(ctx, 'Final molt', x, cy + 62, { size: 11, color: COL.text3, align: 'center' });
    }
    const rects = endRects(626), foc = ui.idx.victory == null ? 0 : ui.idx.victory, lock = real() - ui.enterT < 1.4;
    drawButton(ctx, rects[0], 'Play Again', foc === 0 && !lock, { size: 18, disabled: lock });
    drawButton(ctx, rects[1], 'Title Screen', foc === 1 && !lock, { size: 18, disabled: lock });
    ctx.restore();
  }

  // ========================================================= SCIENCE OVERLAY
  function drawOverlayLayer(ctx) {
    if (Game.state.scene !== 'playing' || !Game.settings.science) return;
    const p = P(), t = real();
    // tag
    const tag = 'SCIENCE MODE', tw = measure(ctx, tag, 11, 700) + 120;
    panel(ctx, W / 2 - tw / 2, 66, tw, 24, { fill: 'rgba(20,50,52,0.78)', border: 'rgba(111,201,192,0.6)', r: 12 });
    icon(ctx, 'eye', W / 2 - tw / 2 + 18, 78, 14, COL.info);
    spaced(ctx, tag, W / 2 - tw / 2 + 32, 82, 2, { size: 11, weight: 700, color: COL.info, align: 'left' });
    keycap(ctx, 'F', W / 2 + tw / 2 - 30, 70, { h: 16, size: 10 });
    if (p) drawTelemetry(ctx, p);
    const pk = ui.picked; if (!pk) return;
    const sp = Game.camera.worldToScreen(pk.x, pk.y), cz = Game.camera.zoom || 1, rad = Math.max(14, pk.r * cz + 8);
    ctx.save(); ctx.strokeStyle = COL.info; ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 20; ctx.beginPath(); ctx.arc(sp.x, sp.y, rad, 0, 7); ctx.stroke(); ctx.restore();
    const lines = safe(() => Game.edu.scienceInfo(pk.e), []) || []; if (!lines.length) return;
    const bw = 330, pad = 14; let bh = pad * 2 + 4; const wr = lines.map((l, i) => wrap(ctx, l, bw - pad * 2, i === 0 ? 15 : 12.5, i === 0 ? 700 : 400, i === 0 ? SERIF : null));
    wr.forEach((ls, i) => { bh += ls.length * (i === 0 ? 20 : 17) + (i === 0 ? 6 : 3); });
    bh = Math.min(bh, 380);
    const right = sp.x < W / 2; let bx = right ? sp.x + rad + 26 : sp.x - rad - 26 - bw, by = clamp(sp.y - bh / 2, 100, H - bh - 16);
    bx = clamp(bx, 8, W - bw - 8);
    ctx.strokeStyle = 'rgba(111,201,192,0.7)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(sp.x + (right ? rad : -rad), sp.y); ctx.lineTo(right ? bx : bx + bw, clamp(sp.y, by + 14, by + bh - 14)); ctx.stroke();
    panel(ctx, bx, by, bw, bh, { fill: 'rgba(10,26,28,0.93)', border: 'rgba(111,201,192,0.7)', r: 12 });
    let y = by + pad;
    ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
    wr.forEach((ls, i) => {
      ls.forEach(l => { txt(ctx, l, bx + pad, y + (i === 0 ? 16 : 13), { size: i === 0 ? 15 : 12.5, weight: i === 0 ? 700 : 400, font: i === 0 ? SERIF : null, color: i === 0 ? COL.amberHi : (i === lines.length - 1 && lines.length > 3 ? COL.info : COL.text) }); y += i === 0 ? 20 : 17; });
      y += i === 0 ? 6 : 3;
    });
    ctx.restore();
  }

  function drawTelemetry(ctx, p) {
    const st = C.STAGES[p.stage || 0] || C.STAGES[0], w = Game.world;
    const z = w && w.zoneAt ? safe(() => w.zoneAt(p.x, p.y), null) : null, dm = p.drainMul == null ? 1 : p.drainMul;
    const cells = [
      ['Health', (p.hp || 0).toFixed(1) + '/' + Math.round(p.maxHp || 0)], ['Speed', Math.round(st.speed * (p.speedMul || 1)) + ' px/s'],
      ['Hunger', (p.hunger || 0).toFixed(1)], ['Bite', ((st.bite || 1) * (p.biteMul || 1)).toFixed(1) + ' dmg'],
      ['Hydration', (p.hydration || 0).toFixed(1)], ['Seen', Math.round((p.stealth == null ? 1 : p.stealth) * 100) + '%'],
      ['Energy', (p.energy || 0).toFixed(1)], ['Senses', Math.round(p.senseRadius || 0) + ' px'],
      ['Silk', (p.silk || 0).toFixed(1) + '/' + Math.round(p.maxSilk || 0)], ['Light', w && w.light != null ? Math.round(w.light * 100) + '%' : '-'],
    ];
    const x = 16, y = 252, pw = 272, ph = 38 + 5 * 21 + 46;
    panel(ctx, x, y, pw, ph, { fill: 'rgba(10,26,28,0.84)', border: 'rgba(111,201,192,0.45)', r: 12 });
    spaced(ctx, 'SPIDER TELEMETRY', x + 16, y + 24, 2, { size: 10, weight: 700, color: COL.info, align: 'left' });
    cells.forEach((c, i) => {
      const cx = x + 16 + (i % 2) * 124, cy = y + 48 + Math.floor(i / 2) * 21;
      txt(ctx, c[0], cx, cy, { size: 11.5, color: COL.text3 }); txt(ctx, c[1], cx + 112, cy, { size: 11.5, weight: 700, color: COL.text, align: 'right' });
    });
    const ly = y + 38 + 5 * 21 + 10;
    ctx.fillStyle = 'rgba(111,201,192,0.2)'; ctx.fillRect(x + 16, ly - 8, pw - 32, 1);
    txt(ctx, 'Drain/s  hunger -' + (st.hungerRate * dm).toFixed(2) + '  thirst -' + (st.thirstRate * dm).toFixed(2), x + 16, ly + 8, { size: 11, color: COL.text2 });
    txt(ctx, 'Zone: ' + (z ? z.name : '-'), x + 16, ly + 24, { size: 11, color: COL.text2 });
  }

  Game.register('ui', ui);
})();
