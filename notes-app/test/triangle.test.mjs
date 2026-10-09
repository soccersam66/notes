// Law of Sines / Cosines tests: node notes-app/test/triangle.test.mjs
import { parseTriangle, solveTriangle, triangleAnswer, looksLikeTriangle } from '../js/triangle.js';

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want))); };
const r2 = (x) => Math.round(x * 100) / 100;
const pick = (s, keys) => keys.map(k => r2(s[k]));

// SSS
let r = solveTriangle({ a: 8, b: 10, c: 13 });
t('SSS angles', pick(r.solutions[0], ['A', 'B', 'C']), [37.96, 50.25, 91.79]);
t('SSS uses cosines', r.method, 'Law of Cosines');
// SAS
r = solveTriangle({ b: 6, c: 9, A: 45 });
t('SAS side a', r2(r.solutions[0].a), 6.37);
t('SAS angles add to 180', r2(r.solutions[0].A + r.solutions[0].B + r.solutions[0].C), 180);
// ASA / AAS
r = solveTriangle({ A: 40, B: 60, c: 10 });
t('ASA', pick(r.solutions[0], ['C', 'a', 'b']), [80, 6.53, 8.79]);
r = solveTriangle({ A: 30, B: 45, a: 10 });
t('AAS', pick(r.solutions[0], ['C', 'b', 'c']), [105, 14.14, 19.32]);
// SSA ambiguous case
r = solveTriangle({ A: 30, a: 6, b: 10 });
t('SSA two triangles', r.solutions.length, 2);
t('SSA triangle 1', pick(r.solutions[0], ['B', 'C', 'c']), [56.44, 93.56, 11.98]);
t('SSA triangle 2', pick(r.solutions[1], ['B', 'C', 'c']), [123.56, 26.44, 5.34]);
t('SSA answer line', triangleAnswer({ A: 30, a: 6, b: 10 }, r), 'Triangle 1: c = 11.98, B = 56.44°, C = 93.56°; Triangle 2: c = 5.34, B = 123.56°, C = 26.44°');
r = solveTriangle({ A: 30, a: 4, b: 10 });
t('SSA no triangle', [r.solutions.length, /more than 1/.test(r.error)], [0, true]);
r = solveTriangle({ A: 30, a: 5, b: 10 });
t('SSA right triangle, one answer', [r.solutions.length, r2(r.solutions[0].B)], [1, 90]);
r = solveTriangle({ A: 110, a: 10, b: 6 });
t('SSA obtuse given angle, one answer', [r.solutions.length, r2(r.solutions[0].B)], [1, 34.32]);
r = solveTriangle({ A: 30, a: 12, b: 10 });
t('SSA long opposite side, one answer', r.solutions.length, 1);
// errors
t('SSS impossible', /No triangle/.test(solveTriangle({ a: 2, b: 3, c: 6 }).error), true);
t('three angles only', /at least one side/.test(solveTriangle({ A: 50, B: 60, C: 70 }).error), true);
t('angles over 180', /add to/.test(solveTriangle({ A: 100, B: 90, a: 5 }).error), true);
t('only two values', /Give 3 values/.test(solveTriangle({ a: 5, B: 40 }).error), true);
t('area SAS', r2(solveTriangle({ a: 5, b: 7, C: 30 }).solutions[0].area), 8.75);
// reading problems
t('parse sides and m-angle', parseTriangle('In triangle ABC, a = 7, b = 9, m∠C = 40°. Find c.'), { a: 7, b: 9, C: 40 });
t('parse segments', parseTriangle('AB = 5, BC = 7, angle B = 60'), { c: 5, a: 7, B: 60 });
t('parse three-letter angle', parseTriangle('angle BAC = 50, AC = 4, AB = 6'), { b: 4, c: 6, A: 50 });
t('degree sign makes it an angle', parseTriangle('a = 30°, b = 4, c = 5'), { A: 30, b: 4, c: 5 });
t('decimals', parseTriangle('a=7.5, B=42.3, C=61'), { a: 7.5, B: 42.3, C: 61 });
t('looks like a triangle', [looksLikeTriangle('a=3, b=4, c=5'), looksLikeTriangle('Use the law of sines'), looksLikeTriangle('x^2 - 4 = 0')], [true, true, false]);
console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
