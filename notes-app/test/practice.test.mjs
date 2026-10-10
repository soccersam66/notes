// Practice from Mistakes: problem parsing and answer checking through the real Giac engine: node notes-app/test/practice.test.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { createSolver } from '../js/mathengine.js';
import { checkAnswer, parseProblems, practicePrompt, mistakeTask, splitAnswer, isFactored, summarize, answerHint } from '../js/practice.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const caseval = await createRequire(import.meta.url)('./giac-node.cjs')(path.join(here, '../vendor/giac'));
const ev = async (cmd) => caseval(cmd);
const { solveProblem } = createSolver(ev);

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want))); };
// check(problem, task, typed) -> true/false
const check = async (expr, task, typed, extra = {}) => {
  const res = await solveProblem({ expr, raw: expr, task, ...extra });
  return (await checkAnswer(typed, res, task, ev)).ok;
};

// task of a mistake
t('stored task wins', mistakeTask({ problem: 'x^2-4=0', task: 'factor' }), 'factor');
t('old mistake: task from the problem', mistakeTask({ problem: 'x^2-4x-5=0' }), 'solve');
t('unknown stored task falls back', mistakeTask({ problem: 'factor x^2-9', task: 'word' }), 'factor');
t('prompt names the task and count', /task\): factor[\s\S]*Write 5 NEW/.test(practicePrompt({ problem: 'factor x^2-9', task: 'factor' })), true);
t('prompt never asks for answers', /Do not give the answers/.test(practicePrompt({ problem: 'x+1=2' })), true);

// reading Gemini's reply
const m = { problem: 'x^2-4x-5=0', task: 'solve' };
let ps = parseProblems({ problems: [
  { problem: 'Solve x^2-5x+6=0', expr: 'x^2-5x+6=0', task: 'solve' },
  { problem: 'x^2-4x-5=0', expr: 'x^2-4x-5=0' },            // the original again: dropped
  { problem: 'Solve x^2-5x+6=0', expr: 'x^2 - 5x + 6 = 0' },  // a repeat: dropped
  { problem: '', expr: '' }, null, 'junk',
  { problem: 'Solve 2x^2-8=0', task: 'nonsense' },            // no expr: taken from the problem, task from the mistake
] }, m);
t('parse keeps good ones', ps.map(p => p.expr), ['x^2-5x+6=0', '2x^2-8=0']);
t('parse fills the task', ps.map(p => p.task), ['solve', 'solve']);
t('parse caps the count', parseProblems({ problems: Array.from({ length: 9 }, (_, i) => ({ problem: `x+${i}=0`, expr: `x+${i}=0` })) }, m).length, 5);
t('parse bad reply', parseProblems(null, m), []);
t('parse bare array', parseProblems([{ problem: 'x+1=0', expr: 'x+1=0' }], m).length, 1);

// splitting typed answers
t('split commas', splitAnswer('5, -1'), ['5', '-1']);
t('split or + x=', splitAnswer('x = 5 or x = -1'), ['5', '-1']);
t('split keeps brackets', splitAnswer('sqrt(2, 3), 4'), ['sqrt(2, 3)', '4']);
t('factored', [isFactored('(2x-1)(3x+2)'), isFactored('2(x+1)^2'), isFactored('6x^2+x-2'), isFactored('(x+1)+x')], [true, true, false, false]);
t('summary', summarize([{ checked: true, ok: true }, { checked: true, ok: false }, { checked: false }]), { right: 1, total: 2 });
t('hint for solve', /comma/i.test(answerHint('solve', {})), true);

// solve
t('solve right, any order', await check('x^2-4x-5=0', 'solve', '5, -1'), true);
t('solve right, x= and or', await check('x^2-4x-5=0', 'solve', 'x=-1 or x=5'), true);
t('solve missing one', await check('x^2-4x-5=0', 'solve', '5'), false);
t('solve wrong value', await check('x^2-4x-5=0', 'solve', '5, 1'), false);
t('solve repeated value does not count twice', await check('x^2-4x-5=0', 'solve', '5, 5'), false);
t('solve fractions', await check('2x^2+x-1=0', 'solve', '1/2, -1'), true);
t('solve decimal for a fraction', await check('2x^2+x-1=0', 'solve', '0.5, -1'), true);
t('solve radicals', await check('x^2-2=0', 'solve', 'sqrt(2), -sqrt(2)'), true);
t('solve radicals with the root sign', await check('x^2-2=0', 'solve', '√2, -√2'), true);
t('solve rounded radicals', await check('x^2-2=0', 'solve', '1.414, -1.414'), true);
t('solve rounded to one decimal place', await check('x^2-2=0', 'solve', '1.4, -1.4'), true);
t('solve wrong decimals', await check('x^2-2=0', 'solve', '1.5, -1.5'), false);
t('trig solve', await check('2sin(x)-1=0', 'solve', 'pi/6, 5pi/6'), true);
t('trig solve with the pi sign', await check('2sin(x)-1=0', 'solve', '5π/6, π/6'), true);
t('trig solve missing one', await check('2sin(x)-1=0', 'solve', 'pi/6'), false);
t('no real solution', await check('x^2+1=0', 'solve', 'no solution'), true);
t('no real solution, wrong', await check('x^2+1=0', 'solve', '1, -1'), false);
t('system point', await check('2x+y=5, x-y=1', 'solve', '(2, 1)'), true);
t('system order matters', await check('2x+y=5, x-y=1', 'solve', '(1, 2)'), false);
t('inequality interval', await check('2x+1>5', 'solve', '(2, inf)'), true);
t('inequality interval with infinity sign', await check('2x+1>5', 'solve', '(2,∞)'), true);
t('inequality wrong bracket', await check('2x+1>5', 'solve', '[2, inf)'), false);
// expressions
t('factor right', await check('6x^2+x-2', 'factor', '(2x-1)(3x+2)'), true);
t('factor other order', await check('6x^2+x-2', 'factor', '(3x+2)(2x-1)'), true);
t('factor wrong sign', await check('6x^2+x-2', 'factor', '(2x+1)(3x-2)'), false);
t('factor: the unfactored form is not an answer', await check('6x^2+x-2', 'factor', '6x^2+x-2'), false);
t('expand right', await check('(x+2)^3', 'expand', 'x^3+6x^2+12x+8'), true);
t('expand: the bracket form is not an answer', await check('(x+2)^3', 'expand', '(x+2)^3'), false);
t('simplify right', await check('(x^2-1)/(x-1)', 'simplify', 'x+1'), true);
t('simplify wrong', await check('(x^2-1)/(x-1)', 'simplify', 'x-1'), false);
t('evaluate number', await check('3^4-2', 'evaluate', '79'), true);
t('evaluate wrong', await check('3^4-2', 'evaluate', '80'), false);
t('exact trig value', await check('sin(pi/3)', 'evaluate', 'sqrt(3)/2'), true);
t('inverse trig: rounded decimal', await check('arcsin(1/2)', 'evaluate', '0.5236'), true);
t('inverse trig: exact angle', await check('arcsin(1/2)', 'evaluate', 'pi/6'), true);
t('convert to radians', await check('150° to radians', 'convert', '5pi/6'), true);
t('vertex point', await check('y=x^2-4x+1', 'vertex', '(2, -3)'), true);
t('vertex swapped', await check('y=x^2-4x+1', 'vertex', '(-3, 2)'), false);
t('divide', await check('(x^3-1)/(x-1)', 'divide', 'x^2+x+1'), true);
t('triangle labelled', await check('a=7, b=9, C=40', 'triangle', 'c=5.79, A=51.05, B=88.95'), true);
t('triangle numbers in order', await check('a=7, b=9, C=40', 'triangle', '5.79, 51.05, 88.95'), true);
t('triangle wrong', await check('a=7, b=9, C=40', 'triangle', 'c=6.2, A=51.05, B=88.95'), false);
t('identity yes', await check('tan(x)*cos(x)=sin(x)', 'identity', 'yes'), true);
t('identity no', await check('tan(x)*cos(x)=sin(x)', 'identity', 'no'), false);
t('empty answer', await check('x+1=2', 'solve', '  '), false);

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
