import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const v = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// After a version bump run `npm run stamp`, so participants' browsers load the new files instead of cached ones.
test('pages load this version\'s files (run npm run stamp after a version bump)', () => {
  const mods = readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.js'));
  for (const page of ['study.html', 'index.html']) {
    const s = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(s.includes(`href="styles.css?v=${v}"`), `${page}: styles.css?v=${v}`);
    const map = JSON.parse(s.match(/<script type="importmap" id="rsVersion">(.*?)<\/script>/s)[1]).imports;
    for (const f of mods) assert.equal(map[`./src/${f}`], `./src/${f}?v=${v}`, `${page}: ${f}`);
    assert.match(s, new RegExp(`<script type="module" src="src/[a-z-]+\\.js\\?v=${v.replace(/\./g, '\\.')}"></script>`));
  }
});
