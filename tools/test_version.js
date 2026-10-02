// Test script for the version label. Run: node tools/test_version.js
//   - Game.C.VERSION is a semver string that matches package.json (tools/build.js refuses to bundle otherwise)
//   - the title screen and the pause screen both draw "v<version>"; gameplay and sub-panels do not
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
ok(G.errors.length === 0, 'no errors (' + G.errors.length + ')');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
