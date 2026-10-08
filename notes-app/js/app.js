import * as S from './store.js';
import { db, persist, usage } from './db.js';
import { $, $$, h, toast, sheet, askText, confirmSheet, menu, applyTheme, moveIndicator, I, esc } from './ui.js';
import { openEditor, closeEditor, editorOpen } from './editor.js';
import { importPdfFile } from './pdfimport.js';
import { exportBackup, importBackup } from './backup.js';
import { warmEngine, engineState, onEngineState } from './engine.js';

const view = $('#view');
let settings;

// ---------- boot ----------
async function boot() {
  settings = await S.getSettings();
  applyTheme(settings);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings));
  await S.ensureSeed();
  $('#settingsBtn').innerHTML = I.gear();
  $('#settingsBtn').onclick = openSettings;
  $$('#tabs button').forEach(b => b.onclick = () => { location.hash = b.dataset.route; });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => moveIndicator($('#tabs')));
  route();
  persist();
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  // load the math engine in the background so the first Solve is instant
  setTimeout(() => warmEngine(), 1200);
}

// ---------- router ----------
async function route() {
  const hash = location.hash || '#/today';
  const parts = hash.slice(2).split('/');
  if (parts[0] === 'nb') {
    await openEditor(parts[1], parts[2] || null, { onClose: () => { history.length > 1 ? history.back() : (location.hash = '#/today'); } });
    return;
  }
  if (editorOpen()) closeEditor();
  const tab = parts[0] === 'class' || parts[0] === 'classes' ? '#/classes' : '#/today';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.route === tab));
  moveIndicator($('#tabs'));
  renderStreak();
  if (parts[0] === 'classes') return renderClasses();
  if (parts[0] === 'class') return renderClass(parts[1], parts[2] || 'notebooks');
  return renderToday();
}
export function go(hash) { location.hash = hash; }

async function renderStreak() {
  const s = await S.streakInfo();
  $('#streak').innerHTML = I.flame() + s.count;
}

// ---------- Today ----------
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
const fmtDate = (d = new Date()) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

async function renderToday() {
  const [classes, todos, notes, st, last] = await Promise.all([S.listClasses(), S.listTodos(), S.listNotes(), S.streakInfo(), S.lastPage()]);
  let lastInfo = null;
  if (last) {
    const p = await S.getPage(last.pageId); const nb = p && await S.getNotebook(p.notebookId);
    if (p && nb) {
      const pages = await S.listPages(nb.id); const c = await S.getClass(nb.classId);
      lastInfo = { p, nb, c, idx: pages.findIndex(x => x.id === p.id) + 1, total: pages.length };
    }
  }
  const left = todos.filter(t => !t.done).length;
  const sub = [lastInfo ? 'One page to pick up' : 'Start a page in any class', left ? `${left} thing${left > 1 ? 's' : ''} on your list` : 'nothing on your list'].join(' and ') + '.';
  view.innerHTML = `
    <div class="hello rise d1">
      <div style="display:flex;flex-direction:column;gap:6px">
        <span class="sub" style="font-size:15px;font-weight:500">${fmtDate()}</span>
        <h1 class="title">${greeting()}, ${esc(settings.name || 'there')}</h1>
        <span class="sub" style="font-size:16px">${esc(sub)}</span>
      </div>
      <div class="week">${st.week.map(d => `<div class="wd ${d.now ? 'now' : d.did ? 'did' : d.off ? 'off' : ''}">${d.l}<span>${d.n}</span></div>`).join('')}</div>
    </div>
    <div class="today-grid">
      <div class="card continue rise d2">
        ${lastInfo ? `
        <button class="mini-paper lift" data-open>${lastInfo.p.thumb ? `<img src="${lastInfo.p.thumb}" alt="">` : `<span class="sub">${I.file(28)}</span>`}</button>
        <div style="flex:1;display:flex;flex-direction:column;min-width:0">
          <span class="eyebrow">Continue where you left off</span>
          <h2 style="margin:10px 0 0;font-size:28px;font-weight:800;letter-spacing:-.025em;line-height:1.1" class="ellip">${esc(lastInfo.nb.name)}</h2>
          <span class="sub" style="margin-top:8px;font-size:15px">${esc(lastInfo.c ? lastInfo.c.name : '')}, page ${lastInfo.idx} of ${lastInfo.total}</span>
          <div style="flex:1;min-height:20px"></div>
          <div class="row"><button class="btn big acc grow press" data-open>Continue ${I.arrow()}</button><button class="btn big press" data-newpage>${I.plus(18)} New page</button></div>
        </div>` : `
        <div style="flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center">
          <span class="eyebrow">Start here</span>
          <h2 style="margin:0;font-size:28px;font-weight:800;letter-spacing:-.025em">Open a class and write</h2>
          <span class="sub">Make a blank page, or import your teacher's slides as a PDF.</span>
          <div class="row" style="margin-top:10px"><button class="btn big acc press" data-classes>Go to classes ${I.arrow()}</button></div>
        </div>`}
      </div>
      <div class="card rise d3" style="padding:22px 22px 14px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
          <h2 style="margin:0;font-size:20px;font-weight:750;letter-spacing:-.02em">To do</h2>
          <span class="sub" style="font-size:14px;font-weight:600">${left ? left + ' left' : 'All done'}</span>
        </div>
        <div id="todoList">${todos.slice(0, 6).map(t => `
          <button class="todo press ${t.done ? 'done' : ''}" data-todo="${t.id}"><span class="box ${t.done ? 'on' : ''}">${t.done ? I.check() : ''}</span>
          <span class="grow" style="display:flex;flex-direction:column;gap:3px"><span class="t" style="font-size:16px;font-weight:600">${esc(t.text)}</span>${t.due ? `<span class="sub" style="font-size:13px">${esc(new Date(t.due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</span>` : ''}</span></button>`).join('') || '<p class="sub" style="margin:8px 0">Nothing yet. Add homework or reminders below.</p>'}</div>
        <div style="flex:1"></div>
        <div class="row" style="padding-top:12px"><input id="todoIn" placeholder="Add a to-do" style="height:44px"><button class="icon soft press" id="todoAdd" aria-label="Add to-do">${I.plus(18)}</button></div>
        <span class="sub" style="font-size:12px;padding-top:8px">Next version: Google Classroom assignments show up here by themselves.</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px" class="rise d4">
        ${classes.slice(0, 1).map(c => classCard(c)).join('')}
        <button class="dashed lift" data-addclass><span class="icon soft">${I.plus()}</span><span style="font-size:15px;font-weight:600">${classes.length > 1 ? 'All classes' : 'Add a class'}</span><span style="font-size:13px">${classes.length > 1 ? classes.length + ' classes' : 'Physics and the rest'}</span></button>
      </div>
      <div class="card rise d5" style="padding:22px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:baseline;justify-content:space-between"><h2 style="margin:0;font-size:20px;font-weight:750;letter-spacing:-.02em">Quick notes</h2><span class="sub" style="font-size:13px;font-weight:600">${notes.length || ''}</span></div>
        ${notes.slice(0, 3).map(n => `<div style="padding:10px 14px;border-radius:16px;background:var(--soft);font-size:15px;line-height:1.35">${esc(n.text)}<div class="sub" style="font-size:12px;margin-top:4px">${new Date(n.created).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div></div>`).join('') || '<p class="sub" style="margin:0">Tap the pencil button to jot something down fast.</p>'}
      </div>
    </div>
    <button class="fab press rise d5" id="fab" aria-label="Quick note">${I.note()}</button>`;
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go(`#/nb/${lastInfo.nb.id}/${lastInfo.p.id}`));
  const np = view.querySelector('[data-newpage]');
  if (np) np.onclick = () => newPageSheet(lastInfo.nb.id, lastInfo.p.id);
  const gc = view.querySelector('[data-classes]'); if (gc) gc.onclick = () => go('#/classes');
  view.querySelector('[data-addclass]').onclick = () => classes.length > 1 ? go('#/classes') : addClassSheet();
  view.querySelectorAll('[data-class]').forEach(b => b.onclick = () => go('#/class/' + b.dataset.class));
  view.querySelectorAll('[data-todo]').forEach(b => b.onclick = async () => { await S.toggleTodo(b.dataset.todo); renderToday(); });
  const addTodo = async () => { const v = $('#todoIn').value.trim(); if (!v) return; await S.addTodo(v); renderToday(); };
  $('#todoAdd').onclick = addTodo;
  $('#todoIn').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
  $('#fab').onclick = quickNote;
}

function classCard(c, extra = '') {
  return `<button class="card class-card lift" data-class="${c.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;width:100%"><div class="mono">${esc(c.short)}</div><span class="sub">${I.chev()}</span></div>
    <div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:22px;font-weight:800;letter-spacing:-.02em">${esc(c.name)}</span>${extra}</div></button>`;
}

function quickNote() {
  sheet(`<div style="display:flex;justify-content:space-between;align-items:center"><h3>Quick note</h3><span class="sub" style="font-size:13px;font-weight:600">Shows on Today</span></div>
    <textarea rows="4" placeholder="Ask about problem 9 in class tomorrow"></textarea>
    <div class="row"><button class="btn big grow press" data-x>Cancel</button><button class="btn big acc grow press" data-ok>Save</button></div>`, (el, close) => {
    el.querySelector('[data-x]').onclick = close;
    el.querySelector('[data-ok]').onclick = async () => {
      const v = el.querySelector('textarea').value.trim();
      if (v) { await S.addNote(v); toast('Saved'); }
      close(); if (!location.hash || location.hash === '#/today') renderToday();
    };
  });
}

// ---------- Classes ----------
async function renderClasses() {
  const classes = await S.listClasses();
  const counts = await Promise.all(classes.map(async c => (await S.listNotebooks(c.id)).length));
  view.innerHTML = `
    <div class="hello rise"><div><span class="sub" style="font-size:15px;font-weight:500">${classes.length} class${classes.length === 1 ? '' : 'es'}</span><h1 class="title">Classes</h1></div>
      <button class="btn acc press" id="addClass">${I.plus(18)} Add class</button></div>
    <div class="classes-grid">${classes.map((c, i) => `<div class="rise d${Math.min(5, i + 1)}">${classCard(c, `<span class="sub" style="font-size:14px">${counts[i]} notebook${counts[i] === 1 ? '' : 's'}</span>`)}</div>`).join('')}
      <button class="dashed lift rise d5" id="addClass2"><span class="icon soft">${I.plus()}</span><span style="font-size:15px;font-weight:600">Add a class</span></button></div>`;
  $('#addClass').onclick = addClassSheet; $('#addClass2').onclick = addClassSheet;
  view.querySelectorAll('[data-class]').forEach(b => b.onclick = () => go('#/class/' + b.dataset.class));
}

function addClassSheet() {
  sheet(`<h3>Add a class</h3>
    <div class="field"><label>Name</label><input id="cn" placeholder="AP Physics"></div>
    <div class="field"><label>Short label (2 to 4 letters)</label><input id="cs" placeholder="PH" maxlength="4"></div>
    <div class="row"><button class="btn big grow press" data-x>Cancel</button><button class="btn big acc grow press" data-ok>Add</button></div>`, (el, close) => {
    el.querySelector('[data-x]').onclick = close;
    el.querySelector('[data-ok]').onclick = async () => {
      const n = el.querySelector('#cn').value.trim(); if (!n) return;
      const c = await S.createClass(n, el.querySelector('#cs').value.trim() || null);
      close(); go('#/class/' + c.id);
    };
  });
}

async function renderClass(id, tab) {
  const c = await S.getClass(id);
  if (!c) return go('#/classes');
  const nbs = await S.listNotebooks(id);
  const pagesBy = await Promise.all(nbs.map(nb => S.listPages(nb.id)));
  const mistakes = tab === 'mistakes' ? await S.listMistakes(id) : [];
  view.innerHTML = `
    <div class="rise" style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px;flex-wrap:wrap">
      <button class="press" id="back" style="display:flex;align-items:center;gap:4px;font-size:17px;font-weight:600;color:var(--accText);padding:8px 4px">${I.back()} Classes</button>
      <div class="row">
        <button class="btn card press" id="importPdf">${I.file()} Import PDF</button>
        <button class="btn acc press" id="nlm">${I.book()} ${c.notebookLM ? 'Open in NotebookLM' : 'Link NotebookLM'}</button>
        <button class="icon card press" id="classMore" aria-label="More">${I.more()}</button>
      </div>
    </div>
    <div class="rise d1" style="display:flex;align-items:flex-end;justify-content:space-between;margin:16px 0 4px;gap:12px;flex-wrap:wrap">
      <div><h1 class="title" style="font-size:44px">${esc(c.name)}</h1><span class="sub" style="font-size:15px">${nbs.length} notebook${nbs.length === 1 ? '' : 's'}, ${(n => n + ' page' + (n === 1 ? '' : 's'))(pagesBy.reduce((a, p) => a + p.length, 0))}</span></div>
      <div class="seg" id="seg"><div class="ind"></div><button data-tab="notebooks" class="${tab !== 'mistakes' ? 'on' : ''}">Notebooks</button><button data-tab="mistakes" class="${tab === 'mistakes' ? 'on' : ''}">Mistakes</button></div>
    </div>
    <div id="classBody"></div>
    <input type="file" id="pdfIn" accept="application/pdf,.pdf" class="hide">`;
  moveIndicator($('#seg'));
  $('#back').onclick = () => go('#/classes');
  $$('#seg button').forEach(b => b.onclick = () => go(`#/class/${id}/${b.dataset.tab}`));
  $('#nlm').onclick = async () => {
    if (c.notebookLM) { window.open(c.notebookLM, '_blank'); return; }
    const url = await askText({ title: 'Link NotebookLM', label: 'Paste the link to this class\'s notebook', placeholder: 'https://notebooklm.google.com/notebook/...', ok: 'Link' });
    if (url) { await S.updateClass(id, { notebookLM: url }); renderClass(id, tab); }
  };
  $('#classMore').onclick = (e) => menu(e.currentTarget, [
    { label: 'Rename class', icon: I.edit(), run: async () => { const n = await askText({ title: 'Rename class', value: c.name }); if (n) { await S.updateClass(id, { name: n }); renderClass(id, tab); } } },
    { label: 'Change short label', icon: I.edit(), run: async () => { const n = await askText({ title: 'Short label', value: c.short }); if (n) { await S.updateClass(id, { short: n.slice(0, 4) }); renderClass(id, tab); } } },
    { label: 'Change NotebookLM link', icon: I.book(), run: async () => { const u = await askText({ title: 'NotebookLM link', value: c.notebookLM, placeholder: 'https://notebooklm.google.com/...' }); if (u !== null) { await S.updateClass(id, { notebookLM: u }); renderClass(id, tab); } } },
    'hr',
    { label: 'Delete class', icon: I.trash(), danger: true, run: async () => { if (await confirmSheet({ title: `Delete ${c.name}?`, body: 'Every notebook and page in it will be deleted. Make a backup first if unsure.' })) { await S.deleteClass(id); go('#/classes'); } } }
  ]);
  $('#importPdf').onclick = () => $('#pdfIn').click();
  $('#pdfIn').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const nb = await importPdfFile(f, id, (msg) => toast(msg, 4000));
    if (nb) { toast('Imported ' + f.name); go(`#/nb/${nb.id}`); }
  };
  const body = $('#classBody');
  if (tab === 'mistakes') {
    body.innerHTML = `<div class="card rise" style="padding:8px 24px;margin-top:16px">${mistakes.map(m => `
      <div class="mistake"><div class="grow"><div class="math">${esc(m.problem)}</div><div class="sub" style="font-size:14px;margin-top:4px">Answer: ${esc(m.answer || '')}${m.note ? ', ' + esc(m.note) : ''}</div>
      <div class="sub" style="font-size:12px;margin-top:4px">${new Date(m.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>
      ${m.notebookId ? `<button class="btn sm press" data-goto="${m.notebookId}/${m.pageId || ''}">Open page</button>` : ''}</div>`).join('') || '<p class="sub" style="padding:18px 0;margin:0">No mistakes saved yet. In Solve, tap "Save to Mistakes" on anything you got wrong, and it shows up here to review before quizzes.</p>'}</div>`;
    body.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => go('#/nb/' + b.dataset.goto));
    return;
  }
  body.innerHTML = nbs.map((nb, i) => `
    <div class="card nb rise d${Math.min(5, i + 2)}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div class="row grow"><h2 class="h2 ellip">${esc(nb.name)}</h2><span class="chip">${pagesBy[i].length} page${pagesBy[i].length === 1 ? '' : 's'}</span></div>
        <button class="icon soft press" data-nbmore="${nb.id}" aria-label="Notebook options">${I.more()}</button>
      </div>
      <div class="pages-grid">
        ${pagesBy[i].map((p, j) => `<button class="pg lift" data-page="${nb.id}/${p.id}"><div class="thumb ${p.h < p.w ? 'wide' : ''}">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy">` : (p.paper !== 'pdf' ? paperSwatch(p.paper) : '')}<span class="num">${j + 1}</span></div></button>`).join('')}
        <button class="pg add press" data-newpage="${nb.id}"><div class="thumb"><span style="display:flex;flex-direction:column;align-items:center;gap:6px;font-size:14px;font-weight:700">${I.plus(26)}New page</span></div></button>
      </div>
    </div>`).join('') + `<div class="rise d5" style="margin-top:16px"><button class="btn card press" id="newNb">${I.plus(18)} New notebook</button></div>`;
  body.querySelectorAll('[data-page]').forEach(b => b.onclick = () => go('#/nb/' + b.dataset.page));
  body.querySelectorAll('[data-newpage]').forEach(b => b.onclick = () => newPageSheet(b.dataset.newpage, null));
  $('#newNb').onclick = async () => {
    const n = await askText({ title: 'New notebook', label: 'Name', placeholder: 'Unit 3, Homework, Quiz review...', ok: 'Create' });
    if (!n) return;
    const nb = await S.createNotebook(id, n);
    await S.createPage(nb.id, { paper: settings.defaultPaper });
    renderClass(id, tab);
  };
  body.querySelectorAll('[data-nbmore]').forEach(b => b.onclick = (e) => {
    const nb = nbs.find(x => x.id === b.dataset.nbmore);
    menu(e.currentTarget, [
      { label: 'Rename', icon: I.edit(), run: async () => { const n = await askText({ title: 'Rename notebook', value: nb.name }); if (n) { await S.updateNotebook(nb.id, { name: n }); renderClass(id, tab); } } },
      { label: 'Delete notebook', icon: I.trash(), danger: true, run: async () => { if (await confirmSheet({ title: `Delete ${nb.name}?`, body: 'All its pages and writing will be deleted.' })) { await S.deleteNotebook(nb.id); renderClass(id, tab); } } }
    ]);
  });
}

// ---------- New page sheet (used everywhere) ----------
export function paperSwatch(id) {
  const st = { blank: '', lined: 'background-image:linear-gradient(var(--rule) 1px,transparent 1px);background-size:100% 12px;background-position:0 18px',
    graph: 'background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:10px 10px',
    dot: 'background-image:radial-gradient(circle,var(--bar) 1px,transparent 1.4px);background-size:10px 10px' }[id];
  return `<span class="sw" style="${st}"></span>`;
}
export function newPageSheet(notebookId, afterId, onCreated) {
  let paper = settings.defaultPaper || 'graph';
  sheet(`<h3>New page</h3>
    <div class="opts">${S.PAPERS.map(p => `<button class="opt ${p.id === paper ? 'on' : ''}" data-paper="${p.id}">${paperSwatch(p.id)}${p.name}</button>`).join('')}</div>
    ${afterId ? `<div class="row"><button class="btn big grow press" data-where="after">After this page</button><button class="btn big acc grow press" data-where="end">At the end</button></div>`
    : `<button class="btn big acc press" data-where="end">Create page</button>`}`, (el, close) => {
    el.querySelectorAll('[data-paper]').forEach(b => b.onclick = () => { paper = b.dataset.paper; el.querySelectorAll('[data-paper]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('[data-where]').forEach(b => b.onclick = async () => {
      const p = await S.createPage(notebookId, { paper, afterId: b.dataset.where === 'after' ? afterId : null, atEnd: b.dataset.where === 'end' });
      await S.saveSettings({ defaultPaper: paper }); settings.defaultPaper = paper;
      close();
      if (onCreated) onCreated(p); else go(`#/nb/${notebookId}/${p.id}`);
    });
  });
}

// ---------- Settings ----------
async function openSettings() {
  const est = await usage();
  const keys = settings.keys || [];
  const keyInfo = keys.length ? `${keys.length} key${keys.length > 1 ? 's' : ''} saved (ending ${keys.map(k => k.slice(-4)).slice(0, 4).join(', ')}${keys.length > 4 ? '...' : ''})` : 'No keys yet. Solve still works for most problems without AI.';
  const close = sheet(`<h3>Settings</h3>
    <div class="setrow"><span style="font-weight:600">Your name</span><input id="sName" value="${esc(settings.name)}" style="max-width:200px;height:40px;padding:8px 12px"></div>
    <div class="setrow"><span style="font-weight:600">Accent</span><div class="swatches">${['#111111', '#2F5BEA', '#18794A'].map(c => `<button data-acc="${c}" class="${settings.accent.toUpperCase() === c ? 'on' : ''}" style="background:${c}" aria-label="Accent ${c}"></button>`).join('')}</div></div>
    <div class="setrow"><span style="font-weight:600">Appearance</span><div class="seg" id="sTheme"><div class="ind"></div>${['auto', 'light', 'dark'].map(t => `<button data-theme="${t}" class="${settings.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
    <div class="setrow"><div><div style="font-weight:600">Draw with finger</div><div class="sub" style="font-size:13px">Off means only the Pencil writes, fingers scroll</div></div><button class="toggle ${settings.fingerDraw ? 'on' : ''}" id="sFinger" aria-label="Draw with finger"><i></i></button></div>
    <div class="field" style="padding-top:8px"><label>Gemini API keys, one per line (used only to read handwriting and word problems)</label>
      <textarea id="sKeys" rows="3" placeholder="Paste keys here" data-noautofocus="1" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
      <span class="sub" style="font-size:13px">${esc(keyInfo)} Keys stay on this iPad only. Leave the box empty to keep the saved ones.</span></div>
    <div class="field"><label>Gemini models, in order (fastest first)</label><input id="sModels" value="${esc((settings.models || S.DEFAULT_MODELS).join(', '))}" data-noautofocus="1"></div>
    <div class="setrow"><div><div style="font-weight:600">Math engine</div><div class="sub" style="font-size:13px" id="engState">${engineLabel()}</div></div></div>
    <div class="setrow"><div><div style="font-weight:600">Backup</div><div class="sub" style="font-size:13px">Saves everything to one file. Keep a copy in Google Drive.</div></div>
      <div class="row"><button class="btn sm press" id="bImport">Restore</button><button class="btn sm acc press" id="bExport">Back up</button></div></div>
    <div class="sub" style="font-size:12px">${est ? `Using ${(est.usage / 1048576).toFixed(1)} MB on this iPad. ` : ''}Math engine: Giac (GeoGebra build, GPL-3). PDF reading: pdf.js. Ink smoothing: perfect-freehand.</div>
    <button class="btn big acc press" id="sDone">Done</button>
    <input type="file" id="bFile" accept=".json,application/json" class="hide">`, (el, close) => {
    moveIndicator(el.querySelector('#sTheme'));
    el.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { settings = await S.saveSettings({ accent: b.dataset.acc }); applyTheme(settings); el.querySelectorAll('[data-acc]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('[data-theme]').forEach(b => b.onclick = async () => { settings = await S.saveSettings({ theme: b.dataset.theme }); applyTheme(settings); el.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b)); moveIndicator(el.querySelector('#sTheme')); });
    el.querySelector('#sFinger').onclick = async (e) => { const t = e.currentTarget; settings = await S.saveSettings({ fingerDraw: !settings.fingerDraw }); t.classList.toggle('on', settings.fingerDraw); };
    const off = onEngineState(() => { const s = el.querySelector('#engState'); if (s) s.textContent = engineLabel(); });
    el.querySelector('#bExport').onclick = async () => { toast('Making backup...'); await exportBackup(); };
    el.querySelector('#bImport').onclick = () => el.querySelector('#bFile').click();
    el.querySelector('#bFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!(await confirmSheet({ title: 'Restore this backup?', body: 'It replaces everything currently in the app.', ok: 'Restore' }))) return;
      try { await importBackup(f); toast('Restored'); setTimeout(() => location.reload(), 800); } catch (err) { toast('That file is not a Notes backup'); }
    };
    el.querySelector('#sDone').onclick = async () => {
      const keysText = el.querySelector('#sKeys').value.trim();
      const patch = { name: el.querySelector('#sName').value.trim() || 'there', models: el.querySelector('#sModels').value.split(/[,\s]+/).filter(Boolean) };
      if (keysText) patch.keys = Array.from(new Set(keysText.split(/\s+/).filter(k => k.length > 20)));
      settings = await S.saveSettings(patch);
      off(); close(); route();
      if (keysText) toast(`${patch.keys.length} key${patch.keys.length === 1 ? '' : 's'} saved`);
    };
  });
}
function engineLabel() {
  return { off: 'Not loaded yet', loading: 'Loading (first time takes a few seconds)...', ready: 'Ready, works offline', error: 'Could not load: ' + engineState.error }[engineState.status];
}

boot();
export { renderToday, settings as currentSettings };
