// Build MapLibre glyph (SDF) files from the VT323 font.
// Setup once: npm i fontnik     Run: node scripts/make_glyphs.js
const fs = require('fs');
const path = require('path');
const fontnik = require('fontnik');
const font = fs.readFileSync(path.join(__dirname, 'tools', 'VT323-Regular.ttf'));
const out = path.join(__dirname, '..', 'web', 'glyphs', 'VT323');
fs.mkdirSync(out, { recursive: true });
const ranges = [[0, 255], [256, 511]];
(async () => {
  for (const [start, end] of ranges) {
    const buf = await new Promise((res, rej) => fontnik.range({ font, start, end }, (e, d) => (e ? rej(e) : res(d))));
    fs.writeFileSync(path.join(out, `${start}-${end}.pbf`), buf);
    console.log(`${start}-${end}.pbf`, buf.length, 'bytes');
  }
})();
