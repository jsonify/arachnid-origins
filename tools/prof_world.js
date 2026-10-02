// Honest per-chunk bake cost (forces software canvas to rasterise).   node tools/prof_world.js
const H = require('./harness');
const G = H.load({ tolerant: true }); const W = G.world; const d = W._dbg;
function time(label, fn) { const t = Date.now(); const r = fn(); if (r && r.g) r.g.getImageData(0, 0, 1, 1); console.log(label.padEnd(22), Date.now() - t, 'ms'); return r; }
let tot = 0;
for (const [cx, cy] of [[1, 4], [5, 4], [8, 3], [12, 5], [3, 1], [10, 7]]) {
  time('hi chunk ' + cx + ',' + cy, () => d.renderChunk(cx, cy, 0));
  time('lo chunk ' + cx + ',' + cy, () => d.renderChunk(cx, cy, 1));
}
console.log('items', d.D.items.length, 'obstacles', d.D.obstacles.length, 'anchors', d.D.anchors.length, 'res', d.D.resources.length, 'shelters', d.D.shelters.length, 'canopy', d.D.canopy.length);
