// Practice from Mistakes: the Gemini prompt for new problems of the same type, reading its reply,
// and checking a typed answer against the math engine's answer. Pure, testable in Node.
// ev(cmd) must return a Promise<string> with Giac's output (same as createSolver).
import { normalize, extractMath, detectTask, TASKS } from './mathengine.js';

export const PRACTICE_COUNT = 5; // ask for 5, keep at least 3 the engine can solve
const OK_TASKS = ['solve', 'factor', 'simplify', 'expand', 'evaluate', 'vertex', 'divide', 'domain', 'inverse', 'zeros', 'identity', 'convert', 'triangle'];

// The task of a saved mistake (older mistakes did not store it).
export function mistakeTask(m) {
  const t = m && m.task;
  if (t && OK_TASKS.includes(t)) return t;
  return detectTask(String((m && m.problem) || ''));
}

export function practicePrompt(m, n = PRACTICE_COUNT, seed = 0) {
  const task = mistakeTask(m);
  return `You write practice problems for a high school precalculus student.
They got this problem wrong: ${m.problem}
Problem type (task): ${task} (${TASKS[task] || task})
Write ${n} NEW problems of the same type and about the same difficulty, with different numbers. Each one must have a clean answer (whole numbers, simple fractions, simple square roots, or nice angles), the kind a teacher puts on a quiz.
Return JSON only: {"problems":[{"problem":"the problem as a short readable line","expr":"the math only, in plain calculator syntax","task":"${task}"}]}
expr rules: ^ for powers, * for multiply, sqrt(), abs(), log() is base 10, ln(), pi. For a system, separate the equations with a comma. For divide use (p)/(q). Inverse trig as asin(), acos(), atan(). Keep the degree sign on angles in degrees, like sin(30°). For a triangle write "a=7, b=9, C=40" (sides a, b, c, angles A, B, C in degrees). For vertex, domain and inverse write the function, like y=x^2-4x+1.
Do not give the answers. Variation ${seed}.`;
}

// Gemini's JSON -> [{problem, expr, task}], cleaned, at most n, never the original problem again.
export function parseProblems(json, m, n = PRACTICE_COUNT) {
  const task = mistakeTask(m);
  const list = Array.isArray(json) ? json : (json && Array.isArray(json.problems) ? json.problems : []);
  const seen = new Set([squash(m && m.problem)]);
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const problem = String(p.problem || p.expr || '').trim().slice(0, 300);
    const expr = String(p.expr || extractMath(problem)).trim().slice(0, 300);
    if (!problem || !expr || !/[0-9a-z]/i.test(expr)) continue;
    const k = squash(expr);
    if (seen.has(k) || seen.has(squash(problem))) continue;
    seen.add(k);
    const t = OK_TASKS.includes(p.task) ? p.task : task;
    out.push({ problem, expr, task: t });
    if (out.length >= n) break;
  }
  return out;
}
const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

// What to type, shown under the answer box.
export function answerHint(task, res) {
  if (res && res.interval) return 'Interval notation, like (2, inf) or [-1, 3)';
  if (task === 'triangle') return 'Like c=5.79, A=51.05, B=88.95 (2 decimal places)';
  if (task === 'vertex') return 'A point, like (2, -3)';
  if (task === 'factor') return 'Factored, like (2x-1)(3x+2)';
  if (task === 'solve' || task === 'zeros') return 'Comma separated, like 5, -1 (or "no solution")';
  if (task === 'identity') return 'Type yes or no';
  return 'Use ^ for powers, sqrt() for roots, pi for π';
}

// ---------- checking an answer ----------
const WORDS = [
  { re: /^(no( real)? (solution|answer)s?|none|dne|∅|\{\})$/, key: 'none' },
  { re: /^(all real numbers|all reals|r|ℝ|\(-(inf|∞), ?(inf|∞)\)|infinitely many( solutions)?)$/, key: 'all' },
  { re: /^(true, it is an identity|yes|true|identity|it is an identity)$/, key: 'yes' },
  { re: /^(not an identity|no|false)$/, key: 'no' }
];
function wordKey(s) {
  const t = String(s).toLowerCase().replace(/[.!]/g, '').replace(/\s+/g, ' ').trim();
  for (const w of WORDS) if (w.re.test(t)) return w.key;
  return null;
}
// Split at top-level commas, semicolons, " or " and " and ".
export function splitAnswer(s) {
  const out = []; let depth = 0, cur = '';
  const str = String(s).replace(/\s+(or|and)\s+/gi, ',');
  for (const c of str) {
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if ((c === ',' || c === ';') && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim().replace(/^[a-z]\s*=\s*/i, '').trim()).filter(Boolean);
}
const unwrap = (s) => { s = String(s).trim(); return /^[([{].*[)\]}]$/.test(s) ? s.slice(1, -1) : s; };
const canonInterval = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/infinity|inf|oo/g, '∞').replace(/\+∞/g, '∞').replace(/u/g, '∪');
// Decimal places typed, so a rounded answer (0.5236 for pi/6) counts.
const places = (s) => Math.max(0, ...(String(s).match(/\.\d+/g) || []).map(x => x.length - 1));

function isErr(r) { return !r || /error|syntax|undef|Bad Argument|not defined|inf/i.test(r); }

// true when the typed value a equals the engine value b (exactly, or to the decimals typed)
export async function sameValue(a, b, ev) {
  const A = normalize(a), B = normalize(b);
  if (!A || !B) return false;
  const d = `(${A})-(${B})`;
  const s = String(await ev(`simplify(${d})`)).trim();
  if (s === '0') return true;
  const dp = places(a);
  const tol = dp ? 0.51 * Math.pow(10, -dp) : 1e-9;
  const vars = String(await ev(`lname(${d})`)).replace(/^\[|\]$/g, '').split(',').map(x => x.trim()).filter(x => x && !['pi', 'e', 'i'].includes(x));
  if (!vars.length) {
    const n = parseFloat(await ev(`evalf(${d},12)`));
    return !isNaN(n) && Math.abs(n) <= tol * Math.max(1, dp ? 1 : Math.abs(parseFloat(await ev(`evalf(${B},12)`)) || 1));
  }
  // an expression: equal at a few sample points
  for (const x of ['0.7', '1.3', '2.9', '-0.4']) {
    const r = await ev(`evalf(subst(${d},[${vars.map(v => v + '=' + x).join(',')}]),12)`);
    const n = parseFloat(r);
    if (isErr(r) || isNaN(n) || Math.abs(n) > Math.max(tol, 1e-7)) return false;
  }
  return true;
}

// Does the typed answer match the engine's result? Returns { ok, why }.
export async function checkAnswer(given, res, task, ev) {
  const g = String(given || '').trim();
  if (!g) return { ok: false, why: 'empty' };
  const want = String(res.plain || '');
  const wk = wordKey(want), gk = wordKey(g);
  if (wk || gk) return { ok: wk === gk, why: 'words' };
  if (res.interval) return { ok: canonInterval(g) === canonInterval(want), why: 'interval' };
  if (task === 'triangle') return { ok: sameTriangle(g, want), why: 'triangle' };
  const ordered = task === 'vertex' || (res.vars && res.vars.length > 1); // points and systems keep their order
  const multi = ordered || ['solve', 'zeros'].includes(task) || (res.items && res.items.length > 1);
  if (multi) {
    const wantItems = ordered ? res.items : (res.items && res.items.length ? res.items : splitAnswer(want));
    const gotItems = ordered ? splitAnswer(unwrap(g)) : splitAnswer(g);
    if (gotItems.length !== wantItems.length) return { ok: false, why: 'count' };
    const left = wantItems.slice();
    for (let i = 0; i < gotItems.length; i++) {
      if (ordered) { if (!(await sameValue(gotItems[i], left[i], ev))) return { ok: false, why: 'value' }; continue; }
      let hit = -1;
      for (let j = 0; j < left.length; j++) if (await sameValue(gotItems[i], left[j], ev)) { hit = j; break; }
      if (hit < 0) return { ok: false, why: 'value' };
      left.splice(hit, 1);
    }
    return { ok: true, why: 'match' };
  }
  const cmp = res.exact && task !== 'factor' ? [want, res.exact] : [want];
  let same = false;
  for (const w of cmp) if (await sameValue(g, w, ev)) { same = true; break; }
  if (!same) return { ok: false, why: 'value' };
  // the same value is not enough when the form is the point of the task
  if (task === 'factor' && /\(/.test(want) && !isFactored(g)) return { ok: false, why: 'not factored' };
  if (task === 'expand' && /\(/.test(g)) return { ok: false, why: 'not expanded' };
  return { ok: true, why: 'match' };
}
// A product at the top level: (2x-1)(3x+2), 2(x+1)^2, x(x-3)
export function isFactored(s) {
  const t = String(s).replace(/\s+/g, '');
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === '+' || c === '-') && depth === 0 && i > 0) return false; // a sum at the top level
  }
  return /\(/.test(t);
}
// "c = 5.79, A = 51.05°, B = 88.95°" vs what was typed: labelled numbers, or the numbers in order
function sameTriangle(g, want) {
  const lab = (s) => { const o = {}; (String(s).match(/[a-cA-C]\s*=\s*-?[\d.]+/g) || []).forEach(p => { const [k, v] = p.split('='); o[k.trim()] = parseFloat(v); }); return o; };
  const W = lab(want), G = lab(g), keys = Object.keys(W);
  const near = (a, b) => Math.abs(a - b) <= 0.051 * Math.max(1, Math.abs(b) / 100);
  if (keys.length && Object.keys(G).length) return keys.every(k => G[k] !== undefined && near(G[k], W[k]));
  const nums = (s) => (String(s).match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const a = nums(g), b = Object.values(W).length ? Object.values(W) : nums(want);
  return a.length === b.length && a.every((x, i) => near(x, b[i]));
}

// One practice round as it is saved on the mistake.
export function summarize(items) {
  const done = items.filter(x => x.checked);
  return { right: done.filter(x => x.ok).length, total: done.length };
}
