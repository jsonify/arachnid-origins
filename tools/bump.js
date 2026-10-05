/* Bump the game version and add its changelog entry in one go:
 *   node tools/bump.js <major|minor|patch> "what changed" ["another change" ...]
 * Updates package.json, package-lock.json, VERSION and CHANGELOG in src/core.js, then rebuilds dist/.
 *   major: breaking / save-incompatible changes      minor: new features or content      patch: bug fixes and small tweaks
 * Notes are player-facing (they appear in Settings > Changelog), so write them for players. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..'), rd = (f) => fs.readFileSync(path.join(root, f), 'utf8'), wr = (f, s) => fs.writeFileSync(path.join(root, f), s);
const [kind, ...notes] = process.argv.slice(2);
if (!['major', 'minor', 'patch'].includes(kind) || !notes.length || notes.some(n => !n.trim())) {
  console.error('usage: node tools/bump.js <major|minor|patch> "what changed" ["another change" ...]'); process.exit(1);
}
const pkg = JSON.parse(rd('package.json')), cur = pkg.version.split('.').map(Number);
const next = (kind === 'major' ? [cur[0] + 1, 0, 0] : kind === 'minor' ? [cur[0], cur[1] + 1, 0] : [cur[0], cur[1], cur[2] + 1]).join('.');
const date = new Date().toISOString().slice(0, 10);

let core = rd('src/core.js');
const vRe = /(VERSION:\s*')[^']+(')/, cRe = /(CHANGELOG: \[\n)/;
if (!vRe.test(core) || !cRe.test(core)) { console.error('src/core.js: could not find VERSION / CHANGELOG'); process.exit(1); }
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const entry = "      { version: '" + next + "', date: '" + date + "', notes: [\n" + notes.map(n => '        ' + q(n.trim()) + ',\n').join('') + '      ] },\n';
wr('src/core.js', core.replace(vRe, '$1' + next + '$2').replace(cRe, '$1' + entry));

// package.json / package-lock.json: only the project's own version fields (lock: top level + packages[""])
wr('package.json', rd('package.json').replace(/("version":\s*")[^"]+(")/, '$1' + next + '$2'));
const lock = JSON.parse(rd('package-lock.json')); lock.version = next; if (lock.packages && lock.packages['']) lock.packages[''].version = next;
wr('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

console.log(pkg.version + ' -> ' + next + ' (' + kind + ')');
cp.execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
