// The Solve panel: read the problem, solve it with the math engine, check it, show the answer line.
import { solver, warmEngine, engineState } from './engine.js';
import { detectTask, extractMath, TASKS } from './mathengine.js';
import { readProblem, explainSteps, hasKeys } from './gemini.js';
import { addMistake, getSettings, saveSettings } from './store.js';
import { h, toast, I, esc } from './ui.js';

let panel = null, state = null;
const cache = new Map();

let onClosed = null; // the editor's hook, e.g. to remove the Solve box from the page

let popRO = null;

export function closeSolve() {
  if (popRO) { popRO.disconnect(); popRO = null; }
  if (panel) { panel.remove(); panel = null; state = null; }
  const ed = document.getElementById('editor'); if (ed) ed.classList.remove('solving');
  const cb = onClosed; onClosed = null; if (cb) cb();
}

const looksMath = (t) => /[0-9a-z]/i.test(t) && /[=+\-*/^<>()]|\d[a-z]/i.test(t);

export async function openSolve(ctx) {
  const settings = await getSettings();
  closeSolve();
  onClosed = ctx.onClose || null;
  const ed = document.getElementById('editor');
  const pop = typeof ctx.anchor === 'function'; // a box Solve: small answer card next to the box
  panel = h(`<aside id="solve" class="${pop ? 'pop' : ''}" aria-label="Solve">
    <div class="solve-head"><b style="display:flex;align-items:center;gap:8px;font-size:20px;letter-spacing:-.02em">${I.spark(20)} Solve</b>
      <div class="row" style="gap:6px"><button class="btn sm press" id="sMore">Details</button>
      <button class="icon soft press" id="sClose" aria-label="Close" style="width:34px;height:34px">${I.close()}</button></div></div>
    <div class="solve-body">
      <div class="read">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="eyebrow" id="sSrc">Problem</span>
          <div class="angseg" id="sAng" role="group" aria-label="Angle unit"><button data-ang="rad">Rad</button><button data-ang="deg">Deg</button></div></div>
        <input id="sIn" placeholder="Type a problem, e.g. x^2-4x-5=0" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text">
        <div class="taskchips" id="sTasks">${['solve', 'factor', 'simplify', 'expand', 'triangle', 'vertex', 'divide', 'domain', 'inverse'].map(t => `<button data-task="${t}">${TASKS[t]}</button>`).join('')}</div>
        <span class="sub" style="font-size:12px" id="sHint"></span>
      </div>
      <div id="sOut"></div>
    </div></aside>`);
  ed.appendChild(panel);
  ed.classList.add('solving');
  const shiftPage = () => {
    // slide the page left just enough to stay visible next to the panel
    const pg = ed.querySelector('.page');
    if (pg && window.innerWidth >= 900) {
      const r = pg.getBoundingClientRect(), panelLeft = window.innerWidth - 16 - 410;
      const shift = Math.min(Math.max(0, r.left - 16), Math.max(0, r.right - panelLeft + 16));
      ed.style.setProperty('--solve-shift', -shift + 'px');
    }
  };
  if (pop) {
    ed.style.setProperty('--solve-shift', '0px');
    const place = () => placePop(panel, ctx.anchor());
    place();
    if (window.ResizeObserver) { popRO = new ResizeObserver(place); popRO.observe(panel); }
  } else shiftPage();
  panel.querySelector('#sMore').onclick = () => {
    if (popRO) { popRO.disconnect(); popRO = null; }
    panel.classList.remove('pop'); panel.style.left = ''; panel.style.top = '';
    shiftPage();
  };
  state = { ctx, task: null, raw: '', t0: Date.now(), source: '', angle: settings.solveAngle === 'deg' ? 'deg' : 'rad' };
  const markAngle = () => panel.querySelectorAll('[data-ang]').forEach(b => b.classList.toggle('on', b.dataset.ang === state.angle));
  markAngle();
  panel.querySelectorAll('[data-ang]').forEach(b => b.onclick = async () => {
    if (state.angle === b.dataset.ang) return;
    state.angle = b.dataset.ang; markAngle();
    saveSettings({ solveAngle: state.angle });
    if (state.last) run({ ...state.last, task: state.last.task });
  });
  panel.querySelector('#sClose').onclick = closeSolve;
  const inp = panel.querySelector('#sIn');
  let deb = 0;
  inp.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => run({ expr: inp.value, raw: inp.value, source: 'typed' }), 650); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(deb); run({ expr: inp.value, raw: inp.value, source: 'typed' }); inp.blur(); } });
  panel.querySelectorAll('[data-task]').forEach(b => b.onclick = () => {
    state.task = state.userTask = b.dataset.task; markTask();
    if (state.task === 'triangle') setHint('Type the 3 values you know, like a=7, b=9, C=40. Sides a, b, c; angles A, B, C in degrees (A is across from a).');
    run({ expr: inp.value, raw: inp.value, source: state.source || 'typed', task: state.task }); });
  warmEngine();

  if (!ctx.sel) { setHint('Tap Solve and drag a box over a problem, or type one above.'); inp.focus(); return; }
  if (pop) setSrc('Reading the box...', true);
  // 1) printed text from the PDF: instant, no AI
  const txt = ctx.text();
  const keys = await hasKeys();
  if (txt && looksMath(txt) && (!ctx.hasInk() || ctx.preferText)) {
    const lines = txt.split('\n');
    const mathLine = lines.filter(looksMath).sort((a, b) => (b.match(/[=<>]/) ? 1 : 0) - (a.match(/[=<>]/) ? 1 : 0))[0] || txt;
    const task = detectTask(txt);
    const expr = extractMath(mathLine);
    inp.value = expr; state.source = 'pdf';
    const ok = await run({ expr, raw: txt, task, source: 'pdf' });
    if (ok || !keys) return;
  }
  // 2) handwriting, a photo, or text the engine could not parse: one fast Gemini read
  if (keys) {
    setSrc(`Reading ${ctx.hasInk() ? 'your handwriting' : 'the problem'}...`, true);
    try {
      const img = await ctx.image();
      const r = await readProblem({ imageB64: img, text: txt });
      const j = r.json || {};
      inp.value = j.giac && j.task === 'word' ? (j.problem || j.expr || '') : (j.expr || j.problem || '');
      state.source = 'ai'; state.aiMs = r.ms; state.model = r.model;
      await run({ expr: j.expr || j.problem || '', raw: j.problem || '', task: j.task === 'word' ? null : j.task, command: j.task === 'word' ? j.giac : null, var: j.var, source: 'ai', problemText: j.problem });
    } catch (e) {
      setSrc('Problem');
      setHint(e.message === 'no keys' ? '' : 'Could not read it right now (' + e.message + '). Type it above and Solve still works.');
      if (txt) { inp.value = extractMath(txt); run({ expr: inp.value, raw: txt, source: 'pdf' }); }
      else inp.focus();
    }
  } else {
    if (txt) { inp.value = extractMath(txt); run({ expr: inp.value, raw: txt, source: 'pdf' }); }
    setSrc('Problem');
    setHint(ctx.hasInk() ? 'To read handwriting, add Gemini keys in Settings. For now, type the problem above.' : 'Type the problem above.');
    if (!txt) inp.focus();
  }
}

// Put the answer card beside the box (right, else left, else below or above), inside the screen.
function placePop(el, r) {
  if (!el || !r || window.innerWidth < 760) return; // phones: CSS makes it a small bottom sheet
  const pw = el.offsetWidth, ph = el.offsetHeight, W = window.innerWidth, H = window.innerHeight, g = 14;
  const clampY = (y) => Math.max(76, Math.min(H - ph - 12, y));
  const clampX = (x) => Math.max(12, Math.min(W - pw - 12, x));
  let left, top;
  if (r.right + g + pw <= W - 12) { left = r.right + g; top = clampY(r.top); }
  else if (r.left - g - pw >= 12) { left = r.left - g - pw; top = clampY(r.top); }
  else if (r.bottom + g + ph <= H - 12) { left = clampX(r.left); top = r.bottom + g; }
  else { left = clampX(r.left); top = clampY(r.top - g - ph); }
  el.style.left = left + 'px'; el.style.top = top + 'px';
}

function setSrc(t, busy) { if (!panel) return; panel.querySelector('#sSrc').innerHTML = (busy ? '<span class="spinner" style="width:12px;height:12px;vertical-align:-1px;margin-right:6px"></span>' : '') + esc(t); }
function setHint(t) { if (panel) panel.querySelector('#sHint').textContent = t || ''; }
function markTask() { if (panel) panel.querySelectorAll('[data-task]').forEach(b => b.classList.toggle('on', b.dataset.task === state.task)); }

async function run(p) {
  if (!panel || !p.expr || !p.expr.trim()) return false;
  const out = panel.querySelector('#sOut');
  // a chip you tapped wins; otherwise guess from this problem (not from the last one)
  const task = p.task || state.userTask || detectTask(p.raw || p.expr);
  state.task = task; markTask();
  setSrc(p.source === 'pdf' ? 'Read from the page' : p.source === 'ai' ? 'Read with AI, check it matches' : 'Problem');
  if (engineState.status !== 'ready') out.innerHTML = `<div class="row sub" style="font-size:14px;padding:8px 2px"><span class="spinner"></span>Starting the math engine (first time only)...</div>`;
  const key = task + '|' + p.expr + '|' + (p.command || '') + '|' + (p.general ? 1 : 0) + '|' + state.angle;
  const t0 = performance.now();
  let res;
  try {
    res = cache.get(key) || await solver.solveProblem({ expr: p.expr, raw: p.raw, task, command: p.command, var: p.var, general: p.general, angle: state.angle });
    cache.set(key, res);
  } catch (e) {
    out.innerHTML = `<div class="warnline" style="padding:6px 2px">${I.mistake(16)} The engine could not work with that. Check the problem above (use ^ for powers, * between things), or pick a different task.</div>`;
    return false;
  }
  if (!panel) return false;
  const engineMs = performance.now() - t0;
  state.last = { ...p, task, res };
  out.innerHTML = `
    <div class="answer">
      <span class="eyebrow" style="color:var(--on);opacity:.8">Answer line</span>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="big${res.pretty.length > 22 ? ' long' : ''}">${esc(res.pretty)}</span><button class="copy press" id="sCopy">Copy</button></div>
      ${res.decimal ? `<span style="font-size:14px;opacity:.85">About ${esc(res.decimal)}</span>` : ''}
    </div>
    ${res.checked ? `<div class="okline">${I.check(15, 3)} Checked: ${res.checkText || (task === 'solve' ? 'every answer works in the original problem' : 'it matches the original exactly')}</div>`
      : !(res.items && res.items.length) ? '' : `<div class="sub" style="font-size:13px;font-weight:600">${p.command ? 'Computed by the math engine from the AI\'s setup. Check the setup matches the question.' : 'Exact result from the math engine.'}</div>`}
    ${res.note ? `<div class="sub" style="font-size:13px">${esc(res.note)}</div>` : ''}
    ${/Solutions in \[0/.test(res.note || '') ? `<button class="btn sm press" id="sGeneral" style="align-self:flex-start">All solutions</button>` : ''}
    <button class="btn press" id="sSteps" style="height:46px">${res.steps.length ? 'Show steps' : 'Explain steps with AI'}</button>
    <div id="sStepList" style="display:flex;flex-direction:column;gap:10px"></div>
    <div class="row"><button class="btn grow press" id="sMistake">Save to Mistakes</button></div>
    <div class="speed">${speedLine(engineMs, p.source)}</div>`;
  out.querySelector('#sCopy').onclick = async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(res.plain); btn.textContent = 'Copied'; } catch (err) { toast(res.plain); }
  };
  const g = out.querySelector('#sGeneral');
  if (g) g.onclick = () => run({ ...p, general: true });
  out.querySelector('#sSteps').onclick = async (ev) => {
    const e = { currentTarget: ev.currentTarget };
    const list = out.querySelector('#sStepList');
    if (list.childElementCount) { list.innerHTML = ''; e.currentTarget.textContent = res.steps.length ? 'Show steps' : 'Explain steps with AI'; return; }
    let steps = res.steps;
    if (!steps.length) {
      if (!(await hasKeys())) { toast('Add Gemini keys in Settings for AI explanations'); return; }
      e.currentTarget.innerHTML = '<span class="spinner"></span> Explaining...';
      try { const r = await explainSteps(p.problemText || p.raw || p.expr, res.plain); steps = (r.json.steps || []).map(s => ({ k: s.k, m: s.m, ai: true })); }
      catch (err) { e.currentTarget.textContent = 'Explain steps with AI'; toast('AI is busy, try again in a moment'); return; }
    }
    list.innerHTML = steps.map((s, i) => `<div class="step" style="animation-delay:${i * 0.06}s"><b class="n">${i + 1}</b><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="eyebrow">${esc(s.k)}</span>${s.m ? `<span class="math">${esc(s.m)}</span>` : ''}</div></div>`).join('') + (steps[0] && steps[0].ai ? '<span class="sub" style="font-size:12px">Steps written by AI. The answer above is from the math engine.</span>' : '');
    e.currentTarget.textContent = 'Hide steps';
  };
  out.querySelector('#sMistake').onclick = async (ev) => {
    const e = { currentTarget: ev.currentTarget };
    const c = state.ctx;
    await addMistake({ classId: c.nb.classId, notebookId: c.nb.id, pageId: c.page && c.page.id, problem: p.problemText || p.expr, answer: res.plain, task, expr: p.expr });
    e.currentTarget.textContent = 'Saved to Mistakes'; e.currentTarget.disabled = true;
  };
  return true;
}

function speedLine(ms, source) {
  const s = (ms / 1000).toFixed(ms < 100 ? 2 : 1) + ' s';
  if (source === 'pdf') return `${s}. Read from the PDF and solved by the math engine, no AI.`;
  if (source === 'ai') return `Read with AI in ${((state.aiMs || 0) / 1000).toFixed(1)} s, solved by the math engine in ${s}.`;
  return `Solved by the math engine in ${s}.`;
}
