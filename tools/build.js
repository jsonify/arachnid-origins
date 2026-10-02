/* Bundle src/*.js into a single self-contained HTML file: node tools/build.js [out.html] */
const fs = require('fs'), path = require('path');
const ORDER = ['core', 'world', 'webs', 'player', 'creatures', 'edu', 'audio', 'ui', 'main'];
const out = process.argv[2] || path.join(__dirname, '..', 'dist', 'arachnid-origins.html');
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = ORDER.filter(n => fs.existsSync(path.join(__dirname, '..', 'src', n + '.js'))).map(n => '<script>\n/* ' + n + '.js */\n' + fs.readFileSync(path.join(__dirname, '..', 'src', n + '.js'), 'utf8').replace(/<\/script>/g, '<\\/script>') + '\n</script>').join('\n');
html = html.replace(/<script src="src\/[^"]+"><\/script>\s*/g, '');
html = html.replace('</body>', scripts + '\n</body>');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
