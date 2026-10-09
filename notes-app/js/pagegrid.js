// Long-press a page in a notebook's grid to drag it to a new spot.
// Long-press and let go without moving opens the page menu. A normal tap still opens the page.
const HOLD_MS = 420, SLOP = 10, EDGE = 90;

export function enablePageDrag(grid, { onOpen, onMenu, onReorder }) {
  let hold = null;   // pending long-press
  let drag = null;   // active drag
  let suppressClick = false;

  const tiles = () => Array.from(grid.querySelectorAll('.pg[data-page]'));

  grid.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.pg[data-page]');
    if (!tile || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    hold = { tile, pid: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => startDrag(e.clientX, e.clientY), HOLD_MS) };
  });
  grid.addEventListener('pointermove', (e) => {
    if (hold && e.pointerId === hold.pid && !drag) {
      if (Math.abs(e.clientX - hold.x) + Math.abs(e.clientY - hold.y) > SLOP) cancelHold(); // it is a scroll
      else { hold.x = e.clientX; hold.y = e.clientY; }
      return;
    }
  });
  grid.addEventListener('pointerup', (e) => { if (hold && e.pointerId === hold.pid) cancelHold(); });
  grid.addEventListener('pointercancel', (e) => { if (hold && e.pointerId === hold.pid) cancelHold(); });
  // during a drag, listen on the whole window so a lift anywhere always ends it
  const wMove = (e) => { if (drag && e.pointerId === drag.pid) { e.preventDefault(); moveDrag(e.clientX, e.clientY); } };
  const wUp = (e) => { if (drag && e.pointerId === drag.pid) endDrag(false); };
  const wCancel = (e) => { if (drag && e.pointerId === drag.pid) endDrag(true); };
  // once a page is picked up, the finger must not scroll the screen (Safari needs a non-passive touchmove)
  grid.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.pg[data-page]')) e.preventDefault(); });
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.pg[data-page]');
    if (!tile) return;
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    onOpen(tile.dataset.page);
  }, true);

  function cancelHold() { if (hold) clearTimeout(hold.timer); hold = null; }

  function startDrag(x, y) {
    if (!hold) return;
    const tile = hold.tile, r = tile.getBoundingClientRect();
    const ghost = tile.cloneNode(true);
    ghost.classList.add('pg-ghost');
    ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
    ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost);
    tile.classList.add('pg-hole');
    grid.classList.add('dragging');
    try { tile.setPointerCapture(hold.pid); } catch (err) {}
    drag = { tile, ghost, pid: hold.pid, ox: x - r.left, oy: y - r.top, x0: x, y0: y, moved: false, before: tiles().map(t => t.dataset.page), x, y, raf: 0 };
    hold = null;
    suppressClick = true;
    if (navigator.vibrate) navigator.vibrate(10);
    drag.raf = requestAnimationFrame(autoScroll);
    window.addEventListener('pointermove', wMove, { passive: false });
    window.addEventListener('pointerup', wUp);
    window.addEventListener('pointercancel', wCancel);
  }

  function moveDrag(x, y) {
    drag.x = x; drag.y = y;
    if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > SLOP) drag.moved = true;
    drag.ghost.style.transform = `translate(${x - drag.ox - parseFloat(drag.ghost.style.left)}px,${y - drag.oy - parseFloat(drag.ghost.style.top)}px) scale(1.06)`;
    placeHole(x, y);
  }

  // put the hole before or after the tile under the finger
  function placeHole(x, y) {
    const over = tiles().find(t => { if (t === drag.tile) return false; const r = t.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
    if (!over) return;
    const r = over.getBoundingClientRect();
    const after = x > r.left + r.width / 2;
    const ref = after ? over.nextSibling : over;
    if (ref === drag.tile || ref === drag.tile.nextSibling) return; // already there
    flip(() => grid.insertBefore(drag.tile, ref));
  }

  // smooth slide of the other tiles when the hole moves (FLIP)
  function flip(change) {
    const all = tiles(), first = new Map(all.map(t => [t, t.getBoundingClientRect()]));
    change();
    all.forEach(t => {
      const a = first.get(t), b = t.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      t.style.transition = 'none'; t.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => { t.style.transition = 'transform .45s cubic-bezier(.2,1.3,.35,1)'; t.style.transform = ''; });
    });
  }

  function autoScroll() {
    if (!drag) return;
    const v = drag.y < EDGE ? -(EDGE - drag.y) / 5 : drag.y > window.innerHeight - EDGE ? (drag.y - (window.innerHeight - EDGE)) / 5 : 0;
    if (v) { window.scrollBy(0, v); placeHole(drag.x, drag.y); }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function endDrag(cancelled) {
    const d = drag; drag = null;
    cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', wMove);
    window.removeEventListener('pointerup', wUp);
    window.removeEventListener('pointercancel', wCancel);
    grid.classList.remove('dragging');
    // fly the ghost into the hole, then drop it
    const r = d.tile.getBoundingClientRect();
    d.ghost.style.transition = 'transform .4s cubic-bezier(.2,1.3,.35,1)';
    d.ghost.style.transform = `translate(${r.left - parseFloat(d.ghost.style.left)}px,${r.top - parseFloat(d.ghost.style.top)}px)`;
    setTimeout(() => { d.ghost.remove(); d.tile.classList.remove('pg-hole'); }, 380);
    const after = tiles().map(t => t.dataset.page);
    if (!d.moved) { if (!cancelled) onMenu(d.tile.dataset.page, d.tile); return; }
    if (after.join() !== d.before.join()) onReorder(after);
  }
}
