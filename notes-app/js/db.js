// Tiny IndexedDB layer. Everything lives on the iPad first, so the app works offline.
const DB_NAME = 'notes-app', VERSION = 1;
export const STORES = ['classes', 'notebooks', 'pages', 'ink', 'pdfs', 'renders', 'todos', 'notes', 'mistakes', 'meta'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const mk = (name, key, idx = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, { keyPath: key });
        idx.forEach(i => s.createIndex(i, i));
      };
      mk('classes', 'id'); mk('notebooks', 'id', ['classId']); mk('pages', 'id', ['notebookId']);
      mk('ink', 'pageId'); mk('pdfs', 'id'); mk('renders', 'pageId'); mk('todos', 'id');
      mk('notes', 'id'); mk('mistakes', 'id', ['classId']); mk('meta', 'key');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  byIndex: (store, index, value) => tx(store, 'readonly', s => s.index(index).getAll(value)),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
  async putMany(store, values) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      values.forEach(v => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async meta(key, fallback = null) { const r = await db.get('meta', key); return r ? r.value : fallback; },
  setMeta: (key, value) => db.put('meta', { key, value })
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Ask Safari not to clear our data when storage is low.
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
export async function usage() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) {}
  return null;
}
