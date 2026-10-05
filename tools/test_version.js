// Test script for the version label. Run: node tools/test_version.js
//   - Game.C.VERSION is a semver string that matches package.json (tools/build.js refuses to bundle otherwise)
//   - the title screen and the pause screen both draw "v<version>"; gameplay and sub-panels do not
//   - C.CHANGELOG is newest-first, led by the current version, every entry with notes
//   - Settings has a Changelog row that opens a panel listing the versions, scrolls, and returns to Settings
const H = require('./harness.js');
const pkg = require('../package.json');
const G = H.load({ tolerant: true });
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

ok(/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(G.C.VERSION), 'C.VERSION is semver (' + G.C.VERSION + ')');
ok(G.C.VERSION === pkg.version, 'C.VERSION matches package.json (' + pkg.version + ')');

// record every string the UI draws while rendering one frame
const ctx = H.canvas.getContext('2d'), fillText = ctx.fillText.bind(ctx); let drawn = [];
ctx.fillText = function (s) { drawn.push(String(s)); return fillText.apply(null, arguments); };
const label = 'v' + G.C.VERSION;
function draws(scene) {
  if (scene === 'playing') H.newGame(); else G.setScene(scene);
  H.run(1); drawn = []; G.render();
  return drawn.filter(s => s === label).length;
}
ok(G.state.scene === 'title', 'boots to the title screen');
ok(draws('title') === 1, 'title screen shows ' + label);
H.shot('version_title');
ok(draws('playing') === 0, 'no version label during play');
ok(draws('paused') === 1, 'pause screen shows ' + label);
H.shot('version_pause');
// ---- changelog data
const log = G.C.CHANGELOG, num = (v) => v.split('.').reduce((a, n) => a * 1000 + Number(n), 0);
ok(Array.isArray(log) && log.length >= 2, 'C.CHANGELOG has entries (' + (log && log.length) + ')');
ok(log[0].version === G.C.VERSION, 'CHANGELOG[0] is the current version');
ok(log.every(e => /^\d+\.\d+\.\d+$/.test(e.version) && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.notes.length > 0 && e.notes.every(n => typeof n === 'string' && n)), 'every entry has a semver, a date and notes');
ok(log.every((e, i) => !i || num(log[i - 1].version) > num(e.version)), 'CHANGELOG is strictly newest-first');

// ---- Settings > Changelog
G.setScene('title'); H.run(1);
G.ui.sub = 'settings'; G.ui.idx.settings = 0;
drawn = []; G.render();
ok(drawn.includes('Settings') && drawn.includes('Changelog'), 'Settings lists a Changelog row');
ok(drawn.includes(label + '  \u203a'), 'the row shows the current version');
H.shot('changelog_settings');
for (let i = 0; i < 20 && G.ui.idx.settings < 9; i++) { H.press('ArrowDown'); H.run(0.2); }
ok(G.ui.idx.settings === 9, 'arrow keys reach the Changelog row (idx ' + G.ui.idx.settings + ')');
H.press('Enter'); H.run(0.2);
ok(G.ui.sub === 'changelog', 'Enter opens the changelog panel (sub=' + G.ui.sub + ')');
drawn = []; G.render();
ok(drawn.includes('Changelog') && drawn.includes(label) && drawn.includes('CURRENT'), 'panel shows the current version, marked CURRENT');
ok(log.every(e => drawn.includes('v' + e.version)), 'panel lists every version');
ok(log[0].notes.every(n => drawn.some(d => n.startsWith(d.slice(0, 20)))), 'panel shows the newest version\'s notes');
H.shot('changelog_panel');
// scrolling: pad the log so it overflows, then scroll to the end and back
const real = G.C.CHANGELOG.slice();
for (let i = 0; i < 12; i++) G.C.CHANGELOG.push({ version: '0.0.' + (30 - i), date: '2026-01-01', notes: ['Old note number ' + i + ' that is long enough to wrap onto a second line in the panel, just to add some height.'] });
G.render(); H.run(0.1); G.render();
ok(G.ui._clH > 560, 'overflowing log measures taller than the view (' + Math.round(G.ui._clH) + ')');
const y0 = G.ui.clScroll; for (let i = 0; i < 40; i++) { H.press('ArrowDown'); H.run(0.1); G.render(); }
ok(G.ui.clScroll > y0 && G.ui.clScroll <= G.ui._clH, 'Down scrolls the changelog (' + y0 + ' -> ' + Math.round(G.ui.clScroll) + ')');
H.shot('changelog_scrolled');
for (let i = 0; i < 60; i++) { H.press('ArrowUp'); H.run(0.1); }
ok(G.ui.clScroll === 0, 'Up scrolls back to the top');
G.C.CHANGELOG.length = 0; real.forEach(e => G.C.CHANGELOG.push(e));
H.press('Escape'); H.run(0.2);
ok(G.ui.sub === 'settings', 'Esc returns to Settings, not the title (sub=' + G.ui.sub + ')');
// the toggles above it still work and the link row ignores left/right
G.ui.idx.settings = 9; const before = JSON.stringify(G.settings); H.press('ArrowRight'); H.run(0.2);
ok(JSON.stringify(G.settings) === before && !('changelog' in G.settings), 'left/right on the Changelog row changes no setting');

ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
