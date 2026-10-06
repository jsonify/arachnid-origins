/* ============================================================================
 * Arachnid Origins  --  territory.js   (module `territory`, priority 12)
 * Territory mode (see territory-mode-gdd.md): a persistent campaign over many generations. This module owns
 *   - the calendar: a 36-day year of four 9-day seasons read from world.dayCount, and what each season changes
 *   - the lineage: heirs, generations, inherited traits, mutations, succession when a spider falls, the Legacy scene when she lays
 *   - the territory: the Home Site and its Claim, Claim Points and Rank, heirloom webs, the pantry, the summer rival
 *   - its own slice of the save (serialize / deserialize; save.js orchestrates)
 * Brood and Survival never see any of it: every hook other modules call is guarded by `Game.territory.active`.
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util;
  const clamp = U.clamp, lerp = U.lerp;
  const hypot = Math.hypot, floor = Math.floor, min = Math.min, max = Math.max;

  // ------------------------------------------------------------------- tuning (starting points: GDD section 10)
  const SEASON_DAYS = 9, YEAR_DAYS = 36, MATE_DAY = 16;
  const START_HEIRS = 5;
  const MUTATION_CHANCE = 0.15;
  const HEIRLOOM_COST = 5;                        // silk to mark a web as an heirloom
  const REPAIR_GAIN = 0.3, REPAIR_COST = 0.6;     // one E press restores up to 30% integrity for (web cost x gain x 0.6) silk
  const RECYCLE_HOLD = 1.2, RECYCLE_SHARE = 0.5;  // hold X this long; about half the silk comes back
  const WRAP_COST = 5, WRAP_RETREAT_R = 320;      // silk to wrap and store prey; a retreat web must be within this of the prey
  const CP = { night: 1, prey: 0.2, rival: 5, winter: 10, preyDayCap: 3 };
  const SETBACK = { growthLoss: 0.5, meter: 50, silk: 0, shaken: C.DAY_LENGTH, webLoss: 0.2, webRadius: 400, invuln: 4 };
  const RIVAL = { stayS: 300, leaveS: 45, raidRate: 0.08, repelAt: 0.5 };
  const MANUAL_SAVE_COOLDOWN = 90;                // resting in the home retreat saves, at most this often (s)
  const WEB_WINTER_LOSS = { spring: 0.01, summer: 0.01, autumn: 0.015, winter: 0.035 };   // integrity lost per skipped day (Legacy fast-forward)

  const SEASONS = [
    { id: 'spring', name: 'Spring', blurb: 'Rain and dew. Prey is returning.', prey: [0.85, 1.15], hunger: 0.9, thirst: 0.9, fresh: 6, gap: 0.8,
      weather: { rain: 1.8, drizzle: 1.8, fog: 1, wind: 1, frost: 0 } },
    { id: 'summer', name: 'Summer', blurb: 'Long, hot days. Flyers peak and rivals roam.', prey: [1.3, 1.3], flyers: 1.15, hunger: 1, thirst: 1.2, fresh: 4, gap: 1.6, kinds: { wasp: 1.3, mantis: 1.3 },
      weather: { rain: 0.5, drizzle: 0.4, fog: 0.5, wind: 1, frost: 0 } },
    { id: 'autumn', name: 'Autumn', blurb: 'Fog and heavy dew. Mating season; prey is thinning.', prey: [1.0, 0.6], hunger: 1, thirst: 1, fresh: 7, gap: 1, kinds: { bird: 1.2 },
      weather: { rain: 1, drizzle: 1, fog: 2.2, wind: 1.2, frost: 0 } },
    { id: 'winter', name: 'Winter', blurb: 'Frost and scarce prey. Shelter is life.', prey: [0.25, 0.25], noFlyers: true, hunger: 0.7, thirst: 0.7, fresh: 14, gap: 1,
      weather: { rain: 0.4, drizzle: 0.4, fog: 1, wind: 1, frost: 2.5 } },
  ];
  // rank: Claim radius (px), heirloom web slots, pantry capacity, trait slots at the Legacy scene, bonus heirs in the clutch
  const RANKS = [
    { rank: 1, name: 'Claim', cp: 0, radius: 600, webs: 4, pantry: 6, traits: 1, heirs: 0 },
    { rank: 2, name: 'Hold', cp: 25, radius: 800, webs: 6, pantry: 10, traits: 1, heirs: 0 },
    { rank: 3, name: 'Domain', cp: 75, radius: 1000, webs: 8, pantry: 15, traits: 2, heirs: 1 },
    { rank: 4, name: 'Stronghold', cp: 150, radius: 1200, webs: 10, pantry: 20, traits: 2, heirs: 1 },
    { rank: 5, name: 'Dominion', cp: 300, radius: 1400, webs: 12, pantry: 30, traits: 3, heirs: 2 },
  ];

  const has = (o, f) => !!(o && typeof o[f] === 'function');
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const webCenter = (w) => w.x != null ? { x: w.x, y: w.y } : { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 };
  function sfx(name, vol) { try { Game.emit('sfx', { name, vol: vol == null ? 1 : vol }); } catch (e) { /* ignore */ } }
  const P = () => Game.player || null;

  // ----------------------------------------------------------------------- calendar
  function calendarOf(dayCount, time01) {
    const dc = Math.max(0, dayCount | 0), doy = dc % YEAR_DAYS, si = floor(doy / SEASON_DAYS), dis = doy % SEASON_DAYS;
    const S = SEASONS[si];
    return {
      dayCount: dc, year: floor(dc / YEAR_DAYS) + 1, day: doy + 1, seasonIndex: si, season: S.id, seasonName: S.name,
      dayInSeason: dis + 1, daysLeftInSeason: SEASON_DAYS - dis - 1, progress: clamp((dis + (time01 || 0)) / SEASON_DAYS, 0, 1),
      label: 'Day ' + (doy + 1) + ' of ' + YEAR_DAYS + ', Year ' + (floor(dc / YEAR_DAYS) + 1),
    };
  }

  // ----------------------------------------------------------------------- module
  const T = {
    priority: 12,
    SEASONS, RANKS, SEASON_DAYS, YEAR_DAYS, MATE_DAY, HEIRLOOM_COST, WRAP_COST, SETBACK, RIVAL, CP,
    active: false,
    lineageName: '', lineage: null, cp: 0, rank: 1, home: null, pantry: [],
    legacy: null,            // the Legacy scene in progress (a mother has laid), or null
    ended: null,             // summary of a lineage that died out (Lineage Ended screen)
    succession: null,        // the Succession card in progress, or null
    metab: { hunger: 1, thirst: 1 },   // drain multipliers for the current season (player.js)
    cand: null,              // what E would do right now (see findCandidate)
    rng: Math.random,        // tests replace it
    rival: null,             // { c, t, kind } while a rival is in the Claim
    rivalYears: {},          // years in which the summer invasion already happened
    longest: { seconds: 0, generation: 0, stage: 0 },   // the longest-lived body in the lineage
    _cal: null, _season: null, _night: null, _bodyStart: 0, _dayCP: { day: -1, n: 0 }, _manualCd: 0, _wasHome: false, _eatT: 0, _recycleT: 0, _web: null, _pid: 1,
  };

  T.calendar = () => calendarOf(num(Game.world && Game.world.dayCount, 0), num(Game.world && Game.world.time01, 0));
  T.season = () => SEASONS[(T._cal || T.calendar()).seasonIndex];
  T.rankInfo = (rank) => RANKS[clamp((rank || T.rank) | 0, 1, RANKS.length) - 1];
  T.claimRadius = () => T.rankInfo().radius;
  T.heirloomSlots = () => T.rankInfo().webs;
  T.pantryCapacity = () => T.rankInfo().pantry;
  T.traitSlots = () => T.rankInfo().traits;
  // progress to the next rank: { from, to, f } (to = null at the top)
  T.nextRank = () => {
    const nx = RANKS[T.rank]; if (!nx) return { from: T.cp, to: null, f: 1, next: null };
    const cur = T.rankInfo(); return { from: cur.cp, to: nx.cp, f: clamp((T.cp - cur.cp) / (nx.cp - cur.cp), 0, 1), next: nx };
  };
  T.inClaim = (x, y, pad) => !!(T.active && T.home && hypot(x - T.home.x, y - T.home.y) <= T.claimRadius() + (pad || 0));
  T.spawnPoint = () => (T.active && T.home) ? { x: T.home.x, y: T.home.y } : null;
  T.currentGeneration = () => { const g = T.lineage && T.lineage.generations; return g && g.length ? g[g.length - 1] : null; };

  // ---- season effects (read by world.js, creatures.js and player.js through these hooks)
  T.weatherBias = () => { const S = T.season(); return Object.assign({ gap: S.gap }, S.weather); };
  T.popMul = (kind) => {
    if (!T.active) return 1;
    const k = typeof kind === 'string' ? ((Game.creatures && Game.creatures.KINDS && Game.creatures.KINDS[kind]) || { id: kind }) : (kind || {});
    const cal = T._cal || T.calendar(), S = SEASONS[cal.seasonIndex];
    let m = 1;
    if (k.id === 'bird') return (S.kinds && S.kinds.bird) || 1;       // birds are not in the population table; autumn brings more of them
    if (S.noFlyers && k.isFlyer) return 0;                            // winter: nothing flies
    if (k.role === 'prey' || k.role === 'neutral') { m = lerp(S.prey[0], S.prey[1], cal.progress); if (k.isFlyer && S.flyers) m *= S.flyers; }
    if (S.kinds && S.kinds[k.id]) m *= S.kinds[k.id];
    return m;
  };
  T.healMul = () => {
    if (!T.active || T.season().id !== 'winter') return 1;
    const p = P(), W = Game.webs; return (p && has(W, 'isSheltered') && W.isSheltered(p.x, p.y)) ? 1.5 : 1;   // in winter a silk retreat heals faster
  };
  // the mating season opens on day 16 of the year; before that an adult has nobody to court
  T.mateAllowed = () => !T.active || (T._cal || T.calendar()).day >= MATE_DAY;
  T.matingNote = () => {
    if (!T.active || T.mateAllowed()) return '';
    const d = MATE_DAY - (T._cal || T.calendar()).day;
    return 'Not mating season yet: a mate arrives on day ' + MATE_DAY + ' (' + d + (d === 1 ? ' day' : ' days') + ' to go).';
  };

  // ----------------------------------------------------------------------- lineage
  function speciesName() { return Game.speciesInfo(Game.state.species).name; }
  function newGeneration(n, o) {
    o = o || {}; const cal = T.calendar();
    return { n, species: Game.state.species, born: { year: cal.year, day: cal.day }, status: 'alive', stage: 0, deaths: [], clutch: 0, laid: null,
      traits: o.traits || [], mutation: o.mutation || null, stats: null, t0: Game.time.t };
  }
  T.reset = function () {
    T.active = Game.state.mode === 'territory';
    T.legacy = null; T.ended = null; T.succession = null; T.rival = null; T.rivalYears = {}; T.pantry = []; T.cand = null; T._web = null;
    T._cal = null; T._season = null; T._night = null; T._dayCP = { day: -1, n: 0 }; T._manualCd = 0; T._wasHome = false; T._eatT = 0; T._recycleT = 0; T._pid = 1;
    T.metab = { hunger: 1, thirst: 1 }; T.cp = 0; T.rank = 1; T.home = null; T.lineage = null; T.lineageName = ''; T._inherit = null; T._bodyStart = 0;
    T.longest = { seconds: 0, generation: 0, stage: 0 };
    if (!T.active) return;
    T.lineageName = (Game.state.lineageName || '').trim() || ('Line of the ' + speciesName());
    T.lineage = { heirs: START_HEIRS, generations: [newGeneration(1)] };
    T._cal = T.calendar(); T._season = T._cal.seasonIndex;
    setHome(foundingSite(), true);
  };
  // generation 1 hatches from the egg site nearest the old hatch point
  function foundingSite() {
    const sh = (Game.world && Game.world.shelters) || []; let best = null, bd = 1e18;
    for (let i = 0; i < sh.length; i++) { const s = sh[i]; if (!s.eggSite) continue; const d = hypot(s.x - C.SPAWN.x, s.y - C.SPAWN.y); if (d < bd) { bd = d; best = s; } }
    if (!best) for (let i = 0; i < sh.length; i++) { const s = sh[i], d = hypot(s.x - C.SPAWN.x, s.y - C.SPAWN.y); if (d < bd) { bd = d; best = s; } }
    return best || { id: null, x: C.SPAWN.x, y: C.SPAWN.y };
  }
  // moving the Home Site moves the Claim: heirloom webs outside the new one become ordinary webs (they will decay)
  function setHome(site, quiet) {
    if (!site) return;
    T.home = { shelterId: site.id == null ? null : site.id, x: site.x, y: site.y };
    const W = Game.webs;
    if (has(W, 'heirlooms')) W.heirlooms().forEach(w => { const c = webCenter(w); if (hypot(c.x - T.home.x, c.y - T.home.y) > T.claimRadius()) w.heirloom = false; });
    if (!quiet) Game.emit('territory:claimed', { x: T.home.x, y: T.home.y });
  }

  // ---- inherited traits: one level below the mother's, at least 1
  T.inherited = () => T._inherit || null;

  // ---- Claim Points and Rank
  T.addCP = function (n, reason) {
    if (!T.active || !(n > 0)) return;
    T.cp = Math.round((T.cp + n) * 100) / 100;
    Game.emit('territory:cp', { amount: n, reason: reason || '', total: T.cp });
    let r = 1; for (let i = 0; i < RANKS.length; i++) if (T.cp >= RANKS[i].cp) r = RANKS[i].rank;
    if (r > T.rank) { T.rank = r; Game.emit('territory:rank', { rank: r, name: RANKS[r - 1].name }); sfx('levelup', 0.8); }
  };

  // ----------------------------------------------------------------------- heirloom webs
  T.heirloomWebs = () => has(Game.webs, 'heirlooms') ? Game.webs.heirlooms() : [];
  T.canMark = (web) => !!(T.active && web && !web.dying && !web.heirloom && web.build >= 1 && T.inClaim(webCenter(web).x, webCenter(web).y) && T.heirloomWebs().length < T.heirloomSlots());
  T.markHeirloom = function (web) {
    const p = P(); if (!p || !T.canMark(web) || !(p.silk >= HEIRLOOM_COST)) return false;
    if (!p.useSilk(HEIRLOOM_COST)) return false;
    Game.webs.setHeirloom(web, true);
    sfx('web_place', 0.9); Game.emit('web:heirloom', { web });
    return true;
  };
  T.repairCost = (web) => {
    const gain = min(REPAIR_GAIN, 1 - web.integrity), cost = (C.WEB_TYPES[web.type] && C.WEB_TYPES[web.type].cost) || 20;
    return { gain, silk: Math.max(1, Math.ceil(cost * gain * REPAIR_COST)) };
  };
  T.repairWeb = function (web) {
    const p = P(); if (!p || !web || web.dying || web.integrity >= 0.98) return false;
    const rc = T.repairCost(web); if (!(p.silk >= rc.silk) || !p.useSilk(rc.silk)) return false;
    Game.webs.repair(web, rc.gain); sfx('spin', 0.7); return true;
  };
  T.recycleWeb = function (web) {
    const p = P(); if (!p || !web || web.dying) return 0;
    const give = Game.webs.recycle(web, RECYCLE_SHARE); if (give > 0) p.addSilk(give);
    sfx('rest', 0.8); return give;
  };

  // ----------------------------------------------------------------------- pantry
  T.canStore = () => T.pantry.length < T.pantryCapacity();
  function nearRetreat(x, y) {
    const L = (Game.webs && Game.webs.list) || [];
    for (let i = 0; i < L.length; i++) { const w = L[i]; if (w.type === 'retreat' && !w.dying && w.build >= 0.7 && w.integrity > 0.08 && hypot(w.x - x, w.y - y) <= WRAP_RETREAT_R) return true; }
    return false;
  }
  T.storeCheck = (c) => {   // null when the creature can be wrapped now, else why not
    const p = P();
    if (!c || c.dead || c.state !== 'stuck' || !(c.role === 'prey' || c.role === 'neutral') || !c.k || !c.k.value) return 'Nothing to wrap';
    if (!T.inClaim(c.x, c.y)) return 'Outside your Claim';
    if (!T.canStore()) return 'Pantry full (' + T.pantry.length + '/' + T.pantryCapacity() + ')';
    if (!nearRetreat(c.x, c.y)) return 'Needs a silk retreat nearby';
    if (!p || p.silk < WRAP_COST) return 'Need ' + WRAP_COST + ' silk';
    return null;
  };
  T.store = function (c) {
    const p = P(); if (T.storeCheck(c) || !p.useSilk(WRAP_COST)) return false;
    const cal = T.calendar();
    T.pantry.push({ id: T._pid++, kind: c.kind, nutrition: Math.max(2, num(c.k.value.hunger, 4)), fresh: 1, day: cal.dayCount });
    if (has(Game.creatures, 'remove')) Game.creatures.remove(c);
    Game.stat('stored'); sfx('web_place', 0.9);
    Game.emit('pantry:store', { kind: c.kind });
    if (!T.canStore()) Game.emit('pantry:full', {});
    return true;
  };
  // eat the best bundle: freshest first (nothing is wasted on a half-spoiled one while a good one waits)
  T.eatPantry = function () {
    const p = P(); if (!p || !T.pantry.length) return false;
    let bi = 0; for (let i = 1; i < T.pantry.length; i++) if (T.pantry[i].fresh * T.pantry[i].nutrition > T.pantry[bi].fresh * T.pantry[bi].nutrition) bi = i;
    const it = T.pantry.splice(bi, 1)[0], q = 0.35 + 0.65 * clamp(it.fresh, 0, 1);
    p.feed(it.nutrition * q, 0, it.kind);   // stored prey feeds you but does not grow you: only a fresh kill does that
    return true;
  };
  function tickPantry(dt) {
    if (!T.pantry.length) return;
    const k = dt / (C.DAY_LENGTH * T.season().fresh);
    for (let i = T.pantry.length - 1; i >= 0; i--) {
      const it = T.pantry[i]; it.fresh -= k;
      if (it.fresh <= 0) { T.pantry.splice(i, 1); Game.emit('pantry:spoil', { kind: it.kind }); }
    }
  }

  // ----------------------------------------------------------------------- interaction (E on webs and prey, hold X to recycle)
  function bestWebNear(p) {
    const W = Game.webs; if (!has(W, 'nearestWeb')) return null;
    const reach = p.radius + 8, seen = []; let best = null, bd = 1e18;
    for (let i = 0; i < 4; i++) {
      const w = W.nearestWeb(p.x, p.y, reach, (ww) => !ww.dying && ww.build >= 1 && seen.indexOf(ww) < 0); if (!w) break;
      seen.push(w); const c = webCenter(w), d = hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  function findCandidate(p) {
    if (!p || p.dead || p.molting || p.hatching || p.laying || p.courting || p.reviving) return null;
    // 1. a trapped creature to wrap for the pantry
    if (T.inClaim(p.x, p.y, 40) && has(Game.creatures, 'nearest')) {
      const reach = p.radius + 28;
      const c = Game.creatures.nearest(p.x, p.y, (o) => o.state === 'stuck' && !o.dead && (o.role === 'prey' || o.role === 'neutral') && hypot(o.x - p.x, o.y - p.y) - (o.radius || 3) <= reach, reach + 14);
      if (c) { const why = T.storeCheck(c); return { kind: 'wrap', key: 'E', text: why ? why : 'Wrap and store for later (' + WRAP_COST + ' silk)', ok: !why, warn: !!why, creature: c }; }
    }
    // 2. a web underfoot
    const w = T._web; if (!w) return null;
    const c = webCenter(w), inC = T.inClaim(c.x, c.y);
    if (w.heirloom) {
      if (w.integrity < 0.97) {
        const rc = T.repairCost(w), ok = p.silk >= rc.silk;
        return { kind: 'repair', key: 'E', text: ok ? 'Repair heirloom web (' + rc.silk + ' silk)' : 'Need ' + rc.silk + ' silk to repair', ok, warn: !ok, web: w };
      }
      return { kind: 'keep', key: 'X', text: 'Heirloom web: hold X to recycle', ok: false, soft: true, web: w };
    }
    if (!inC) return null;
    const slots = T.heirloomSlots(), used = T.heirloomWebs().length;
    if (used >= slots) return { kind: 'mark', key: 'E', text: 'Heirloom slots full (' + used + '/' + slots + ')', ok: false, warn: true, web: w };
    if (p.silk < HEIRLOOM_COST) return { kind: 'mark', key: 'E', text: 'Need ' + HEIRLOOM_COST + ' silk to mark', ok: false, warn: true, web: w };
    return { kind: 'mark', key: 'E', text: 'Mark as heirloom web (' + HEIRLOOM_COST + ' silk)', ok: true, web: w };
  }
  T.prompt = () => T.cand ? { key: T.cand.key, text: T.cand.text, warn: !!T.cand.warn, soft: !!T.cand.soft } : null;
  // called by player.interact(): returns true when it used the E press
  T.interact = function (pressed, held, dt) {
    const p = P(), I = Game.input, cand = T.cand;
    if (!p) return false;
    // hold X beside a web: eat the old silk. The ring fills while held; moving or letting go starts over.
    const web = T._web;
    if (I.down('recycle') && web && !web.dying && Math.hypot(p.vx, p.vy) < 40) {
      T._recycleT += dt;
      if (T._recycleT >= RECYCLE_HOLD) { T._recycleT = 0; T.recycleWeb(web); T._web = null; }
    } else T._recycleT = 0;
    if (!pressed || !cand || !cand.ok) return false;
    let done = false;
    if (cand.kind === 'wrap') done = T.store(cand.creature);
    else if (cand.kind === 'mark') done = T.markHeirloom(cand.web);
    else if (cand.kind === 'repair') done = T.repairWeb(cand.web);
    if (done) T.cand = null;
    return done;
  };
  T.recycleProgress = () => clamp(T._recycleT / RECYCLE_HOLD, 0, 1);

  // ----------------------------------------------------------------------- summer rival
  function spawnRival(p) {
    const cr = Game.creatures; if (!has(cr, 'spawn') || !T.home) return null;
    const kind = p.stage <= 2 ? 'jumper' : 'wolf', R = T.claimRadius() * 0.92;
    for (let t = 0; t < 12; t++) {   // a spot on the edge of the Claim, out of view
      const a = T.rng() * Math.PI * 2, x = clamp(T.home.x + Math.cos(a) * R, 60, C.WORLD_W - 60), y = clamp(T.home.y + Math.sin(a) * R, 60, C.WORLD_H - 60);
      if (t < 11 && Game.camera && Game.camera.inView(x, y, 120)) continue;
      const c = cr.spawn(kind, x, y, { instant: true, state: 'patrol' });
      if (c) { c.rival = 1; c.hx = x; c.hy = y; return c; }
    }
    return null;
  }
  T.rivalTarget = (c) => {
    let best = null, bd = 1e18; const L = T.heirloomWebs();
    for (let i = 0; i < L.length; i++) { const w = L[i], q = webCenter(w), d = hypot(q.x - c.x, q.y - c.y); if (d < bd && T.inClaim(q.x, q.y, 80)) { bd = d; best = w; } }
    return best;
  };
  T.rivalRaid = (c, web, dt) => {
    if (!web || web.dying) return;
    Game.webs.damage(web, RIVAL.raidRate * dt, 'torn', 0);
    if (T.rng() < dt * 1.2) { Game.emit('sfx', { name: 'web_snap', x: c.x, y: c.y, vol: 0.6 }); }
    if (web.integrity <= 0) { Game.webs.damage(web, 1, 'torn'); }   // a web with nothing left falls
  };
  function repelRival(c, byPlayer) {
    if (!c || c.rival !== 1) return;
    c.rival = 2; c.state = 'flee'; c.t = 3; c.tx = c.x; c.ty = c.y;
    T.addCP(CP.rival, 'rival'); Game.emit('territory:rival_repelled', { kind: c.kind, byPlayer: !!byPlayer });
    Game.stat('rivalsRepelled'); sfx('unlock', 0.7);
  }
  function tickRival(dt, p) {
    const cal = T._cal;
    if (!T.rival) {
      // a summer invasion: once the Claim has something to raid and its spider is around
      if (cal.season === 'summer' && cal.dayInSeason >= 3 && !T.rivalYears[cal.year] && p && !p.dead && p.stage >= 1 && T.heirloomWebs().length && T.home && hypot(p.x - T.home.x, p.y - T.home.y) < T.claimRadius() + 500) {
        const c = spawnRival(p);
        if (c) { T.rivalYears[cal.year] = true; T.rival = { c, t: 0, kind: c.kind, id: c.id }; Game.emit('territory:rival_started', { kind: c.kind }); sfx('danger', 0.8); }
      }
      return;
    }
    const r = T.rival, c = r.c;
    if (!c || c.dead || c.id !== r.id || !c.rival) { T.rival = null; return; }
    r.t += dt;
    if (c.rival === 1) {
      if (c.hp <= c.maxHp * RIVAL.repelAt) repelRival(c, true);
      else if (r.t > RIVAL.stayS) { c.rival = 2; r.t = 0; Game.emit('territory:rival_left', { kind: c.kind }); }
    } else if (r.t > RIVAL.leaveS || (T.home && hypot(c.x - T.home.x, c.y - T.home.y) > T.claimRadius() + 300 && Game.camera && !Game.camera.inView(c.x, c.y, 100))) {
      if (has(Game.creatures, 'remove')) Game.creatures.remove(c);
      T.rival = null;
    }
  }
  T.rivalPos = () => (T.rival && T.rival.c && !T.rival.c.dead) ? { x: T.rival.c.x, y: T.rival.c.y, kind: T.rival.kind, leaving: T.rival.c.rival === 2 } : null;

  // ----------------------------------------------------------------------- nights: heirloom webs that held
  function tickNight(p) {
    if (!T._night) return;
    const L = T.heirloomWebs();
    for (let i = 0; i < L.length; i++) { const w = L[i], m = T._night[w.id]; T._night[w.id] = m == null ? w.integrity : min(m, w.integrity); }
  }
  function endNight() {
    if (!T._night) return;
    const live = {}; T.heirloomWebs().forEach(w => { live[w.id] = true; });
    let kept = 0, total = 0;
    for (const id in T._night) { if (!live[id]) continue; total++; if (T._night[id] >= 0.5) kept++; }
    T._night = null;
    if (total) { if (kept) T.addCP(CP.night * kept, 'night'); Game.emit('territory:night', { kept, total }); }
  }

  // ----------------------------------------------------------------------- per-frame update
  T.init = function () {
    Game.on('day:phase', (d) => {
      if (!T.active || !d) return;
      if (d.phase === 'dusk' && !T._night) T._night = {};
      else if (d.phase === 'dawn') endNight();
    });
    Game.on('stage:change', (d) => { const g = T.currentGeneration(); if (T.active && g && d) g.stage = max(g.stage, d.stage | 0); });
    Game.on('web:trapped', (d) => {   // prey caught in the Claim earns a little standing, up to a daily cap
      if (!T.active || !d || !d.creature || !d.web) return;
      const c = webCenter(d.web), r = d.creature.role; if (!(r === 'prey' || r === 'neutral') || !T.inClaim(c.x, c.y)) return;
      const dc = num(Game.world && Game.world.dayCount, 0); if (T._dayCP.day !== dc) T._dayCP = { day: dc, n: 0 };
      if (T._dayCP.n < CP.preyDayCap) { T._dayCP.n += CP.prey; T.addCP(CP.prey, 'prey'); }
    });
    Game.on('creature:killed', (d) => { if (T.active && T.rival && d && d.creature === T.rival.c && d.by === 'player') { const c = d.creature; if (c.rival === 1) { c.rival = 2; T.addCP(CP.rival, 'rival'); Game.emit('territory:rival_repelled', { kind: c.kind, byPlayer: true }); Game.stat('rivalsRepelled'); } T.rival = null; } });
    Game.on('weather:change', (d) => { if (T.active && d && d.weather === 'frost') Game.emit('territory:frost', {}); });
    Game.addDrawer(Game.LAYER.SHELTER + 1, drawClaim);
  };
  T.update = function (dt) {
    if (!T.active) return;
    const p = P(), cal = T._cal = T.calendar(), S = SEASONS[cal.seasonIndex];
    T.metab.hunger = S.hunger; T.metab.thirst = S.thirst;
    if (T._season == null) T._season = cal.seasonIndex;
    else if (cal.seasonIndex !== T._season) { const prev = SEASONS[T._season].id; T._season = cal.seasonIndex; Game.emit('season:change', { season: S.id, prev }); }
    tickPantry(dt); tickNight(p);
    T._manualCd = max(0, T._manualCd - dt);
    if (p) {
      T._web = (!p.dead && !p.molting) ? bestWebNear(p) : null;
      T.cand = findCandidate(p);
      // resting in a retreat web at home: the pantry feeds you, and the game is saved
      const retreat = (p.resting && !p.dead && has(Game.webs, 'sheltered')) ? Game.webs.sheltered(p.x, p.y) : null, atHome = !!(retreat && T.inClaim(p.x, p.y));
      if (atHome) {
        if (!T._wasHome && T._manualCd <= 0 && Game.save && Game.save.canWrite && Game.save.canWrite()) { T._manualCd = MANUAL_SAVE_COOLDOWN; Game.save.write(Game.state.slot, 'manual'); }
        T._eatT -= dt; if (T._eatT <= 0) { T._eatT = 1.5; if (p.hunger <= 88 && T.pantry.length) T.eatPantry(); }
      }
      T._wasHome = atHome;
      tickRival(dt, p);
    }
  };

  // the Claim, drawn on the ground: a faint dashed ring and a warm glow where the egg site is
  function drawClaim(ctx) {
    if (!T.active || !T.home) return;
    const p = P(), R = T.claimRadius(), cam = Game.camera, hx = T.home.x, hy = T.home.y;
    const d = p ? hypot(p.x - hx, p.y - hy) : 1e9; if (d > R + 500) return;
    const t = Game.time.real, k = 1 / (cam.zoom || 1), edge = clamp(1 - Math.abs(d - R) / 260, 0, 1);   // the ring shows when you are near its edge
    ctx.save();
    if (edge > 0.02) {
      ctx.lineWidth = 2.2 * k; ctx.setLineDash([14 * k, 10 * k]); ctx.lineDashOffset = -t * 8 * k;
      ctx.strokeStyle = 'rgba(255,208,126,' + (0.1 + 0.28 * edge).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(hx, hy, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (d < 360) {
      const g = ctx.createRadialGradient(hx, hy, 4, hx, hy, 70); g.addColorStop(0, 'rgba(255,214,140,' + (0.2 + 0.06 * Math.sin(t * 2)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 70, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ----------------------------------------------------------------------- succession (replaces Brood's sibling revive)
  function nearestOwnedShelter(from) {
    let best = T.home ? { x: T.home.x, y: T.home.y, d: hypot(T.home.x - from.x, T.home.y - from.y) } : { x: from.x, y: from.y, d: 0 };
    const L = (Game.webs && Game.webs.list) || [];
    for (let i = 0; i < L.length; i++) { const w = L[i]; if (w.type !== 'retreat' || w.dying || w.build < 0.7 || w.integrity <= 0.08) continue; const d = hypot(w.x - from.x, w.y - from.y); if (d < best.d) best = { x: w.x, y: w.y, d }; }
    return best;
  }
  // player.js asks which screen follows a death. With heirs left: the Succession card; none left: the line has ended.
  T.deathScene = function (cause) {
    const p = P(), L = T.lineage, g = T.currentGeneration(), cal = T.calendar(), lived = max(0, Game.time.t - T._bodyStart);
    if (!L || !g) return 'gameover';
    g.deaths.push({ cause: cause || 'eaten', stage: p ? p.stage : 0, year: cal.year, day: cal.day, lived: Math.round(lived) });
    if (lived > T.longest.seconds) T.longest = { seconds: Math.round(lived), generation: g.n, stage: p ? p.stage : 0 };
    if (L.heirs > 0) { T.succession = { cause: cause || 'eaten', heirsLeft: L.heirs - 1, stage: p ? p.stage : 0, x: p ? p.x : 0, y: p ? p.y : 0, setback: true }; return 'succession'; }
    finalizeLine(cause);
    return 'lineageended';
  };
  T.completeSuccession = function () {
    const s = T.succession, p = P(), L = T.lineage; if (!s || !p || !L || L.heirs < 1) return false;
    L.heirs--; T.succession = null;
    const from = { x: s.x, y: s.y }, pt = nearestOwnedShelter(from);
    // the old body's webs near where it fell are shaken: heirloom webs close by lose a little integrity (never all of it)
    if (has(Game.webs, 'heirlooms')) Game.webs.heirlooms().forEach(w => { const c = webCenter(w); if (hypot(c.x - from.x, c.y - from.y) <= SETBACK.webRadius) Game.webs.damage(w, SETBACK.webLoss, 'torn', 0.05); });
    p.respawnHeir(pt, { growthLoss: SETBACK.growthLoss, meter: SETBACK.meter, silk: SETBACK.silk, shaken: SETBACK.shaken, invuln: SETBACK.invuln });
    T._bodyStart = Game.time.t;
    if (has(Game.creatures, 'syncKin')) Game.creatures.syncKin(false);
    if (has(Game.creatures, 'startle')) Game.creatures.startle(pt.x, pt.y, 260);
    Game.setScene('playing');
    Game.stat('successions');
    Game.emit('succession', { heirs: L.heirs });
    return true;
  };
  function finalizeLine(cause) {
    const L = T.lineage, g = T.currentGeneration(), E = Game.edu, cal = T.calendar();
    if (g) g.status = 'ended';
    const gens = L.generations.length, deaths = L.generations.reduce((n, x) => n + x.deaths.length, 0);
    T.ended = {
      name: T.lineageName, species: Game.state.species, generations: gens, rank: T.rank, rankName: T.rankInfo().name, cp: Math.round(T.cp), deaths,
      longest: Object.assign({}, T.longest), facts: has(E, 'counts') ? E.counts().unlocked : 0, factsTotal: has(E, 'counts') ? E.counts().total : 0,
      cause: cause || 'eaten', year: cal.year, day: cal.day, playSeconds: Math.round(Game.time.t), endedAt: Date.now(), generationsList: L.generations.map(x => Object.assign({}, x)),
    };
    Game.emit('lineage:ended', { summary: T.ended });
    if (Game.save && Game.save.endLine) { try { Game.save.endLine(Game.state.slot, T.ended); } catch (e) { Game.reportError('territory.endLine', e); } }
  }
  // "Found a New Line": a fresh lineage in the same slot (the Codex and unlocked spiders are global, so they come along)
  T.foundNewLine = function () {
    const slot = Game.state.slot || 1, sp = Game.state.species;
    T.ended = null;
    Game.newGame('territory', sp, { slot, name: '' });
  };

  // ----------------------------------------------------------------------- laying and the Legacy scene
  function clutchOf(p, cal) {
    const pantry = min(3, floor(T.pantry.length / 5)), cond = (p.hp / p.maxHp > 0.6 && p.hunger > 60 && p.hydration > 60 && p.energy > 60) ? 1 : 0, rank = T.rankInfo().heirs;
    const mult = cal.day >= 33 ? 0.4 : (cal.day >= 28 ? 0.7 : 1), raw = 3 + pantry + cond + rank;
    return { base: 3, pantry, items: T.pantry.length, condition: cond, rank, raw, mult, day: cal.day, total: max(1, Math.round(raw * mult)) };
  }
  T.clutchPreview = () => { const p = P(); return p ? clutchOf(p, T.calendar()) : null; };
  function snapshotGeneration() {
    const E = Game.edu, es = (E && E.stats) || {}, gs = Game.state.stats || {}, mx = (a, b) => max(a || 0, b || 0);
    return { time: Math.round(Game.time.t - num((T.currentGeneration() || {}).t0, 0)), eaten: mx(es.ate, gs.eaten), webs: mx(es.spun, gs.webs), trapped: mx(es.trapped, gs.trapped), molts: mx(es.molts, gs.moltCount),
      stageTimes: (E && E.stageTimes ? E.stageTimes.slice() : []), facts: has(E, 'counts') ? (E.recent ? E.recent.length : 0) : 0, deaths: (T.currentGeneration() || { deaths: [] }).deaths.length, stored: gs.stored || 0 };
  }
  // player.js calls this when the egg sac is laid. Returns true when the Legacy scene took over (otherwise player.js ends the game as usual).
  T.onLaid = function (site) {
    const p = P(), g = T.currentGeneration(); if (!p || !g || !T.lineage) return false;
    const cal = T.calendar(), clutch = clutchOf(p, cal), ups = [];
    C.UPGRADES.forEach(u => { const lv = (p.upgrades && p.upgrades[u.id]) || 0; if (lv > 0) ups.push({ id: u.id, level: lv, passes: max(1, lv - 1) }); });
    ups.sort((a, b) => b.level - a.level);
    const slots = T.traitSlots();
    let mutation = null;
    if (T.rng() < MUTATION_CHANCE) { const pool = C.UPGRADES.filter(u => !((p.upgrades && p.upgrades[u.id]) > 0)); if (pool.length) mutation = pool[floor(T.rng() * pool.length) % pool.length].id; }
    g.status = 'laid'; g.clutch = clutch.total; g.stage = max(g.stage, p.stage); g.laid = { year: cal.year, day: cal.day, site: site ? site.id : null }; g.stats = snapshotGeneration();
    const zone = site && Game.world && Game.world.zoneAt ? Game.world.zoneAt(site.x, site.y) : null;
    T.legacy = {
      generation: g.n, year: cal.year, day: cal.day, season: cal.season, clutch, slots, candidates: ups, chosen: ups.slice(0, slots).map(u => u.id), mutation,
      site: site ? { id: site.id, x: site.x, y: site.y, type: site.type, zone: zone ? zone.id : null } : (T.home ? { id: T.home.shelterId, x: T.home.x, y: T.home.y, type: 'hollow', zone: null } : null),
      mother: { species: Game.state.species, stage: p.stage, upgrades: Object.assign({}, p.upgrades), stats: g.stats, deaths: g.deaths.length }, step: 0, report: null,
    };
    Game.emit('territory:generation_end', { generation: g.n });
    Game.setScene('legacy');
    return true;
  };
  T.legacyToggle = function (id) {
    const L = T.legacy; if (!L || !L.candidates.some(c => c.id === id)) return false;
    const i = L.chosen.indexOf(id);
    if (i >= 0) L.chosen.splice(i, 1); else if (L.chosen.length < L.slots) L.chosen.push(id); else return false;
    return true;
  };
  // winter turnover while the Legacy scene plays: skip to the next spring. Heirloom webs weather, stores spoil, the water comes back.
  T.runWinter = function () {
    const L = T.legacy; if (!L) return null; if (L.report) return L.report;
    const w = Game.world, cal = T.calendar(), from = cal.dayCount, to = (floor(from / YEAR_DAYS) + 1) * YEAR_DAYS;
    const rep = { days: to - from, fromYear: cal.year, fromDay: cal.day, toYear: cal.year + 1, websLost: 0, websDamaged: 0, spoiled: 0, kept: 0, cp: CP.winter };
    const webs = T.heirloomWebs();
    for (let dc = from; dc < to; dc++) {
      const S = SEASONS[floor((dc % YEAR_DAYS) / SEASON_DAYS)], loss = WEB_WINTER_LOSS[S.id] || 0.01;
      webs.forEach(web => { if (!web.dying) web.integrity = max(0, web.integrity - loss * (web.type === 'retreat' ? 0.5 : 1)); });
      for (let i = T.pantry.length - 1; i >= 0; i--) { T.pantry[i].fresh -= 1 / S.fresh; }
    }
    webs.forEach(web => { if (web.integrity <= 0.03) { web.integrity = 0; rep.websLost++; } else rep.websDamaged++; });
    for (let i = T.pantry.length - 1; i >= 0; i--) if (T.pantry[i].fresh <= 0) { T.pantry.splice(i, 1); rep.spoiled++; }
    rep.kept = T.pantry.length;
    L.report = rep;
    if (w) { w.dayCount = to; if (has(w, 'setTime')) w.setTime(0.02); else w.time01 = 0.02; if (has(w, 'regrow')) w.regrow(); }
    return rep;
  };
  T.legacyConfirm = function () {
    const L = T.legacy, lin = T.lineage; if (!L || !lin) return false;
    if (!L.report) T.runWinter();
    const prev = 'winter';   // the turnover always runs on to the next spring, so the winter is behind the clutch
    // ordinary webs do not survive the winter, and heirloom webs the winter finished fall now: the new generation does not start with a wreck on screen
    if (has(Game.webs, 'keepOnly')) Game.webs.keepOnly(w => w.heirloom && w.integrity > 0);
    const inh = {}, traits = [];
    L.chosen.forEach(id => { const c = L.candidates.find(x => x.id === id); if (c) { inh[id] = c.passes; traits.push({ id, level: c.passes }); } });
    if (L.mutation && !inh[L.mutation]) { inh[L.mutation] = 1; }
    T._inherit = inh;
    const site = L.site && L.site.id != null && Game.world && Game.world.shelters ? Game.world.shelters.find(s => s.id === L.site.id) : null;
    const gen = newGeneration(L.generation + 1, { traits, mutation: L.mutation });
    lin.generations.push(gen); lin.heirs = L.clutch.total;
    if (site) setHome(site); else if (L.site) setHome({ id: L.site.id, x: L.site.x, y: L.site.y });
    T.legacy = null;
    Game.state.stats = {};
    ['player', 'creatures', 'boss', 'edu'].forEach(n => {
      const m = Game[n], f = n === 'edu' ? (m && m.nextGeneration) : (m && m.reset);
      if (f) { try { f.call(m); } catch (e) { Game.reportError('territory.' + n, e); } }
    });
    T._cal = T.calendar(); T._season = T._cal.seasonIndex; T._night = null; T._bodyStart = Game.time.t; T.rival = null;
    T.addCP(CP.winter, 'winter');
    Game.camera.target = Game.player; Game.camera.targetZoom = C.STAGES[0].zoom; Game.camera.snap();
    Game.setScene('playing');
    Game.emit('season:change', { season: 'spring', prev });
    Game.emit('territory:generation_begin', { generation: gen.n, heirs: lin.heirs, mutation: L.mutation || null });
    return true;
  };

  // ----------------------------------------------------------------------- saving
  T.serialize = function () {
    if (!T.active) return null;
    const rd = (v) => Math.round(v * 100) / 100;
    return {
      v: 1, name: T.lineageName, lineage: { heirs: T.lineage.heirs, generations: T.lineage.generations.map(g => Object.assign({}, g)) }, cp: rd(T.cp), rank: T.rank, home: T.home,
      pantry: T.pantry.map(i => ({ id: i.id, kind: i.kind, nutrition: i.nutrition, fresh: rd(i.fresh), day: i.day })), pid: T._pid, rivalYears: Object.assign({}, T.rivalYears),
      longest: Object.assign({}, T.longest), bodyLived: Math.round(max(0, Game.time.t - T._bodyStart)), dayCP: Object.assign({}, T._dayCP), legacy: T.legacy ? JSON.parse(JSON.stringify(T.legacy)) : null,
    };
  };
  T.deserialize = function (d) {
    if (!d || typeof d !== 'object' || !T.active) return;
    const L = d.lineage || {};
    if (typeof d.name === 'string' && d.name.trim()) T.lineageName = d.name.slice(0, 40);
    const gens = Array.isArray(L.generations) && L.generations.length ? L.generations.filter(g => g && typeof g === 'object').map(g => Object.assign(newGeneration(num(g.n, 1)), g)) : [newGeneration(1)];
    T.lineage = { heirs: max(0, floor(num(L.heirs, START_HEIRS))), generations: gens };
    T.cp = max(0, num(d.cp, 0)); T.rank = 1; for (let i = 0; i < RANKS.length; i++) if (T.cp >= RANKS[i].cp) T.rank = RANKS[i].rank;
    if (d.home && typeof d.home.x === 'number' && typeof d.home.y === 'number') T.home = { shelterId: d.home.shelterId == null ? null : d.home.shelterId, x: d.home.x, y: d.home.y };
    else setHome(foundingSite(), true);
    T.pantry = Array.isArray(d.pantry) ? d.pantry.filter(i => i && typeof i.kind === 'string').map(i => ({ id: num(i.id, 0) || T._pid++, kind: i.kind, nutrition: max(1, num(i.nutrition, 4)), fresh: clamp(num(i.fresh, 1), 0.01, 1), day: num(i.day, 0) })) : [];
    T._pid = max(num(d.pid, 1), T.pantry.reduce((m, i) => max(m, i.id + 1), 1));
    T.rivalYears = (d.rivalYears && typeof d.rivalYears === 'object') ? Object.assign({}, d.rivalYears) : {};
    if (d.longest && typeof d.longest === 'object') T.longest = { seconds: num(d.longest.seconds, 0), generation: num(d.longest.generation, 0), stage: num(d.longest.stage, 0) };
    T._bodyStart = Game.time.t - max(0, num(d.bodyLived, 0));
    if (d.dayCP && typeof d.dayCP === 'object') T._dayCP = { day: num(d.dayCP.day, -1), n: num(d.dayCP.n, 0) };
    T.legacy = (d.legacy && typeof d.legacy === 'object' && d.legacy.clutch && Array.isArray(d.legacy.candidates)) ? Object.assign(d.legacy, { step: 0, report: null }) : null;
    T._cal = T.calendar(); T._season = T._cal.seasonIndex; T._night = null;
    // the rival (if one was in the Claim) comes back with the creatures: pick it up again
    T.rival = null;
  };
  // after a load: pick up a rival that came back with the creatures; a save made at the Legacy scene returns to it
  T.resumeScene = function () {
    if (T.legacy) return 'legacy';
    const cr = Game.creatures;
    if (cr && cr.list) { for (let i = 0; i < cr.list.length; i++) { const c = cr.list[i]; if (c.rival && !c.dead) { T.rival = { c, t: 0, kind: c.kind, id: c.id }; break; } } }
    return 'playing';
  };

  Game.register('territory', T);
})();
