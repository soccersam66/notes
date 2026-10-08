// One-file backup of everything (classes, pages, ink, PDFs, to-dos, settings).
import { db } from './db.js';

const STORES = ['classes', 'notebooks', 'pages', 'ink', 'pdfs', 'todos', 'notes', 'mistakes', 'meta'];

const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
const fromB64 = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

export async function exportBackup() {
  const out = { app: 'notes-app', version: 1, at: new Date().toISOString(), data: {} };
  for (const s of STORES) {
    let rows = await db.all(s);
    if (s === 'pdfs') rows = await Promise.all(rows.map(async r => ({ ...r, blob: undefined, b64: await toB64(r.blob), type: r.blob.type || 'application/pdf' })));
    if (s === 'meta') rows = rows.map(r => r.key === 'settings' ? { ...r, value: { ...r.value, keys: [] } } : r); // never put API keys in a backup file
    out.data[s] = rows;
  }
  const name = `notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(out)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export async function importBackup(file) {
  const j = JSON.parse(await file.text());
  if (j.app !== 'notes-app' || !j.data) throw new Error('not a backup');
  const keepKeys = ((await db.meta('settings', {})) || {}).keys || [];
  for (const s of STORES) {
    await db.clear(s);
    let rows = j.data[s] || [];
    if (s === 'pdfs') rows = rows.map(r => ({ id: r.id, name: r.name, added: r.added, blob: fromB64(r.b64, r.type) }));
    if (s === 'meta') rows = rows.map(r => r.key === 'settings' ? { ...r, value: { ...r.value, keys: keepKeys } } : r);
    if (rows.length) await db.putMany(s, rows);
  }
  await db.clear('renders');
}
