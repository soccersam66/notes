import { db, uid } from './db.js';

export const PAGE_W = 816, LETTER_H = 1056;
export const PAPERS = [
  { id: 'blank', name: 'Blank' }, { id: 'lined', name: 'Lined' },
  { id: 'graph', name: 'Graph' }, { id: 'dot', name: 'Dot grid' }
];
export const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
export const DEFAULT_SETTINGS = { accent: '#111111', theme: 'auto', keys: [], models: DEFAULT_MODELS, fingerDraw: false, name: 'Sam', defaultPaper: 'graph' };

let settingsCache = null;
export async function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...(await db.meta('settings', {})) };
  return settingsCache;
}
export async function saveSettings(patch) {
  settingsCache = { ...(await getSettings()), ...patch };
  await db.setMeta('settings', settingsCache);
  return settingsCache;
}

const now = () => Date.now();
const sortBy = (k) => (a, b) => (a[k] ?? 0) - (b[k] ?? 0);

// ---------- classes ----------
export async function listClasses() { return (await db.all('classes')).sort(sortBy('order')); }
export async function getClass(id) { return db.get('classes', id); }
export async function createClass(name, short) {
  const all = await listClasses();
  const c = { id: uid(), name, short: short || name.slice(0, 2).toUpperCase(), order: all.length, notebookLM: '', created: now() };
  await db.put('classes', c);
  await createNotebook(c.id, 'Class notes');
  return c;
}
export async function updateClass(id, patch) { const c = await getClass(id); Object.assign(c, patch); await db.put('classes', c); return c; }
export async function deleteClass(id) {
  for (const nb of await listNotebooks(id)) await deleteNotebook(nb.id);
  await db.del('classes', id);
}

// ---------- notebooks ----------
export async function listNotebooks(classId) { return (await db.byIndex('notebooks', 'classId', classId)).sort(sortBy('order')); }
export async function getNotebook(id) { return db.get('notebooks', id); }
export async function createNotebook(classId, name) {
  const all = await listNotebooks(classId);
  const nb = { id: uid(), classId, name, order: all.length ? Math.max(...all.map(n => n.order)) + 1 : 0, created: now(), updated: now() };
  await db.put('notebooks', nb);
  return nb;
}
export async function updateNotebook(id, patch) { const n = await getNotebook(id); Object.assign(n, patch, { updated: now() }); await db.put('notebooks', n); return n; }
export async function deleteNotebook(id) {
  for (const p of await listPages(id)) await deletePage(p.id);
  await db.del('notebooks', id);
}

// ---------- pages ----------
export async function listPages(notebookId) { return (await db.byIndex('pages', 'notebookId', notebookId)).sort(sortBy('order')); }
export async function getPage(id) { return db.get('pages', id); }
export async function createPage(notebookId, { paper = 'graph', afterId = null, atEnd = false, extra = {} } = {}) {
  const pages = await listPages(notebookId);
  let order;
  if (!pages.length) order = 1;
  else if (atEnd || !afterId) order = pages[pages.length - 1].order + 1;
  else {
    const i = pages.findIndex(p => p.id === afterId);
    const a = pages[i] ? pages[i].order : pages[pages.length - 1].order;
    const b = pages[i + 1] ? pages[i + 1].order : a + 2;
    order = (a + b) / 2;
  }
  const p = { id: uid(), notebookId, order, paper, w: PAGE_W, h: LETTER_H, created: now(), updated: now(), thumb: '', ...extra };
  await db.put('pages', p);
  await updateNotebook(notebookId, {});
  return p;
}
export async function updatePage(id, patch) { const p = await getPage(id); if (!p) return null; Object.assign(p, patch, { updated: now() }); await db.put('pages', p); return p; }
export async function deletePage(id) {
  await db.del('pages', id); await db.del('ink', id); await db.del('renders', id);
}
export async function getInk(pageId) { return (await db.get('ink', pageId)) || { pageId, strokes: [] }; }
export async function saveInk(pageId, strokes) { await db.put('ink', { pageId, strokes }); }

// ---------- to-dos, quick notes, mistakes ----------
export async function listTodos() { return (await db.all('todos')).sort((a, b) => (a.done - b.done) || ((a.due || 9e15) - (b.due || 9e15)) || (a.created - b.created)); }
export async function addTodo(text, due = null) { const t = { id: uid(), text, due, done: false, created: now() }; await db.put('todos', t); return t; }
export async function toggleTodo(id) { const t = await db.get('todos', id); t.done = !t.done; t.doneAt = now(); await db.put('todos', t); return t; }
export async function listNotes() { return (await db.all('notes')).sort((a, b) => b.created - a.created); }
export async function addNote(text) { const n = { id: uid(), text, created: now() }; await db.put('notes', n); return n; }
export async function listMistakes(classId) { return (await db.byIndex('mistakes', 'classId', classId)).sort((a, b) => b.created - a.created); }
export async function addMistake(m) { const x = { id: uid(), created: now(), ...m }; await db.put('mistakes', x); return x; }

// ---------- activity + streak (school days only, one freeze per week) ----------
const dayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export async function markActive() {
  const k = dayKey(new Date());
  const days = await db.meta('activity', []);
  if (!days.includes(k)) { days.push(k); await db.setMeta('activity', days.slice(-500)); }
}
export async function streakInfo() {
  const days = new Set(await db.meta('activity', []));
  const today = new Date();
  let count = 0, freezesUsed = new Set(), d = new Date(today);
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet does not break it
  for (let guard = 0; guard < 400; guard++) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) {
      if (days.has(dayKey(d))) count++;
      else {
        const wk = weekId(d);
        if (freezesUsed.has(wk)) break;
        freezesUsed.add(wk);
      }
    }
    d.setDate(d.getDate() - 1);
    if (count === 0 && guard > 7) break;
  }
  // week strip Mon..Sun of this week
  const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon); x.setDate(mon.getDate() + i);
    week.push({ l: 'MTWTFSS'[i], n: x.getDate(), did: days.has(dayKey(x)), now: dayKey(x) === dayKey(today), off: i >= 5 });
  }
  const thisWeekFreeze = freezesUsed.has(weekId(today));
  return { count, week, freezeLeft: thisWeekFreeze ? 0 : 1 };
}
function weekId(d) { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(m); }

// ---------- first run ----------
export async function ensureSeed() {
  if ((await db.all('classes')).length) return;
  const c = await createClass('Precalc', 'f(x)');
  const [nb] = await listNotebooks(c.id);
  await createPage(nb.id, { paper: 'graph' });
}

export async function lastPage() { return db.meta('lastPage', null); }
export async function setLastPage(info) { return db.setMeta('lastPage', info); }
