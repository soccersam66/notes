// Search across classes: notebook names and the printed text of imported PDF pages.
// Pure functions (no DOM, no database) so they can be tested in Node.

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const words = (q) => norm(q).split(' ').filter(Boolean);
const escHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// index: { notebooks: [{ id, name, cls }], pages: [{ nbId, pageId, nb, cls, n, text }] }
// Every word of the query must appear. Returns { notebooks, pages } with snippets for pages.
export function search(index, query, limit = 40) {
  const ws = words(query);
  if (!ws.length) return { notebooks: [], pages: [] };
  const has = (t) => ws.every(w => t.includes(w));
  const notebooks = index.notebooks.filter(n => has(norm(n.name + ' ' + n.cls)));
  const pages = [];
  for (const p of index.pages) {
    const orig = String(p.text || '').replace(/\s+/g, ' ').trim(), t = orig.toLowerCase();
    if (!t || !has(t)) continue;
    const hits = ws.reduce((k, w) => k + t.split(w).length - 1, 0);
    pages.push({ ...p, hits, snippet: snippet(t, ws, 40, 90, orig.length === t.length ? orig : t) });
  }
  pages.sort((a, b) => b.hits - a.hits);
  return { notebooks, pages: pages.slice(0, limit) };
}

// A short piece of text around the first match (found in lowercase t, cut from src, which keeps the capitals).
export function snippet(t, ws, before = 40, after = 90, src = t) {
  let at = Infinity;
  ws.forEach(w => { const i = t.indexOf(w); if (i >= 0 && i < at) at = i; });
  if (at === Infinity) at = 0;
  let a = Math.max(0, at - before), b = Math.min(t.length, at + after);
  if (a > 0) { const sp = t.indexOf(' ', a); if (sp >= 0 && sp < at) a = sp + 1; }
  if (b < t.length) { const sp = t.lastIndexOf(' ', b); if (sp > at) b = sp; }
  return (a > 0 ? '...' : '') + src.slice(a, b) + (b < t.length ? '...' : '');
}

// Escape text for HTML and wrap the query words in <mark>.
export function highlight(text, ws) {
  if (!ws.length) return escHtml(text);
  const re = new RegExp('(' + ws.map(escRe).sort((x, y) => y.length - x.length).join('|') + ')', 'gi');
  return text.split(re).map((part, i) => i % 2 ? `<mark>${escHtml(part)}</mark>` : escHtml(part)).join('');
}
