// Gemini calls with "hedging": if the first model is slow or busy, a second
// model starts after a few seconds and the first good answer wins.
import { getSettings, DEFAULT_MODELS } from './store.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
let keyIdx = Math.floor(Math.random() * 1000);

export async function hasKeys() { const s = await getSettings(); return !!(s.keys && s.keys.length); }

async function attempt(model, parts, keys, signal, temperature = 0) {
  let lastErr = 'busy';
  for (let k = 0; k < Math.min(3, keys.length); k++) {
    const key = keys[(keyIdx++) % keys.length];
    let res;
    try {
      res = await fetch(API + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature } })
      });
    } catch (e) { if (signal.aborted) throw e; lastErr = 'network'; continue; }
    if (res.status === 429) { lastErr = 'rate limit'; continue; }      // that key is out for now, try another
    if (!res.ok) throw new Error(res.status === 503 ? 'busy' : res.status === 404 ? 'model not found' : 'error ' + res.status);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    try { return JSON.parse(text.replace(/^```json\s*|```\s*$/g, '')); } catch (e) { throw new Error('bad reply'); }
  }
  throw new Error(lastErr);
}

export async function askGemini(parts, { stagger = 3000, total = 25000, temperature = 0 } = {}) {
  const s = await getSettings();
  const keys = s.keys || [];
  if (!keys.length) throw new Error('no keys');
  const models = (s.models && s.models.length ? s.models : DEFAULT_MODELS).slice(0, 4);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const ctrls = []; let launched = 0, failed = 0, done = false; const errs = [];
    const finish = (fn, v) => { if (done) return; done = true; ctrls.forEach(c => c.abort()); clearTimeout(timer); timers.forEach(clearTimeout); fn(v); };
    const launch = () => {
      if (done || launched >= models.length) return;
      const model = models[launched++];
      const c = new AbortController(); ctrls.push(c);
      attempt(model, parts, keys, c.signal, temperature)
        .then(json => finish(resolve, { json, model, ms: Date.now() - t0 }))
        .catch(e => { if (done) return; errs.push(model + ': ' + e.message); failed++; if (launched < models.length) launch(); else if (failed >= launched) finish(reject, new Error(errs.join('; '))); });
    };
    const timers = [];
    launch();
    for (let i = 1; i < models.length; i++) timers.push(setTimeout(launch, stagger * i));
    const timer = setTimeout(() => finish(reject, new Error('timed out')), total);
  });
}

const READ_PROMPT = `You read ONE math problem from a student's worksheet (printed text and/or handwriting).
Return JSON only, with these keys:
"problem": the problem as a short readable line,
"task": one of solve, factor, simplify, expand, evaluate, vertex, divide, domain, inverse, zeros, identity, convert, triangle, word,
"expr": the math in plain calculator syntax: ^ for powers, * for multiply, sqrt(), abs(), log() is base 10, ln(), logb(x,b) for other bases, pi. For a system, separate the equations with a comma. For divide use (p)/(q).
"var": the variable to solve for (usually x),
Trig: write inverse trig as asin(), acos(), atan() (also for arcsin and sin^-1); keep the degree sign on angles in degrees, like sin(30°).
For a triangle (Law of Sines or Cosines) use task triangle and write expr like "a=7, b=9, C=40": sides a, b, c and angles A, B, C in degrees, where side a is across from angle A (side AB is c, BC is a, AC is b).
For "verify/prove the identity" use task identity with both sides, like "tan(x)*cos(x)=sin(x)". For changing degrees to radians or back use task convert, like "150° to radians".
"giac": ONLY when task is word: one Giac/Xcas command that computes the final answer (for example solve(-16*t^2+32*t+6=0,t) or fMax(-16*t^2+32*t+6,t)); otherwise "".
"work": if the student already wrote some work, a short summary of it; otherwise "".
Copy every number and sign exactly. Do not solve the problem yourself.`;

export async function readProblem({ imageB64, text }) {
  const parts = [{ text: READ_PROMPT + (text ? `\nPrinted text found in the selection (may be missing exponents): ${text}` : '') }];
  if (imageB64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageB64 } });
  return askGemini(parts);
}

export async function explainSteps(problem, answer) {
  const parts = [{ text: `Explain how to solve this high school precalculus problem in 2 to 5 short steps for a student.
Problem: ${problem}
The correct answer (already checked by a math engine, do not change it): ${answer}
Return JSON only: {"steps":[{"k":"what to do in a few words","m":"the math for that step in plain text"}]}. Use ^ for powers and sqrt() for roots. No LaTeX.` }];
  return askGemini(parts, { stagger: 4000, total: 30000 });
}

// New practice problems like a saved mistake (a little randomness so each round is different).
export async function makePractice(prompt) {
  return askGemini([{ text: prompt }], { stagger: 4000, total: 30000, temperature: 0.9 });
}
