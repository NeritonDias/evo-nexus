// Run once at build/harvest time. Idempotent.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const matchPng = (prefix) => (f) => new RegExp(`^${prefix}_\\d+\\.png$`, 'i').test(f);
const sortByNumber = (a, b) => parseInt(/(\d+)/.exec(a)?.[1] ?? '0') - parseInt(/(\d+)/.exec(b)?.[1] ?? '0');
const listSorted = (sub, prefix) => {
  try {
    return readdirSync(join(ROOT, sub)).filter(matchPng(prefix)).sort(sortByNumber);
  } catch {
    return [];
  }
};
const furniture = readdirSync(join(ROOT, 'furniture'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
let defaultLayout = null;
let bestRev = 0;
for (const f of readdirSync(ROOT)) {
  const m = /^default-layout-(\d+)\.json$/.exec(f);
  if (m && +m[1] > bestRev) {
    bestRev = +m[1];
    defaultLayout = f;
  }
}
const idx = {
  floors: listSorted('floors', 'floor'),
  walls: listSorted('walls', 'wall'),
  characters: listSorted('characters', 'char'),
  furniture,
  defaultLayout,
};
writeFileSync(join(ROOT, 'index.json'), JSON.stringify(idx, null, 2));
console.log('Wrote index.json:', idx);
