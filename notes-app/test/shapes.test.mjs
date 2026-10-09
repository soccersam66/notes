// Shape clean-up tests: node notes-app/test/shapes.test.mjs
import { straightLine, cleanShape } from '../js/shapes.js';

let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const flat = (pts, jitter = 0) => pts.flatMap(([x, y]) => [x + rnd() * jitter, y + rnd() * jitter, 0.5]);
const poly = (corners, step = 3) => { const o = []; for (let i = 0; i < corners.length - 1; i++) { const [a, b] = [corners[i], corners[i + 1]]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step); for (let k = 0; k < n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return o; };
const ellipse = (cx, cy, rx, ry, turns = 1.03, n = 80) => Array.from({ length: n }, (_, k) => { const a = k / (n - 1) * Math.PI * 2 * turns; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });

let pass = 0, fail = 0;
const t = (name, got, want) => { if (got === want) pass++; else { fail++; console.log('FAIL', name, 'got', got, 'want', want); } };
const kind = (p) => (cleanShape(p) || {}).kind || null;

// shapes that should be cleaned
t('round circle', kind(flat(ellipse(200, 200, 60, 60), 5)), 'circle');
t('slightly oval circle', kind(flat(ellipse(200, 200, 60, 54), 5)), 'circle');
t('wide ellipse', kind(flat(ellipse(200, 200, 110, 50), 5)), 'ellipse');
t('circle with a gap', kind(flat(ellipse(200, 200, 50, 50, 0.85), 3)), 'circle');
t('rectangle', kind(flat(poly([[100, 100], [300, 102], [298, 220], [101, 218], [104, 104]]), 4)), 'rect');
t('square', kind(flat(poly([[100, 100], [180, 100], [180, 180], [100, 180], [100, 103]]), 3)), 'rect');
// things that must stay as drawn
t('open U shape', kind(flat(poly([[100, 100], [100, 200], [200, 200], [200, 100]]), 2)), null);
t('triangle', kind(flat(poly([[100, 200], [160, 100], [220, 200], [100, 200]]), 2)), null);
t('tiny o (letter)', kind(flat(ellipse(50, 50, 8, 9), 1)), null);
t('zigzag', kind(flat(poly([[0, 0], [30, 40], [60, 0], [90, 40], [120, 0]]), 2)), null);
t('straight line is not a shape', kind(flat(poly([[0, 0], [200, 5]]), 2)), null);
const S = flat(Array.from({ length: 60 }, (_, k) => [100 + 25 * Math.sin(k / 59 * Math.PI * 2) * (k < 30 ? 1 : -1), 100 + k * 1.2]), 1);
t('letter S', kind(S), null);

// hold-to-straighten
// a real hand-drawn line: a slow wobble of a few units plus a little jitter
const wobbly = flat(poly([[50, 50], [350, 80]]).map(([x, y], k) => [x, y + 4 * Math.sin(k / 9)]), 1);
t('wobbly line straightens', !!straightLine(wobbly), true);
t('vertical line straightens', !!straightLine(flat(poly([[50, 50], [52, 300]]), 4)), true);
t('short tick stays', !!straightLine(flat(poly([[50, 50], [60, 55]]), 1)), false);
t('curve stays', !!straightLine(flat(ellipse(200, 200, 80, 80, 0.4), 1)), false);
t('pause in a letter stays', !!straightLine(S), false);
const L = straightLine(wobbly) || [];
t('line starts where the stroke starts', Math.abs(L[0] - wobbly[0]) < 0.01 && Math.abs(L[1] - wobbly[1]) < 0.01, true);
t('line ends where the stroke ends', Math.abs(L[L.length - 3] - wobbly[wobbly.length - 3]) < 0.01, true);
t('a closed rough circle is not a line', !!straightLine(flat(ellipse(200, 200, 60, 60), 3)), false);

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
