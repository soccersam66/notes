// Trig, inverse trig, degrees and triangles through the real Giac engine: node notes-app/test/trig.test.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { createSolver, normalize } from '../js/mathengine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const loadGiac = createRequire(import.meta.url)('./giac-node.cjs');
const caseval = await loadGiac(path.join(here, '../vendor/giac'));
const { solveProblem } = createSolver(async (cmd) => caseval(cmd));

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = want instanceof RegExp ? want.test(String(got)) : JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', String(want))); };
const S = async (expr, extra = {}) => { try { return await solveProblem({ expr, raw: expr, ...extra }); } catch (e) { return { plain: 'ERROR ' + e.message }; } };

// reading inverse trig
t('arcsin name', normalize('arcsin(1/2)'), 'asin(1/2)');
t('sin^-1', normalize('sin^-1(x)'), 'asin(x)');
t('sin^(-1)', normalize('sin^(-1)(0.5)'), 'asin((5/10))');
t('leading zero decimals', normalize('0.08x'), '(8/100)*x');
t('superscript inverse', normalize('cos⁻¹(1/2)'), 'acos(1/2)');
t('arc without brackets', normalize('arctan 1'), 'atan(1)');
t('degree sign removed', normalize('sin(30°)'), 'sin(30)');

// inverse trig: decimal answer, exact underneath
let r = await S('arcsin(cos(pi/3))');
t('arcsin(cos(pi/3)) decimal', r.plain, '0.5236');
t('arcsin(cos(pi/3)) exact', r.exact, 'pi/6');
t('arcsin(cos(pi/3)) note', r.note, /pi\/6 radians, which is 30°/);
t('arcsin(cos(pi/3)) steps', (r.steps || []).map(s => s.k).join(' | '), /inside first/);
r = await S('arcsin(3/2)');
t('arcsin(3/2) no real answer', r.plain, 'No real answer');
t('arcsin(3/2) says why', r.note, /from -1 to 1.*1\.5/);
t('arccos(2) no real answer', (await S('arccos(2)')).plain, 'No real answer');
t('sin^-1(1/2)', (await S('sin^-1(1/2)')).plain, '0.5236');
r = await S('arccos(-1/2)');
t('arccos(-1/2)', [r.plain, r.exact], ['2.0944', '2pi/3']);
t('arctan(-1)', (await S('arctan(-1)')).plain, '-0.7854');
t('arcsin(sin(5pi/6)) is pi/6', (await S('arcsin(sin(5pi/6))')).exact, 'pi/6');
t('arcsec(2)', (await S('arcsec(2)')).plain, '1.0472');
t('arcsin(1/3) decimal', (await S('arcsin(1/3)')).plain, '0.3398');
// degrees
r = await S('arcsin(1/2)', { angle: 'deg' });
t('arcsin(1/2) in degrees', [r.plain, r.pretty], ['30', '30°']);
r = await S('arcsin(cos(pi/3))', { angle: 'deg' });
t('pi input stays radians inside, answer in degrees', [r.plain, r.pretty, r.exact], ['30', '30\u00b0', '30']);
t('arccos(cos(2pi/3)) in degrees', (await S('arccos(cos(2pi/3))', { angle: 'deg' })).plain, '120');
t('arctan(3/4) in degrees', (await S('arctan(3/4)', { angle: 'deg' })).plain, '36.8699');
t('sin(30°) switches to degrees', (await S('sin(30°)')).plain, '1/2');
t('cos(60 degrees)', (await S('cos(60 degrees)')).plain, '1/2');
t('degree mode is reset afterwards', (await S('sin(pi/6)')).plain, '1/2');
// exact values
t('tan(pi/4)', (await S('tan(pi/4)')).plain, '1');
t('sec(pi/3)', (await S('sec(pi/3)')).plain, '2');
t('csc(pi/6)', (await S('csc(pi/6)')).plain, '2');
t('cot(pi/6)', (await S('cot(pi/6)')).plain, 'sqrt(3)');
t('sin(2pi/3) with decimal', [(await S('sin(2pi/3)')).plain, (await S('sin(2pi/3)')).decimal], ['sqrt(3)/2', '0.866025']);
// trig equations
t('solve 2sin(x)-1=0', (await S('2sin(x)-1=0')).plain, 'pi/6, 5pi/6');
r = await S('2sin(x)=1', { angle: 'deg' });
t('solve in degrees', [r.plain, r.pretty], ['30, 150', '30°, 150°']);
t('solve 2cos^2(x)+3cos(x)+1=0', (await S('2cos(x)^2+3cos(x)+1=0')).plain, '2pi/3, pi, 4pi/3');
t('sin(x)=2 has no solution', (await S('sin(x)=2')).plain, 'No solution');
t('identity as an equation', (await S('sin(x)^2+cos(x)^2=1')).plain, 'All real numbers');
// identities and simplifying
t('verify identity', (await S('Verify tan(x)cos(x)=sin(x)')).plain, 'True, it is an identity');
t('verify sec^2 - tan^2 = 1', (await S('Prove sec(x)^2-tan(x)^2=1')).plain, 'True, it is an identity');
t('not an identity', (await S('Verify sin(x)+cos(x)=1')).plain, 'Not an identity');
t('simplify (1-cos^2)/sin', (await S('simplify (1-cos(x)^2)/sin(x)')).plain, 'sin(x)');
t('simplify sin(x)sec(x)', (await S('simplify sin(x)*sec(x)')).plain, 'tan(x)');
// converting
t('150° to radians', (await S('Convert 150° to radians')).plain, '5pi/6');
t('5pi/6 to degrees', (await S('Convert 5pi/6 to degrees')).plain, '150');
r = await S('2 radians to degrees');
t('2 radians to degrees', [r.plain, r.decimal], ['360/pi', '114.5916']);
// triangles
r = await S('a=7, b=9, C=40');
t('triangle SAS answer', r.plain, /^c = 5\.\d+, A = \d+\.\d+°, B = \d+\.\d+°$/);
t('triangle checked', r.checked, true);
r = await S('In triangle ABC, A = 30°, a = 6, b = 10. Find B.');
t('triangle ambiguous case', r.plain, /^Triangle 1: .*; Triangle 2: /);
t('triangle law of sines', (await S('Use the law of sines: A=40, B=60, c=10')).plain, 'a = 6.53, b = 8.79, C = 80°');
t('no triangle', (await S('a=2, b=3, c=6')).plain, /No triangle/);
// the old basics still work
t('quadratic', (await S('x^2-4x-5=0')).plain, '-1, 5');
t('factor', (await S('factor 6x+9')).plain, '3(2x+3)');
t('system', (await S('2x+y=5, x-y=1')).plain, '(2, 1)');
t('log', (await S('log(100)')).plain, '2');

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
