/* ============================================================================
 * Arachnid Origins  --  save.js   (module `save`, priority 5, alwaysUpdate)
 * The save system for Territory mode (territory-mode-gdd.md section 7). Brood and Survival are never saved.
 *
 *   Game.save.slots()                  -> 3 slot cards {slot, empty, name, meta, savedAt, kinds, hasSuspend, hall}
 *   Game.save.write(slot, kind)        -> bool   kind: 'autosave' | 'manual' | 'suspend'
 *   Game.save.read(slot, kind?)        -> the save document, or null (Game.save.lastError says why)
 *   Game.save.delete(slot, kind?)      Game.save.exportSlot(slot) / importText(slot, text) / importSlot(file, slot)
 *   Game.save.backend                  the storage adapter (swappable with setBackend)
 *
 * The API is synchronous: snapshots live in an in-memory cache and are persisted through the backend behind it (IndexedDB can only answer later).
 * A snapshot is one JSON text per slot and kind, with a checksum, written to a temporary key, read back, then swapped in with the old one kept as
 * `.bak`. Each module contributes its own slice through the optional hooks serialize() / deserialize(data) (see ARCHITECTURE.md).
 * ========================================================================== */
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const Game = root.Game;
  if (!Game || !Game.register) return;
  const C = Game.C, U = Game.util;

  const SCHEMA = 1, SLOTS = 3, KINDS = ['autosave', 'manual', 'suspend'];
  const AUTOSAVE_EVERY = 300, CALM = 0.2;          // seconds of play between autosaves, and the danger level above which one waits
  const LEASE_KEY = 'saveLease', LEASE_TTL = 15000, LEASE_BEAT = 5;   // one lease per slot (key saveLease1..3): another tab owns a slot while its lease is newer than 15 s
  const HALL_MAX = 20;

  // schema upgrades: MIGRATIONS[n](doc) turns a version-n document into version n + 1 (and sets doc.schema). None exist yet: schema 1 is the first.
  const MIGRATIONS = {};

  const has = (o, f) => !!(o && typeof o[f] === 'function');
  const keyOf = (slot, kind) => 's' + slot + '.' + kind;
  const sorted = () => Object.keys(Game.modules).map(n => Game.modules[n]).sort((a, b) => a.priority - b.priority);

  // =============================================================== storage backends
  // adapter: { name, loadAll(keys, cb), put(key, text, cb), get(key, cb), del(key, cb) }; every callback is cb(err, value) and may fire at once (sync backends)
  function memoryBackend() {
    const m = {};
    return { name: 'memory', loadAll: (keys, cb) => cb(null, Object.assign({}, m)), put: (k, t, cb) => { m[k] = t; cb(null); }, get: (k, cb) => cb(null, k in m ? m[k] : null), del: (k, cb) => { delete m[k]; cb(null); }, _m: m };
  }
  function localBackend() {
    const P = 'ao_snap_', ls = () => root.localStorage;
    return {
      name: 'localStorage',
      loadAll(keys, cb) { const o = {}; (keys || []).forEach(k => { try { const v = ls().getItem(P + k); if (v != null) o[k] = v; } catch (e) { /* skip */ } }); cb(null, o); },
      put(k, t, cb) { try { ls().setItem(P + k, t); cb(null); } catch (e) { cb(e); } },
      get(k, cb) { try { cb(null, ls().getItem(P + k)); } catch (e) { cb(e); } },
      del(k, cb) { try { ls().removeItem(P + k); cb(null); } catch (e) { cb(e); } },
    };
  }
  function idbBackend(done) {
    const name = 'arachnid-origins', store = 'snaps'; let db = null, req;
    try { req = root.indexedDB.open(name, 1); } catch (e) { done(e); return; }
    const tx = (mode, fn, cb) => { try { const t = db.transaction(store, mode), os = t.objectStore(store); let val; fn(os, (v) => { val = v; }); t.oncomplete = () => cb(null, val); t.onerror = () => cb(t.error || new Error('idb transaction failed')); t.onabort = () => cb(t.error || new Error('idb transaction aborted')); } catch (e) { cb(e); } };
    const be = {
      name: 'indexedDB',
      loadAll(keys, cb) { const out = {}; tx('readonly', (os) => { const rq = os.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } }; }, (err) => cb(err, out)); },
      put(k, t, cb) { tx('readwrite', (os) => { os.put(t, k); }, (err) => cb(err)); },
      get(k, cb) { tx('readonly', (os, set) => { const rq = os.get(k); rq.onsuccess = () => set(rq.result == null ? null : rq.result); }, cb); },
      del(k, cb) { tx('readwrite', (os) => { os.delete(k); }, (err) => cb(err)); },
    };
    req.onupgradeneeded = () => { try { req.result.createObjectStore(store); } catch (e) { /* exists */ } };
    req.onsuccess = () => { db = req.result; done(null, be); };
    req.onerror = () => done(req.error || new Error('idb open failed'));
    req.onblocked = () => done(new Error('idb blocked'));
  }

  // =============================================================== documents: encode, decode, validate, migrate
  function encode(doc) {
    const body = JSON.stringify(doc);
    return JSON.stringify(Object.assign({}, doc, { checksum: U.hash32(body) }));
  }
  // -> { ok, doc } or { ok: false, error } with error: empty | corrupt | checksum | schema | newer | unsupported | world | mode
  function decode(text, o) {
    o = o || {};
    if (typeof text !== 'string' || !text.length) return { ok: false, error: 'empty' };
    let obj; try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'corrupt' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'corrupt' };
    const sum = obj.checksum; delete obj.checksum;
    if (typeof sum !== 'string' || U.hash32(JSON.stringify(obj)) !== sum) return { ok: false, error: 'checksum' };
    if (typeof obj.schema !== 'number' || obj.schema < 0 || obj.schema !== Math.floor(obj.schema)) return { ok: false, error: 'schema' };
    if (obj.schema > SCHEMA) return { ok: false, error: 'newer' };
    while (obj.schema < SCHEMA) {   // chain from the stored version up to this one
      const fn = save.migrations[obj.schema];
      if (!fn) return { ok: false, error: 'unsupported' };
      try { obj = fn(obj); } catch (e) { return { ok: false, error: 'unsupported' }; }
      if (!obj || obj.schema !== undefined && typeof obj.schema !== 'number') return { ok: false, error: 'unsupported' };
    }
    if (!obj.meta || typeof obj.meta !== 'object' || obj.meta.mode !== 'territory') return { ok: false, error: 'mode' };
    if (!o.skipWorld && Game.world && Game.world.seed != null && obj.seed !== Game.world.seed) return { ok: false, error: 'world' };
    return { ok: true, doc: obj };
  }
  const ERRORS = {
    empty: 'That save slot is empty.', corrupt: 'The save file is damaged and cannot be read.', checksum: 'The save file is damaged (its checksum does not match).',
    schema: 'The save file is not a valid Arachnid Origins save.', newer: 'This save was made by a newer version of the game. Update the game to open it.',
    unsupported: 'This save is from an old version that can no longer be opened.', world: 'This save belongs to a different world version and cannot be loaded.', mode: 'This is not a Territory save.',
    missing: 'No save was found in that slot.', 'not-ready': 'Saves are still loading. Try again in a moment.', apply: 'The save could not be restored.', 'read-only': 'Another tab is using this slot.',
  };

  // =============================================================== the module
  const save = {
    priority: 5, alwaysUpdate: true,
    SCHEMA, SLOTS, KINDS, ERRORS, migrations: MIGRATIONS,
    backend: null, ready: false, lastError: null, lastLoad: null, lastSize: 0,
    active: null,            // { slot, readOnly } while a Territory game is running
    readOnly: false,
    _cache: {}, _loading: null, _pending: null, _timer: 0, _beat: 0, _seq: 0, _tab: Math.random().toString(36).slice(2),
  };

  // ---- the slot index (kept in the key-value store so the title can draw the slot cards at once)
  function loadIndex() {
    const v = Game.store.get('saveIndex', null);
    const idx = (v && typeof v === 'object' && v.slots && typeof v.slots === 'object') ? v : { v: 1, slots: {}, keys: [] };
    if (!Array.isArray(idx.keys)) idx.keys = [];
    for (let s = 1; s <= SLOTS; s++) { const e = idx.slots[s] || (idx.slots[s] = {}); if (!e.kinds || typeof e.kinds !== 'object') e.kinds = {}; if (!Array.isArray(e.hall)) e.hall = []; }
    return idx;
  }
  let index = loadIndex();
  function saveIndex() { Game.store.set('saveIndex', index); }
  function trackKey(k) { if (index.keys.indexOf(k) < 0) index.keys.push(k); }
  function untrackKey(k) { const i = index.keys.indexOf(k); if (i >= 0) index.keys.splice(i, 1); }

  save.slots = function () {
    const out = [];
    for (let s = 1; s <= SLOTS; s++) {
      const e = index.slots[s]; let at = 0, meta = null;
      KINDS.forEach(k => { const m = e.kinds[k]; if (m && m.at >= at) { at = m.at; meta = m.meta; } });
      out.push({ slot: s, empty: !meta, name: meta ? meta.lineage : '', meta, savedAt: at, kinds: Object.assign({}, e.kinds), hasSuspend: !!e.kinds.suspend, hall: e.hall.slice() });
    }
    return out;
  };
  save.hasAny = () => save.slots().some(c => !c.empty);
  save.latest = () => { let best = null; save.slots().forEach(c => { if (!c.empty && (!best || c.savedAt > best.savedAt)) best = c; }); return best; };
  save.firstFree = () => { const c = save.slots().find(x => x.empty); return c ? c.slot : 0; };
  save.status = () => ({ ready: save.ready, backend: save.backend ? save.backend.name : 'none', readOnly: save.readOnly, active: save.active });
  const message = (code) => ERRORS[code] || ('Save error: ' + code);
  save.message = message;
  function fail(code, detail) { save.lastError = code; if (detail) Game.reportError('save.' + code, detail instanceof Error ? detail : new Error(String(detail))); return false; }

  // ---- storage: attach a backend and load the snapshots it holds into the cache
  save.setBackend = function (be, cb) {
    save.backend = be; save.ready = false;
    be.loadAll(index.keys.slice(), (err, map) => {
      if (err) { Game.reportError('save.loadAll', err); }
      else if (map) for (const k in map) { if (!(k in save._cache)) save._cache[k] = map[k]; }
      save.ready = true;
      if (!index.keys.length) rebuildIndex();
      Game.emit('save:ready', { backend: be.name });
      if (cb) cb();
    });
  };
  // the index lives in localStorage and snapshots may live elsewhere (IndexedDB): if the index was lost but the snapshots are still there, rebuild it
  function rebuildIndex() {
    let any = false;
    Object.keys(save._cache).forEach(k => {
      const m = /^s(\d)\.(autosave|manual|suspend)$/.exec(k); if (!m) return;
      const d = decode(save._cache[k], { skipWorld: true }); if (!d.ok) return;
      const e = index.slots[+m[1]]; if (!e) return;
      e.kinds[m[2]] = { at: Date.parse(d.doc.savedAt) || 0, meta: d.doc.meta }; trackKey(k); trackKey(k + '.bak'); any = true;
    });
    if (any) saveIndex();
  }
  function persist(key, text, cb) { const b = save.backend; if (!b) { cb(new Error('no backend')); return; } try { b.put(key, text, cb); } catch (e) { cb(e); } }
  function persistDel(key, cb) { const b = save.backend; if (!b) { cb && cb(null); return; } try { b.del(key, cb || (() => {})); } catch (e) { cb && cb(e); } }

  // ---- write
  function territoryRun() { const T = Game.territory; return !!(T && T.active && Game.state.mode === 'territory' && Game.state.slot); }
  save.canWrite = () => !!(save.active && !save.readOnly && territoryRun());
  function collect(kind) {
    const T = Game.territory, P = Game.player, cal = T.calendar(), g = T.currentGeneration();
    const doc = {
      schema: SCHEMA, gameVersion: C.VERSION, savedAt: new Date().toISOString(), kind,
      meta: { mode: 'territory', lineage: T.lineageName, species: Game.state.species, year: cal.year, season: cal.season, day: cal.day, generation: g ? g.n : 1, rank: T.rank, rankName: T.rankInfo().name,
        heirs: T.lineage ? T.lineage.heirs : 0, cp: Math.round(T.cp), stage: P ? P.stage : 0, playSeconds: Math.round(Game.time.t), slot: Game.state.slot },
      seed: Game.world ? Game.world.seed : null, time: { t: Math.round(Game.time.t * 100) / 100 }, stats: Object.assign({}, Game.state.stats),
    };
    sorted().forEach(m => { if (has(m, 'serialize')) { const d = m.serialize(); if (d != null) doc[m.name] = d; } });
    return doc;
  }
  // may a snapshot be taken right now? (not while dead or part-way through a state that cannot be restored)
  function writable(kind) {
    const sc = Game.state.scene, P = Game.player, T = Game.territory;
    if (sc === 'title' || sc === 'boot' || sc === 'succession' || sc === 'lineageended' || (T && T.ended)) return false;
    if (P && P.dead && sc !== 'legacy') return false;
    return true;
  }
  save.write = function (slot, kind) {
    slot = slot | 0; kind = kind || 'manual';
    if (slot < 1 || slot > SLOTS || KINDS.indexOf(kind) < 0) return fail('args');
    if (!territoryRun()) return fail('mode');
    if (!save.canWrite()) { Game.emit('save:error', { slot, kind, code: 'read-only', message: message('read-only') }); return fail('read-only'); }
    if (!writable(kind)) return fail('busy');
    let doc, text;
    try { doc = collect(kind); text = encode(doc); } catch (e) { Game.emit('save:error', { slot, kind, code: 'collect', message: 'Couldn\'t save.' }); return fail('collect', e); }
    if (!decode(text, { skipWorld: true }).ok) { Game.emit('save:error', { slot, kind, code: 'verify', message: 'Couldn\'t save.' }); return fail('verify', 'a snapshot failed its own verification'); }
    save.lastSize = text.length;
    commit(slot, kind, text, doc.meta, Date.parse(doc.savedAt) || Date.now());
    return true;
  };
  // temp key -> read back -> backup of the old one -> real key. The cache is updated at once; the index and the "saved" event follow the durable write.
  function commit(slot, kind, text, meta, at) {
    const key = keyOf(slot, kind), old = save._cache[key], tmp = key + '.tmp' + (++save._seq);
    save._cache[key] = text; if (old != null) save._cache[key + '.bak'] = old;
    const bad = (err) => { Game.emit('save:error', { slot, kind, code: 'storage', message: 'Couldn\'t save.' }); Game.reportError('save.persist', err instanceof Error ? err : new Error(String(err))); save.lastError = 'storage'; };
    const be = save.backend; if (!be) { bad('no backend'); return; }
    persist(tmp, text, (e1) => {
      if (e1) return bad(e1);
      be.get(tmp, (e2, back) => {
        if (e2 || back !== text) { persistDel(tmp); return bad(e2 || 'read-back did not match'); }
        const finish = () => persist(key, text, (e4) => {
          persistDel(tmp);
          if (e4) return bad(e4);
          trackKey(key); trackKey(key + '.bak'); index.slots[slot].kinds[kind] = { at, meta }; saveIndex();
          Game.emit('save:written', { slot, kind });
        });
        if (old != null) persist(key + '.bak', old, (e3) => { if (e3) { Game.reportError('save.bak', e3); } finish(); }); else finish();
      });
    });
  }

  // ---- read
  function readKind(slot, kind) {
    const key = keyOf(slot, kind); let firstErr = null;
    for (let pass = 0; pass < 2; pass++) {
      const text = save._cache[pass ? key + '.bak' : key]; if (text == null) continue;
      const d = decode(text);
      if (d.ok) { if (firstErr) save.lastError = firstErr; return { doc: d.doc, kind, fromBackup: !!pass }; }
      if (!firstErr) firstErr = d.error;
    }
    save.lastError = firstErr || 'missing';
    return null;
  }
  save.read = function (slot, kind) {
    slot = slot | 0; if (slot < 1 || slot > SLOTS) { fail('args'); return null; }
    save.lastError = null;
    const r = readKind(slot, kind || save.pick(slot) || 'autosave');
    return r ? r.doc : null;
  };
  // which snapshot Continue / Load would open: a suspend save first, else the newest checkpoint
  save.pick = function (slot) {
    const e = index.slots[slot]; if (!e) return null;
    if (e.kinds.suspend) return 'suspend';
    let best = null, at = -1;
    ['manual', 'autosave'].forEach(k => { const m = e.kinds[k]; if (m && m.at > at) { at = m.at; best = k; } });
    return best;
  };
  // the three steps of Game.loadGame: beginLoad (read, validate, take the slot) -> apply -> finishLoad (a suspend save is spent) / failLoad
  save.beginLoad = function (slot, kind) {
    slot = slot | 0; save.lastError = null;
    if (!save.ready) { fail('not-ready'); return null; }
    if (slot < 1 || slot > SLOTS) { fail('args'); return null; }
    const first = kind || save.pick(slot);
    if (!first) { fail('missing'); return null; }
    const order = [first].concat(KINDS.filter(k => k !== first && !kind));   // a damaged snapshot falls back to the slot's other checkpoints
    let r = null, err = null;
    for (let i = 0; i < order.length && !r; i++) { r = readKind(slot, order[i]); if (!r && !err) err = save.lastError; }
    if (!r) { save.lastError = err || 'missing'; return null; }
    r.slot = slot; r.readOnly = !acquire(slot); r.warning = r.fromBackup ? 'backup' : (r.kind !== first ? 'older' : null);
    save._loading = { slot, readOnly: r.readOnly };
    return r;
  };
  save.apply = function (doc) {
    const mods = sorted();
    for (let i = 0; i < mods.length; i++) { const m = mods[i]; if (has(m, 'deserialize')) m.deserialize(doc[m.name]); }
  };
  save.finishLoad = function (info) {
    if (info.kind === 'suspend' && !info.readOnly) { save.delete(info.slot, 'suspend'); }   // a suspend save is one-shot: it cannot be used to retry a bad moment
    save._loading = null;
    save.lastLoad = { slot: info.slot, kind: info.kind, savedAt: info.doc.savedAt, fromBackup: info.fromBackup, warning: info.warning, readOnly: info.readOnly };
    save._timer = 0; save._pending = null;
    Game.emit('save:loaded', { slot: info.slot, kind: info.kind, fromBackup: info.fromBackup, readOnly: info.readOnly, warning: info.warning });
  };
  save.failLoad = function (info, e) { save._loading = null; save.lastError = 'apply'; release(); };

  // ---- delete, hall of lines
  save.delete = function (slot, kind) {
    slot = slot | 0; const e = index.slots[slot]; if (!e) return false;
    (kind ? [kind] : KINDS).forEach(k => {
      const key = keyOf(slot, k);
      [key, key + '.bak'].forEach(kk => { delete save._cache[kk]; untrackKey(kk); persistDel(kk); });
      delete e.kinds[k];
    });
    saveIndex(); Game.emit('save:deleted', { slot, kind: kind || null });
    return true;
  };
  // a line has died out: it goes to the slot's Hall of Lines and the slot is free for a new one
  save.endLine = function (slot, summary) {
    slot = slot | 0; const e = index.slots[slot]; if (!e || !summary) return false;
    e.hall.unshift({ name: summary.name, species: summary.species, generations: summary.generations, rank: summary.rank, rankName: summary.rankName, cp: summary.cp, deaths: summary.deaths,
      longest: summary.longest, facts: summary.facts, cause: summary.cause, year: summary.year, playSeconds: summary.playSeconds, endedAt: summary.endedAt });
    if (e.hall.length > HALL_MAX) e.hall.length = HALL_MAX;
    save.delete(slot);
    return true;
  };

  // ---- export / import (.aosave files: browser data can be cleared, so a lineage can be kept as a file)
  save.exportSlot = function (slot, kind) {
    slot = slot | 0; save.lastError = null;
    const r = readKind(slot, kind || save.pick(slot)); if (!r) return null;
    const doc = Object.assign({}, r.doc), slug = String(doc.meta.lineage || 'lineage').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lineage';
    return { filename: slug + '-slot' + slot + '.aosave', text: encode(doc) };
  };
  save.download = function (exp) {
    try {
      if (!exp || !root.document || !root.Blob || !root.URL || !root.URL.createObjectURL) return false;
      const a = root.document.createElement('a'); a.href = root.URL.createObjectURL(new root.Blob([exp.text], { type: 'application/json' })); a.download = exp.filename;
      root.document.body.appendChild(a); a.click(); root.document.body.removeChild(a); setTimeout(() => { try { root.URL.revokeObjectURL(a.href); } catch (e) { /* ignore */ } }, 2000);
      return true;
    } catch (e) { return false; }
  };
  // validate a file's text and put it in `slot` (replacing whatever was there). -> { ok, error?, meta? }
  save.importText = function (slot, text) {
    slot = slot | 0; if (slot < 1 || slot > SLOTS) return { ok: false, error: 'args', message: message('args') };
    if (!save.ready) return { ok: false, error: 'not-ready', message: message('not-ready') };
    const d = decode(text); if (!d.ok) { save.lastError = d.error; return { ok: false, error: d.error, message: message(d.error) }; }
    const doc = Object.assign({}, d.doc, { kind: 'manual' }); doc.meta = Object.assign({}, doc.meta, { slot });
    save.delete(slot);
    commit(slot, 'manual', encode(doc), doc.meta, Date.parse(doc.savedAt) || Date.now());
    return { ok: true, meta: doc.meta };
  };
  save.importSlot = function (file, slot) {   // a File from <input type=file> -> Promise<{ok, ...}>
    return new Promise((resolve) => {
      try {
        if (file && typeof file.text === 'function') file.text().then(t => resolve(save.importText(slot, t)), () => resolve({ ok: false, error: 'corrupt', message: message('corrupt') }));
        else if (root.FileReader) { const fr = new root.FileReader(); fr.onload = () => resolve(save.importText(slot, String(fr.result))); fr.onerror = () => resolve({ ok: false, error: 'corrupt', message: message('corrupt') }); fr.readAsText(file); }
        else resolve({ ok: false, error: 'corrupt', message: message('corrupt') });
      } catch (e) { resolve({ ok: false, error: 'corrupt', message: message('corrupt') }); }
    });
  };

  // ---- one tab per slot: a lease in the store that the owning tab refreshes; a second tab opens read-only
  const leaseKey = (slot) => LEASE_KEY + (slot | 0);
  function heldElsewhere(slot) { const c = Game.store.get(leaseKey(slot), null); return !!(c && c.id !== save._tab && Date.now() - c.t < LEASE_TTL); }
  function acquire(slot) {
    if (heldElsewhere(slot)) return false;
    Game.store.set(leaseKey(slot), { id: save._tab, t: Date.now() });
    save._leased = slot | 0;
    return true;
  }
  function release() {
    const slot = save._leased;
    if (slot) { const cur = Game.store.get(leaseKey(slot), null); if (cur && cur.id === save._tab) Game.store.set(leaseKey(slot), null); }
    save._leased = 0; save.active = null; save.readOnly = false;
  }
  save.acquire = acquire; save.release = release;
  save.leaseHeldElsewhere = heldElsewhere;

  // ---- autosave: on each season change, after a molt, when a mother lays and a new generation hatches, every 5 minutes of play while it is calm,
  // and as a suspend snapshot when the window loses focus (core pauses the game then)
  save.requestAutosave = (reason) => { if (save.canWrite()) save._pending = reason || 'auto'; };
  function stable() {
    const sc = Game.state.scene, P = Game.player;
    if (sc === 'legacy') return true;
    if (sc !== 'playing' || !P) return false;
    return !(P.dead || P.molting || P.hatching || P.laying || P.courting || P.reviving);
  }
  save.init = function () {
    const be = noIndexedDb() ? pickLocal() : null;
    if (be) save.setBackend(be);
    else idbBackend((err, b) => { if (err) { save.setBackend(pickLocal()); } else save.setBackend(b); });
    ['season:change', 'molt:end', 'territory:generation_end', 'territory:generation_begin'].forEach(evt => Game.on(evt, () => save.requestAutosave(evt)));
    Game.on('window:blur', () => { if (save.canWrite() && Game.state.scene === 'playing') save.write(Game.state.slot, 'suspend'); });
    Game.on('scene:change', (d) => { if (d && d.to === 'title') release(); });
    Game.on('game:new', (d) => {
      if (!territoryRun()) { save.active = null; save.readOnly = false; return; }
      const ld = save._loading, slot = Game.state.slot;
      save.readOnly = ld && ld.slot === slot ? !!ld.readOnly : !acquire(slot);
      save.active = { slot, readOnly: save.readOnly };
      if (save.readOnly) Game.emit('save:error', { slot, kind: null, code: 'read-only', message: message('read-only') });
      else if (!(d && d.loaded)) save.delete(slot);   // a brand-new lineage replaces whatever the slot held (its Hall of Lines stays), so an old suspend save can never outrank it
    });
    if (root.addEventListener) root.addEventListener('beforeunload', () => { release(); });
  };
  function noIndexedDb() { return !(root.indexedDB && typeof root.indexedDB.open === 'function'); }
  function pickLocal() {
    try { root.localStorage.setItem('ao_snap_probe', '1'); root.localStorage.removeItem('ao_snap_probe'); return localBackend(); } catch (e) { return memoryBackend(); }
  }
  save.reset = function () { save._pending = null; save._timer = 0; };
  save.update = function (dt) {
    if (!territoryRun() || !save.active) return;
    // keep the lease alive (every scene, wall-clock)
    save._beat += dt; if (save._beat >= LEASE_BEAT) { save._beat = 0; if (!save.readOnly && save._leased) Game.store.set(leaseKey(save._leased), { id: save._tab, t: Date.now() }); }
    if (Game.state.scene === 'playing') save._timer += dt;
    if (save._pending && stable()) { const r = save._pending; save._pending = null; save._timer = 0; save.write(Game.state.slot, 'autosave'); return; }
    if (save._timer >= AUTOSAVE_EVERY && (Game.state.danger || 0) < CALM && stable()) { save._timer = 0; save.write(Game.state.slot, 'autosave'); }
  };

  Game.register('save', save);
})();
