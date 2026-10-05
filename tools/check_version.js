/* Version policy check: node tools/check_version.js [baseRef]      (CI passes origin/<base branch>)
 *   always:       package.json, VERSION in src/core.js and CHANGELOG[0] agree; CHANGELOG is valid semver, strictly newest-first, with notes;
 *                 dist/ is a fresh build of src/
 *   with baseRef: if the game's code (src/, index.html, dist/) changed against baseRef, the version must be higher than baseRef's and
 *                 CHANGELOG[0] must be a new entry. Fix with: node tools/bump.js <major|minor|patch> "what changed" */
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const root = path.join(__dirname, '..'), rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const base = process.argv[2];
let fails = 0;
const bad = (m) => { console.error('FAIL ' + m); fails++; }, good = (m) => console.log('ok   ' + m);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/, parse = (v) => v.split('.').map(Number);
const cmp = (a, b) => { a = parse(a); b = parse(b); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const coreInfo = (src) => ({
  version: (/VERSION:\s*'([^']+)'/.exec(src) || [])[1],
  log: Array.from(src.matchAll(/\{ version: '([^']+)', date: '([^']*)', notes: \[([\s\S]*?)\n      \] \}/g)).map(m => ({ version: m[1], date: m[2], notes: (m[3].match(/^\s+'/gm) || []).length })),
});
const git = (args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const pkgV = JSON.parse(rd('package.json')).version, core = coreInfo(rd('src/core.js'));
if (!SEMVER.test(pkgV || '')) bad('package.json version "' + pkgV + '" is not major.minor.patch');
if (core.version !== pkgV) bad('VERSION in src/core.js (' + core.version + ') != package.json (' + pkgV + ')'); else good('package.json and src/core.js agree on ' + pkgV);
const lockV = JSON.parse(rd('package-lock.json')).version;
if (lockV !== pkgV) bad('package-lock.json version (' + lockV + ') != package.json (' + pkgV + ')');
if (!core.log.length || core.log[0].version !== pkgV) bad('CHANGELOG[0] (' + (core.log[0] && core.log[0].version) + ') is not the current version ' + pkgV); else good('CHANGELOG[0] is ' + pkgV);
core.log.forEach((e, i) => {
  if (!SEMVER.test(e.version)) bad('CHANGELOG entry "' + e.version + '" is not major.minor.patch');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) bad('CHANGELOG ' + e.version + ' needs a YYYY-MM-DD date');
  if (!e.notes) bad('CHANGELOG ' + e.version + ' has no notes');
  if (i && SEMVER.test(e.version) && SEMVER.test(core.log[i - 1].version) && cmp(core.log[i - 1].version, e.version) <= 0) bad('CHANGELOG must be strictly newest-first (' + core.log[i - 1].version + ' before ' + e.version + ')');
});

// dist/ must be what tools/build.js makes from src/
const tmp = path.join(os.tmpdir(), 'ao-build-check-' + process.pid + '.html');
try {
  cp.execFileSync(process.execPath, [path.join(__dirname, 'build.js'), tmp], { stdio: 'ignore' });
  if (fs.readFileSync(tmp, 'utf8') !== rd('dist/arachnid-origins.html')) bad('dist/arachnid-origins.html is stale: run node tools/build.js'); else good('dist/ is up to date');
} catch (e) { bad('tools/build.js failed: ' + e.message.split('\n')[0]); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } }

if (base) {
  let changed = null;
  try { changed = git(['diff', '--name-only', base + '...HEAD', '--', 'src', 'index.html', 'dist']).split('\n').filter(Boolean); } catch (e) { bad('cannot diff against ' + base + ' (' + e.message.split('\n')[0] + '); fetch it first'); }
  if (changed && !changed.length) good('no game code changed against ' + base + ', no bump needed');
  else if (changed) {
    let baseV = null, baseTop = null;
    try { baseV = JSON.parse(git(['show', base + ':package.json'])).version; baseTop = (coreInfo(git(['show', base + ':src/core.js'])).log[0] || {}).version; } catch (e) { bad('cannot read the version at ' + base); }
    if (baseV) {
      console.log('code changed against ' + base + ' (' + changed.length + ' files): ' + baseV + ' -> ' + pkgV);
      if (cmp(pkgV, baseV) <= 0) bad('game code changed but the version is still ' + pkgV + ' (' + base + ' has ' + baseV + '). Run: node tools/bump.js <major|minor|patch> "what changed"');
      else if (core.log[0] && core.log[0].version === baseTop) bad('version was raised but CHANGELOG has no new entry for it');
      else good('version raised to ' + pkgV + ' with a changelog entry');
    }
  }
}
console.log(fails ? '\n' + fails + ' problem(s). Bump with: node tools/bump.js <major|minor|patch> "what changed"' : '\nversion policy ok');
process.exit(fails ? 1 : 0);
