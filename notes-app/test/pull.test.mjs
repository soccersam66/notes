// Precalc auto-pull: the Apps Script (run with fake Google services) and the app's helpers.
// node notes-app/test/pull.test.mjs
import { readFileSync } from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import { pullUrl, checkUrl, readAnswer, noteName, findPrecalc, skipList, pruneSeen, nextSince, b64ToBytes } from '../js/pull.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : (fail++, console.log('FAIL', name, info)); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want));

// ---------- the Apps Script, with fake Drive ----------
const NOW = Date.UTC(2026, 9, 13, 18, 0);
const day = 86400000;
const SLIDES = 'application/vnd.google-apps.presentation', DOCS = 'application/vnd.google-apps.document', PDF = 'application/pdf';
const drive = [
  { id: 'a', name: 'PreCalc Day 12 Slides', owner: 'mr.t@school.org', mod: NOW - 1 * day, type: SLIDES },
  { id: 'b', name: 'pre-calc unit 3 notes', owner: 'mr.t@school.org', mod: NOW - 2 * day, type: DOCS },
  { id: 'c', name: 'Pre Calc Quiz Review.pdf', owner: 'mr.t@school.org', mod: NOW - 3 * day, type: PDF },
  { id: 'd', name: 'Day 11 slides', owner: 'mr.t@school.org', mod: NOW - 4 * day, type: SLIDES },   // no "precalc": only with OWNERS
  { id: 'e', name: 'Chemistry lab', owner: 'ms.c@school.org', mod: NOW - 1 * day, type: DOCS },
  { id: 'f', name: 'PRECALC old unit', owner: 'mr.t@school.org', mod: NOW - 30 * day, type: SLIDES }, // too old
  { id: 'g', name: 'Precalc broken export', owner: 'mr.t@school.org', mod: NOW - 5 * day, type: SLIDES, broken: true },
];
function runScript({ key = 'K3y', owners = null, params = {}, files = drive } = {}) {
  let src = readFileSync(path.join(here, '../../apps-script/precalc-pull.gs'), 'utf8');
  if (owners) src = src.replace('const OWNERS = [];', `const OWNERS = ${JSON.stringify(owners)};`);
  let lastQuery = '';
  const ctx = {
    Date: class extends Date { constructor(...a) { if (!a.length) super(NOW); else super(...a); } static now() { return NOW; } },
    MimeType: { GOOGLE_SLIDES: SLIDES, GOOGLE_DOCS: DOCS, PDF },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'KEY' ? key : null) }) },
    Utilities: { base64Encode: (bytes) => Buffer.from(bytes).toString('base64') },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    DriveApp: {
      searchFiles(q) {
        lastQuery = q;
        const since = Date.parse(q.match(/modifiedDate > '([^']+)'/)[1]);
        const list = files.filter(f => q.includes('sharedWithMe') && f.mod > since && q.includes(`mimeType = '${f.type}'`));
        let i = 0;
        return { hasNext: () => i < list.length, next: () => { const f = list[i++]; return {
          getId: () => f.id, getName: () => f.name, getMimeType: () => f.type,
          getOwner: () => ({ getEmail: () => f.owner }), getLastUpdated: () => new Date(f.mod),
          getBlob: () => ({ getBytes: () => Array.from(Buffer.from('%PDF ' + f.id)) }),
          getAs: (t) => { if (f.broken) throw new Error('Export failed'); if (t !== PDF) throw new Error('wrong type'); return { getBytes: () => Array.from(Buffer.from('%PDF from ' + f.id)) }; }
        }; } };
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const out = ctx.doGet({ parameter: params });
  return { json: JSON.parse(out.text), query: lastQuery };
}

eq('no key: bad key', runScript({ params: {} }).json, { error: 'bad key' });
eq('wrong key: bad key', runScript({ params: { key: 'nope' } }).json, { error: 'bad key' });
eq('no KEY set in Script Properties: bad key', runScript({ key: null, params: { key: 'K3y' } }).json, { error: 'bad key' });
let r = runScript({ params: { key: 'K3y' } });
eq('first run: Precalc files from the last 14 days, newest first (export errors reported)', r.json.files.map(f => f.id), ['a', 'b', 'c', 'g']);
ok('query asks for shared, not trashed, Slides/Docs/PDF', /sharedWithMe and trashed = false and modifiedDate > '2026-09-29T18:00:00.000Z' and \(mimeType = 'application\/vnd.google-apps.presentation' or mimeType = 'application\/vnd.google-apps.document' or mimeType = 'application\/pdf'\)/.test(r.query), r.query);
eq('Slides exported as PDF', Buffer.from(r.json.files[0].pdf_base64, 'base64').toString(), '%PDF from a');
eq('a real PDF is sent as it is', Buffer.from(r.json.files[2].pdf_base64, 'base64').toString(), '%PDF c');
eq('fields', Object.keys(r.json.files[0]).sort(), ['id', 'modified', 'name', 'owner', 'pdf_base64', 'type']);
eq('owner and date', [r.json.files[0].owner, r.json.files[0].modified], ['mr.t@school.org', NOW - day]);
ok('a file that cannot be exported says why (no crash)', r.json.files[3].error === 'Export failed' && !r.json.files[3].pdf_base64);
eq('more: false', r.json.more, false);
r = runScript({ params: { key: 'K3y', since: String(NOW - 2.5 * day) } });
eq('since: only newer files', r.json.files.map(f => f.id), ['a', 'b']);
r = runScript({ owners: ['MR.T@school.org'], params: { key: 'K3y' } });
eq('OWNERS: the teacher\'s files count even without "precalc" (any case)', r.json.files.map(f => f.id), ['a', 'b', 'c', 'd', 'g']);
r = runScript({ params: { key: 'K3y', skip: 'a,c' } });
eq('skip: files the app already has are not sent again', r.json.files.map(f => f.id), ['b', 'g']);
r = runScript({ params: { key: 'K3y', list: '1' } });
eq('list mode: names, owners, dates, no PDFs', r.json.files.map(f => [f.id, f.name, f.owner, !!f.pdf_base64]), [['a', 'PreCalc Day 12 Slides', 'mr.t@school.org', false], ['b', 'pre-calc unit 3 notes', 'mr.t@school.org', false], ['c', 'Pre Calc Quiz Review.pdf', 'mr.t@school.org', false], ['g', 'Precalc broken export', 'mr.t@school.org', false]]);
eq('list mode: shows what it skipped (to add OWNERS)', [r.json.othersCount, r.json.others.map(f => f.id)], [2, ['e', 'd']]);
ok('list mode tells the date it looked back to', r.json.since === NOW - 14 * day);
const many = Array.from({ length: 13 }, (_, i) => ({ id: 'm' + i, name: 'Precalc ' + i, owner: 'mr.t@school.org', mod: NOW - (i + 1) * 3600000, type: PDF }));
r = runScript({ params: { key: 'K3y' }, files: many });
eq('at most 10 per call, newest first, more: true', [r.json.files.length, r.json.files[0].id, r.json.files[9].id, r.json.more], [10, 'm0', 'm9', true]);
r = runScript({ params: { key: 'K3y', skip: many.slice(0, 10).map(f => f.id).join(',') }, files: many });
eq('next call with skip gets the rest', [r.json.files.map(f => f.id), r.json.more], [['m10', 'm11', 'm12'], false]);
ok('no secret in the script', !/K3y|key\s*=\s*['"][A-Za-z0-9]{8,}/.test(readFileSync(path.join(here, '../../apps-script/precalc-pull.gs'), 'utf8')));

// ---------- the app's helpers ----------
eq('pull URL', pullUrl('https://script.google.com/macros/s/AKf/exec', 'k y', { since: 1700000000000.7, skip: ['a', 'b'] }), 'https://script.google.com/macros/s/AKf/exec?key=k%20y&since=1700000000000&skip=a,b');
eq('list URL', pullUrl(' https://script.google.com/macros/s/AKf/exec ', 'K', { list: true }), 'https://script.google.com/macros/s/AKf/exec?key=K&list=1');
eq('URL that already has ?', pullUrl('https://script.google.com/macros/s/AKf/exec?x=1', 'K'), 'https://script.google.com/macros/s/AKf/exec?x=1&key=K');
eq('good URL', checkUrl('https://script.google.com/macros/s/AKfycb123/exec'), '');
ok('missing URL', /Add the web app URL/.test(checkUrl('')));
ok('not Apps Script', /not an Apps Script/.test(checkUrl('https://drive.google.com/x')));
ok('editor link', /editor link/.test(checkUrl('https://script.google.com/home/projects/123/edit')));
ok('/dev link', /\/dev/.test(checkUrl('https://script.google.com/macros/s/AKf/dev')));
eq('answer: files', readAnswer('{"files":[{"id":"a"}],"more":false}'), { ok: true, data: { files: [{ id: 'a' }], more: false } });
ok('answer: bad key', /^Key is wrong/.test(readAnswer('{"error":"bad key"}').error));
ok('answer: Google sign-in page (not shared with Anyone)', /Anyone/.test(readAnswer('<!DOCTYPE html><html>Sign in</html>').error));
ok('answer: junk', /cannot read/.test(readAnswer('{"x":1}').error));
ok('answer: script error passed on', /had a problem: Exception/.test(readAnswer('{"error":"Exception: boom"}').error));
eq('note name', noteName({ name: 'PreCalc Day 12 Slides.pdf', modified: Date.UTC(2026, 9, 13, 15) }), 'PreCalc Day 12 Slides (Oct 13)');
eq('Precalc class found', findPrecalc([{ name: 'Physics' }, { name: 'Pre-Calculus H' }]).name, 'Pre-Calculus H');
eq('no Precalc class', findPrecalc([{ name: 'Physics' }]), null);
eq('skip list inside the window', skipList({ a: 1000 * day, b: 5 * day }, 900 * day).sort(), ['a']);
eq('old seen ids dropped after 60 days', Object.keys(pruneSeen({ a: NOW - 10 * day, b: NOW - 70 * day }, NOW)), ['a']);
eq('first pull: since 0 (script uses 14 days)', nextSince(0), 0);
eq('later pulls look back a week (late shares)', nextSince(NOW), NOW - 7 * day);
eq('base64 to bytes', Array.from(b64ToBytes(Buffer.from('%PDF').toString('base64'))), [37, 80, 68, 70]);

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
