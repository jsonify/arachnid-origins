/* ============================================================================
 * Arachnid Origins: The Spider's Journey  --  core.js
 * Engine core: registry, event bus, input, camera, utils, game loop, scenes.
 * Owned by: lead. Do NOT edit from module agents (report needed changes instead).
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game = root.Game || {};

  // ---------------------------------------------------------------- constants
  const C = Game.C = {
    VERSION: '1.2.0',           // shown on the title and pause screens; keep in step with package.json and CHANGELOG[0] (tools/check_version.js checks)
    // newest first; shown in Settings > Changelog. Add an entry with `node tools/bump.js <major|minor|patch> "what changed"`
    CHANGELOG: [
      { version: '1.2.0', date: '2026-10-06', notes: [
        'New journey: Territory. Claim a home site, spin heirloom webs that last, stock a pantry for the lean months and live through a 36-day year of four seasons.',
        'When your spider falls an heir takes her place; lay your egg sac to hand traits down to the next generation, and keep the line going for as long as you can.',
        'Three save slots with autosave, manual save and suspend, Continue and Load Game, and saves you can export and import as files.',
        'Seasons change the world: summer brings prey and rivals who raid your webs, autumn brings fog and the mating season, winter brings frost and scarcity.',
        'Rise from a Claim to a Dominion by earning Claim Points. New Codex facts, a Lineage tab and Territory goals.',
      ] },
      { version: '1.1.0', date: '2026-10-05', notes: [
        'Added this Changelog, in Settings.',
        'Fixed the "Catch a flying insect in a web" objective, which never completed when a flyer was caught.',
      ] },
      { version: '1.0.0', date: '2026-10-05', notes: [
        'First versioned release.',
        'Brood and Survival modes, with sibling revives in Brood.',
        'Defeat the Widow Matriarch to unlock the Black Widow as a playable spider.',
        'Mouse-aim controls and an on-screen key guide.',
      ] },
    ],
    VIEW_W: 1280, VIEW_H: 720,
    WORLD_W: 6400, WORLD_H: 3600,
    DAY_LENGTH: 300,            // seconds for a full day/night cycle
    // Game modes, chosen on the title screen (New Game) and remembered in Game.settings.mode. The first one is the default.
    //   brood:    siblings give their lives to revive you (1 sibling = 1 revive)
    //   survival: one life; siblings still warn you and huddle, but cannot save you
    //   territory: a persistent, saved campaign over many generations (territory.js, save.js); heirs replace sibling revives
    MODES: [
      { id: 'brood',    name: 'Brood',    tag: 'Default', blurb: 'Your siblings have your back. If you would die, a sibling gives its life to bring you back: one sibling, one revive. They also warn you of predators and huddle in while you rest.', note: 'Up to 5 revives, fewer as siblings drift away.' },
      { id: 'survival', name: 'Survival', tag: 'Hard',    blurb: 'One life, no second chances. Your siblings still warn you of predators and huddle in while you rest, but they cannot save you. When you die, the journey is over.', note: 'No revives.' },
      { id: 'territory', name: 'Territory', tag: 'Saves',  blurb: 'A home that remembers. Claim a site, spin heirloom webs, stock a pantry and live through the seasons. When you fall an heir takes your place; when you lay your egg sac the next generation hatches into the territory you built.', note: 'Saves in 3 slots. Ends only if the line dies out.' },
    ],
    // Playable spiders. The first one is the starter and is always available; the others are locked until Game.unlocks.unlock(id)
    // (the Widow Matriarch boss unlocks the Black Widow). A species is data: `mods` multiply the stage stats (see player.applyUpgrades),
    // `venom` makes bites poison prey, `nightStealth` multiplies how easily hunters notice you after dusk, `leg` stretches the legs.
    SPECIES: [
      { id: 'garden', name: 'Garden Spider', latin: 'Araneus diadematus', tag: 'Starter',
        blurb: 'A balanced orb-weaver, the spider you start as. Nothing special, nothing missing: a good all-rounder that learns every web.',
        perks: ['Balanced: no strengths, no weaknesses', 'Weaves every web type'], mods: {}, leg: 1 },
      { id: 'widow', name: 'Black Widow', latin: 'Latrodectus mactans', tag: 'Boss reward',
        blurb: 'A shy night hunter with a famous neurotoxin. Her bite poisons prey, her silk is strong and plentiful, and she hides well in the dark, but she is a little frail and slower on her feet.',
        perks: ['Neurotoxic bite: poison keeps working after the bite', '+35% bite damage, +25% silk', 'Hunters notice you 20% less at night', '-6% speed, -10% health'],
        mods: { bite: 1.35, silk: 1.25, speed: 0.94, hp: 0.9, venom: 0.5, nightStealth: 0.8 }, leg: 1.08,
        unlock: 'Defeat the Widow Matriarch in her lair deep in the Old Oak Bark. Grow to a sub-adult first.', boss: 'widow' },
    ],
    SPAWN: { x: 320, y: 1800 }, // hatch point (inside Leaf Litter)
    ZONES: [
      { id: 'litter', name: 'Leaf Litter',  x0: 0,    x1: 2400, y0: 0, y1: 3600, color: '#5a4327' },
      { id: 'bark',   name: 'Old Oak Bark', x0: 2400, x1: 4200, y0: 0, y1: 3600, color: '#4a3b30' },
      { id: 'garden', name: 'Flower Garden',x0: 4200, x1: 6400, y0: 0, y1: 3600, color: '#3d6b35' },
    ],
    // radius = world px; zoom = camera zoom (bigger spider -> lower zoom -> wider view)
    STAGES: [
      { id: 'hatchling', name: 'Hatchling',  radius: 5,  growthNeeded: 60,  speed: 95,  maxHp: 30,  maxSilk: 20,  silkRegen: 2.0, bite: 1,  zoom: 3.0, hungerRate: 0.55, thirstRate: 0.50, energyRate: 0.30, webs: [] },
      { id: 'spiderling',name: 'Spiderling', radius: 8,  growthNeeded: 140, speed: 115, maxHp: 50,  maxSilk: 60,  silkRegen: 2.5, bite: 2,  zoom: 2.4, hungerRate: 0.50, thirstRate: 0.45, energyRate: 0.28, webs: ['line'] },
      { id: 'juvenile',  name: 'Juvenile',   radius: 12, growthNeeded: 260, speed: 135, maxHp: 80,  maxSilk: 100, silkRegen: 3.0, bite: 4,  zoom: 1.9, hungerRate: 0.45, thirstRate: 0.40, energyRate: 0.26, webs: ['line', 'sheet', 'retreat'] },
      { id: 'subadult',  name: 'Sub-adult',  radius: 17, growthNeeded: 420, speed: 150, maxHp: 120, maxSilk: 150, silkRegen: 3.5, bite: 7,  zoom: 1.5, hungerRate: 0.42, thirstRate: 0.36, energyRate: 0.24, webs: ['line', 'sheet', 'retreat', 'orb'] },
      { id: 'adult',     name: 'Adult',      radius: 22, growthNeeded: 0,   speed: 160, maxHp: 160, maxSilk: 200, silkRegen: 4.0, bite: 10, zoom: 1.2, hungerRate: 0.40, thirstRate: 0.34, energyRate: 0.22, webs: ['line', 'sheet', 'retreat', 'orb'] },
    ],
    // key = hotbar key (Digit1..4); stage = minimum stage index that unlocks it
    WEB_TYPES: {
      line:    { key: 1, name: 'Dragline',      cost: 8,  stage: 1, desc: 'A single silk line: travel fast, snag small prey.' },
      sheet:   { key: 2, name: 'Sheet Web',     cost: 25, stage: 2, desc: 'A flat sheet that entangles walking prey.' },
      orb:     { key: 3, name: 'Orb Web',       cost: 45, stage: 3, desc: 'A classic spiral orb that catches flyers.' },
      retreat: { key: 4, name: 'Silk Retreat',  cost: 30, stage: 2, desc: 'A silk shelter: rest safely, hide from predators.' },
    },
    // Molt upgrades. Max level 3 each. Player module applies the effects.
    UPGRADES: [
      { id: 'speed',      name: 'Swift Legs',      desc: '+8% move speed per level.',                     max: 3 },
      { id: 'silk',       name: 'Silk Glands',     desc: '+25% silk capacity and regen per level.',       max: 3 },
      { id: 'camo',       name: 'Camouflage',      desc: 'Predators notice you 20% less per level.',      max: 3 },
      { id: 'venom',      name: 'Potent Venom',    desc: '+25% bite damage per level.',                   max: 3 },
      { id: 'carapace',   name: 'Tough Cuticle',   desc: '+20% max health, -10% damage taken per level.', max: 3 },
      { id: 'vibration',  name: 'Vibration Sense', desc: 'Sense nearby creatures through the dark (+110 px radius per level).', max: 3 },
      { id: 'metabolism', name: 'Efficient Metabolism', desc: '-15% hunger and thirst drain per level.', max: 3 },
    ],
    // Every sfx name that may be emitted via Game.emit('sfx', {name, x, y, vol}).
    SFX: ['step', 'sprint', 'bite', 'eat', 'drink', 'spin', 'web_place', 'web_snap', 'trap', 'struggle',
          'hurt', 'death', 'molt_start', 'molt_end', 'levelup', 'ui_click', 'ui_hover', 'ui_back', 'unlock',
          'danger', 'splash', 'thunder', 'wasp_buzz', 'bird_screech', 'ant_hiss', 'rest', 'courtship', 'egg', 'victory', 'revive',
          'boss_roar', 'web_spit', 'slam'],
    KEYMAP: {
      up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
      sprint: ['ShiftLeft', 'ShiftRight'], spin: ['Space'], bite: ['KeyJ'], interact: ['KeyE'], rest: ['KeyR'],
      web1: ['Digit1'], web2: ['Digit2'], web3: ['Digit3'], web4: ['Digit4'],
      map: ['KeyM'], codex: ['KeyB'], science: ['KeyF'], zoomOut: ['KeyZ'], guide: ['KeyH'], territory: ['KeyT'], recycle: ['KeyX'],
      pause: ['Escape', 'KeyP'], confirm: ['Enter', 'Space'], back: ['Escape', 'Backspace'],
      menuUp: ['ArrowUp', 'KeyW'], menuDown: ['ArrowDown', 'KeyS'], menuLeft: ['ArrowLeft', 'KeyA'], menuRight: ['ArrowRight', 'KeyD'],
      tabNext: ['Tab', 'KeyE'], tabPrev: ['KeyQ'],
    },
  };

  // ------------------------------------------------------------------- utils
  const U = Game.util = {
    clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smooth: (t) => t * t * (3 - 2 * t),
    approach: (v, target, step) => v < target ? Math.min(v + step, target) : Math.max(v - step, target),
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    dist2: (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay),
    angleTo: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    wrapAngle: (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; },
    angleDiff: (a, b) => U.wrapAngle(b - a),
    turnToward: (a, target, maxStep) => { const d = U.angleDiff(a, target); return a + U.clamp(d, -maxStep, maxStep); },
    // seeded RNG (deterministic world gen): const r = mulberry32(123); r() -> [0,1)
    mulberry32: (seed) => { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    // deterministic value noise in [0,1]
    hash2: (x, y, seed) => { let h = (x * 374761393 + y * 668265263 + (seed || 0) * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; },
    noise2: (x, y, seed) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const s = (t) => t * t * (3 - 2 * t);
      const a = U.hash2(xi, yi, seed), b = U.hash2(xi + 1, yi, seed), c = U.hash2(xi, yi + 1, seed), d = U.hash2(xi + 1, yi + 1, seed);
      const u = s(xf), v = s(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    },
    // distance from point to segment, and closest point {x,y,t}
    pointSeg: (px, py, x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const x = x1 + dx * t, y = y1 + dy * t;
      return { x, y, t, d: Math.hypot(px - x, py - y) };
    },
    hexToRgb: (hex) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
    mixColor: (c1, c2, t) => { const a = U.hexToRgb(c1), b = U.hexToRgb(c2); return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')'; },
    rgba: (hex, a) => { const c = U.hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; },
    // Create an offscreen canvas (works in browser and in the headless test harness).
    makeCanvas: (w, h) => { const c = (root.document && root.document.createElement) ? root.document.createElement('canvas') : null; if (c) { c.width = w; c.height = h; } return c; },
    inRect: (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1,
    // bytes <-> base64 text (the headless test context has no btoa/atob) and a small string hash; used by saves
    bytesToB64: (u8) => {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let o = '';
      for (let i = 0; i < u8.length; i += 3) {
        const a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0, n = (a << 16) | (b << 8) | c;
        o += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < u8.length ? A[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? A[n & 63] : '=');
      }
      return o;
    },
    b64ToBytes: (str) => {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; str = String(str || '').replace(/[^A-Za-z0-9+/]/g, '');
      const out = new Uint8Array(Math.floor(str.length * 3 / 4)); let k = 0;
      for (let i = 0; i < str.length; i += 4) {
        const a = A.indexOf(str[i]), b = A.indexOf(str[i + 1]), c = i + 2 < str.length ? A.indexOf(str[i + 2]) : -1, d = i + 3 < str.length ? A.indexOf(str[i + 3]) : -1;
        out[k++] = (a << 2) | (b >> 4); if (c >= 0) out[k++] = ((b & 15) << 4) | (c >> 2); if (d >= 0) out[k++] = ((c & 3) << 6) | d;
      }
      return out.subarray(0, k);
    },
    hash32: (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); },
  };

  // --------------------------------------------------------------- event bus
  const listeners = {};
  Game.on = (evt, fn) => { (listeners[evt] || (listeners[evt] = [])).push(fn); return fn; };
  Game.off = (evt, fn) => { const l = listeners[evt]; if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  Game.emit = (evt, data) => {
    const l = listeners[evt]; if (!l) return;
    for (let i = 0; i < l.length; i++) { try { l[i](data, evt); } catch (e) { Game.reportError('event:' + evt, e); } }
  };

  // Errors never crash the loop; they are recorded (tests assert this list is empty).
  Game.errors = [];
  const seenErr = {};
  Game.reportError = (where, e) => {
    const key = where + '|' + (e && e.message);
    Game.errors.push({ where, message: e && e.message, stack: e && e.stack });
    if (!seenErr[key]) { seenErr[key] = 1; if (root.console) console.error('[Game] error in ' + where + ':', e); }
    if (Game.errors.length > 200) Game.errors.shift();
  };

  // --------------------------------------------------------------- settings/store
  const memStore = {};
  Game.store = {
    get(k, d) { try { const v = root.localStorage && root.localStorage.getItem('ao_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return k in memStore ? memStore[k] : d; } },
    set(k, v) { try { root.localStorage.setItem('ao_' + k, JSON.stringify(v)); } catch (e) { memStore[k] = v; } },
  };
  Game.settings = Object.assign({ master: 0.8, music: 0.6, sfx: 0.9, muted: false, science: false, hints: true, screenShake: true, mouseAim: true, keyGuide: true, mode: 'brood', species: 'garden' }, Game.store.get('settings', {}));
  if (!C.MODES.some(m => m.id === Game.settings.mode)) Game.settings.mode = C.MODES[0].id;   // unknown / stale saved value
  Game.modeInfo = (id) => C.MODES.find(m => m.id === id) || C.MODES[0];
  Game.saveSettings = () => Game.store.set('settings', Game.settings);

  // Spiders you can play as. The starter (C.SPECIES[0]) is always available; the rest are unlocked by beating their boss and stay
  // unlocked between journeys (saved in the store, like Codex discoveries).
  //   Game.unlocks.has(id)      is this species available?        Game.unlocks.list()  ids of every available species
  //   Game.unlocks.unlock(id)   unlock it -> true if it was new (emits `species:unlocked` {id}); unknown ids are ignored
  const speciesIds = () => C.SPECIES.map(s => s.id);
  const savedUnlocks = () => { const v = Game.store.get('unlocks', []); return Array.isArray(v) ? v.filter(id => speciesIds().indexOf(id) > 0) : []; };   // index 0 is the starter: never "locked"
  let unlockedSet = new Set(savedUnlocks());
  Game.speciesInfo = (id) => C.SPECIES.find(s => s.id === id) || C.SPECIES[0];
  Game.unlocks = {
    has: (id) => id === C.SPECIES[0].id || unlockedSet.has(id),
    list: () => C.SPECIES.filter(s => Game.unlocks.has(s.id)).map(s => s.id),
    unlock(id) {
      if (speciesIds().indexOf(id) < 0 || Game.unlocks.has(id)) return false;
      unlockedSet.add(id); Game.store.set('unlocks', Array.from(unlockedSet));
      Game.emit('species:unlocked', { id });
      return true;
    },
    reload() { unlockedSet = new Set(savedUnlocks()); },   // re-read the saved list (tests)
  };
  // the species a new game uses: the one asked for, else the one picked last, as long as it is unlocked; otherwise the starter
  Game.pickSpecies = (id) => { const s = Game.speciesInfo(id || Game.settings.species); return Game.unlocks.has(s.id) ? s.id : C.SPECIES[0].id; };
  if (!Game.unlocks.has(Game.settings.species)) Game.settings.species = C.SPECIES[0].id;   // stale saved choice

  // --------------------------------------------------------------- shared state
  // Modules own their own state (Game.player.x ...). Game.state only holds cross-cutting flags.
  Game.state = {
    scene: 'boot',    // boot|title|playing|paused|molting|codex|gameover|victory
    prevScene: null,
    danger: 0,        // 0..1 nearest-predator threat; written by creatures, read by audio/ui
    stats: {},        // free-form counters (eaten, webs, moltCount, daysSurvived...) written by anyone via Game.stat()
    victory: false,
    mode: 'brood',    // brood|survival|territory: set by Game.newGame(mode)
    species: 'garden', // which spider you are (a Game.C.SPECIES id): set by Game.newGame(mode, species)
    slot: null,       // Territory: the save slot (1..3) this run writes to; null in the other modes
    lineageName: '',  // Territory: the name given to a new lineage
  };
  Game.stat = (k, add) => { const s = Game.state.stats; s[k] = (s[k] || 0) + (add === undefined ? 1 : add); return s[k]; };

  Game.time = { t: 0, real: 0, dt: 0, frame: 0 };  // t = sim seconds (only advances while playing), real = wall seconds (always)

  Game.setScene = (name) => {
    const from = Game.state.scene; if (from === name) return;
    Game.state.prevScene = from; Game.state.scene = name;
    Game.emit('scene:change', { from, to: name });
  };

  // ---------------------------------------------------------------- registry
  Game.modules = {};
  const modList = [];
  // Game.register('player', { priority, alwaysUpdate, init(), reset(), update(dt), ... })
  Game.register = (name, mod) => {
    mod.name = name; if (mod.priority == null) mod.priority = 50;
    Game.modules[name] = mod; Game[name] = mod;
    modList.push(mod); modList.sort((a, b) => a.priority - b.priority);
    return mod;
  };

  // Drawer layers (world space unless 'screen')
  Game.LAYER = { BACKGROUND: 0, GROUND: 10, RESOURCES: 20, SHELTER: 25, WEBS: 30, CREATURES_LOW: 40, PLAYER: 50, CREATURES_HIGH: 60, CANOPY: 70, WEATHER: 80, DARKNESS: 90, HUD: 100, MENU: 200, OVERLAY: 300 };
  const worldDrawers = [], screenDrawers = [];
  Game.addDrawer = (layer, fn, space) => {
    const list = space === 'screen' ? screenDrawers : worldDrawers;
    list.push({ layer, fn, order: list.length }); list.sort((a, b) => a.layer - b.layer || a.order - b.order);
  };
  Game.addScreenDrawer = (layer, fn) => Game.addDrawer(layer, fn, 'screen');

  // ------------------------------------------------------------------- input
  const keysDown = {}, keysPressed = {}, keysReleased = {}, textBuf = [];   // textBuf: characters typed this frame ('\b' = backspace), for text fields
  const mouse = { x: 640, y: 360, wx: 0, wy: 0, down: false, pressed: false, released: false, right: false, rightPressed: false, wheel: 0, moved: false };
  const codeToActions = {};
  Object.keys(C.KEYMAP).forEach(a => C.KEYMAP[a].forEach(k => (codeToActions[k] || (codeToActions[k] = [])).push(a)));
  const actionDown = (a) => { const ks = C.KEYMAP[a]; if (!ks) return false; for (let i = 0; i < ks.length; i++) if (keysDown[ks[i]]) return true; return false; };
  const actionEdge = (a, table) => { const ks = C.KEYMAP[a]; if (!ks) return false; for (let i = 0; i < ks.length; i++) if (table[ks[i]]) return true; return false; };
  Game.input = {
    mouse,
    down: (action) => actionDown(action) || (action === 'bite' && mouse.down),
    pressed: (action) => actionEdge(action, keysPressed) || (action === 'bite' && mouse.pressed),
    released: (action) => actionEdge(action, keysReleased) || (action === 'bite' && mouse.released),
    key: (code) => !!keysDown[code],
    keyPressed: (code) => !!keysPressed[code],
    // movement axis, each -1..1, normalized when diagonal
    axis: () => {
      let x = (actionDown('right') ? 1 : 0) - (actionDown('left') ? 1 : 0);
      let y = (actionDown('down') ? 1 : 0) - (actionDown('up') ? 1 : 0);
      if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      return { x, y };
    },
    anyPressed: () => { for (const k in keysPressed) return true; return mouse.pressed; },
    // characters typed since the last frame (printable keys, ' ' and '\b' for backspace); cleared at the end of every frame
    takeText: () => { const s = textBuf.join(''); textBuf.length = 0; return s; },
    // Tests may inject input:  Game.input.inject.keyDown('KeyW') / keyUp / click(x,y)
    inject: {
      keyDown: (code) => { if (!keysDown[code]) keysPressed[code] = true; keysDown[code] = true; Game.audioUnlock(); },
      keyUp: (code) => { keysDown[code] = false; keysReleased[code] = true; },
      click: (x, y) => { mouse.x = x; mouse.y = y; mouse.pressed = true; mouse.down = true; mouse.released = true; mouse.moved = true; Game.audioUnlock(); },
      clear: () => { for (const k in keysDown) keysDown[k] = false; },
      type: (str) => { for (const ch of String(str)) textBuf.push(ch); },
    },
  };
  Game.audioUnlock = () => { if (Game.audio && Game.audio.unlock) { try { Game.audio.unlock(); } catch (e) { Game.reportError('audio.unlock', e); } } };

  // ------------------------------------------------------------------ camera
  const cam = Game.camera = {
    x: C.SPAWN.x, y: C.SPAWN.y, zoom: 3.0, targetZoom: 3.0,
    target: null,          // object with x,y ; default Game.player
    lerp: 6,               // follow speed
    shakeAmt: 0, shakeX: 0, shakeY: 0,
    view: { x0: 0, y0: 0, x1: 0, y1: 0 },  // visible world rect (updated each frame)
    zoomOutHeld: false,
    shake(amount) { if (Game.settings.screenShake) cam.shakeAmt = Math.max(cam.shakeAmt, amount); },
    snap() { const t = cam.target || Game.player; if (t) { cam.x = t.x; cam.y = t.y; } cam.zoom = cam.targetZoom; },
    worldToScreen(wx, wy) { return { x: (wx - cam.x) * cam.zoom + C.VIEW_W / 2, y: (wy - cam.y) * cam.zoom + C.VIEW_H / 2 }; },
    screenToWorld(sx, sy) { return { x: (sx - C.VIEW_W / 2) / cam.zoom + cam.x, y: (sy - C.VIEW_H / 2) / cam.zoom + cam.y }; },
    inView(x, y, pad) { pad = pad || 0; const v = cam.view; return x >= v.x0 - pad && x <= v.x1 + pad && y >= v.y0 - pad && y <= v.y1 + pad; },
  };
  function updateCamera(dt) {
    const t = cam.target || Game.player;
    if (t && typeof t.x === 'number') {
      const k = 1 - Math.exp(-cam.lerp * dt);
      cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
    }
    // stage zoom is set by player module via camera.targetZoom; hold Z to zoom out for perspective
    const zt = cam.targetZoom * (Game.input.down('zoomOut') && Game.state.scene === 'playing' ? 0.45 : 1);
    cam.zoom += (zt - cam.zoom) * (1 - Math.exp(-4 * dt));
    // clamp so the view stays inside the world
    const hw = C.VIEW_W / 2 / cam.zoom, hh = C.VIEW_H / 2 / cam.zoom;
    cam.x = U.clamp(cam.x, hw, Math.max(hw, C.WORLD_W - hw)); cam.y = U.clamp(cam.y, hh, Math.max(hh, C.WORLD_H - hh));
    if (cam.shakeAmt > 0.05) { cam.shakeX = (Math.random() - 0.5) * cam.shakeAmt; cam.shakeY = (Math.random() - 0.5) * cam.shakeAmt; cam.shakeAmt *= Math.exp(-9 * dt); } else { cam.shakeAmt = 0; cam.shakeX = cam.shakeY = 0; }
    cam.view.x0 = cam.x - hw; cam.view.x1 = cam.x + hw; cam.view.y0 = cam.y - hh; cam.view.y1 = cam.y + hh;
    const mw = cam.screenToWorld(mouse.x, mouse.y); mouse.wx = mw.x; mouse.wy = mw.y;
  }

  // ------------------------------------------------------------- game control
  // mode: a Game.C.MODES id; omitted = the one last chosen (Game.settings.mode, saved by the title screen)
  // species: a Game.C.SPECIES id that is unlocked; omitted, unknown or still locked = the one last chosen (Game.settings.species), else the starter
  // opts (Territory): { slot: 1..3 (the save slot this run writes to; default 1), name: the lineage name }
  function resetModules() {
    modList.forEach(m => { if (m.reset) { try { m.reset(); } catch (e) { Game.reportError(m.name + '.reset', e); } } });
  }
  function beginRun(mode, species, opts) {
    opts = opts || {};
    Game.state.mode = Game.modeInfo(mode || Game.settings.mode).id;
    Game.state.species = Game.pickSpecies(species);
    Game.state.slot = Game.state.mode === 'territory' ? (opts.slot >= 1 && opts.slot <= 3 ? opts.slot | 0 : 1) : null;
    Game.state.lineageName = Game.state.mode === 'territory' ? String(opts.name || '').slice(0, 40) : '';
    Game.state.victory = false; Game.state.danger = 0; Game.state.stats = {};
    Game.time.t = 0;
    resetModules();
  }
  Game.newGame = (mode, species, opts) => {
    beginRun(mode, species, opts);
    cam.target = Game.player || null; cam.targetZoom = C.STAGES[0].zoom; cam.snap();
    Game.setScene('playing');
    Game.emit('game:new', { mode: Game.state.mode, slot: Game.state.slot });
  };
  // Territory: continue a saved lineage. Reads and validates the slot (Game.save), runs the same reset path as newGame, then lets every module
  // restore its slice of the save (deserialize, ascending priority). Returns true on success; Game.save.lastError says why not.
  Game.loadGame = (slot, kind) => {
    const S = Game.save, info = S && S.beginLoad ? S.beginLoad(slot, kind) : null;
    if (!info) return false;
    const doc = info.doc, meta = doc.meta || {};
    try {
      beginRun('territory', meta.species, { slot, name: meta.lineage });
      Game.time.t = +(doc.time && doc.time.t) || 0;   // timestamps inside the save (web birth, stage timers) stay valid
      Game.state.stats = Object.assign({}, doc.stats || {});
      Game.setScene('playing');                       // modules that start a molt or a scene while restoring need the right scene
      S.apply(doc);
      cam.target = Game.player || null; cam.snap();
      Game.emit('game:new', { mode: 'territory', slot, loaded: true });
      const rs = Game.territory && Game.territory.resumeScene ? Game.territory.resumeScene() : 'playing';
      if (rs && rs !== 'playing') Game.setScene(rs);
      S.finishLoad(info);
      return true;
    } catch (e) {
      Game.reportError('loadGame', e);
      if (S.failLoad) S.failLoad(info, e);
      Game.toTitle();
      return false;
    }
  };
  // Show the title screen with a fresh world behind it (does not start the sim).
  Game.toTitle = () => {
    Game.state.danger = 0; Game.state.stats = {}; Game.time.t = 0;
    resetModules();
    cam.target = Game.player || null; cam.targetZoom = 1.4; cam.snap(); Game.setScene('title');
  };
  Game.pause = () => { if (Game.state.scene === 'playing') Game.setScene('paused'); };
  Game.resume = () => { const sc = Game.state.scene; if (sc === 'paused' || sc === 'codex' || sc === 'molting' || sc === 'territory') Game.setScene('playing'); };

  // -------------------------------------------------------------- main loop
  let canvas = null, ctx = null, dpr = 1, running = false, lastTs = 0;
  Game.canvas = null; Game.ctx = null;

  function callMod(m, hook, dt) { if (!m[hook]) return; try { m[hook](dt); } catch (e) { Game.reportError(m.name + '.' + hook, e); } }

  Game.step = function (dt) {
    // dt in seconds. One full frame: update then (optionally) draw.
    dt = Math.min(dt, 1 / 20);
    Game.time.dt = dt; Game.time.real += dt; Game.time.frame++;
    const playing = Game.state.scene === 'playing';
    if (playing) Game.time.t += dt;
    updateCamera(dt);
    for (let i = 0; i < modList.length; i++) {
      const m = modList[i];
      if (playing || m.alwaysUpdate) callMod(m, 'update', dt);
    }
    // late update for modules that need everything else settled (ui, audio)
    for (let i = 0; i < modList.length; i++) { const m = modList[i]; if ((playing || m.alwaysUpdate) && m.lateUpdate) callMod(m, 'lateUpdate', dt); }
    // clear per-frame input edges
    for (const k in keysPressed) delete keysPressed[k];
    for (const k in keysReleased) delete keysReleased[k];
    mouse.pressed = false; mouse.released = false; mouse.rightPressed = false; mouse.wheel = 0; mouse.moved = false;
    textBuf.length = 0;
  };

  Game.render = function () {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c0a08'; ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
    if (Game.state.scene === 'boot') return;
    ctx.save();
    ctx.translate(C.VIEW_W / 2 + cam.shakeX, C.VIEW_H / 2 + cam.shakeY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    for (let i = 0; i < worldDrawers.length; i++) { try { ctx.save(); worldDrawers[i].fn(ctx); ctx.restore(); } catch (e) { ctx.restore(); Game.reportError('draw(world):' + worldDrawers[i].layer, e); } }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < screenDrawers.length; i++) { try { ctx.save(); screenDrawers[i].fn(ctx); ctx.restore(); } catch (e) { ctx.restore(); Game.reportError('draw(screen):' + screenDrawers[i].layer, e); } }
  };

  function frame(ts) {
    if (!running) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60; lastTs = ts;
    Game.step(dt); Game.render();
    root.requestAnimationFrame(frame);
  }

  function resize() {
    if (!canvas || !root.innerWidth) return;
    const s = Math.min(root.innerWidth / C.VIEW_W, root.innerHeight / C.VIEW_H);
    canvas.style.width = Math.floor(C.VIEW_W * s) + 'px'; canvas.style.height = Math.floor(C.VIEW_H * s) + 'px';
    dpr = Math.min(2, (root.devicePixelRatio || 1) * s); dpr = Math.max(1, dpr);
    canvas.width = Math.floor(C.VIEW_W * dpr); canvas.height = Math.floor(C.VIEW_H * dpr);
  }

  function bindInput() {
    const d = root.document; if (!d || !d.addEventListener) return;
    const stopKeys = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };
    root.addEventListener('keydown', (e) => {
      if (stopKeys[e.code]) e.preventDefault(); if (!keysDown[e.code]) keysPressed[e.code] = true; keysDown[e.code] = true; Game.audioUnlock();
      if (e.key && !e.ctrlKey && !e.metaKey && !e.altKey && textBuf.length < 32) { if (e.key.length === 1) textBuf.push(e.key); else if (e.key === 'Backspace') textBuf.push('\b'); }
    });
    root.addEventListener('keyup', (e) => { keysDown[e.code] = false; keysReleased[e.code] = true; });
    root.addEventListener('blur', () => { for (const k in keysDown) keysDown[k] = false; mouse.down = false; if (Game.state.scene === 'playing') { Game.emit('window:blur'); Game.pause(); } });
    const pos = (e) => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * C.VIEW_W / r.width; mouse.y = (e.clientY - r.top) * C.VIEW_H / r.height; mouse.moved = true; };
    canvas.addEventListener('mousemove', pos);
    canvas.addEventListener('mousedown', (e) => { pos(e); if (e.button === 0) { mouse.down = true; mouse.pressed = true; } else if (e.button === 2) { mouse.right = true; mouse.rightPressed = true; } Game.audioUnlock(); });
    root.addEventListener('mouseup', (e) => { if (e.button === 0) { mouse.down = false; mouse.released = true; } else if (e.button === 2) mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    root.addEventListener('resize', resize);
  }

  // Boot: call once after all scripts have loaded.
  Game.boot = function (canvasEl) {
    const d = root.document;
    canvas = canvasEl || (d && d.getElementById && d.getElementById('game')) || (d && d.createElement && d.createElement('canvas'));
    Game.canvas = canvas;
    if (canvas) { ctx = canvas.getContext('2d'); Game.ctx = ctx; canvas.width = C.VIEW_W; canvas.height = C.VIEW_H; resize(); bindInput(); }
    modList.forEach(m => { if (m.init) { try { m.init(); } catch (e) { Game.reportError(m.name + '.init', e); } } });
    Game.toTitle();
    return Game;
  };
  Game.start = function () { if (running) return; running = true; lastTs = 0; if (root.requestAnimationFrame) root.requestAnimationFrame(frame); };
  Game.stop = function () { running = false; };
  Game.isRunning = () => running;

  // Dev helper: log a one-line snapshot
  Game.snapshot = function () {
    const p = Game.player || {};
    return { scene: Game.state.scene, t: +Game.time.t.toFixed(1), stage: p.stage, x: Math.round(p.x || 0), y: Math.round(p.y || 0), hp: Math.round(p.hp || 0), hunger: Math.round(p.hunger || 0), errors: Game.errors.length };
  };
})();
