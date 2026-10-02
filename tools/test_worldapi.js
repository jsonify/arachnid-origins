const H = require('./harness'); const G = H.load({ tolerant: true }); G.newGame();
const W = G.world; let fail = 0; const ck = (c, m) => { if (!c) fail++; console.log(c ? 'ok  ' : 'FAIL', m); };
ck(W.width === 6400 && W.height === 3600, 'size');
ck(W.zoneAt(300, 1800).id && W.zoneAt(3300, 1800).id !== W.zoneAt(5200, 1800).id, 'zones');
// resolve
let bad = 0, n = 0; W.obstacles.slice(0, 400).forEach(o => { const r = W.resolve(o.x, o.y, 14); n++; const d = Math.hypot(r.x - o.x, r.y - o.y); if (!isFinite(r.x) || (o.r && d < 1)) bad++; });
ck(bad === 0, 'resolve pushes out (' + n + ')');
const c = W.resolve(-50, -50, 10); ck(c.x >= 10 && c.y >= 10, 'resolve clamps');
// connectivity flood fill, radius 22, 40px cells
const CS = 40, cols = 160, rows = 90, seen = new Uint8Array(cols * rows); const free = (i, j) => { const x = i * CS + 20, y = j * CS + 20, r = W.resolve(x, y, 22); return Math.hypot(r.x - x, r.y - y) < 1.5; };
const sp = W.spawnPoints('open'); const s0 = G.player && G.player.pos || { x: 320, y: 1800 };
let q = [[(s0.x / CS) | 0, (s0.y / CS) | 0]]; seen[q[0][1] * cols + q[0][0]] = 1; let tot = 0;
while (q.length) { const [i, j] = q.pop(); tot++; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => { const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= cols || y >= rows || seen[y * cols + x]) return; if (!free(x, y)) return; seen[y * cols + x] = 1; q.push([x, y]); }); }
let fr = 0; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (free(i, j)) fr++;
ck(tot / fr > 0.9, 'connectivity ' + (tot / fr * 100).toFixed(1) + '% of free cells');
const reach = (p) => seen[((p.y / CS) | 0) * cols + ((p.x / CS) | 0)] || [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]].some(([a,b]) => seen[(((p.y / CS) | 0) + b) * cols + ((p.x / CS) | 0) + a]);
const egg = W.shelters.filter(s => s.eggSite); ck(egg.length >= 3, 'eggSites ' + egg.length);
ck(W.shelters.filter(s => !reach(s)).length <= 2, 'shelters reachable (unreachable ' + W.shelters.filter(s => !reach(s)).length + '/' + W.shelters.length + ')');
ck(W.resources.filter(r => !reach(r)).length < W.resources.length * 0.05, 'resources reachable (unreach ' + W.resources.filter(r => !reach(r)).length + '/' + W.resources.length + ')');
// APIs
const r0 = W.resources[0]; const nr = W.nearestResource(r0.x, r0.y, r0.type, 100); ck(nr, 'nearestResource');
const a0 = r0.amount; W.consumeResource(r0, 1); ck(r0.amount < a0 || a0 === 0, 'consume');
ck(W.nearestAnchor(3300, 1400, 400) !== undefined, 'nearestAnchor');
ck(W.shelterAt(egg[0].x, egg[0].y), 'shelterAt'); const ex = W.exposure(egg[0].x, egg[0].y); ck(ex >= 0 && ex <= 1, 'exposure ' + ex);
W.markExplored(320, 1800, 200); ck(W.isExplored(320, 1800), 'explored');
// events
const ev = { zone: 0, phase: 0, weather: 0, sfx: {} }; G.on('zone:enter', () => ev.zone++); G.on('day:phase', () => ev.phase++); G.on('weather:change', () => ev.weather++); G.on('sfx', e => { ev.sfx[e.name] = 1; });
let rainDay0 = false; for (let i = 0; i < 60 * 600; i++) { G.step(1 / 20 * 1); if (W.dayCount === 0 && W.weather.type === 'rain' && W.weather.intensity > 0.05) rainDay0 = true; if (i % 1200 === 0 && G.player) { /* idle */ } }
ck(!rainDay0, 'no rain on day 0'); console.log('events', ev.phase, ev.weather, 'day', W.dayCount, 'errors', G.errors.length);
G.newGame(); W.forceWeather('rain', 1); console.log('scene', G.scene); for (let i = 0; i < 1500; i++) G.step(1 / 20); ck(ev.sfx.thunder || Object.keys(ev.sfx).some(k => /thunder/.test(k)), 'thunder sfx (' + Object.keys(ev.sfx).join(',') + ')');
ck(G.errors.length === 0, 'errors empty'); console.log(fail ? 'FAILED ' + fail : 'ALL OK');
