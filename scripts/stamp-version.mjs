// Adds ?v=<package version> to the page's stylesheet and scripts, and an import map that does the same for every
// module in src/, so browsers fetch the new files after each release instead of reusing cached ones (GitHub Pages
// lets browsers keep files for 10 minutes). Run after bumping the version: node scripts/stamp-version.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const v = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const mods = readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js')).sort();
const map = `<script type="importmap" id="rsVersion">${JSON.stringify({ imports: Object.fromEntries(mods.map(f => [`./src/${f}`, `./src/${f}?v=${v}`])) })}</script>`;
for (const page of ['study.html', 'index.html']) {
  const file = new URL(page, root);
  let s = readFileSync(file, 'utf8');
  s = s.replace(/<script type="importmap" id="rsVersion">.*?<\/script>/s, '');
  s = s.replace(/href="styles\.css(\?v=[^"]*)?"/, `href="styles.css?v=${v}"`);
  s = s.replace(/src="settings\.js(\?v=[^"]*)?"/, `src="settings.js?v=${v}"`);
  s = s.replace(/<script type="module" src="(src\/[a-z-]+\.js)(\?v=[^"]*)?"><\/script>/, (_, p) => `${map}<script type="module" src="${p}?v=${v}"></script>`);
  writeFileSync(file, s);
}
console.log(`stamped ${v} on study.html and index.html (${mods.length} modules)`);
