// The page editor: vertical list of pages, Apple Pencil ink, lasso, undo, zoom.
import * as S from './store.js';
import { db } from './db.js';
import { $, h, toast, menu, confirmSheet, askText, I, esc } from './ui.js';
import { getStroke } from '../vendor/pf/perfect-freehand.js';
import { renderPdfPageBlob, importPdfFile } from './pdfimport.js';
import { openSolve, closeSolve } from './solve.js';
import { newPageSheet } from './app.js';

const ED = $('#editor');
let st = null; // editor state

const INK_COLORS_LIGHT = ['#111113', '#2F5BEA', '#E5484D', '#18794A'];
const INK_COLORS_DARK = ['#F5F5F7', '#8AB4FF', '#FF6B6F', '#4ADE80'];
const SIZES = [2.2, 3.4, 5.5];
const KEYS = ['k', 'b', 'r', 'g'];
function resolveColor(c, dark) {
  const i = KEYS.indexOf(c);
  if (i >= 0) return (dark ? INK_COLORS_DARK : INK_COLORS_LIGHT)[i];
  return c;
}
const PAPER_SPACING = { lined: 32, graph: 24, dot: 24 };

export const editorOpen = () => !!st;

export async function openEditor(notebookId, pageId, { onClose } = {}) {
  if (st && st.nb.id === notebookId) { if (pageId) scrollToPage(pageId); return; }
  if (st) await closeEditor();
  const nb = await S.getNotebook(notebookId);
  if (!nb) { toast('That notebook is gone'); onClose && onClose(); return; }
  const settings = await S.getSettings();
  const cls = await S.getClass(nb.classId);
  const pages = await S.listPages(notebookId);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  st = {
    nb, cls, pages, settings, onClose, dark,
    tool: 'pen', color: 0, size: 1, zoom: 1, baseW: 0,
    mounted: new Map(),   // pageId -> {el, canvas, ctx, img, url}
    inkCache: new Map(),  // pageId -> strokes[]
    dirty: new Set(), thumbsDirty: new Set(),
    undo: [], redo: [], drawing: null, sel: null, current: pageId || (pages[0] && pages[0].id)
  };
  build();
  document.body.style.overflow = 'hidden';
  ED.classList.remove('hide');
  layout();
  if (pageId) requestAnimationFrame(() => scrollToPage(pageId, false));
  S.setLastPage({ pageId: st.current, notebookId });
}

export async function closeEditor() {
  if (!st) return;
  closeSolve();
  await flushAll();
  st.io && st.io.disconnect();
  for (const id of Array.from(st.mounted.keys())) unmount(id);
  window.removeEventListener('resize', st.onResize);
  document.removeEventListener('visibilitychange', st.onVis);
  ED.innerHTML = ''; ED.classList.add('hide');
  document.body.style.overflow = '';
  st = null;
}

// ---------------- UI ----------------
function inkColors() { return st.dark ? INK_COLORS_DARK : INK_COLORS_LIGHT; }

function build() {
  ED.innerHTML = `
    <div class="ed-top">
      <div class="ed-title">
        <button class="icon glass press" id="edBack" aria-label="Back">${I.back()}</button>
        <div style="display:flex;flex-direction:column;min-width:0" class="t2"><b class="ellip" style="font-size:15px">${esc(st.nb.name)}</b><span class="sub ellip" style="font-size:13px" id="edPageNo"></span></div>
      </div>
      <div class="toolbar glass" id="toolbar">
        <button class="tool" data-tool="pen" aria-label="Pen">${I.pen()}</button>
        <button class="tool" data-tool="hi" aria-label="Highlighter">${I.hi()}</button>
        <button class="tool" data-tool="eraser" aria-label="Eraser">${I.eraser()}</button>
        <button class="tool" data-tool="lasso" aria-label="Lasso">${I.lasso()}</button>
        <div class="sep"></div>
        ${inkColors().map((c, i) => `<button class="ink-sw" data-color="${i}" style="color:${c}" aria-label="Ink colour ${i + 1}"><i style="background:${c}"></i></button>`).join('')}
        <div class="sep"></div>
        ${SIZES.map((s, i) => `<button class="size-dot" data-size="${i}" aria-label="Size ${i + 1}"><i style="width:${4 + i * 3}px;height:${4 + i * 3}px"></i></button>`).join('')}
        <div class="sep"></div>
        <button class="tool" id="undoBtn" aria-label="Undo">${I.undo()}</button>
        <button class="tool" id="redoBtn" aria-label="Redo">${I.redo()}</button>
      </div>
      <div class="ed-right">
        <button class="icon glass press" id="edAdd" aria-label="Add page">${I.plus(20)}</button>
        <button class="icon glass press" id="edMore" aria-label="More">${I.more()}</button>
        <button class="btn acc press" id="edSolve" style="height:44px;box-shadow:0 10px 30px rgba(0,0,0,.18)">${I.spark()} Solve</button>
      </div>
    </div>
    <div id="scroller"><div id="pages"></div></div>
    <div class="zoom-pill glass"><button id="zOut" aria-label="Zoom out">${I.minus()}</button><span id="zVal">100%</span><button id="zIn" aria-label="Zoom in">${I.plus(18)}</button></div>
    <input type="file" id="edPdf" accept="application/pdf,.pdf" class="hide">`;
  ED.querySelector('#edBack').onclick = async () => { const cb = st.onClose; await closeEditor(); cb && cb(); };
  ED.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  ED.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { st.color = +b.dataset.color; if (st.tool === 'eraser' || st.tool === 'lasso') setTool('pen'); refreshToolbar(); });
  ED.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { st.size = +b.dataset.size; refreshToolbar(); });
  ED.querySelector('#undoBtn').onclick = undo;
  ED.querySelector('#redoBtn').onclick = redo;
  ED.querySelector('#edAdd').onclick = () => newPageSheet(st.nb.id, st.current, async (p) => { await reloadPages(); scrollToPage(p.id); });
  ED.querySelector('#edMore').onclick = (e) => moreMenu(e.currentTarget);
  ED.querySelector('#edSolve').onclick = () => openSolve(solveCtx(null));
  ED.querySelector('#zIn').onclick = () => setZoom(st.zoom * 1.25);
  ED.querySelector('#zOut').onclick = () => setZoom(st.zoom / 1.25);
  ED.querySelector('#edPdf').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    await importPdfFile(f, st.nb.classId, (m) => toast(m, 4000), st.nb.id);
    await reloadPages(); toast('Added ' + f.name);
  };
  const sc = ED.querySelector('#scroller');
  // Pencil must never scroll the page; fingers scroll unless finger drawing is on.
  const blockStylus = (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (t.touchType === 'stylus' || (st.settings.fingerDraw && e.touches.length === 1 && st.tool !== null)) e.preventDefault();
  };
  sc.addEventListener('touchstart', blockStylus, { passive: false });
  sc.addEventListener('touchmove', blockStylus, { passive: false });
  // Pinch to zoom (Safari gesture events)
  let z0 = 1;
  sc.addEventListener('gesturestart', (e) => { e.preventDefault(); z0 = st.zoom; });
  sc.addEventListener('gesturechange', (e) => { e.preventDefault(); const pg = ED.querySelector('#pages'); pg.style.transform = `scale(${Math.max(.5, Math.min(3, z0 * e.scale)) / st.zoom})`; });
  sc.addEventListener('gestureend', (e) => { e.preventDefault(); ED.querySelector('#pages').style.transform = ''; setZoom(z0 * e.scale); });
  sc.addEventListener('scroll', onScroll, { passive: true });
  st.onResize = () => layout(true);
  window.addEventListener('resize', st.onResize);
  st.onVis = () => { if (document.visibilityState === 'hidden') flushAll(); };
  document.addEventListener('visibilitychange', st.onVis);
  refreshToolbar();
}

function refreshToolbar() {
  ED.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === st.tool));
  ED.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', +b.dataset.color === st.color && st.tool !== 'eraser' && st.tool !== 'lasso'));
  ED.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === st.size));
  ED.querySelector('#undoBtn').disabled = !st.undo.length;
  ED.querySelector('#redoBtn').disabled = !st.redo.length;
}
function setTool(t) { st.tool = t; clearSelection(); refreshToolbar(); }

function moreMenu(anchor) {
  const p = st.pages.find(x => x.id === st.current);
  const items = [
    { label: 'Add a PDF to this notebook', icon: I.file(), run: () => ED.querySelector('#edPdf').click() },
    { label: 'Rename notebook', icon: I.edit(), run: async () => { const n = await askText({ title: 'Rename notebook', value: st.nb.name }); if (n) { st.nb = await S.updateNotebook(st.nb.id, { name: n }); ED.querySelector('.ed-title b').textContent = n; } } }
  ];
  if (p && p.paper !== 'pdf') {
    items.push({ label: 'Change paper of this page', icon: I.file(), run: () => changePaper(p) });
  }
  items.push('hr',
    { label: 'Clear writing on this page', icon: I.eraser(18), danger: true, run: async () => { if (await confirmSheet({ title: 'Clear this page?', body: 'Removes all your writing on it. You can undo right after.', ok: 'Clear' })) { const strokes = st.inkCache.get(p.id) || []; pushUndo({ page: p.id, type: 'remove', strokes: strokes.slice() }); st.inkCache.set(p.id, []); changed(p.id); } } },
    { label: 'Delete this page', icon: I.trash(), danger: true, run: async () => { if (await confirmSheet({ title: 'Delete this page?', body: 'The page and its writing are deleted.' })) { await S.deletePage(p.id); st.inkCache.delete(p.id); if (!(await S.listPages(st.nb.id)).length) await S.createPage(st.nb.id, { paper: st.settings.defaultPaper || 'graph' }); await reloadPages(); toast('Page deleted'); } } });
  menu(anchor, items);
}
function changePaper(p) {
  const m = menu(ED.querySelector('#edMore'), S.PAPERS.map(pp => ({ label: pp.name, run: async () => { await S.updatePage(p.id, { paper: pp.id }); await reloadPages(); } })));
  return m;
}

// ---------------- layout + virtualization ----------------
function layout(keep) {
  const sc = ED.querySelector('#scroller');
  const ratio = keep ? sc.scrollTop / Math.max(1, sc.scrollHeight) : 0;
  st.baseW = Math.min(sc.clientWidth - 40, 860);
  const pagesEl = ED.querySelector('#pages');
  const existing = new Map(Array.from(pagesEl.children).map(el => [el.dataset.id, el]));
  st.pages.forEach((p, i) => {
    let el = existing.get(p.id);
    if (!el) {
      el = h(`<div class="page" data-id="${p.id}"><span class="pnum">${i + 1}</span></div>`);
      attachPointer(el, p.id);
    }
    existing.delete(p.id);
    pagesEl.appendChild(el);
    el.querySelector('.pnum').textContent = i + 1;
    styleOne(p, el);
  });
  existing.forEach((el, id) => { unmount(id); el.remove(); });
  if (!st.io) {
    st.io = new IntersectionObserver((entries) => {
      entries.forEach(en => { const id = en.target.dataset.id; if (en.isIntersecting) mount(id); else unmount(id); });
    }, { root: sc, rootMargin: '120% 0px' });
  }
  ED.querySelectorAll('.page').forEach(el => { st.io.unobserve(el); st.io.observe(el); });
  // re-render mounted at new size
  for (const id of Array.from(st.mounted.keys())) { unmount(id); mount(id); }
  if (keep) sc.scrollTop = ratio * sc.scrollHeight;
  ED.querySelector('#zVal').textContent = Math.round(st.zoom * 100) + '%';
  updatePageNo();
}
function styleOne(p, el) {
  const w = st.baseW * st.zoom, scale = w / p.w, hh = p.h * scale;
  el.style.width = w + 'px'; el.style.height = hh + 'px';
  el.className = 'page' + (p.paper && p.paper !== 'pdf' && p.paper !== 'blank' ? ' paper-' + p.paper : '');
  const sp = PAPER_SPACING[p.paper];
  if (sp) { el.style.backgroundSize = p.paper === 'lined' ? `100% ${sp * scale}px` : `${sp * scale}px ${sp * scale}px`; el.style.backgroundPosition = p.paper === 'lined' ? `0 ${96 * scale}px` : `${(p.w % sp) / 2 * scale}px ${(p.h % sp) / 2 * scale}px`; }
  else { el.style.backgroundSize = ''; el.style.backgroundPosition = ''; }
}
async function reloadPages() {
  st.pages = await S.listPages(st.nb.id);
  layout(true);
}
function setZoom(z) {
  z = Math.max(0.6, Math.min(3, z));
  const sc = ED.querySelector('#scroller');
  const centerRatio = (sc.scrollTop + sc.clientHeight / 2) / Math.max(1, sc.scrollHeight);
  st.zoom = z;
  layout(false);
  sc.scrollTop = centerRatio * sc.scrollHeight - sc.clientHeight / 2;
  sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
}
function scrollToPage(id, smooth = true) {
  const el = ED.querySelector(`.page[data-id="${id}"]`);
  if (!el) return;
  const sc = ED.querySelector('#scroller');
  sc.scrollTo({ top: el.offsetTop - 84, behavior: smooth ? 'smooth' : 'auto' });
  st.current = id; updatePageNo();
}
let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!st) return;
    const sc = ED.querySelector('#scroller');
    const mid = sc.scrollTop + sc.clientHeight * 0.4;
    let best = null;
    ED.querySelectorAll('.page').forEach(el => { if (el.offsetTop <= mid) best = el.dataset.id; });
    if (best && best !== st.current) { st.current = best; updatePageNo(); S.setLastPage({ pageId: best, notebookId: st.nb.id }); }
  });
}
function updatePageNo() {
  const i = st.pages.findIndex(p => p.id === st.current);
  const n = ED.querySelector('#edPageNo');
  if (n) n.textContent = `${st.cls ? st.cls.name + ', ' : ''}page ${i + 1} of ${st.pages.length}`;
}

async function mount(id) {
  if (!st || st.mounted.has(id)) return;
  const p = st.pages.find(x => x.id === id); const el = ED.querySelector(`.page[data-id="${id}"]`);
  if (!p || !el) return;
  const m = { el };
  st.mounted.set(id, m);
  const w = el.clientWidth, hh = el.clientHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const maxPx = 6e6;
  if (w * hh * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * hh));
  if (p.paper === 'pdf') {
    const img = document.createElement('img'); img.className = 'bg'; img.alt = '';
    el.insertBefore(img, el.firstChild); m.img = img;
    let r = await db.get('renders', id);
    if (!r) {
      try { const blob = await renderPdfPageBlob(p.pdfId, p.pdfPage, 1632); r = { pageId: id, blob }; await db.put('renders', r); }
      catch (e) { console.warn(e); }
    }
    if (r && st && st.mounted.get(id) === m) { m.url = URL.createObjectURL(r.blob); img.src = m.url; }
  }
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
  el.appendChild(c);
  m.canvas = c; m.ctx = c.getContext('2d'); m.scale = (w / p.w) * dpr; m.cssScale = w / p.w;
  if (!st.inkCache.has(id)) st.inkCache.set(id, (await S.getInk(id)).strokes || []);
  if (!st || st.mounted.get(id) !== m) return;
  redraw(id);
  if (!p.thumb) { st.thumbsDirty.add(id); if (p.paper === 'pdf' && m.img && !m.img.complete) m.img.addEventListener('load', () => st && makeThumb(id), { once: true }); else makeThumb(id); }
}
function unmount(id) {
  const m = st && st.mounted.get(id);
  if (!m) return;
  if (st.thumbsDirty.has(id)) makeThumb(id);
  if (m.canvas) { m.canvas.width = 0; m.canvas.height = 0; m.canvas.remove(); }
  if (m.live) { m.live.width = 0; m.live.remove(); }
  if (m.img) { m.img.remove(); }
  if (m.url) URL.revokeObjectURL(m.url);
  st.mounted.delete(id);
}

// ---------------- drawing ----------------
function strokePath(s, scale) {
  const pts = [];
  for (let i = 0; i < s.p.length; i += 3) pts.push([s.p[i] * scale, s.p[i + 1] * scale, s.p[i + 2]]);
  const hasP = s.pr;
  const size = s.s * scale * (s.t === 'hi' ? 4.2 : 1.6);
  const outline = getStroke(pts, s.t === 'hi'
    ? { size, thinning: 0, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last: true, start: { cap: false }, end: { cap: false } }
    : { size, thinning: 0.55, smoothing: 0.55, streamline: 0.42, simulatePressure: !hasP, last: true });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[i + 1];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}
function paintStroke(ctx, s, scale) {
  ctx.save();
  if (s.t === 'hi') { ctx.globalAlpha = st.dark ? 0.4 : 0.32; }
  ctx.fillStyle = resolveColor(s.c, s.forceLight ? false : st && st.dark);
  ctx.fill(strokePath(s, scale));
  ctx.restore();
}
function redraw(id) {
  const m = st.mounted.get(id); if (!m || !m.ctx) return;
  const { ctx, canvas, scale } = m;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const strokes = st.inkCache.get(id) || [];
  // highlighter under pen
  strokes.forEach(s => { if (s.t === 'hi') paintStroke(ctx, s, scale); });
  strokes.forEach(s => { if (s.t !== 'hi') paintStroke(ctx, s, scale); });
  if (st.sel && st.sel.page === id) drawSelection(m);
}
function liveCanvas(m) {
  if (!m.live) {
    const c = document.createElement('canvas'); c.width = m.canvas.width; c.height = m.canvas.height;
    c.style.pointerEvents = 'none'; m.el.appendChild(c); m.live = c; m.lctx = c.getContext('2d');
  }
  return m.lctx;
}

function attachPointer(el, id) {
  el.addEventListener('pointerdown', (e) => onDown(e, id));
  el.addEventListener('pointermove', (e) => onMove(e, id));
  el.addEventListener('pointerup', (e) => onUp(e, id));
  el.addEventListener('pointercancel', (e) => onUp(e, id, true));
}
function canDraw(e) { return e.pointerType === 'pen' || e.pointerType === 'mouse' || (st.settings.fingerDraw && e.pointerType === 'touch'); }
function toPage(e, id) {
  const m = st.mounted.get(id); const r = m.el.getBoundingClientRect();
  return [(e.clientX - r.left) / m.cssScale, (e.clientY - r.top) / m.cssScale, e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5];
}

function onDown(e, id) {
  if (!st || !st.mounted.get(id) || !st.mounted.get(id).ctx) return;
  // a finger (or Pencil) on an active selection moves it
  if (st.sel && st.sel.page === id) {
    const [x, y] = toPage(e, id);
    const b = st.sel.box;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      e.preventDefault(); el(e).setPointerCapture(e.pointerId);
      st.drawing = { mode: 'move', id, x0: x, y0: y, dx: 0, dy: 0, pid: e.pointerId };
      hideLassoMenu();
      return;
    }
    if (canDraw(e)) clearSelection();
  }
  if (!canDraw(e)) return;
  e.preventDefault();
  el(e).setPointerCapture(e.pointerId);
  if (st.current !== id) { st.current = id; updatePageNo(); }
  const pt = toPage(e, id);
  if (st.tool === 'eraser') { st.drawing = { mode: 'erase', id, removed: [], pid: e.pointerId }; eraseAt(id, pt); return; }
  if (st.tool === 'lasso') { clearSelection(); st.drawing = { mode: 'lasso', id, pts: [pt[0], pt[1]], pid: e.pointerId }; return; }
  st.drawing = { mode: 'ink', id, pid: e.pointerId, stroke: { id: S_uid(), t: st.tool === 'hi' ? 'hi' : 'pen', c: KEYS[st.color], s: SIZES[st.size], pr: e.pointerType === 'pen', p: pt.slice() } };
}
const el = (e) => e.currentTarget;
function S_uid() { return Math.random().toString(36).slice(2, 10); }

function onMove(e, id) {
  const d = st && st.drawing; if (!d || d.pid !== e.pointerId || d.id !== id) return;
  e.preventDefault();
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
  const m = st.mounted.get(id); if (!m) return;
  if (d.mode === 'ink') {
    for (const ev of evs) { const p = toPage(ev, id); d.stroke.p.push(p[0], p[1], p[2]); }
    const lctx = liveCanvas(m);
    lctx.clearRect(0, 0, m.live.width, m.live.height);
    paintStroke(lctx, d.stroke, m.scale);
  } else if (d.mode === 'erase') {
    for (const ev of evs) eraseAt(id, toPage(ev, id));
  } else if (d.mode === 'lasso') {
    for (const ev of evs) { const p = toPage(ev, id); d.pts.push(p[0], p[1]); }
    const lctx = liveCanvas(m);
    lctx.clearRect(0, 0, m.live.width, m.live.height);
    lctx.save(); lctx.setLineDash([8, 8]); lctx.lineWidth = 2; lctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--acc');
    lctx.beginPath();
    for (let i = 0; i < d.pts.length; i += 2) lctx[i ? 'lineTo' : 'moveTo'](d.pts[i] * m.scale, d.pts[i + 1] * m.scale);
    lctx.stroke(); lctx.restore();
  } else if (d.mode === 'move') {
    const [x, y] = toPage(e, id);
    d.dx = x - d.x0; d.dy = y - d.y0;
    const lctx = liveCanvas(m);
    lctx.clearRect(0, 0, m.live.width, m.live.height);
    m.canvas.style.opacity = '1';
    lctx.save(); lctx.translate(d.dx * m.scale, d.dy * m.scale);
    st.sel.strokes.forEach(s => paintStroke(lctx, s, m.scale));
    lctx.restore();
  }
}

function onUp(e, id, cancelled) {
  const d = st && st.drawing; if (!d || d.pid !== e.pointerId) return;
  st.drawing = null;
  const m = st.mounted.get(d.id);
  if (m && m.live) m.lctx.clearRect(0, 0, m.live.width, m.live.height);
  if (d.mode === 'ink') {
    if (cancelled || d.stroke.p.length < 3) return;
    if (d.stroke.p.length === 3) d.stroke.p.push(d.stroke.p[0] + 0.3, d.stroke.p[1] + 0.3, d.stroke.p[2]);
    const arr = st.inkCache.get(d.id) || []; arr.push(d.stroke); st.inkCache.set(d.id, arr);
    pushUndo({ page: d.id, type: 'add', strokes: [d.stroke] });
    if (m) paintStroke(m.ctx, d.stroke, m.scale);
    changed(d.id, false);
  } else if (d.mode === 'erase') {
    if (d.removed.length) { pushUndo({ page: d.id, type: 'remove', strokes: d.removed }); changed(d.id, false); }
  } else if (d.mode === 'lasso') {
    finishLasso(d);
  } else if (d.mode === 'move') {
    if (Math.abs(d.dx) + Math.abs(d.dy) > 0.5) {
      moveStrokes(st.sel.strokes, d.dx, d.dy);
      st.sel.box.x += d.dx; st.sel.box.y += d.dy;
      pushUndo({ page: d.id, type: 'move', strokes: st.sel.strokes.slice(), dx: d.dx, dy: d.dy });
      changed(d.id);
    } else redraw(d.id);
    showLassoMenu();
  }
}

function moveStrokes(strokes, dx, dy) { strokes.forEach(s => { for (let i = 0; i < s.p.length; i += 3) { s.p[i] += dx; s.p[i + 1] += dy; } delete s.bb; }); }
function bbox(s) {
  if (s.bb) return s.bb;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < s.p.length; i += 3) { const x = s.p[i], y = s.p[i + 1]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const pad = s.s * (s.t === 'hi' ? 3 : 1.2);
  return (s.bb = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });
}
function eraseAt(id, [x, y]) {
  const arr = st.inkCache.get(id) || [];
  const r = 9;
  const keep = [];
  let hit = false;
  for (const s of arr) {
    const b = bbox(s);
    let gone = false;
    if (x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r) {
      for (let i = 0; i < s.p.length; i += 3) { const dx = s.p[i] - x, dy = s.p[i + 1] - y; if (dx * dx + dy * dy < (r + s.s) * (r + s.s)) { gone = true; break; } }
    }
    if (gone) { st.drawing.removed.push(s); hit = true; } else keep.push(s);
  }
  if (hit) { st.inkCache.set(id, keep); redraw(id); }
}

// ---------------- lasso ----------------
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function finishLasso(d) {
  if (d.pts.length < 8) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < d.pts.length; i += 2) { x0 = Math.min(x0, d.pts[i]); x1 = Math.max(x1, d.pts[i]); y0 = Math.min(y0, d.pts[i + 1]); y1 = Math.max(y1, d.pts[i + 1]); }
  const arr = st.inkCache.get(d.id) || [];
  const chosen = arr.filter(s => {
    let inside = 0, n = 0;
    for (let i = 0; i < s.p.length; i += 9) { n++; if (pointInPoly(s.p[i], s.p[i + 1], d.pts)) inside++; }
    return n && inside / n >= 0.5;
  });
  const area = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  let box = area;
  if (chosen.length) {
    const bs = chosen.map(bbox);
    const bx0 = Math.min(...bs.map(b => b.x0)), by0 = Math.min(...bs.map(b => b.y0));
    box = { x: bx0, y: by0, w: Math.max(...bs.map(b => b.x1)) - bx0, h: Math.max(...bs.map(b => b.y1)) - by0 };
  }
  st.sel = { page: d.id, strokes: chosen, box, area, poly: d.pts };
  redraw(d.id);
  showLassoMenu();
}
function drawSelection(m) {
  const b = st.sel.box, s = m.scale;
  const ctx = m.ctx;
  ctx.save(); ctx.setLineDash([7, 6]); ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--acc');
  ctx.strokeRect((b.x - 6) * s, (b.y - 6) * s, (b.w + 12) * s, (b.h + 12) * s);
  ctx.restore();
}
function clearSelection() {
  if (!st || !st.sel) return;
  const id = st.sel.page; st.sel = null; hideLassoMenu(); redraw(id);
}
function hideLassoMenu() { const m = ED.querySelector('.lasso-menu'); if (m) m.remove(); }
function showLassoMenu() {
  hideLassoMenu();
  if (!st.sel) return;
  const m = st.mounted.get(st.sel.page); if (!m) return;
  const b = st.sel.box, scale = m.cssScale;
  const r = m.el.getBoundingClientRect();
  const menuEl = h(`<div class="lasso-menu glass">
    <button class="acc" data-a="solve">${I.spark(16)} Solve</button>
    ${st.sel.strokes.length ? `<button data-a="move">${I.move(16)} Move</button><button data-a="color">Color</button><button data-a="del" style="color:var(--bad)">${I.trash(16)}</button>` : ''}
    <button data-a="x" aria-label="Done">${I.close(14)}</button></div>`);
  ED.appendChild(menuEl);
  let top = r.top + (b.y - 6) * scale - 56;
  if (top < 80) top = r.top + (b.y + b.h + 8) * scale;
  menuEl.style.top = Math.min(window.innerHeight - 60, top) + 'px';
  menuEl.style.left = Math.max(10, Math.min(window.innerWidth - menuEl.offsetWidth - 10, r.left + b.x * scale)) + 'px';
  menuEl.querySelector('[data-a="solve"]').onclick = () => { const ctx = solveCtx(st.sel); hideLassoMenu(); openSolve(ctx); };
  const mv = menuEl.querySelector('[data-a="move"]'); if (mv) mv.onclick = () => toast('Drag the selection with your finger or Pencil');
  const col = menuEl.querySelector('[data-a="color"]');
  if (col) col.onclick = () => {
    menu(col, inkColors().map((c, i) => ({ label: ['Black', 'Blue', 'Red', 'Green'][i], icon: `<i style="display:inline-block;width:16px;height:16px;border-radius:99px;background:${c}"></i>`, run: () => {
      const before = st.sel.strokes.map(s => s.c);
      st.sel.strokes.forEach(s => { s.c = KEYS[i]; });
      pushUndo({ page: st.sel.page, type: 'color', strokes: st.sel.strokes.slice(), before, after: KEYS[i] });
      changed(st.sel.page);
    } })));
  };
  const del = menuEl.querySelector('[data-a="del"]');
  if (del) del.onclick = () => {
    const id = st.sel.page, gone = new Set(st.sel.strokes);
    st.inkCache.set(id, (st.inkCache.get(id) || []).filter(s => !gone.has(s)));
    pushUndo({ page: id, type: 'remove', strokes: Array.from(gone) });
    st.sel = null; hideLassoMenu(); changed(id);
  };
  menuEl.querySelector('[data-a="x"]').onclick = clearSelection;
}

// ---------------- undo ----------------
function pushUndo(op) { st.undo.push(op); if (st.undo.length > 200) st.undo.shift(); st.redo = []; refreshToolbar(); }
function apply(op, reverse) {
  const arr = st.inkCache.get(op.page) || [];
  const add = (op.type === 'add') !== reverse;
  if (op.type === 'add' || op.type === 'remove') {
    if (add) st.inkCache.set(op.page, arr.concat(op.strokes.filter(s => !arr.includes(s))));
    else { const gone = new Set(op.strokes); st.inkCache.set(op.page, arr.filter(s => !gone.has(s))); }
  } else if (op.type === 'move') {
    moveStrokes(op.strokes, reverse ? -op.dx : op.dx, reverse ? -op.dy : op.dy);
  } else if (op.type === 'color') {
    op.strokes.forEach((s, i) => { s.c = reverse ? op.before[i] : op.after; });
  }
  if (st.sel) { st.sel = null; hideLassoMenu(); }
  changed(op.page);
  if (!st.mounted.has(op.page)) scrollToPage(op.page);
}
function undo() { const op = st.undo.pop(); if (!op) return; apply(op, true); st.redo.push(op); refreshToolbar(); }
function redo() { const op = st.redo.pop(); if (!op) return; apply(op, false); st.undo.push(op); refreshToolbar(); }

// ---------------- saving ----------------
let saveTimer = 0;
function changed(id, doRedraw = true) {
  st.dirty.add(id); st.thumbsDirty.add(id);
  if (doRedraw) redraw(id);
  refreshToolbar();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushInk, 700);
}
async function flushInk() {
  if (!st) return;
  const ids = Array.from(st.dirty); st.dirty.clear();
  for (const id of ids) await S.saveInk(id, (st.inkCache.get(id) || []).map(s => ({ id: s.id, t: s.t, c: s.c, s: s.s, pr: s.pr, p: s.p })));
  if (ids.length) S.markActive();
}
async function flushAll() {
  if (!st) return;
  clearTimeout(saveTimer);
  await flushInk();
  for (const id of Array.from(st.thumbsDirty)) await makeThumb(id);
}
async function makeThumb(id) {
  if (!st) return;
  st.thumbsDirty.delete(id);
  const p = st.pages.find(x => x.id === id); if (!p) return;
  const W = 240, scale = W / p.w, H = Math.round(p.h * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const paperCol = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff';
  ctx.fillStyle = paperCol; ctx.fillRect(0, 0, W, H);
  const m = st.mounted.get(id);
  if (p.paper === 'pdf' && m && m.img && m.img.complete && m.img.naturalWidth) ctx.drawImage(m.img, 0, 0, W, H);
  else if (p.paper === 'pdf') {
    const r = await db.get('renders', id);
    if (r) { try { const bmp = await createImageBitmap(r.blob); ctx.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close(); } catch (e) {} }
  } else drawPaper(ctx, p, scale);
  const strokes = st ? (st.inkCache.get(id) || []) : [];
  strokes.forEach(s => { if (s.t === 'hi') paintStroke(ctx, s, scale); });
  strokes.forEach(s => { if (s.t !== 'hi') paintStroke(ctx, s, scale); });
  const thumb = c.toDataURL('image/jpeg', 0.7);
  await S.updatePage(id, { thumb });
  if (st) { const pp = st.pages.find(x => x.id === id); if (pp) pp.thumb = thumb; }
}
export function drawPaper(ctx, p, scale, ox = 0, oy = 0, W, H) {
  const sp = PAPER_SPACING[p.paper]; if (!sp) return;
  const cs = getComputedStyle(document.documentElement);
  W = W || p.w * scale; H = H || p.h * scale;
  ctx.save();
  if (p.paper === 'lined') { ctx.strokeStyle = cs.getPropertyValue('--rule'); ctx.lineWidth = 1; for (let y = 96; y < p.h; y += sp) { const yy = y * scale - oy; if (yy < 0 || yy > H) continue; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); } }
  else if (p.paper === 'graph') { ctx.strokeStyle = cs.getPropertyValue('--grid'); ctx.lineWidth = 1; const offx = (p.w % sp) / 2, offy = (p.h % sp) / 2; for (let x = offx; x < p.w; x += sp) { const xx = x * scale - ox; if (xx < 0 || xx > W) continue; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, H); ctx.stroke(); } for (let y = offy; y < p.h; y += sp) { const yy = y * scale - oy; if (yy < 0 || yy > H) continue; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); } }
  else if (p.paper === 'dot') { ctx.fillStyle = cs.getPropertyValue('--bar'); for (let x = sp / 2; x < p.w; x += sp) for (let y = sp / 2; y < p.h; y += sp) { const xx = x * scale - ox, yy = y * scale - oy; if (xx < 0 || yy < 0 || xx > W || yy > H) continue; ctx.beginPath(); ctx.arc(xx, yy, 1.2, 0, 7); ctx.fill(); } }
  ctx.restore();
}

// ---------------- data for Solve ----------------
function solveCtx(sel) {
  const page = sel ? st.pages.find(p => p.id === sel.page) : st.pages.find(p => p.id === st.current);
  return {
    page, sel, cls: st.cls, nb: st.nb,
    // problem image (paper + PDF + your ink) inside the lasso, as base64 JPEG
    async image() {
      if (!sel) return null;
      const a = sel.area, pad = 8;
      const x = Math.max(0, a.x - pad), y = Math.max(0, a.y - pad), w = Math.min(page.w - x, a.w + pad * 2), hh = Math.min(page.h - y, a.h + pad * 2);
      const scale = Math.min(3, 1400 / Math.max(w, hh));
      const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(hh * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      if (page.paper === 'pdf') {
        const r = await db.get('renders', page.id);
        if (r) { const bmp = await createImageBitmap(r.blob); const k = bmp.width / page.w; ctx.drawImage(bmp, x * k, y * k, w * k, hh * k, 0, 0, c.width, c.height); bmp.close && bmp.close(); }
      }
      // ink in dark colours so the reader sees it clearly on white
      const strokes = st.inkCache.get(page.id) || [];
      ctx.save(); ctx.translate(-x * scale, -y * scale);
      strokes.forEach(s => {
        const b = bbox(s); if (b.x1 < x || b.x0 > x + w || b.y1 < y || b.y0 > y + hh) return;
        paintStroke(ctx, { ...s, forceLight: true }, scale);
      });
      ctx.restore();
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    },
    // printed text inside the lasso (teacher's PDF), no AI needed
    text() {
      if (!sel || !page.text || !page.text.length) return '';
      const a = sel.area;
      const items = page.text.filter(t => { const cx = t.x + t.w / 2, cy = t.y + t.h / 2; return cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h; });
      return itemsToText(items);
    },
    hasInk() { return !!(sel && sel.strokes.length); },
    gotoPage: (id) => scrollToPage(id)
  };
}

// Rebuild math text from PDF text pieces: lines top to bottom, raised small pieces become exponents.
export function itemsToText(items) {
  if (!items.length) return '';
  const sorted = items.slice().sort((a, b) => (a.y + a.h) - (b.y + b.h));
  const lines = [];
  for (const it of sorted) {
    const base = it.y + it.h;
    const line = lines.find(l => Math.abs(l.base - base) < Math.max(l.h, it.h) * 0.75);
    if (line) { line.items.push(it); if (it.h > line.h) { line.h = it.h; line.base = base; } } else lines.push({ base, h: it.h, items: [it] });
  }
  return lines.sort((a, b) => a.base - b.base).map(l => {
    l.items.sort((a, b) => a.x - b.x);
    let out = '';
    l.items.forEach((it, i) => {
      const raised = it.h < l.h * 0.8 && (it.y + it.h) < l.base - l.h * 0.15;
      const prev = l.items[i - 1];
      const gap = prev ? it.x - (prev.x + prev.w) : 0;
      if (raised) out += '^' + (it.s.trim().length > 1 ? '(' + it.s.trim() + ')' : it.s.trim());
      else out += (prev && gap > it.h * 0.15 && !out.endsWith(' ') ? ' ' : '') + it.s;
    });
    return out;
  }).join('\n').trim();
}
