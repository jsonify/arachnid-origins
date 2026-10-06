// Test script for the Territory save system (src/save.js and the serialize/deserialize hooks). Run: node tools/test_save.js
//   - a save/load round trip restores the player, world clock and weather, webs (heirloom flagged), pantry, rank, heirs and the explored map
//   - the three kinds: autosave, manual (keeps a .bak) and suspend (spent when loaded)
//   - corruption fails safe: truncated JSON, a bad checksum, an old or newer schema, a foreign world, a save from another mode
//   - storage: in-memory, localStorage and an asynchronous backend (a fake IndexedDB, incl. rebuilding a lost index)
//   - one tab per slot (lease), export/import of .aosave files, the Hall of Lines
//   - autosave fires on season change, molt end, laying, every 5 calm minutes and as a suspend snapshot on window blur
const H = require('./harness.js');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 0.11 : e);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- a fake IndexedDB (asynchronous, like the real one)
function fakeIndexedDB() {
  const data = {};
  const db = {
    transaction() {
      const ops = [], t = {};
      const os = {
        put(v, k) { ops.push(() => { data[k] = v; }); },
        delete(k) { ops.push(() => { delete data[k]; }); },
        get(k) { const rq = {}; ops.push(() => { rq.result = data[k]; if (rq.onsuccess) rq.onsuccess(); }); return rq; },
        openCursor() { const rq = {}; ops.push(() => { Object.keys(data).forEach(k => { rq.result = { key: k, value: data[k], continue() {} }; if (rq.onsuccess) rq.onsuccess(); }); rq.result = null; if (rq.onsuccess) rq.onsuccess(); }); return rq; },
      };
      t.objectStore = () => os;
      setTimeout(() => { try { ops.forEach(f => f()); if (t.oncomplete) t.oncomplete(); } catch (e) { t.error = e; if (t.onerror) t.onerror(); } }, 2);
      return t;
    },
    createObjectStore() {},
  };
  return { _data: data, open() { const rq = {}; setTimeout(() => { rq.result = db; if (rq.onupgradeneeded) rq.onupgradeneeded(); if (rq.onsuccess) rq.onsuccess(); }, 2); return rq; } };
}

// ---------------------------------------------------------------- helpers to stage a lineage
function stage(G, o) {
  o = o || {};
  G.newGame('territory', 'garden', { slot: o.slot || 1, name: o.name || 'Test Line' });
  const T = G.territory, P = G.player, W = G.world;
  P.debugSetStage(o.stage == null ? 2 : o.stage); P.silk = 100; P.hunger = 66; P.hydration = 55; P.energy = 77; P.upgrades.speed = 2; P.upgrades.camo = 1; P.applyUpgrades(false);
  H.run(2);
  G.webs.select('retreat'); G.webs.spin('retreat'); H.run(2);
  G.webs.select('sheet'); P.x += 120; P.silk = 100; G.webs.spin('sheet'); H.run(2);
  G.webs.select('line'); P.x += 90; P.silk = 100; G.webs.spin('line'); H.run(2);
  P.silk = 60; T.markHeirloom(G.webs.list[1]);
  T.pantry.push({ id: 1, kind: 'cricket', nutrition: 14, fresh: 0.8, day: 12 }); T.pantry.push({ id: 2, kind: 'aphid', nutrition: 6, fresh: 0.5, day: 12 });
  T.addCP(31);
  W.dayCount = 12; W.time01 = 0.31; W.forceWeather('rain', 0.7); W.resources[3].amount = 2; W.resources[9].amount = 5.5;
  T.lineage.heirs = 4;
  H.run(1);
  return { T, P, W };
}
function fingerprint(G) {
  const P = G.player, T = G.territory, W = G.world;
  return {
    scene: G.state.scene, x: Math.round(P.x), y: Math.round(P.y), stage: P.stage, hp: Math.round(P.hp), hunger: Math.round(P.hunger), hydration: Math.round(P.hydration), energy: Math.round(P.energy), silk: Math.round(P.silk), growth: Math.round(P.growth),
    ups: JSON.stringify(P.upgrades), webs: G.webs.list.length, heirlooms: T.heirloomWebs().length, types: G.webs.list.map(w => w.type).join(','), pantry: T.pantry.map(i => i.kind + ':' + i.fresh.toFixed(2)).join(','),
    cp: T.cp, rank: T.rank, heirs: T.lineage.heirs, gen: T.lineage.generations.length, name: T.lineageName, day: W.dayCount, time01: +W.time01.toFixed(3), weather: W.weather.type, res3: +W.resources[3].amount.toFixed(1), res9: +W.resources[9].amount.toFixed(1),
    explored: W.explored.reduce((a, b) => a + (b ? 1 : 0), 0), t: Math.round(G.time.t * 10) / 10, home: T.home.shelterId, mate: JSON.stringify(P.mate),
  };
}

(async () => {
  // ================================================================ round trip
  let G = H.load({ tolerant: true });
  ok(G.save && G.save.ready && G.save.backend.name === 'localStorage', 'save.js is loaded and ready on localStorage when there is no IndexedDB (' + (G.save && G.save.backend && G.save.backend.name) + ')');
  ok(G.save.SCHEMA === 1 && G.save.SLOTS === 3, 'schema 1, three slots');
  ok(G.world.seed === 90417, 'the world exposes its fixed seed (' + G.world.seed + ')');
  ok(!G.save.hasAny() && G.save.slots().length === 3 && G.save.slots().every(c => c.empty), 'three empty slot cards to begin with');
  const mem = (() => { const m = {}; return { name: 'memory', loadAll: (k, cb) => cb(null, Object.assign({}, m)), put: (k, t, cb) => { m[k] = t; cb(null); }, get: (k, cb) => cb(null, k in m ? m[k] : null), del: (k, cb) => { delete m[k]; cb(null); }, _m: m }; })();
  G.save.setBackend(mem);
  ok(G.save.backend === mem && G.save.ready, 'an in-memory backend can be injected (the test harness uses this)');

  const { T, P, W } = stage(G);
  const before = fingerprint(G);
  const wrote = []; G.on('save:written', d => wrote.push(d));
  ok(G.save.write(1, 'manual') === true, 'write(1, "manual") succeeds');
  ok(wrote.length === 1 && wrote[0].slot === 1 && wrote[0].kind === 'manual', 'save:written {slot, kind} is emitted');
  ok(G.save.lastSize > 500 && G.save.lastSize < 60000, 'a typical save is small (' + G.save.lastSize + ' bytes of JSON)');
  const card = G.save.slots()[0];
  ok(!card.empty && card.name === 'Test Line' && card.meta.season === 'summer' && card.meta.day === 13 && card.meta.generation === 1 && card.meta.rank === 2 && card.meta.heirs === 4 && card.meta.species === 'garden', 'the slot card shows the lineage, season and day, generation, rank, heirs and species');
  const doc = G.save.read(1, 'manual');
  ok(doc && doc.schema === 1 && doc.kind === 'manual' && doc.seed === 90417 && typeof doc.checksum === 'undefined' && typeof doc.savedAt === 'string', 'read() returns the document: schema, kind, seed, ISO savedAt (the checksum is checked and removed)');
  ok(['world', 'territory', 'webs', 'player', 'creatures', 'boss', 'edu'].every(k => doc[k] && typeof doc[k] === 'object'), 'every module with serialize() contributed its slice (' + Object.keys(doc).filter(k => typeof doc[k] === 'object').join(', ') + ')');
  ok(doc.creatures.persistent.length === 0 || doc.creatures.persistent.every(p => p.kind === 'mate' || p.kind === 'rival'), 'only the mate and rivals are saved among the creatures (everything else is respawned)');

  G.toTitle(); H.run(0.4);
  ok(G.state.scene === 'title' && G.webs.list.length === 0, 'quit to title clears the run');
  ok(G.loadGame(1) === true && G.state.scene === 'playing', 'loadGame(1) restores the lineage and plays');
  const after = fingerprint(G);
  Object.keys(before).forEach(k => ok(JSON.stringify(before[k]) === JSON.stringify(after[k]) || (typeof before[k] === 'number' && near(before[k], after[k], 1)), 'round trip keeps ' + k + ' (' + before[k] + (JSON.stringify(before[k]) === JSON.stringify(after[k]) ? '' : ' -> ' + after[k]) + ')'));
  ok(G.state.mode === 'territory' && G.state.slot === 1 && G.territory.active, 'the run is a Territory game in slot 1 again');
  ok(G.webs.list.every(w => w.type === 'line' ? w.bt : (w.type === 'orb' ? w.ra : (w.type === 'sheet' ? w.bxu : w.lm))), 'restored webs have their strand geometry rebuilt from the seed');
  ok(G.creatures.list.length > 40 && G.creatures.siblings === 4, 'the population is respawned around the player (' + G.creatures.list.length + ' creatures) with the heirs as siblings (' + G.creatures.siblings + ')');
  // a save made right after loading is the same game again
  G.save.write(1, 'manual'); const d2 = G.save.read(1, 'manual');
  ok(JSON.stringify(d2.territory.lineage) === JSON.stringify(doc.territory.lineage) && d2.territory.cp === doc.territory.cp, 'saving again keeps the lineage and Claim Points unchanged' + (JSON.stringify(d2.territory.lineage) === JSON.stringify(doc.territory.lineage) ? '' : ' [lineage ' + JSON.stringify(doc.territory.lineage).slice(0, 160) + ' => ' + JSON.stringify(d2.territory.lineage).slice(0, 160) + ']') + ' cp ' + doc.territory.cp + ' => ' + d2.territory.cp);
  H.run(8);
  ok(G.state.scene === 'playing' && G.errors.length === 0, 'the restored game runs on without errors');

  // ================================================================ kinds: manual keeps a backup, suspend is spent
  stage(G, { slot: 2, name: 'Kinds' });
  G.save.write(2, 'autosave'); H.run(3); G.save.write(2, 'manual'); H.run(3); G.save.write(2, 'suspend');
  let c2 = G.save.slots()[1];
  ok(c2.hasSuspend && Object.keys(c2.kinds).sort().join() === 'autosave,manual,suspend', 'one slot can hold an autosave, a manual save and a suspend save');
  ok(G.save.pick(2) === 'suspend', 'Continue / Load prefers the suspend snapshot');
  const tSuspend = G.time.t;
  G.toTitle(); H.run(0.3);
  ok(G.loadGame(2) && Math.abs(G.time.t - tSuspend) < 0.1, 'loading restores the exact moment of the suspend snapshot (t=' + G.time.t.toFixed(1) + ')');
  ok(!G.save.slots()[1].hasSuspend && G.save.read(2, 'suspend') === null, 'loading a suspend save deletes it (no save-scumming)');
  ok(G.save.pick(2) === 'manual', 'the next load falls back to the newest checkpoint (the manual save)');
  G.toTitle();
  ok(G.save.lastLoad.kind === 'suspend' && G.save.lastLoad.fromBackup === false, 'lastLoad remembers which snapshot it used');
  // two manual saves: the second one keeps the first as .bak; damage the main file and the backup is used
  const key = 's2.manual';
  G.loadGame(2); H.run(1); G.player.hunger = 42; G.save.write(2, 'manual');
  ok(typeof mem._m[key] === 'string' && typeof mem._m[key + '.bak'] === 'string' && mem._m[key] !== mem._m[key + '.bak'], 'a second manual save keeps the first as ' + key + '.bak');
  const good = mem._m[key]; mem._m[key] = good.slice(0, good.length >> 1);
  G.save._cache[key] = mem._m[key];
  const r = G.save.beginLoad(2, 'manual');
  ok(r && r.fromBackup === true && r.warning === 'backup', 'a damaged main save falls back to the .bak and says so (warning: ' + (r && r.warning) + ')');
  G.save.failLoad(r); G.toTitle();

  // ================================================================ corruption fails safe
  // a valid save for slot 3, then the same file damaged in different ways (a document sealed with the game's own checksum, so only the field under test is wrong)
  stage(G, { slot: 3, name: 'Corrupt' }); G.save.write(3, 'manual');
  const valid = G.save._cache['s3.manual'];
  G.toTitle();
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
  const goodDoc = JSON.parse(valid); delete goodDoc.checksum;
  const sealed = (o) => JSON.stringify(Object.assign({}, o, { checksum: fnv(JSON.stringify(o)) }));
  ok(sealed(goodDoc) === valid, 'the checksum is FNV-1a over the JSON text of the document (reproducible by a test, or by a person with a tool)');
  function tryLoad(text, label, expectErr) {
    G.save._cache['s3.manual'] = text; ['s3.manual.bak', 's3.autosave', 's3.autosave.bak', 's3.suspend', 's3.suspend.bak'].forEach(k => delete G.save._cache[k]);   // the staging run left an autosave: only the damaged file may be left
    const nerr = G.errors.length, scene = G.state.scene, okLoad = G.loadGame(3);
    ok(okLoad === false && G.save.lastError === expectErr && G.state.scene === scene && G.errors.length === nerr, label + ' -> refused ("' + G.save.lastError + '"), no crash, scene unchanged');
    ok(G.save.message(G.save.lastError).length > 20, '   and there is a plain-language message for it: ' + G.save.message(G.save.lastError));
  }
  tryLoad(valid.slice(0, 300), 'truncated JSON', 'corrupt');
  tryLoad(valid.slice(0, valid.length - 40), 'a file cut off near its end', 'corrupt');
  tryLoad('not json at all', 'garbage', 'corrupt');
  tryLoad('[1,2,3]', 'JSON that is not a save', 'corrupt');
  tryLoad('{}', 'an empty object (no checksum)', 'checksum');
  const hand = JSON.parse(valid); hand.player.hp = 9999; tryLoad(JSON.stringify(hand), 'a hand-edited value (stale checksum)', 'checksum');
  tryLoad(sealed(Object.assign({}, goodDoc, { schema: 2 })), 'a save from a newer schema', 'newer');
  tryLoad(sealed(Object.assign({}, goodDoc, { schema: 0 })), 'an old schema with no migration', 'unsupported');
  tryLoad(sealed(Object.assign({}, goodDoc, { schema: -1 })), 'a nonsense schema', 'schema');
  tryLoad(sealed(Object.assign({}, goodDoc, { seed: 1234 })), 'a save from a different world', 'world');
  tryLoad(sealed(Object.assign({}, goodDoc, { meta: Object.assign({}, goodDoc.meta, { mode: 'brood' }) })), 'a save that is not a Territory save', 'mode');
  // formatting is not content: re-spacing the JSON does not break the checksum
  G.save._cache['s3.manual'] = JSON.stringify(JSON.parse(valid), null, 2);
  ok(G.loadGame(3) === true, 'a pretty-printed copy of a valid save still loads (the checksum covers the data, not the whitespace)');
  G.toTitle();
  // migrations: schema n -> n + 1, chained from the stored version
  let ran = 0; G.save.migrations[0] = (d) => { ran++; return Object.assign({}, d, { schema: 1 }); };
  G.save._cache['s3.manual'] = sealed(Object.assign({}, goodDoc, { schema: 0 }));
  ok(G.loadGame(3) === true && ran === 1, 'a registered migration upgrades an old save on load (the 0 -> 1 step ran once)');
  delete G.save.migrations[0]; G.toTitle();
  ok(G.errors.length === 0, 'none of the bad files produced a game error (' + G.errors.length + ')');

  // ================================================================ one tab per slot
  G = H.load({ tolerant: true });
  G.save.setBackend((() => { const m = {}; return { name: 'memory', loadAll: (k, cb) => cb(null, Object.assign({}, m)), put: (k, t, cb) => { m[k] = t; cb(null); }, get: (k, cb) => cb(null, k in m ? m[k] : null), del: (k, cb) => { delete m[k]; cb(null); } }; })());
  G.store.set('saveLease1', { id: 'another-tab', t: Date.now() });
  const errs = []; G.on('save:error', d => errs.push(d));
  G.newGame('territory', 'garden', { slot: 1, name: 'Busy' }); H.run(1);
  ok(G.save.readOnly === true && G.save.canWrite() === false, 'a second tab opens the slot read-only while the other tab holds the lease');
  ok(G.save.write(1, 'manual') === false && G.save.lastError === 'read-only' && errs.some(e => e.code === 'read-only'), 'writes are refused with a read-only warning');
  ok(G.save.leaseHeldElsewhere(1) === true && G.save.leaseHeldElsewhere(2) === false, 'the other tab owns slot 1 only');
  G.newGame('territory', 'garden', { slot: 2, name: 'Free' }); H.run(1);
  ok(G.save.readOnly === false && G.save.write(2, 'manual') === true, 'a different slot is free to use');
  G.toTitle(); const lease = G.store.get('saveLease1', null);
  ok(lease && lease.id === 'another-tab' && G.store.get('saveLease2', 'x') === null, 'playing slot 2 never touches the other tab\'s lease on slot 1, and quitting releases only our own');
  G.store.set('saveLease1', { id: 'another-tab', t: Date.now() - 60000 });
  G.newGame('territory', 'garden', { slot: 1, name: 'Stale' }); H.run(1);
  ok(G.save.readOnly === false && G.save.write(1, 'manual') === true, 'an expired lease (a closed tab) no longer blocks the slot');
  H.run(6);
  const l2 = G.store.get('saveLease1', null);
  ok(l2 && l2.id === G.save._tab && Date.now() - l2.t < 8000, 'the owning tab keeps its lease fresh while it plays');
  G.toTitle();
  ok(G.store.get('saveLease1', 'x') === null, 'quitting to the title releases the lease');
  // loading a suspend save in a read-only tab does not spend it
  G.newGame('territory', 'garden', { slot: 3, name: 'Susp' }); H.run(1); G.save.write(3, 'suspend'); G.toTitle();
  G.store.set('saveLease3', { id: 'another-tab', t: Date.now() });
  ok(G.loadGame(3) === true && G.save.readOnly === true && G.save.slots()[2].hasSuspend === true, 'a read-only load leaves the suspend save in place');
  G.toTitle();

  // ================================================================ export / import
  G.store.set('saveLease3', null);
  stage(G, { slot: 1, name: 'Exported' }); G.save.write(1, 'manual');
  const exp = G.save.exportSlot(1);
  ok(exp && /^exported-slot1\.aosave$/.test(exp.filename) && typeof exp.text === 'string' && exp.text.length > 500, 'exportSlot gives a .aosave file named after the lineage (' + (exp && exp.filename) + ')');
  ok(G.save.download(exp) === false, 'download() declines politely outside a browser');
  const fpExp = fingerprint(G);
  G.toTitle();
  const imp = G.save.importText(2, exp.text);
  ok(imp.ok === true && imp.meta.slot === 2 && G.save.slots()[1].name === 'Exported', 'importText puts a valid file into the chosen slot');
  ok(G.loadGame(2) && fingerprint(G).webs === fpExp.webs && fingerprint(G).pantry === fpExp.pantry && G.territory.cp === fpExp.cp, 'an imported lineage loads like the original');
  G.toTitle();
  ok(G.save.importText(3, exp.text.slice(0, 200)).ok === false && G.save.importText(3, 'nope').error === 'corrupt', 'a damaged file is refused with a message');
  ok(G.save.importText(9, exp.text).ok === false, 'a bad slot number is refused');
  const bad = JSON.parse(exp.text); bad.player.hp = 1;
  ok(G.save.importText(3, JSON.stringify(bad)).error === 'checksum', 'a tampered file is refused (checksum)');
  const pr = await G.save.importSlot({ text: () => Promise.resolve(exp.text) }, 3);
  ok(pr.ok === true && G.save.slots()[2].name === 'Exported', 'importSlot(file, slot) reads a File-like object');
  // delete and the Hall of Lines
  G.save.delete(3);
  ok(G.save.slots()[2].empty && G.save.read(3) === null, 'delete(slot) empties the slot');
  G.save.endLine(2, { name: 'Gone', species: 'garden', generations: 3, rank: 2, rankName: 'Hold', cp: 40, deaths: 9, longest: { seconds: 100, generation: 2 }, facts: 12, cause: 'eaten', year: 2, playSeconds: 4000, endedAt: Date.now() });
  const cd = G.save.slots()[1];
  ok(cd.empty && cd.hall.length === 1 && cd.hall[0].name === 'Gone' && cd.hall[0].generations === 3, 'endLine frees the slot and keeps the lineage in its Hall of Lines');

  // ================================================================ a new lineage replaces what the slot held
  G = H.load({ tolerant: true });
  stage(G, { slot: 1, name: 'Old Line' }); G.save.write(1, 'manual'); G.save.write(1, 'autosave'); G.save.write(1, 'suspend');
  G.save.endLine(2, { name: 'Earlier', species: 'garden', generations: 2, rank: 1, rankName: 'Claim', cp: 5, deaths: 3, longest: { seconds: 10, generation: 1 }, facts: 1, cause: 'eaten', year: 1, playSeconds: 100, endedAt: Date.now() });
  ok(Object.keys(G.save.slots()[0].kinds).sort().join() === 'autosave,manual,suspend', 'slot 1 holds all three kinds of an old lineage');
  G.toTitle(); G.newGame('territory', 'garden', { slot: 1, name: 'Fresh Line' }); H.run(1);
  ok(G.save.slots()[0].empty && G.save.read(1) === null && G.save.hasAny() === false, 'starting a new lineage in the slot clears the old snapshots at once (a stale suspend save can never outrank it)');
  G.save.write(1, 'manual'); ok(G.save.slots()[0].name === 'Fresh Line' && G.save.pick(1) === 'manual', 'the first save is the new lineage');
  G.toTitle(); G.newGame('territory', 'garden', { slot: 2, name: 'Second' }); H.run(1);
  ok(G.save.slots()[1].hall.length === 1 && G.save.slots()[1].hall[0].name === 'Earlier', 'the Hall of Lines of the slot survives a new lineage');
  G.toTitle();
  // loading is not "new": the same slot keeps its snapshots (the suspend one is spent on load, the rest stay)
  ok(G.loadGame(1) === true && G.save.slots()[0].name === 'Fresh Line' && !!G.save.slots()[0].kinds.manual, 'loading a lineage does not clear its slot');
  G.toTitle();
  // a tab that does not own the slot never wipes it
  G.store.set('saveLease1', { id: 'another-tab', t: Date.now() });
  G.newGame('territory', 'garden', { slot: 1, name: 'Intruder' }); H.run(1);
  ok(G.save.readOnly === true && G.save.slots()[0].name === 'Fresh Line', 'a read-only tab starting a new game leaves the other tab\'s snapshots alone');
  G.toTitle();

  // ================================================================ autosave triggers
  G = H.load({ tolerant: true });
  const kinds = []; G.on('save:written', d => kinds.push(d.kind + ':' + d.slot));
  stage(G, { slot: 2, stage: 1 });
  G.world.dayCount = 8; G.world.time01 = 0.99; H.run(0.3);   // the last day of spring, a moment before midnight
  kinds.length = 0; H.run(5);
  ok(G.territory.calendar().season === 'summer' && kinds.indexOf('autosave:2') >= 0, 'the turn from spring to summer writes an autosave (' + kinds.join(',') + ')');
  kinds.length = 0; G.player.invuln = 99;
  G.player.addGrowth(G.player.growthNeeded + 1); H.run(0.5); G.player.chooseUpgrade(G.player.offers[0]); H.run(8);
  ok(G.player.stage === 2 && kinds.indexOf('autosave:2') >= 0, 'finishing a molt writes an autosave (' + kinds.join(',') + ')');
  G.save._timer = 0; H.run(10);
  ok(Math.abs(G.save._timer - 10) < 0.5, 'the autosave timer counts seconds of play only (' + G.save._timer.toFixed(1) + ' after 10 s)');
  kinds.length = 0; G.save._timer = 299.5; G.state.danger = 0; H.run(2);
  ok(kinds.filter(k => k === 'autosave:2').length === 1 && G.save._timer < 5, 'five minutes of calm play write an autosave, then the timer starts over');
  kinds.length = 0; G.save._timer = 301; for (let i = 0; i < 120; i++) { G.state.danger = 0.9; G.step(1 / 60); }
  ok(kinds.filter(k => k === 'autosave:2').length === 0, 'the timed autosave waits while danger is high');
  G.state.danger = 0; G.step(1 / 60); G.step(1 / 60);
  ok(kinds.filter(k => k === 'autosave:2').length === 1, 'and goes out as soon as it is calm again');
  kinds.length = 0; G.emit('window:blur'); G.pause(); H.run(0.2);
  ok(kinds.indexOf('suspend:2') >= 0 && G.state.scene === 'paused', 'losing window focus writes a suspend snapshot (core pauses the game)');
  G.resume();
  kinds.length = 0; G.player.invuln = 99; G.player.addGrowth(G.player.growthNeeded + 1); H.run(0.5);
  G.save.requestAutosave('test'); H.run(1);
  ok(G.state.scene === 'molting' && kinds.length === 0, 'an autosave is deferred while the spider is choosing a molt');
  G.player.chooseUpgrade(G.player.offers[0]); H.run(8);
  ok(kinds.indexOf('autosave:2') >= 0, 'and written once the molt is over');
  G.newGame('brood'); H.run(1); kinds.length = 0;
  G.emit('season:change', { season: 'summer', prev: 'spring' }); G.emit('molt:end', { stage: 1 }); G.emit('window:blur'); G.save._timer = 400; H.run(3);
  ok(kinds.length === 0 && G.save.write(1, 'manual') === false, 'Brood is never saved');
  G.newGame('survival'); H.run(1);
  ok(G.save.write(1, 'manual') === false && G.save.lastError === 'mode', 'Survival is never saved either (lastError: ' + G.save.lastError + ')');

  // ================================================================ pending Legacy checkpoint
  G = H.load({ tolerant: true });
  const Lw = stage(G, { slot: 1, stage: 4 });
  G.territory.rng = () => 0.5; G.player.hunger = G.player.hydration = G.player.energy = 90; G.player.hp = G.player.maxHp;
  const site = G.world.shelters.find(s => s.id === 'sh14'); G.player.x = site.x; G.player.y = site.y; G.player.mate.found = G.player.mate.courted = true; G.world.dayCount = 20; H.run(0.5);
  H.press('KeyE'); H.run(6);
  ok(G.state.scene === 'legacy' && G.territory.legacy, 'laying the egg sac starts the Legacy scene');
  H.run(0.5);
  ok(G.save.slots()[0].kinds.autosave, 'the Legacy scene is checkpointed at once (territory:generation_end)');
  const clutch = G.territory.legacy.clutch.total; G.toTitle(); G.loadGame(1);
  ok(G.state.scene === 'legacy' && G.territory.legacy && G.territory.legacy.clutch.total === clutch, 'loading that save returns to the Legacy scene with the same clutch (' + clutch + ')');
  ok(G.territory.legacyConfirm() && G.state.scene === 'playing' && G.territory.lineage.generations.length === 2, 'and the next generation can be started from it');

  // ================================================================ an asynchronous backend: a fake IndexedDB
  const idb = fakeIndexedDB(), store = {};
  G = H.load({ tolerant: true, store, globals: { indexedDB: idb } });
  ok(G.save.ready === false, 'with IndexedDB the snapshots load asynchronously (not ready at boot)');
  const nr = G.save.beginLoad(1);
  ok(nr === null && G.save.lastError === 'not-ready', 'an early load says the saves are still loading instead of failing quietly');
  await wait(30);
  ok(G.save.ready && G.save.backend.name === 'indexedDB', 'once open, IndexedDB is the backend');
  stage(G, { slot: 1, name: 'IDB Line' }); const idbFp = fingerprint(G);
  ok(G.save.write(1, 'manual') === true, 'write() answers at once, even though IndexedDB commits later');
  G.save.write(1, 'manual');
  await wait(60);
  const keys = Object.keys(idb._data).sort();
  ok(keys.indexOf('s1.manual') >= 0 && keys.indexOf('s1.manual.bak') >= 0 && !keys.some(k => /\.tmp/.test(k)), 'the snapshot, its .bak and no temporary key are in IndexedDB (' + keys.join(', ') + ')');
  ok(JSON.parse(store.ao_saveIndex).slots[1].kinds.manual && !('ao_snap_s1.manual' in store), 'the slot index stays in localStorage and the snapshot only in IndexedDB');
  // "reload the browser": new instance, same storage
  G = H.load({ tolerant: true, store, globals: { indexedDB: idb } });
  ok(G.save.slots()[0].name === 'IDB Line', 'the title can draw the slot card at once, before IndexedDB has answered');
  await wait(30);
  ok(G.save.ready && G.loadGame(1) === true && fingerprint(G).webs === idbFp.webs && fingerprint(G).name === 'IDB Line', 'after a reload the lineage loads from IndexedDB');
  G.toTitle();
  // the index is lost (localStorage cleared) but the snapshots are still in IndexedDB
  const store2 = {};
  G = H.load({ tolerant: true, store: store2, globals: { indexedDB: idb } });
  await wait(30);
  ok(G.save.hasAny() && G.save.slots()[0].name === 'IDB Line', 'a lost slot index is rebuilt from the snapshots in IndexedDB');
  // a failing write is reported, never thrown
  const failing = { name: 'failing', loadAll: (k, cb) => cb(null, {}), put: (k, t, cb) => cb(new Error('QuotaExceededError')), get: (k, cb) => cb(null, null), del: (k, cb) => cb(null) };
  G = H.load({ tolerant: true }); G.save.setBackend(failing);
  const se = []; G.on('save:error', d => se.push(d));
  stage(G, { slot: 1 }); se.length = 0; const nerr2 = G.errors.length; G.save.write(1, 'manual');
  ok(se.length === 1 && se[0].code === 'storage' && /save/i.test(se[0].message) && G.save.slots()[0].empty, 'a storage error shows "Couldn\'t save" and the slot card is not updated');
  ok(G.errors.slice(nerr2).every(e => e.where === 'save.persist'), 'the failure goes through Game.reportError and nothing throws');
  // a backend that fails the read-back
  const liar = { name: 'liar', loadAll: (k, cb) => cb(null, {}), put: (k, t, cb) => cb(null), get: (k, cb) => cb(null, 'something else'), del: (k, cb) => cb(null) };
  G = H.load({ tolerant: true }); G.save.setBackend(liar);
  const se2 = []; G.on('save:error', d => se2.push(d));
  stage(G, { slot: 1 }); se2.length = 0; G.save.write(1, 'manual');
  ok(se2.length === 1 && se2[0].code === 'storage' && G.save.slots()[0].empty, 'a write that does not read back identical is rejected before it replaces anything');

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
