// Precalc auto-pull: the teacher's daily slides (shared to Sam's personal Drive by his school
// script) come in through his own Apps Script web app and land at the end of the Precalc class's
// current unit. The web app URL and key live ONLY in this iPad's browser storage (meta 'pull'),
// never in code, never in a backup file.

export const PULL_EVERY_MS = 10 * 60 * 1000; // automatic pull when the app opens, at most every 10 minutes
export const WINDOW_EVERY_MS = 5 * 60 * 1000; // from 12:00 to 1:00 pm: every 5 minutes while the app is open
export const WINDOW = { from: 12, to: 13 };   // hours, iPad local time (when the teacher posts the notes)

// Is it the noon window (12:00 to 12:59, local time)?
export function inPullWindow(d = new Date()) { const h = d.getHours(); return h >= WINDOW.from && h < WINDOW.to; }
// Should an automatic check run now? opening: the app was just opened or came back.
export function autoDue(lastTry, now = new Date(), opening = false) {
  const since = now.getTime() - (lastTry || 0);
  if (inPullWindow(now)) return since >= WINDOW_EVERY_MS;
  return opening && since >= PULL_EVERY_MS;
}
const OVERLAP_MS = 7 * 86400000;             // look back a week: a file can be shared days after it was edited
const KEEP_SEEN_MS = 60 * 86400000;

// URL?key=...&since=...&skip=... (a plain GET: no custom headers, so Google's redirect works from Safari)
export function pullUrl(base, key, { since = 0, skip = [], list = false } = {}) {
  const u = String(base || '').trim();
  const params = ['key=' + encodeURIComponent(String(key || '').trim())];
  if (since > 0) params.push('since=' + Math.floor(since));
  if (list) params.push('list=1');
  if (skip.length) params.push('skip=' + skip.map(encodeURIComponent).join(','));
  return u + (u.includes('?') ? '&' : '?') + params.join('&');
}

// Is this a deployed Apps Script web app address?
export function checkUrl(u) {
  const s = String(u || '').trim();
  if (!s) return 'Add the web app URL in Settings first.';
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(s)) return 'That is not an Apps Script web app URL. It starts with https://script.google.com/macros/s/';
  if (/\/edit(\b|$)|\/home\//.test(s)) return 'That is the script editor link. Use the Web app URL from Deploy (it ends in /exec).';
  if (/\/dev(\?|$)/.test(s)) return 'That is the test (/dev) URL. Use the Web app URL that ends in /exec.';
  return '';
}

// The web app's answer (text) -> { ok, data } or { ok: false, error } in plain words
export function readAnswer(text) {
  let j;
  try { j = JSON.parse(text); }
  catch (e) {
    if (/<html|<!doctype/i.test(String(text))) return { ok: false, error: 'The web app answered with a Google page, not data. In the script: Deploy > Manage deployments, make sure "Who has access" is "Anyone".' };
    return { ok: false, error: 'The web app sent something the app cannot read.' };
  }
  if (j && j.error === 'bad key') return { ok: false, error: 'Key is wrong. It must match the KEY in the script\'s Script Properties exactly.' };
  if (j && j.error) return { ok: false, error: 'The web app had a problem: ' + j.error };
  if (!j || !Array.isArray(j.files)) return { ok: false, error: 'The web app sent something the app cannot read.' };
  return { ok: true, data: j };
}

// "Unit 3 Slides (Oct 13)"
export function noteName(f) {
  const d = new Date(Number(f.modified) || Date.now());
  const name = String(f.name || 'Precalc slides').replace(/\.pdf$/i, '').trim();
  return `${name} (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
}

// The Precalc class among Sam's classes (name like Precalc, Pre-calc, Pre Calc, Precalculus)
export function findPrecalc(classes) {
  return (classes || []).find(c => /pre[\s-]?calc/i.test(c.name || '')) || null;
}

// Which ids to tell the web app to skip (already imported and still inside the look-back window)
export function skipList(seen, since) {
  return Object.entries(seen || {}).filter(([, m]) => !since || m >= since - 86400000).map(([id]) => id);
}
export function pruneSeen(seen, now = Date.now()) {
  const out = {};
  for (const [id, m] of Object.entries(seen || {})) if (now - m < KEEP_SEEN_MS) out[id] = m;
  return out;
}
export function nextSince(lastPulled) { return lastPulled ? lastPulled - OVERLAP_MS : 0; }

export function b64ToBytes(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---------- in the app ----------
let running = null;

async function call(url) {
  let res;
  try { res = await fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store' }); }
  catch (e) { return { ok: false, error: 'Can\'t reach the web app. Check the URL and your internet.' }; }
  if (!res.ok) return { ok: false, error: res.status === 404 ? 'Can\'t reach the web app (not found). Check the URL, or deploy the script again.' : `Can't reach the web app (error ${res.status}).` };
  return readAnswer(await res.text());
}

// Test connection: what the web app sees (?list=1), no PDFs.
export async function testPull(cfg, S) {
  const bad = checkUrl(cfg.url); if (bad) return { ok: false, error: bad };
  if (!String(cfg.key || '').trim()) return { ok: false, error: 'Add the key in Settings first.' };
  const st = (await S.getPullState());
  return call(pullUrl(cfg.url, cfg.key, { since: nextSince(st.lastPulled), list: true }));
}

// Pull new Precalc slides into the app. Returns { ok, added: [names], error }.
// importPdf(file, classId, notebookId) is the app's normal PDF import.
export function pullPrecalc({ S, importPdf, progress = () => {} }) {
  if (running) return running;
  running = (async () => {
    const st = await S.getPullState();
    const bad = checkUrl(st.url); if (bad) return { ok: false, error: bad };
    if (!String(st.key || '').trim()) return { ok: false, error: 'Add the key in Settings first.' };
    await S.savePullState({ lastTry: Date.now() });
    const since = nextSince(st.lastPulled);
    let seen = pruneSeen(st.seen);
    const added = [], failed = [];
    let target = null;
    for (let round = 0; round < 4; round++) {
      const r = await call(pullUrl(st.url, st.key, { since, skip: skipList(seen, since) }));
      if (!r.ok) { await S.savePullState({ seen }); return { ok: false, error: r.error, added }; }
      const files = r.data.files.filter(f => f && f.id && !seen[f.id]);
      // oldest first, so the notebook reads in class order
      files.sort((a, b) => a.modified - b.modified);
      for (const f of files) {
        if (!f.pdf_base64) { failed.push(f.name); seen[f.id] = Number(f.modified) || Date.now(); continue; }
        if (!target) target = await S.precalcNotebook();
        progress(`Adding ${noteName(f)}...`);
        const file = new File([b64ToBytes(f.pdf_base64)], noteName(f) + '.pdf', { type: 'application/pdf' });
        f.pdf_base64 = null; // let go of the text copy right away (memory on the old iPad)
        const nb = await importPdf(file, target.classId, target.id);
        if (!nb) { failed.push(f.name); continue; } // a broken PDF: try again next time
        seen[f.id] = Number(f.modified) || Date.now();
        added.push(noteName(f));
        await S.savePullState({ seen });
      }
      if (!r.data.more) break;
    }
    await S.savePullState({ seen, lastPulled: Date.now() });
    return { ok: true, added, failed, notebook: target };
  })().finally(() => { running = null; });
  return running;
}
