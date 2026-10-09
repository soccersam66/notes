// Solve a triangle with the Law of Sines and the Law of Cosines (angles in degrees).
// Side a is opposite angle A, b opposite B, c opposite C. Pure functions, tested in Node.

const R = Math.PI / 180;
const sinD = (x) => Math.sin(x * R), cosD = (x) => Math.cos(x * R);
const asinD = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / R, acosD = (x) => Math.acos(Math.max(-1, Math.min(1, x))) / R;
export const fmt = (x, dp = 2) => String(+x.toFixed(dp));
const SIDES = ['a', 'b', 'c'], ANGLES = ['A', 'B', 'C'];
const opp = (L) => L.toLowerCase(); // side opposite an angle

// "a = 7, b = 9.5, C = 40°", "angle A = 30", "side c is 12", "AB = 5", "m∠B = 70" -> { a: 7, b: 9.5, C: 40 }
export function parseTriangle(text) {
  const t = String(text || '').replace(/∠/g, ' angle ').replace(/\bm\s*angle\b/gi, ' angle ').replace(/[≈≅]/g, '=');
  const out = {};
  const num = '(-?\\d+(?:\\.\\d+)?)';
  // segment names: AB is the side opposite C, and so on
  for (const m of t.matchAll(new RegExp('\\b([ABC])([ABC])\\s*(?:=|is)\\s*' + num, 'g'))) {
    if (m[1] === m[2]) continue;
    const third = ANGLES.find(L => L !== m[1] && L !== m[2]);
    out[opp(third)] = parseFloat(m[3]);
  }
  // three-letter angle names: angle BAC is angle A
  for (const m of t.matchAll(new RegExp('angle\\s+([ABC])([ABC])([ABC])\\s*(?:=|is)\\s*' + num, 'gi'))) out[m[2].toUpperCase()] = parseFloat(m[4]);
  for (const m of t.matchAll(new RegExp('(angle\\s+|side\\s+)?\\b([abcABC])\\s*(?:=|is|:)\\s*' + num + '\\s*(\\u00b0|degrees?\\b|deg\\b)?', 'g'))) {
    const pre = (m[1] || '').toLowerCase(), L = m[2], v = parseFloat(m[3]), degSign = !!m[4];
    const before = t.slice(Math.max(0, m.index - 1), m.index);
    if (/[A-Za-z]/.test(before)) continue; // part of AB = 5 (handled above)
    if (pre.startsWith('angle') || degSign) out[L.toUpperCase()] = v;
    else if (pre.startsWith('side')) out[L.toLowerCase()] = v;
    else out[L] = v;
  }
  return out;
}

export const looksLikeTriangle = (text) => {
  if (/law of (sines|cosines)|triangle/i.test(text)) return true;
  return Object.keys(parseTriangle(text)).length >= 3;
};

// Returns { solutions: [{a,b,c,A,B,C,area}], steps: [{k,m}], method, error? }
export function solveTriangle(given) {
  const k = {}; for (const L of [...SIDES, ...ANGLES]) if (typeof given[L] === 'number' && isFinite(given[L])) k[L] = given[L];
  const s = SIDES.filter(L => L in k), a = ANGLES.filter(L => L in k);
  const steps = [];
  const fail = (error) => ({ solutions: [], steps, error });
  if (s.length + a.length < 3) return fail('Give 3 values: sides a, b, c and angles A, B, C (in degrees), for example a=7, b=9, C=40.');
  if (!s.length) return fail('Three angles only fix the shape, not the size. Give at least one side.');
  for (const L of s) if (!(k[L] > 0)) return fail(`Side ${L} must be a positive number.`);
  for (const L of a) if (!(k[L] > 0 && k[L] < 180)) return fail(`Angle ${L} must be between 0° and 180°.`);
  const angSum = a.reduce((x, L) => x + k[L], 0);
  if (a.length >= 2 && (a.length === 2 ? angSum >= 180 : Math.abs(angSum - 180) > 0.01)) return fail(`The angles add to ${fmt(angSum)}°, but a triangle's angles add to 180°.`);

  const done = (t, method) => {
    t.area = 0.5 * t.a * t.b * sinD(t.C);
    return t;
  };
  const sol = [];
  let method;
  if (a.length >= 2) {
    // ASA or AAS: third angle, then Law of Sines
    method = 'Law of Sines';
    const t = { ...k };
    if (a.length === 2) {
      const L = ANGLES.find(x => !(x in t)); t[L] = 180 - angSum;
      steps.push({ k: 'Angles add to 180°', m: `${L} = 180° - ${a.map(x => fmt(k[x]) + '°').join(' - ')} = ${fmt(t[L])}°` });
    }
    const known = s[0], ratio = k[known] / sinD(t[known.toUpperCase()]);
    steps.push({ k: 'Law of Sines', m: `${known} / sin ${known.toUpperCase()} = ${fmt(k[known])} / sin ${fmt(t[known.toUpperCase()])}° = ${fmt(ratio, 4)}` });
    for (const L of SIDES) if (!(L in t)) {
      t[L] = ratio * sinD(t[L.toUpperCase()]);
      steps.push({ k: `Find ${L}`, m: `${L} = ${fmt(ratio, 4)} · sin ${fmt(t[L.toUpperCase()])}° = ${fmt(t[L])}` });
    }
    sol.push(done(t));
  } else if (s.length === 3) {
    // SSS: Law of Cosines for every angle
    method = 'Law of Cosines';
    const [x, y, z] = [k.a, k.b, k.c].sort((p, q) => p - q);
    if (x + y <= z) return fail(`No triangle: ${fmt(x)} + ${fmt(y)} is not more than ${fmt(z)} (the two shorter sides must add to more than the longest).`);
    const t = { ...k };
    for (const L of ANGLES) {
      const o = opp(L), [p, q] = SIDES.filter(x => x !== o);
      t[L] = acosD((t[p] ** 2 + t[q] ** 2 - t[o] ** 2) / (2 * t[p] * t[q]));
      steps.push({ k: `Law of Cosines for ${L}`, m: `cos ${L} = (${p}² + ${q}² - ${o}²) / (2${p}${q}) = (${fmt(t[p])}² + ${fmt(t[q])}² - ${fmt(t[o])}²) / (2 · ${fmt(t[p])} · ${fmt(t[q])}), so ${L} = ${fmt(t[L])}°` });
    }
    sol.push(done(t));
  } else if (s.length === 2) {
    const ang = a[0], angOpp = opp(ang);
    if (!s.includes(angOpp)) {
      // SAS: the angle is between the two sides
      method = 'Law of Cosines';
      const t = { ...k }, [p, q] = s;
      t[angOpp] = Math.sqrt(k[p] ** 2 + k[q] ** 2 - 2 * k[p] * k[q] * cosD(k[ang]));
      steps.push({ k: `Law of Cosines for side ${angOpp}`, m: `${angOpp}² = ${p}² + ${q}² - 2${p}${q} cos ${ang} = ${fmt(k[p])}² + ${fmt(k[q])}² - 2 · ${fmt(k[p])} · ${fmt(k[q])} · cos ${fmt(k[ang])}°, so ${angOpp} = ${fmt(t[angOpp])}` });
      for (const L of ANGLES) if (L !== ang) {
        const o = opp(L), [m1, m2] = SIDES.filter(x => x !== o);
        t[L] = acosD((t[m1] ** 2 + t[m2] ** 2 - t[o] ** 2) / (2 * t[m1] * t[m2]));
      }
      const [L1, L2] = ANGLES.filter(L => L !== ang);
      steps.push({ k: `Law of Cosines for ${L1}, then angles add to 180°`, m: `${L1} = ${fmt(t[L1])}°, ${L2} = ${fmt(t[L2])}°` });
      sol.push(done(t));
    } else {
      // SSA: the ambiguous case
      method = 'Law of Sines (ambiguous case, SSA)';
      const other = s.find(x => x !== angOpp), O = other.toUpperCase();
      const sinO = k[other] * sinD(k[ang]) / k[angOpp];
      steps.push({ k: 'Law of Sines', m: `sin ${O} = ${other} · sin ${ang} / ${angOpp} = ${fmt(k[other])} · sin ${fmt(k[ang])}° / ${fmt(k[angOpp])} = ${fmt(sinO, 4)}` });
      if (sinO > 1 + 1e-9) {
        steps.push({ k: 'Sine cannot be more than 1', m: 'So no triangle has these measurements.' });
        return { solutions: [], steps, method, error: `No triangle: sin ${O} would be ${fmt(sinO, 4)}, more than 1.` };
      }
      const o1 = Math.abs(sinO - 1) < 1e-9 ? 90 : asinD(sinO), cands = [o1];
      if (Math.abs(o1 - 90) > 1e-4) cands.push(180 - o1); // exactly 90 degrees gives just one (right) triangle
      for (const oAng of cands) {
        if (k[ang] + oAng >= 180 - 1e-9) continue;
        const t = { ...k }; t[O] = oAng;
        const L3 = ANGLES.find(x => x !== ang && x !== O);
        t[L3] = 180 - k[ang] - oAng;
        t[opp(L3)] = k[angOpp] * sinD(t[L3]) / sinD(k[ang]);
        sol.push(done(t));
      }
      steps.push({ k: sol.length === 2 ? `Two possible angles for ${O} (${fmt(o1)}° and 180° - ${fmt(o1)}° = ${fmt(180 - o1)}°), both fit` : `${O} = ${fmt(sol[0] ? sol[0][O] : o1)}° (the other choice, ${fmt(180 - o1)}°, makes the angles add to more than 180°)`,
        m: sol.map((t, i) => `${sol.length > 1 ? 'Triangle ' + (i + 1) + ': ' : ''}${ANGLES.filter(x => x !== ang && x !== O)[0]} = ${fmt(t[ANGLES.filter(x => x !== ang && x !== O)[0]])}°, ${opp(ANGLES.filter(x => x !== ang && x !== O)[0])} = ${fmt(t[opp(ANGLES.filter(x => x !== ang && x !== O)[0])])}`).join('; ') });
      if (!sol.length) return { solutions: [], steps, method, error: 'No triangle fits these measurements.' };
    }
  } else {
    return fail('Give at least 3 values, including a side.');
  }
  steps.push({ k: 'Area', m: sol.map((t, i) => `${sol.length > 1 ? 'Triangle ' + (i + 1) + ': ' : ''}(1/2)ab sin C = ${fmt(t.area)}`).join('; ') });
  return { solutions: sol, steps, method };
}

// The answer line: the values you did not give, rounded.
export function triangleAnswer(given, res, dp = 2) {
  if (res.error) return res.error;
  const unknown = [...SIDES, ...ANGLES].filter(L => !(L in given));
  const one = (t) => unknown.map(L => `${L} = ${fmt(t[L], dp)}${ANGLES.includes(L) ? '°' : ''}`).join(', ');
  return res.solutions.length === 1 ? one(res.solutions[0]) : res.solutions.map((t, i) => `Triangle ${i + 1}: ${one(t)}`).join('; ');
}
