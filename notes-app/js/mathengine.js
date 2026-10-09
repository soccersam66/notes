// Turns a problem ("x^2 - 4x - 5 = 0", "factor 6x^2+x-2", ...) into exact,
// checked answers using the Giac engine. No AI in here.
// ev(cmd) must return a Promise<string> with Giac's output.
import { looksLikeTriangle, parseTriangle, solveTriangle, triangleAnswer } from './triangle.js';

const FUNCS = ['asin', 'acos', 'atan', 'asec', 'acsc', 'acot', 'trigsimplify', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sqrt', 'ln', 'log10', 'logb', 'log', 'abs', 'exp', 'f', 'g', 'h', 'floor', 'ceil', 'nthroot'];

export const TASKS = {
  solve: 'Solve', factor: 'Factor', simplify: 'Simplify', expand: 'Expand', evaluate: 'Evaluate',
  vertex: 'Vertex', divide: 'Divide', domain: 'Domain', inverse: 'Inverse', zeros: 'Zeros', command: 'Compute',
  triangle: 'Triangle', convert: 'Convert', identity: 'Identity'
};

// Angles written in degrees: 30°, 30 degrees, 30 deg
export const hasDegrees = (s) => /\d\s*(\u00b0|degrees?\b|deg\b)/i.test(String(s || ''));
const INV = /\ba(sin|cos|tan|sec|csc|cot)\(/;

// ---------- 1. Normalise what we read into Giac syntax ----------
export function normalize(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/[\u2212\u2013\u2014\u2010\u2012]/g, '-')
    .replace(/[\u00d7\u22c5\u00b7\u2219]/g, '*').replace(/\u00f7/g, '/')
    .replace(/\u2264/g, '<=').replace(/\u2265/g, '>=').replace(/\u2260/g, '!=')
    .replace(/\u03c0/g, 'pi').replace(/\u03b8/g, 'theta')
    .replace(/\u221e/g, 'inf')
    .replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ');
  // superscript digits: x\u00b2 -> x^2, x\u207b\u00b9 -> x^(-1)
  const sup = { '\u2070': '0', '\u00b9': '1', '\u00b2': '2', '\u00b3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9', '\u207b': '-' };
  s = s.replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079\u207b]+/g, m => '^(' + m.split('').map(c => sup[c]).join('') + ')');
  s = s.replace(/\^\((\d+)\)/g, '^$1');
  // square roots written with the radical sign
  s = s.replace(/\u221a\s*\(/g, 'sqrt(').replace(/\u221a\s*([a-z0-9.]+)/gi, 'sqrt($1)');
  // |x - 3| -> abs(x - 3)
  let open = true;
  s = s.replace(/\|/g, () => { const r = open ? 'abs(' : ')'; open = !open; return r; });
  // inverse trig: arcsin, sin^-1, sin^(-1), sin⁻¹ -> asin (Giac's names)
  s = s.replace(/\barc\s*(sin|cos|tan|sec|csc|cot)\b/gi, (m, f) => 'a' + f.toLowerCase());
  s = s.replace(/(?<![a-z])(sin|cos|tan|sec|csc|cot)\s*\^\s*\(?\s*-\s*1\s*\)?/gi, (m, f) => 'a' + f.toLowerCase());
  s = s.replace(/(?<![a-z])(a(?:sin|cos|tan|sec|csc|cot))\s+(-?[0-9.]+(?:\/[0-9.]+)?|[a-z])(?![\w(])/gi, '$1($2)');
  // degree marks go; the solver switches Giac to degrees instead (hasDegrees)
  s = s.replace(/(\d)\s*(?:\u00b0|degrees?\b|deg\b)/gi, '$1');
  // logs: log_2(x), log2(x), log base 2 -> logb(x,2); plain log -> base 10 (US convention)
  s = s.replace(/log_?\{?(\d+|e)\}?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (m, b, a) => b === 'e' ? `ln(${a})` : `logb(${a},${b})`);
  s = s.replace(/\blog\s*\(/gi, 'log10(');
  s = s.replace(/\bln\b\s*([a-z0-9]+)(?!\()/gi, 'ln($1)');
  // trig without brackets: sin x -> sin(x), sin2x -> sin(2x)
  s = s.replace(/(?<![a-z])(sin|cos|tan|sec|csc|cot)\s+(\d*[a-z](?:\^\d)?)\b(?!\()/gi, '$1($2)');
  // sin^2(x) -> sin(x)^2
  s = s.replace(/(?<![a-z])(sin|cos|tan|sec|csc|cot)\^(\d+)\s*\(([^()]*)\)/gi, '$1($3)^$2');
  // implicit multiplication
  s = s.replace(/(\d)\s*([a-z(])/gi, (m, d, c) => d + '*' + c);
  s = s.replace(/\)\s*([a-z0-9(])/gi, ')*$1');
  s = s.replace(/\b([a-z])\s*\(/gi, (m, v, off, str) => {
    // single-letter followed by "(": function only if f, g or h
    const prev = str.slice(0, off);
    if (/[a-z]$/i.test(prev)) return m; // part of a longer name like "sin("
    return /[fgh]/i.test(v) ? m : v + '*(';
  });
  s = s.replace(/\b([xyt])\s*([xyt])\b/g, '$1*$2');
  // undo damage to function names (e.g. log10*( from the digit rule)
  for (const f of FUNCS) s = s.replace(new RegExp('\\b' + f + '\\*\\(', 'g'), f + '(');
  s = s.replace(/log1\*0\(/g, 'log10(');
  s = s.replace(/\binf\b/g, 'inf');
  // decimals -> exact fractions so answers stay exact (2.5 -> (25/10))
  s = s.replace(/(?<![\w.])(\d+)\.(\d+)(?![\w.])/g, (m, a, b) => `(${(a + b).replace(/^0+(?=\d)/, '')}/1${'0'.repeat(b.length)})`);
  return s.trim();
}

// ---------- 2. Guess the task from the problem text ----------
export function detectTask(text) {
  const t = String(text || '').toLowerCase();
  const strip = t.replace(/^\s*(\d+[.)]|[a-z][.)])\s+/, '');
  if (looksLikeTriangle(String(text || ''))) return 'triangle';
  if (/\b(to|in(to)?)\s+(radians?|degrees?)\b|\bconvert\b/.test(strip)) return 'convert';
  if (/\b(verify|prove|identity|show that)\b/.test(strip)) return 'identity';
  const rules = [
    ['vertex', /vertex/], ['factor', /\bfactor/], ['expand', /\b(expand|multiply out|foil)/],
    ['simplify', /\bsimplify/], ['divide', /\b(divide|long division|synthetic)/], ['domain', /\bdomain/],
    ['inverse', /\binverse/], ['zeros', /\b(zeros|roots|x-intercepts)/], ['evaluate', /\b(evaluate|calculate|compute|find the value)/],
    ['solve', /\bsolve/]
  ];
  for (const [k, r] of rules) if (r.test(strip)) return k;
  if (/(<=|>=|!=|=|<|>)/.test(strip)) return 'solve';
  return 'simplify';
}

// Strip "3. Solve:" style instructions, keep the math.
export function extractMath(text) {
  let s = String(text || '').trim();
  s = s.replace(/^\s*(\d+[.)]|[a-z][.)])\s+/i, '');
  s = s.replace(/\s*\bin vertex form\.?\s*$/i, '').replace(/^write\s+/i, '');
  s = s.replace(/^(verify|prove|show that)(\s+(that|the identity))?\s*[:.]?\s*/i, '');
  s = s.replace(/^(solve|factor( completely)?|simplify|expand|evaluate|divide|find the (vertex|domain|inverse|zeros)( of)?)\s*(for\s+[a-z])?\s*[:.]?\s*/i, '');
  s = s.replace(/[.;]\s*$/, '');
  s = s.replace(/^y\s*=\s*(?=.*x)/i, m => m); // keep y = ... for vertex/inverse
  return s.trim();
}

// ---------- helpers ----------
const isErr = r => !r || /error|syntax|undef|Bad Argument|not defined/i.test(r);
function splitTop(s, sep = ',') {
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map(x => x.trim());
}
export function listItems(r) {
  let s = String(r).trim();
  if (s.startsWith('list[')) s = s.slice(5, -1);
  else if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  else return [s];
  return s === '' ? [] : splitTop(s);
}
function stripParens(s) {
  s = s.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let d = 0, ok = true;
    for (let i = 0; i < s.length; i++) { if (s[i] === '(') d++; if (s[i] === ')') d--; if (d === 0 && i < s.length - 1) { ok = false; break; } }
    if (!ok) break; s = s.slice(1, -1).trim();
  }
  return s;
}

// Giac output -> what you type into DeltaMath (plain) and what we show (pretty)
export function toPlain(r) {
  let s = String(r).replace(/^"|"$/g, '').replace(/(\d)\.0+(?!\d)/g, '$1');
  s = s.replace(/exp\(1\)/g, 'e').replace(/exp\(([^()]+)\)/g, 'e^($1)').replace(/e\^\((\d+)\)/g, 'e^$1');
  // \u221a41 -> sqrt(41), \u221a(x+1) -> sqrt(x+1)
  s = s.replace(/\u221a\(/g, 'sqrt(').replace(/\u221a([a-z0-9.]+)/gi, 'sqrt($1)');
  s = s.replace(/\(-i\)/g, '-i');
  s = s.replace(/\binf\b/g, '\u221e');
  // 1/4*(a) -> (a)/4 ; 1/3*pi -> pi/3
  const fm = s.match(/^(-?\d+)\/(\d+)\*(.+)$/);
  if (fm) {
    let x = fm[3];
    if (splitTop(x.replace(/([^(])-/g, '$1+-'), '+').length > 1 && !(x.startsWith('(') && stripParens(x) !== x)) x = '(' + x + ')';
    const n = fm[1] === '1' ? '' : fm[1] === '-1' ? '-' : fm[1];
    s = n + x + '/' + fm[2];
  }
  s = s.replace(/(\d)\*([a-z(])/gi, '$1$2').replace(/\)\*\(/g, ')(');
  s = s.replace(/i\*sqrt/g, 'i sqrt');
  return s;
}
export function toPretty(plain) {
  return String(plain).replace(/sqrt\(([^()]+)\)/g, (m, a) => /^[a-z0-9.]+$/i.test(a) ? '\u221a' + a : '\u221a(' + a + ')')
    .replace(/(?<![a-z])pi(?![a-z])/g, '\u03c0').replace(/<=/g, '\u2264').replace(/>=/g, '\u2265').replace(/!=|<>/g, '\u2260')
    .replace(/\*/g, '\u00b7');
}

// Inequality solutions from Giac -> interval notation
export function toInterval(items, v) {
  if (items.length === 1 && items[0] === v) return '(-\u221e, \u221e)';
  const parts = [];
  for (let it of items) {
    it = stripParens(it);
    const and = it.split(/\s+and\s+/).map(stripParens);
    let lo = '-\u221e', hi = '\u221e', lb = '(', rb = ')';
    for (const c of and) {
      let m;
      if ((m = c.match(new RegExp('^' + v + '\\s*(<=|<)\\s*(.+)$')))) { hi = toPlain(m[2]); rb = m[1] === '<=' ? ']' : ')'; }
      else if ((m = c.match(new RegExp('^' + v + '\\s*(>=|>)\\s*(.+)$')))) { lo = toPlain(m[2]); lb = m[1] === '>=' ? '[' : '('; }
      else if ((m = c.match(new RegExp('^(.+?)\\s*(>=|>)\\s*' + v + '$')))) { hi = toPlain(m[1]); rb = m[2] === '>=' ? ']' : ')'; }
      else if ((m = c.match(new RegExp('^(.+?)\\s*(<=|<)\\s*' + v + '$')))) { lo = toPlain(m[1]); lb = m[2] === '<=' ? '[' : '('; }
      else if ((m = c.match(new RegExp('^' + v + '\\s*=\\s*(.+)$')))) { lo = hi = toPlain(m[1]); lb = '['; rb = ']'; }
      else if ((m = c.match(new RegExp('^' + v + '\\s*<>\\s*(.+)$')))) return null;
      else return null;
    }
    parts.push(lb + lo + ', ' + hi + rb);
  }
  return parts.join(' \u222a ');
}

function pickVar(expr) {
  const names = (expr.match(/\b[a-z]+\b/gi) || []).filter(n => !FUNCS.includes(n) && !['pi', 'e', 'i', 'and', 'or', 'inf'].includes(n));
  for (const v of ['x', 't', 'theta', 'n', 'a']) if (names.includes(v)) return v;
  return names.find(n => n !== 'y') || names[0] || 'x';
}
const hasTrig = s => /\b(sin|cos|tan|sec|csc|cot)\(/.test(s);

// ---------- 3. Solve ----------
export function createSolver(ev) {
  const run = async (cmd) => {
    const r = await ev(cmd);
    return typeof r === 'string' ? r.trim() : String(r);
  };

  // True when L = R for every value of v (checks symbolically, then at a few sample points)
  async function isIdentity(L, R, v) {
    const d = `(${L})-(${R})`;
    for (const f of ['simplify', 'trigsimplify']) { if ((await run(`${f}(${d})`)) === '0') return true; }
    for (const x of ['0.7', '1.3', '2.9', '-0.4']) {
      const n = parseFloat(await run(`evalf(subst(${d},${v}=${x}),12)`));
      if (isNaN(n) || Math.abs(n) > 1e-9) return false;
    }
    return true;
  }

  async function isZero(expr) {
    const r = await run(`simplify(${expr})`);
    if (r === '0') return true;
    const n = await run(`evalf(${expr})`);
    const v = parseFloat(n);
    return !isNaN(v) && Math.abs(v) < 1e-9;
  }

  async function solveEq(expr, v, opts) {
    const rel = expr.match(/(<=|>=|!=|<|>|=)/);
    const sides = expr.split(/(?:<=|>=|!=|<|>|=)/);
    const isIneq = rel && rel[1] !== '=';
    let domain = '';
    if (hasTrig(expr) && !isIneq && !opts.general) domain = opts.deg ? ` and ${v}>=0 and ${v}<360` : ` and ${v}>=0 and ${v}<2*pi`;
    // a trig equation that is true for every angle is an identity, not something to solve
    if (hasTrig(expr) && !isIneq && sides.length === 2 && await isIdentity(sides[0], sides[1], v)) {
      return { plain: 'All real numbers', items: [], checked: true, identity: true, note: 'Both sides are equal for every angle where they are defined (it is an identity).' };
    }
    const sysParts = splitTop(expr).filter(p => /=/.test(p));
    // systems: "2x+y=5, x-y=1"
    if (sysParts.length > 1) {
      const vars = listItems(await run(`lname([${sysParts.join(',')}])`)).filter(n => !['pi', 'e', 'i'].includes(n));
      const r = await run(`solve([${sysParts.join(',')}],[${vars.join(',')}])`);
      if (isErr(r)) throw new Error('engine');
      const sols = listItems(r);
      if (!sols.length) return { plain: 'No solution', items: [], checked: false, note: 'The engine found no solution.' };
      const first = listItems(sols[0]).map(toPlain);
      let checked = true;
      for (const eq of sysParts) {
        const [l, rr] = eq.split('=');
        const sub = vars.map((n, i) => `${n}=${listItems(sols[0])[i]}`).join(',');
        if (!(await isZero(`subst((${l})-(${rr}),[${sub}])`))) checked = false;
      }
      return { plain: '(' + first.join(', ') + ')', items: first, vars, checked, note: vars.join(', ') + ' = ' + first.join(', ') };
    }
    const r = await run(`solve(${expr}${domain},${v})`);
    if (isErr(r)) throw new Error('engine');
    let items = listItems(r);
    if (isIneq) {
      const iv = toInterval(items, v);
      if (!items.length) return { plain: 'No solution', items: [], checked: false };
      return { plain: iv || items.map(toPlain).join(' or '), items: items.map(toPlain), checked: false, interval: true,
        note: iv ? 'Interval notation' : '' };
    }
    if (!items.length && hasTrig(expr)) {
      return { plain: 'No solution', items: [], checked: false, note: 'No angle makes this true. Remember sine and cosine are always between -1 and 1.' };
    }
    if (!items.length) {
      // complex roots for polynomials
      const c = await run(`csolve(${expr},${v})`);
      const ci = listItems(c).filter(x => x && !isErr(x));
      if (ci.length) {
        return { plain: 'No real solution', items: [], complex: ci.map(toPlain), checked: false,
          note: 'Complex solutions: ' + ci.map(toPlain).join(', ') };
      }
      return { plain: 'No solution', items: [], checked: false, note: 'Any answers would make a denominator zero or are not real.' };
    }
    const lhs = sides[0], rhs = sides[1] || '0';
    let checked = true;
    for (const it of items) if (!(await isZero(`subst((${lhs})-(${rhs}),${v}=${it})`))) checked = false;
    const plainItems = items.map(toPlain);
    const res = { plain: plainItems.join(', '), items: plainItems, checked, v };
    if (domain) res.note = opts.deg ? 'Solutions in [0\u00b0, 360\u00b0), in degrees. Tap "All solutions" for the general answer.' : 'Solutions in [0, 2\u03c0). Tap "All solutions" for the general answer.';
    if (opts.deg) res.unit = '\u00b0';
    if (plainItems.some(p => /sqrt|ln|pi|e\^|\//.test(p))) {
      const dec = [];
      for (const it of items) dec.push(parseFloat(await run(`evalf(${it},6)`)));
      if (dec.every(d => !isNaN(d))) res.decimal = dec.map(d => +d.toFixed(4)).join(', ');
    }
    return res;
  }

  async function noRealAnswer(e, task, deg, t0) {
    let note = 'The result is not a real number (for example the square root or log of a negative number).';
    const m = e.match(/a(sin|cos|sec|csc)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/);
    if (m) {
      const arg = parseFloat(await run(`evalf(${m[2]},6)`));
      const name = 'arc' + m[1];
      note = /sin|cos/.test(m[1])
        ? `${name} only takes inputs from -1 to 1, because sine and cosine are never bigger than 1 or smaller than -1. Here the input is ${isNaN(arg) ? toPlain(m[2]) : +arg.toFixed(4)}, so no angle works.`
        : `${name} only takes inputs of 1 or more, or -1 or less. Here the input is ${isNaN(arg) ? toPlain(m[2]) : +arg.toFixed(4)}.`;
    }
    return { plain: 'No real answer', items: [], pretty: 'No real answer', checked: false, note, task, expr: e, deg,
      steps: [{ k: 'Why', m: note }], ms: Date.now() - t0 };
  }

  async function steps(task, expr, v, result, deg) {
    const out = [];
    try {
      if ((task === 'simplify' || task === 'evaluate') && INV.test(expr) && result.exact) {
        // arcsin(cos(pi/3)): inside first, then the inverse function and its range
        const m = expr.match(/a(sin|cos|tan|sec|csc|cot)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/);
        if (m) {
          const inner = m[2];
          if (/[a-z]/i.test(inner.replace(/sqrt|pi/g, ''))) out.push({ k: 'Work out the inside first', m: `${toPlain(inner)} = ${toPlain(await run(`simplify(${inner})`))}` });
          const ranges = deg ? { sin: '-90\u00b0 to 90\u00b0', cos: '0\u00b0 to 180\u00b0', tan: '-90\u00b0 to 90\u00b0' } : { sin: '-\u03c0/2 to \u03c0/2', cos: '0 to \u03c0', tan: '-\u03c0/2 to \u03c0/2' };
          if (ranges[m[1]]) out.push({ k: `arc${m[1]} always gives an angle from ${ranges[m[1]]}`, m: `arc${m[1]}(${toPlain(await run(`simplify(${inner})`))}) = ${result.exact}${deg ? '\u00b0' : ''}` });
          out.push({ k: 'As a decimal', m: `${result.exact}${deg ? '\u00b0' : ''} \u2248 ${result.plain}${deg ? '\u00b0' : ''}` });
        }
        return out;
      }
      if (task === 'solve' && /=/.test(expr) && !/(<=|>=|<|>)/.test(expr)) {
        const [l, r] = expr.split('=');
        const p = await run(`normal((${l})-(${r ?? 0}))`);
        const isPoly = (await run(`is_polynomial(${p},${v})`)) === 'true';
        if (!isPoly) return out;
        const deg = parseInt(await run(`degree(${p},${v})`), 10);
        if (String(r).trim() !== '0') out.push({ k: 'Move everything to one side', m: toPlain(p) + ' = 0' });
        const f = await run(`factor(${p})`);
        if (f !== p && /\)\*\(|\)\^|^\d+\*\(/.test(f.replace(/\s/g, ''))) {
          out.push({ k: 'Factor', m: toPlain(f) + ' = 0' });
          out.push({ k: 'Set each factor to zero', m: result.items.map(x => `${v} = ${x}`).join('   or   ') });
        } else if (deg === 2) {
          const [a, b, c] = listItems(await run(`coeff(${p},${v})`));
          const d = await run(`simplify((${b})^2-4*(${a})*(${c}))`);
          out.push({ k: 'It does not factor nicely, so use the quadratic formula', m: `a = ${a}, b = ${b}, c = ${c}` });
          out.push({ k: 'Discriminant', m: `b^2 - 4ac = ${toPlain(d)}` });
          const nb = await run(`simplify(-(${b}))`), den = await run(`simplify(2*(${a}))`);
          out.push({ k: 'Plug into x = (-b \u00b1 sqrt(b^2 - 4ac)) / 2a', m: `${v} = (${toPlain(nb)} \u00b1 sqrt(${toPlain(d)})) / ${toPlain(den)}` });
        }
      } else if (task === 'factor') {
        const g = await run(`gcd(coeffs(${expr},${v}))`);
        if (g !== '1' && g !== '-1' && !isErr(g)) out.push({ k: 'Pull out the common factor', m: `${g}(${toPlain(await run(`normal((${expr})/${g})`))})` });
        out.push({ k: 'Factor the rest', m: result.plain });
      } else if (task === 'vertex') {
        out.push({ k: 'Vertex form', m: result.extra });
        out.push({ k: 'Read the vertex (h, k)', m: result.plain });
      }
    } catch (e) { /* steps are optional */ }
    return out;
  }

  // Main entry. problem = { task?, expr, raw?, var?, general?, angle?: 'deg' | 'rad' }
  // One problem at a time: the degree setting lives inside Giac, so two at once could mix it up.
  let lock = Promise.resolve();
  function solveProblem(problem) {
    const job = lock.then(() => solveOne(problem));
    lock = job.catch(() => null);
    return job;
  }
  async function solveOne(problem) {
    const t0 = Date.now();
    const raw = problem.raw || problem.expr || '';
    let task = problem.command ? 'command' : (problem.task || detectTask(raw));
    if (task === 'triangle') return triangleResult(problem, t0);
    if (task === 'convert') return convertResult(problem, t0);
    const wantDeg = !problem.command && (problem.angle === 'deg' || hasDegrees(raw) || hasDegrees(problem.expr));
    // a problem written with pi is in radians (arcsin(cos(pi/3))): work it out in radians, show angles in degrees
    const deg = wantDeg && !(/pi|\u03c0/i.test(raw + ' ' + (problem.expr || '')) && !hasDegrees(raw) && !hasDegrees(problem.expr));
    if (deg) await run('angle_radian:=0');
    try { return await solveCore(problem, task, deg, t0, wantDeg); }
    finally { if (deg) await run('angle_radian:=1'); }
  }

  function triangleResult(problem, t0) {
    let given = parseTriangle(problem.expr);
    if (Object.keys(given).length < 3) given = { ...parseTriangle(problem.raw), ...given };
    const r = solveTriangle(given);
    const plain = triangleAnswer(given, r);
    const sol = r.solutions;
    const ok = sol.length && sol.every(x => Math.abs(x.A + x.B + x.C - 180) < 1e-6 && Math.abs(x.a / Math.sin(x.A * Math.PI / 180) - x.c / Math.sin(x.C * Math.PI / 180)) < 1e-6 * x.a);
    return { plain, items: [plain], pretty: plain, checked: !!ok, checkText: 'angles add to 180\u00b0 and the Law of Sines holds for every side',
      note: sol.length ? (r.method + '. ' + sol.map((x, i) => (sol.length > 1 ? `Triangle ${i + 1}: ` : '') + `a = ${+x.a.toFixed(2)}, b = ${+x.b.toFixed(2)}, c = ${+x.c.toFixed(2)}, A = ${+x.A.toFixed(2)}\u00b0, B = ${+x.B.toFixed(2)}\u00b0, C = ${+x.C.toFixed(2)}\u00b0, area = ${+x.area.toFixed(2)}`).join('; ')) : '',
      steps: r.steps, task: 'triangle', expr: problem.expr, ms: Date.now() - t0 };
  }

  // 150 degrees -> 5pi/6 radians, and 5pi/6 -> 150 degrees
  async function convertResult(problem, t0) {
    const raw = String(problem.raw || problem.expr);
    const toDeg = /\bto\s+degrees?\b|\bin\s+degrees?\b/i.test(raw) || (!hasDegrees(raw) && /pi|\u03c0|rad/i.test(raw));
    const e = normalize(String(problem.expr || raw).replace(/\b(convert|to|into|in|from|radians?|rad|degrees?|deg)\b|\u00b0|[:?]/gi, ' '));
    if (!e || /[a-z]{2,}/i.test(e.replace(/pi/g, ''))) throw new Error('engine');
    const r = await run(`simplify((${e})*${toDeg ? '180/pi' : 'pi/180'})`);
    if (isErr(r)) throw new Error('engine');
    const d = parseFloat(await run(`evalf((${e})*${toDeg ? '180/pi' : 'pi/180'},10)`));
    const plain = toPlain(r);
    const res = { plain, items: [plain], checked: true, checkText: `multiplied by ${toDeg ? '180/\u03c0' : '\u03c0/180'}`, task: 'convert', expr: e,
      note: toDeg ? 'Degrees = radians \u00b7 180/\u03c0' : 'Radians = degrees \u00b7 \u03c0/180', steps: [] };
    if (!isNaN(d) && String(+d.toFixed(4)) !== plain) res.decimal = String(+d.toFixed(4));
    res.pretty = toPretty(plain) + (toDeg ? '\u00b0' : '');
    res.ms = Date.now() - t0;
    return res;
  }

  async function solveCore(problem, task, deg, t0, showDeg = deg) {
    let expr = normalize(problem.command ? problem.expr : extractMath(problem.expr));
    if (!problem.command) {
      const words = (expr.match(/[a-z]{2,}/gi) || []).filter(w => !FUNCS.includes(w) && !['pi', 'and', 'or', 'inf', 'theta'].includes(w));
      if (words.length) throw new Error('engine');
    }
    let v = problem.var || pickVar(expr.replace(/^y\s*=/, ''));
    let res;
    if (task === 'command') {
      const r = await run(problem.command);
      if (isErr(r)) throw new Error('engine');
      const items = listItems(r).map(toPlain);
      res = { plain: items.join(', '), items, checked: false };
    } else if (task === 'solve' || task === 'zeros') {
      if (task === 'zeros' && !/=/.test(expr)) expr = expr.replace(/^y\s*=\s*/, '') + '=0';
      if (!/(<=|>=|!=|<|>|=)/.test(expr)) expr += '=0';
      res = await solveEq(expr, v, { ...problem, deg });
    } else if (task === 'identity') {
      const [L, R] = expr.includes('=') ? expr.split('=') : [expr, '0'];
      const yes = await isIdentity(L, R ?? '0', v);
      res = { plain: yes ? 'True, it is an identity' : 'Not an identity', items: [], checked: yes, checkText: 'both sides are equal for every angle',
        note: yes ? 'The left side simplifies to the right side.' : 'The two sides are different for some angles, so this is not an identity.' };
    } else if (task === 'factor') {
      const e = expr.replace(/=\s*0\s*$/, '');
      let r = await run(`factor(${e})`);
      if (isErr(r)) throw new Error('engine');
      const checked = await isZero(`expand(${r})-(${e})`);
      res = { plain: toPlain(r), items: [toPlain(r)], checked };
      if (r === (await run(`normal(${e})`))) res.note = 'This does not factor over the rational numbers (it is prime).';
    } else if (task === 'expand') {
      const r = await run(`expand(${expr})`);
      if (isErr(r)) throw new Error('engine');
      res = { plain: toPlain(r), items: [toPlain(r)], checked: await isZero(`(${r})-(${expr})`) };
    } else if (task === 'simplify' || task === 'evaluate') {
      const e = expr.replace(/^y\s*=\s*/, '');
      const numeric = !/[a-z]/i.test(e.replace(/sqrt|pi|ln|log10|logb|a?(?:sin|cos|tan|sec|csc|cot)|exp/g, ''));
      if (numeric) {
        // a complex result means there is no real answer (arcsin(3/2), sqrt(-4), log(-1), ...)
        const dv = await run(`evalf(${e},10)`);
        if (/(^|[^a-z])i($|[^a-z])/.test(dv) && !/(^|[^a-z])i($|[^a-z])/.test(e)) return noRealAnswer(e, task, deg, t0);
      }
      let r = await run(`simplify(${e})`);
      if (isErr(r)) throw new Error('engine');
      if (hasTrig(e) && !numeric) {
        const r2 = await run(`trigsimplify(${e})`);
        if (!isErr(r2) && toPlain(r2).length < toPlain(r).length) r = r2;
      }
      res = { plain: toPlain(r), items: [toPlain(r)], checked: await isZero(`(${r})-(${e})`) };
      if (numeric) {
        const d = parseFloat(await run(`evalf(${e},10)`));
        if (INV.test(e) && !isNaN(d)) {
          // inverse trig: the answer line is the decimal, the exact angle is shown under it
          let exact = res.plain, dec = String(+d.toFixed(4));
          let other = parseFloat(await run(deg ? `evalf((${e})*pi/180,10)` : `evalf((${e})*180/pi,10)`));
          if (showDeg && !deg) { // radians inside, degrees out
            const radExact = exact, radDec = d;
            exact = toPlain(await run(`simplify((${e})*180/pi)`)); dec = String(+other.toFixed(4)); other = radDec;
            res.radExact = radExact;
          }
          const inDeg = deg || showDeg;
          res.plain = dec; res.items = [dec]; res.exact = exact;
          if (inDeg) res.unit = '\u00b0';
          res.note = inDeg ? `Exact: ${exact}\u00b0, which is ${+other.toFixed(4)} radians.` : `Exact: ${exact} radians, which is ${+other.toFixed(4)}\u00b0.`;
        } else if (!isNaN(d) && String(+d.toFixed(6)) !== res.plain) res.decimal = String(+d.toFixed(6));
      }
    } else if (task === 'vertex') {
      const e = expr.replace(/^[a-z]\s*(\([a-z]\))?\s*=\s*/i, '');
      const c = listItems(await run(`coeff(${e},${v})`));
      if (c.length !== 3) throw new Error('engine');
      const h = await run(`simplify(-(${c[1]})/(2*(${c[0]})))`);
      const k = await run(`simplify(subst(${e},${v}=${h}))`);
      const form = await run(`canonical_form(${e})`);
      res = { plain: `(${toPlain(h)}, ${toPlain(k)})`, items: [toPlain(h), toPlain(k)], checked: true, extra: 'y = ' + toPlain(form),
        note: 'Vertex form: y = ' + toPlain(form) };
    } else if (task === 'divide') {
      const parts = expr.split(/\s*(?:\/|\bby\b|\u00f7)\s*(?![^(]*\))/);
      let [p, q] = parts.length >= 2 ? [parts[0], parts.slice(1).join('/')] : [expr, ''];
      p = stripParens(p); q = stripParens(q);
      const quo = await run(`quo(${p},${q},${v})`), rem = await run(`rem(${p},${q},${v})`);
      if (isErr(quo)) throw new Error('engine');
      const plain = rem === '0' ? toPlain(quo) : `${toPlain(quo)} + (${toPlain(rem)})/(${toPlain(q)})`;
      res = { plain, items: [toPlain(quo)], checked: await isZero(`(${quo})*(${q})+(${rem})-(${p})`), note: `Quotient ${toPlain(quo)}, remainder ${toPlain(rem)}` };
    } else if (task === 'domain') {
      const e = expr.replace(/^[a-z]\s*(\([a-z]\))?\s*=\s*/i, '');
      const r = await run(`domain(${e},${v})`);
      if (isErr(r)) throw new Error('engine');
      const iv = toInterval([r], v);
      res = { plain: iv || toPlain(r), items: [toPlain(r)], checked: false, note: iv ? 'Interval notation' : '' };
    } else if (task === 'inverse') {
      const e = expr.replace(/^[a-z]\s*(\([a-z]\))?\s*=\s*/i, '');
      const r = await run(`solve(y=${e},${v})`);
      const items = listItems(r);
      if (!items.length || isErr(r)) throw new Error('engine');
      const inv = await run(`simplify(subst(${items[0]},y=${v}))`);
      res = { plain: toPlain(inv), items: [toPlain(inv)], checked: await isZero(`simplify(subst(${e},${v}=${inv}))-${v}`), note: 'f\u207b\u00b9(x) = ' + toPlain(inv) };
    } else {
      throw new Error('engine');
    }
    res.task = task; res.expr = expr; res.v = v; res.deg = deg;
    res.pretty = res.unit && res.items.length ? res.items.map(x => toPretty(x) + res.unit).join(', ') : toPretty(res.plain);
    res.steps = await steps(task, expr, v, res, deg || showDeg);
    res.ms = Date.now() - t0;
    return res;
  }

  return { solveProblem, run };
}
