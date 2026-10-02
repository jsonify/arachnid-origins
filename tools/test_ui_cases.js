// scenario scripts for tools/test_ui.js
const C = {};
const SEEN = ['springtail', 'mite', 'aphid', 'ant', 'pillbug', 'centipede', 'wolfspider', 'cricket', 'bird'];
function seeSome(T) { const G = T.Game; SEEN.forEach(k => { G.creatures.visibleKinds.add(k); G.emit('creature:seen', { kind: k }); }); }

C.shots = (T) => {
  const G = T.load();
  T.step(30); T.shot('title');
  // sub panels on the title
  T.hover(640, 396); T.click(640, 396); T.step(3); T.shot('settings');
  T.tap('Escape'); T.hover(640, 455); T.click(640, 455); T.step(3); T.shot('howto');
  T.tap('Escape'); T.hover(640, 573); T.click(640, 573); T.step(3); T.shot('credits');
  T.tap('Escape');
  // new game + HUD
  T.hover(640, 336); T.click(640, 336); T.step(2);
  console.log('scene', G.state.scene);
  G.world.time01 = 0.33; seeSome(T);
  T.run(6);
  T.shot('hud_start');
  const P = G.player;
  // damage, facts, objectives
  P.hunger = 20; P.hydration = 22; P.energy = 18; P.hp = P.maxHp * 0.25;
  G.emit('player:damaged', { amount: 5, source: 'test' });
  G.edu.unlock('two_body_parts'); G.edu.unlock('silk_is_protein');
  T.step(20);
  T.shot('hud_low');
  T.run(5);
  T.noErrors('hud');
};
C.screens = (T) => {
  const G = T.load();
  T.step(5); T.click(640, 336); T.step(2); seeSome(T);
  T.run(3);
  G.input.inject.keyDown('KeyB'); T.step(2); G.input.inject.keyUp('KeyB'); T.step(2);
  console.log('scene', G.state.scene);
  T.step(20);
  T.shot('codex_bestiary');
  T.tap('KeyE'); T.step(20); T.shot('codex_ency');
  T.tap('KeyE'); T.step(20); T.shot('codex_anatomy');
  T.tap('KeyE'); T.step(20); T.shot('codex_web');
  T.noErrors('codex');
};
C.scenes = (T) => {
  const G = T.load();
  T.step(5); T.click(640, 336); T.step(2); seeSome(T);
  T.run(4);
  const P = G.player;
  // pause menu
  T.tap('Escape'); T.step(20); console.log('scene', G.state.scene); T.shot('pause');
  T.hover(640, 313); T.click(640, 313); T.step(20); T.shot('pause_settings');
  T.tap('Escape'); T.step(2);
  T.hover(640, 424); T.click(640, 424); T.step(15); T.shot('pause_confirm');
  T.tap('Escape'); T.tap('Escape'); T.step(5);
  console.log('scene after resume', G.state.scene);
  // molting
  P.stage = 0; P.addGrowth(999); T.step(60); console.log('scene', G.state.scene); T.shot('molting');
  T.hover(490 + 150, 300); T.step(10); T.shot('molting_hover');
  T.tap('Digit2'); T.step(3);
  console.log('scene after choose', G.state.scene, 'stage', P.stage, JSON.stringify(P.upgrades));
  T.run(12);
  T.shot('hud_stagecard');
  // game over
  P.dead = true; G.emit('player:died', { cause: 'eaten' }); G.setScene('gameover'); T.step(90); T.shot('gameover');
  T.noErrors('scenes');
};
C.end = (T) => {
  const G = T.load();
  T.step(5); T.click(640, 336); T.step(2); seeSome(T); T.run(2);
  G.state.stats = { eaten: 17, webs: 9 }; G.emit('game:victory'); G.setScene('victory'); T.step(100); T.shot('victory');
  T.noErrors('end');
};
C.science = (T) => {
  const G = T.load();
  T.step(5); T.click(640, 336); T.step(2); seeSome(T); T.run(2);
  const P = G.player;
  const c = G.creatures.spawn('springtail', P.x + 60, P.y + 20);
  const c2 = G.creatures.spawn('wolfspider', P.x - 80, P.y - 30);
  T.tap('KeyF'); T.step(2);
  const sp = G.camera.worldToScreen(c.x, c.y);
  T.hover(sp.x, sp.y); T.step(12);
  T.shot('science_creature');
  T.tap('KeyM'); T.step(3); T.shot('science_bigmap');
  T.noErrors('science');
};
C.logic = (T) => {
  const store = {};
  let G = T.load({ store });
  const E = G.edu;
  console.log('-- edu content');
  T.assert(E.FACTS.length >= 40, 'FACTS >= 40 (' + E.FACTS.length + ')');
  const ids = new Set(E.FACTS.map(f => f.id)); T.assert(ids.size === E.FACTS.length, 'fact ids unique');
  const cats = new Set(E.CATEGORIES.map(c => c.id)); T.assert(E.FACTS.every(f => cats.has(f.category)), 'all categories valid');
  T.assert(E.FACTS.every(f => f.title && f.text && f.text.length > 80 && f.hint && f.unlockOn && f.unlockOn.event), 'fact fields complete');
  T.assert(E.CATEGORIES.every(c => E.counts(c.id).total >= 5), 'each category has >=5 facts: ' + E.CATEGORIES.map(c => c.id + ':' + E.counts(c.id).total).join(' '));
  T.assert(E.STAGE_LORE.length === 5 && E.STAGE_LORE.every(l => l.title && l.text && l.scienceText), 'STAGE_LORE x5');
  T.assert(E.ANATOMY.parts.length >= 10 && E.ANATOMY.parts.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && p.text), 'ANATOMY parts');
  console.log('-- objectives / facts');
  T.step(5); T.click(640, 336); T.step(2);
  const P = G.player; let completed = [], newObj = [], unlocked = [], sfxs = [];
  G.on('objective:complete', d => completed.push(d.id)); G.on('objective:new', d => newObj.push(d.id)); G.on('fact:unlock', d => unlocked.push(d.id)); G.on('sfx', d => { if (d.name === 'unlock') sfxs.push(1); });
  T.assert(E.objectives.length === 3, '3 active objectives at start: ' + E.objectives.map(o => o.id).join(','));
  const g0 = P.growth; G.emit('player:drank', { amount: 10 }); T.step(2);
  T.assert(completed.includes('h_drink'), 'drink objective completes'); T.assert(P.growth > g0, 'reward growth applied (+' + (P.growth - g0) + ')');
  T.assert(unlocked.includes('dew_drinking') && sfxs.length >= 1, 'dew fact unlocked with sfx');
  G.emit('player:ate', { kind: 'springtail', value: 5 }); G.emit('player:ate', { kind: 'mite' }); G.emit('player:ate', { kind: 'aphid' }); T.step(2);
  T.assert(completed.includes('h_eat'), 'eat x3 objective completes');
  const n1 = unlocked.filter(x => x === 'fangs_venom').length; G.emit('player:ate', { kind: 'ant' }); T.assert(unlocked.filter(x => x === 'fangs_venom').length === n1 && n1 === 1, 'fact unlocks once only');
  T.run(5);
  T.assert(newObj.includes('h_night'), '4th objective queued after completions: ' + E.objectives.map(o => o.id).join(','));
  T.assert(E.objectives.length <= 3, 'max 3 active');
  // persistence
  const saved = JSON.parse(store['ao_facts']); T.assert(saved.includes('dew_drinking'), 'facts persisted to store');
  G = T.load({ store }); T.assert(G.edu.unlocked.has('dew_drinking') && G.edu.unlocked.has('fangs_venom'), 'facts restored after reload');
  console.log('-- stage objectives');
  for (let st = 0; st <= 4; st++) { const defs = G.edu.OBJECTIVE_DEFS[st]; const sum = defs.reduce((a, d) => a + d.reward, 0); console.log('   stage', st, defs.length, 'objectives, reward total', sum, 'of', G.C.STAGES[st].growthNeeded); }
  T.step(5); T.click(640, 336); T.step(2);
  const P2 = G.player; P2.stage = 1; G.emit('stage:change', { stage: 1, prev: 0 }); T.step(1);
  T.assert(G.edu.objectives[0].id === 's_line', 'stage change rebuilds objectives: ' + G.edu.objectives.map(o => o.id));
  G.emit('web:spun', { type: 'line' }); G.emit('web:trapped', { creature: { flying: false } }); T.step(2);
  T.assert(G.edu.objectives.filter(o => o.done).length === 2, 'web objectives complete');
  P2.stage = 3; G.emit('stage:change', { stage: 3, prev: 2 }); T.step(1);
  G.emit('web:trapped', { creature: { flying: false } }); T.assert(!G.edu.objectives.find(o => o.id === 'a_flyer').done, 'ground prey does not satisfy flying objective');
  G.emit('web:trapped', { creature: { flying: true } }); T.assert(G.edu.objectives.find(o => o.id === 'a_flyer').done, 'flying prey satisfies it');
  console.log('-- tip / science / food web');
  T.assert(typeof G.edu.tip() === 'string', 'tip() returns string: "' + G.edu.tip() + '"');
  const cr = G.creatures.spawn('springtail', P2.x + 10, P2.y);
  T.assert(G.edu.scienceInfo(cr).length >= 4, 'scienceInfo(creature)'); T.assert(G.edu.scienceInfo(P2).length >= 4, 'scienceInfo(player)');
  T.assert(G.edu.scienceInfo({ type: 'orb', integrity: 0.8, trapped: [], age: 20 }).length >= 3, 'scienceInfo(web)');
  T.assert(G.edu.scienceInfo({ type: 'dew', amount: 10, max: 40 }).length >= 2, 'scienceInfo(resource)');
  const fw = G.edu.foodWeb(); T.assert(fw.nodes.length > 15 && fw.edges.length > 20, 'foodWeb from KINDS: ' + fw.nodes.length + ' nodes ' + fw.edges.length + ' edges');
  T.assert(fw.edges.every(e => fw.nodes.some(n => n.id === e.from) && fw.nodes.some(n => n.id === e.to)), 'edges reference nodes');
  const G2 = T.load({ noCreatures: true }); const fw2 = G2.edu.foodWeb(); T.assert(fw2.nodes.length > 15 && fw2.edges.length > 20, 'foodWeb fallback without creatures: ' + fw2.nodes.length + ' nodes');
  T.step(5); T.click(640, 336); T.step(60); T.shot('nocreatures_hud'); G2.input.inject.keyDown('KeyB'); T.step(2); G2.input.inject.keyUp('KeyB'); T.step(30); T.shot('nocreatures_codex'); T.tap('KeyE'); T.tap('KeyE'); T.tap('KeyE'); T.step(20); T.shot('nocreatures_web');
  T.noErrors('logic-nocreatures');
};
C.nav = (T) => {
  const store = {};
  let G = T.load({ store }); const E = G.edu;
  const scene = () => G.state.scene;
  console.log('-- title keyboard');
  T.step(10); T.assert(scene() === 'title', 'boot -> title');
  T.tap('ArrowDown'); T.tap('Enter'); T.step(2); T.assert(G.ui.sub === 'settings', 'Down+Enter opens settings');
  const m0 = G.settings.master; T.tap('ArrowRight'); T.tap('ArrowRight'); T.assert(Math.abs(G.settings.master - Math.min(1, m0 + 0.1)) < 1e-6, 'right arrow raises master volume ' + m0 + ' -> ' + G.settings.master);
  T.assert(JSON.parse(store['ao_settings']).master === G.settings.master, 'settings saved');
  T.tap('ArrowDown'); T.tap('ArrowDown'); T.tap('ArrowDown'); T.tap('Enter'); T.assert(G.settings.muted === true, 'mute toggle via Enter'); T.tap('Enter'); T.assert(G.settings.muted === false, 'toggle back');
  for (let i = 0; i < 3; i++) T.tap('ArrowDown'); // screenShake, science, hints
  T.tap('Enter'); T.assert(G.settings.hints === false, 'hints toggle'); T.tap('Enter');
  T.tap('Escape'); T.assert(G.ui.sub === null, 'Esc closes settings');
  console.log('-- title mouse: slider drag');
  T.hover(640, 396); T.click(640, 396); T.step(2); const L = { x: 640 - 330 + 28 + 270, w: 250 };
  Game_drag: { const I = G.input.inject; I.click(L.x + 125, 192 + 0); }
  T.step(2);
  T.tap('Escape');
  console.log('-- event sounds');
  const sfx = []; G.on('sfx', d => sfx.push(d.name));
  T.hover(640, 336); T.step(1); T.hover(640, 396); T.step(1); T.assert(sfx.includes('ui_hover'), 'hover emits ui_hover'); T.click(640, 336); T.assert(sfx.includes('ui_click') && scene() === 'playing', 'click New Game: ui_click + playing');
  console.log('-- pause');
  T.run(1); T.tap('Escape'); T.assert(scene() === 'paused', 'Esc pauses'); T.tap('Escape'); T.assert(scene() === 'playing', 'Esc resumes'); T.tap('KeyP'); T.assert(scene() === 'paused', 'P pauses'); T.tap('KeyP'); T.assert(scene() === 'playing', 'P resumes');
  T.tap('Escape'); T.tap('ArrowDown'); T.tap('ArrowDown'); T.tap('ArrowDown'); T.tap('Enter'); T.assert(scene() === 'codex', 'pause -> Bestiary opens codex'); T.tap('Escape'); T.assert(scene() === 'paused', 'Esc in codex returns to pause');
  T.tap('ArrowDown'); T.tap('Enter'); T.assert(G.ui.sub === 'confirmQuit', 'quit asks to confirm'); T.tap('Enter'); T.assert(scene() === 'paused' && G.ui.sub === null, 'default choice is Keep Playing');
  T.tap('Enter'); T.tap('ArrowLeft'); T.tap('Enter'); T.assert(scene() === 'title', 'Quit confirmed -> toTitle');
  console.log('-- codex from title and playing');
  T.tap('ArrowDown'); T.tap('ArrowDown'); T.tap('ArrowDown'); T.tap('Enter'); T.assert(scene() === 'codex', 'title Bestiary'); T.tap('Escape'); T.assert(scene() === 'title', 'back to title');
  T.step(2); T.click(640, 336); T.run(1); T.tap('KeyB'); T.assert(scene() === 'codex', 'B opens codex'); T.tap('KeyB'); T.assert(scene() === 'playing', 'B closes codex');
  T.tap('KeyB'); T.tap('KeyE'); T.assert(G.ui.codex.tab === 1, 'E next tab'); T.tap('KeyQ'); T.assert(G.ui.codex.tab === 0, 'Q prev tab');
  T.hover(400, 70); T.click(400, 70); T.assert(G.ui.codex.tab === 1, 'click tab -> Encyclopedia'); T.tap('ArrowRight'); T.assert(G.ui.codex.cat === 1, 'right arrow category'); for (let i = 0; i < 40; i++) T.tap('ArrowDown'); T.assert(G.ui.codex.escroll > 0, 'scroll down encyclopedia'); G.input.mouse.wheel = -10; T.step(1);
  T.hover(1000, 300); G.input.mouse.wheel = 3; T.step(1);
  T.click(1000, 70); T.assert(G.ui.codex.tab === 1, 'tab stays'); T.tap('KeyE'); T.tap('ArrowRight'); T.assert(G.ui.codex.part === 1, 'anatomy part select'); T.hover(430, 333); T.step(1);
  T.tap('KeyE'); T.tap('ArrowRight'); T.assert(G.ui.codex.fsel === 1, 'food web select'); T.tap('KeyB'); T.assert(scene() === 'playing', 'closed');
  T.tap('KeyB'); T.tap('Tab'); T.assert(G.ui.codex.tab === 0, 'Tab next tab (wraps from Food Web)'); T.tap('Escape'); T.assert(scene() === 'playing', 'Esc closes codex');
  console.log('-- molting');
  const P = G.player; const chosen = []; G.on('molt:choose', d => chosen.push(d.id));
  P.addGrowth(999); T.step(3); T.assert(scene() === 'molting', 'molting scene'); T.tap('Digit1'); T.assert(scene() === 'molting', 'input locked right after molt start'); T.run(1);
  T.tap('ArrowRight'); T.tap('Enter'); T.assert(scene() === 'playing' && chosen.length === 1, 'arrows+Enter choose -> ' + chosen);
  T.run(10); P.stage = 1; P.growth = 0; P.growthNeeded = 140; P.molting = false; P.moltPhase = 'none';
  P.addGrowth(999); T.run(1.2); T.tap('Digit3'); T.assert(scene() === 'playing' && chosen.length === 2, 'Digit3 chooses');
  T.run(10); P.molting = false; P.moltPhase = 'none'; P.growth = 0;
  P.addGrowth(999); T.run(1.2); const r = [490 + 150, 300]; T.hover(r[0], r[1]); T.click(r[0], r[1]); T.assert(scene() === 'playing' && chosen.length === 3, 'mouse click card chooses');
  T.noErrors('nav-1');
  console.log('-- game over / victory');
  T.run(2); P.dead = true; G.emit('player:died', { cause: 'starved' }); G.setScene('gameover'); T.tap('Enter'); T.assert(scene() === 'gameover', 'gameover input lock'); T.run(1.2);
  T.tap('Enter'); T.assert(scene() === 'playing' && P.dead === false, 'Retry restarts game (Enter)');
  T.run(1); G.emit('player:died', { cause: 'eaten' }); G.setScene('gameover'); T.run(1.2); T.tap('ArrowRight'); T.tap('Enter'); T.assert(scene() === 'title', 'Title Screen from gameover');
  T.step(2); T.click(640, 336); T.run(1); G.emit('game:victory'); G.setScene('victory'); T.run(2); T.tap('ArrowRight'); T.tap('Enter'); T.assert(scene() === 'title', 'Title from victory');
  T.step(2); T.click(640, 336); T.run(1); G.emit('game:victory'); G.setScene('victory'); T.run(2); T.tap('Enter'); T.assert(scene() === 'playing', 'Play Again from victory');
  console.log('-- science / map keys');
  T.run(1); T.tap('KeyF'); T.assert(G.settings.science === true, 'F toggles science'); T.tap('KeyF'); T.assert(G.settings.science === false, 'F toggles off'); T.tap('KeyM'); T.assert(G.ui.mapBig === true, 'M toggles big map'); T.tap('KeyM');
  T.run(3); T.noErrors('nav-2');
};
module.exports = C;
