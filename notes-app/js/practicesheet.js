// Practice sheet: Gemini writes 3 to 5 new problems like a saved mistake, the math engine solves
// them on the iPad, Sam types each answer and the engine checks it. Every answer is saved on the mistake.
import { solver, warmEngine, evalCmd } from './engine.js';
import { makePractice, hasKeys } from './gemini.js';
import { practicePrompt, parseProblems, checkAnswer, answerHint, mistakeTask, summarize } from './practice.js';
import { toPretty, TASKS } from './mathengine.js';
import { getSettings, savePractice } from './store.js';
import { uid } from './db.js';
import { sheet, I, esc } from './ui.js';

const MIN = 3;

export async function openPractice(m, onDone) {
  let closed = false, el = null, close = null;
  close = sheet(`<div class="row" style="justify-content:space-between"><h3 style="display:flex;align-items:center;gap:8px">${I.spark(18)} Practice</h3>
      <button class="icon soft press" data-x aria-label="Close" style="width:40px;height:40px">${I.close()}</button></div>
    <div id="pr" class="practice"></div>`, (e) => { el = e; });
  el.querySelector('[data-x]').onclick = () => close();
  const bd = el.parentElement;
  const mo = new MutationObserver(() => { if (!bd.isConnected) { mo.disconnect(); closed = true; if (onDone) onDone(); } });
  mo.observe(document.body, { childList: true });
  const box = el.querySelector('#pr');
  const task = mistakeTask(m);

  if (!(await hasKeys())) {
    box.innerHTML = `<p class="sub" style="margin:0">Practice needs a Gemini key to write new problems. Add one in Settings (gear, top right), then try again. Checking your answers stays on this iPad.</p>
      <button class="btn big acc press" data-ok>OK</button>`;
    box.querySelector('[data-ok]').onclick = () => close();
    return;
  }

  const load = async () => {
    box.innerHTML = `<div class="pr-load"><span class="spinner"></span><div><b>Making problems like this one</b><div class="math sub" style="font-size:16px;margin-top:4px">${esc(toPretty(m.problem))}</div></div></div>`;
    warmEngine();
    const settings = await getSettings();
    const angle = settings.solveAngle === 'deg' ? 'deg' : 'rad';
    let probs = [];
    try {
      const r = await makePractice(practicePrompt(m, 5, Math.floor(Math.random() * 10000)));
      probs = parseProblems(r.json, m);
    } catch (e) { if (!closed) failed('Could not reach Gemini right now (' + e.message + ').'); return; }
    // the engine solves each one here; a problem it cannot solve is dropped
    const ready = [];
    for (const p of probs) {
      if (closed) return;
      try {
        const res = await solver.solveProblem({ expr: p.expr, raw: p.problem, task: p.task, angle });
        if (res && res.plain && !/^No real answer$/.test(res.plain)) ready.push({ ...p, res });
      } catch (e) { /* skip it */ }
    }
    if (closed) return;
    if (ready.length < MIN) { failed('The problems that came back were not ones the math engine could check.'); return; }
    run(ready);
  };
  const failed = (why) => {
    box.innerHTML = `<p class="sub" style="margin:0">${esc(why)} Try again in a moment.</p>
      <div class="row"><button class="btn big grow press" data-x2>Close</button><button class="btn big acc grow press" data-again>Try again</button></div>`;
    box.querySelector('[data-x2]').onclick = () => close();
    box.querySelector('[data-again]').onclick = load;
  };

  const run = (probs) => {
    const round = { id: uid(), at: Date.now(), task, items: probs.map(p => ({ problem: p.problem, answer: p.res.plain, given: '', ok: false, checked: false })) };
    let i = 0;
    const save = () => { Object.assign(round, summarize(round.items)); return savePractice(m.id, round).catch(() => {}); };
    const show = () => {
      const p = probs[i], it = round.items[i];
      box.innerHTML = `
        <div class="pr-dots">${probs.map((_, j) => `<i class="${j < i ? (round.items[j].ok ? 'ok' : 'bad') : j === i ? 'now' : ''}"></i>`).join('')}</div>
        <div class="row" style="justify-content:space-between"><span class="eyebrow">Problem ${i + 1} of ${probs.length}</span><span class="chip">${esc(TASKS[p.task] || p.task)}</span></div>
        <div class="pr-q math">${esc(toPretty(p.problem))}</div>
        <div class="field"><input id="prIn" placeholder="Your answer" autocomplete="off" autocapitalize="off" spellcheck="false" data-noautofocus="1">
          <span class="sub" style="font-size:12px">${esc(answerHint(p.task, p.res))}</span></div>
        <div id="prOut"></div>
        <div class="row"><button class="btn big grow press" id="prShow">Show answer</button><button class="btn big acc grow press" id="prCheck">Check</button></div>`;
      const inp = box.querySelector('#prIn'), out = box.querySelector('#prOut');
      const checkBtn = box.querySelector('#prCheck'), showBtn = box.querySelector('#prShow');
      const next = () => { i++; if (i < probs.length) show(); else results(); };
      const reveal = async (ok, given) => {
        it.given = given; it.ok = ok; it.checked = true;
        save();
        out.innerHTML = ok
          ? `<div class="okline" style="font-size:15px">${I.check(16, 3)} Right. Checked by the math engine.</div>`
          : `<div class="pr-ans"><span class="warnline">${I.mistake(16)} ${given ? 'Not quite' : 'Answer'}</span><b class="math">${esc(toPretty(p.res.plain))}</b>${p.res.note ? `<span class="sub" style="font-size:13px">${esc(p.res.note)}</span>` : ''}</div>`;
        inp.disabled = true; showBtn.classList.add('hide');
        checkBtn.textContent = i + 1 < probs.length ? 'Next' : 'See results';
        checkBtn.onclick = next;
      };
      checkBtn.onclick = async () => {
        const given = inp.value.trim();
        if (!given) { inp.focus(); return; }
        checkBtn.innerHTML = '<span class="spinner" style="border-top-color:var(--on)"></span>';
        let ok = false;
        try { ok = (await checkAnswer(given, p.res, p.task, evalCmd)).ok; } catch (e) { ok = false; }
        if (!closed) reveal(ok, given);
      };
      showBtn.onclick = () => reveal(false, '');
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !inp.disabled) checkBtn.click(); });
    };
    const results = () => {
      const s = summarize(round.items);
      box.innerHTML = `
        <div class="pr-score"><b>${s.right} of ${s.total}</b><span class="sub">${s.right === s.total ? 'All right. Nice work.' : s.right >= s.total - 1 ? 'Almost there.' : 'Worth another round.'}</span></div>
        <div class="pr-list">${round.items.map((x, j) => `<div class="pr-row"><span class="pr-mark ${x.ok ? 'ok' : 'bad'}">${x.ok ? I.check(14, 3) : I.close(12)}</span>
          <div class="grow" style="min-width:0"><div class="math" style="font-size:16px">${esc(toPretty(probs[j].problem))}</div>
          <div class="sub" style="font-size:13px">${x.ok ? 'You: ' + esc(x.given) : (x.given ? 'You: ' + esc(x.given) + '. ' : '') + 'Answer: ' + esc(x.answer)}</div></div></div>`).join('')}</div>
        <span class="sub" style="font-size:12px">Saved with this mistake.</span>
        <div class="row"><button class="btn big grow press" data-done>Done</button><button class="btn big acc grow press" data-again>New problems</button></div>`;
      box.querySelector('[data-done]').onclick = () => close();
      box.querySelector('[data-again]').onclick = load;
    };
    show();
  };

  load();
}
