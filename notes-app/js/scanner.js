// Scan pages with the camera: take a photo, the sheet's corners are found (drag them to fix),
// then the page is flattened and cleaned. Several pages in a row, saved together as photo pages.
import { findQuad, refineQuad, shrinkQuad, toGray, insetQuad, warp, enhance, outputSize } from './scan.js';
import { getSettings, saveSettings } from './store.js';
import { h, toast, confirmSheet, I } from './ui.js';

const SRC_MAX = 2400; // longest side kept from the camera photo (12 MP photos are too big for the old iPad)
const DETECT_MAX = 480, REFINE_MAX = 1200;
const MODES = [['clean', 'Clean'], ['bw', 'B&W'], ['color', 'Photo']];

let S = null; // the open scanner: { el, input, src, quad, found, pages, mode, onSave, ... }

// Call straight from a tap (Safari only opens the camera from a tap). onSave(pages) gets
// [{ blob, w, h }] in order when Sam taps Save.
export function startScan({ onSave }) {
  if (S && S.el) return;
  if (S) finish(); // the camera was closed last time without a photo

  S = { el: null, input: null, src: null, quad: null, found: false, pages: [], mode: 'clean', onSave, urls: [] };
  getSettings().then(s => { if (S && MODES.some(m => m[0] === s.scanMode)) S.mode = s.scanMode; });
  const input = h('<input type="file" accept="image/*" capture="environment" class="hide">');
  document.body.appendChild(input);
  S.input = input;
  input.onchange = async () => {
    const f = input.files && input.files[0]; input.value = '';
    if (!f || !S) return;
    await loadPhoto(f);
  };
  input.click();
}

function finish() {
  if (!S) return;
  if (S.src) { S.src.width = 0; S.src.height = 0; }
  S.urls.forEach(u => URL.revokeObjectURL(u));
  if (S.el) S.el.remove();
  if (S.input) S.input.remove();
  if (S.onResize) window.removeEventListener('resize', S.onResize);
  S = null;
}

async function loadPhoto(file) {
  build();
  setBusy('Finding the page...');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // Safari turns the photo the right way up (EXIF) when drawing an <img>
    const k = Math.min(1, SRC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const src = document.createElement('canvas');
    src.width = Math.round(img.naturalWidth * k); src.height = Math.round(img.naturalHeight * k);
    src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
    img.src = '';
    // find the corners on a small copy
    const d = Math.min(1, DETECT_MAX / Math.max(src.width, src.height));
    const sm = document.createElement('canvas');
    sm.width = Math.round(src.width * d); sm.height = Math.round(src.height * d);
    const sctx = sm.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(src, 0, 0, sm.width, sm.height);
    const r = findQuad(sctx.getImageData(0, 0, sm.width, sm.height).data, sm.width, sm.height);
    sm.width = 0; sm.height = 0;
    let quad = r.quad.map(([x, y]) => [x / d, y / d]);
    if (r.found) {
      // sharpen the corners on a bigger copy: the small one is only good to a few pixels
      const k2 = Math.min(1, REFINE_MAX / Math.max(src.width, src.height));
      const md = document.createElement('canvas');
      md.width = Math.round(src.width * k2); md.height = Math.round(src.height * k2);
      const mctx = md.getContext('2d', { willReadFrequently: true });
      mctx.drawImage(src, 0, 0, md.width, md.height);
      const g = toGray(mctx.getImageData(0, 0, md.width, md.height).data, md.width, md.height);
      quad = refineQuad(g, md.width, md.height, quad.map(([x, y]) => [x * k2, y * k2])).map(([x, y]) => [x / k2, y / k2]);
      md.width = 0; md.height = 0;
    }
    if (!S) { src.width = 0; return; }
    if (S.src) { S.src.width = 0; S.src.height = 0; } // the last photo is only let go once this one is ready (Fix last needs it)
    S.src = src;
    S.quad = quad;
    S.found = r.found;
    S.auto = S.quad.map(p => p.slice()); // found corners (or a frame just inside the photo)
    showCrop();
  } catch (e) {
    console.warn(e);
    toast('Could not open that photo');
    if (S && !S.pages.length) finish(); else if (S) showReview();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function build() {
  if (S.el) return;
  S.el = h(`<div id="scan" role="dialog" aria-label="Scan pages">
    <div class="scan-top">
      <button class="btn sm scan-glass press" data-a="cancel">Cancel</button>
      <b class="scan-title"></b>
      <span class="scan-count"></span>
    </div>
    <div class="scan-stage"></div>
    <div class="scan-bar"></div>
    <div class="scan-busy hide"><span class="spinner"></span><span></span></div>
  </div>`);
  document.body.appendChild(S.el);
  S.el.querySelector('[data-a="cancel"]').onclick = async () => {
    if (S.pages.length && !(await confirmSheet({ title: `Throw away ${S.pages.length} scanned page${S.pages.length > 1 ? 's' : ''}?`, body: 'They have not been saved yet.', ok: 'Throw away' }))) return;
    finish();
  };
  S.onResize = () => { if (S && S.step === 'crop') layoutCrop(); };
  window.addEventListener('resize', S.onResize);
}

function setBusy(msg) {
  const b = S.el.querySelector('.scan-busy');
  b.classList.toggle('hide', !msg);
  if (msg) b.lastElementChild.textContent = msg;
}
function setHead(title) {
  S.el.querySelector('.scan-title').textContent = title;
  S.el.querySelector('.scan-count').textContent = S.pages.length ? `${S.pages.length} saved` : '';
}

// ---------- step 1: corners ----------
function showCrop() {
  S.step = 'crop';
  setBusy('');
  setHead(S.found ? 'Check the corners' : 'Drag the corners to the page');
  const stage = S.el.querySelector('.scan-stage');
  stage.innerHTML = `<div class="scan-wrap"><svg class="scan-svg"><path class="scan-shade" fill-rule="evenodd"/><polygon class="scan-poly"/></svg>
    ${[0, 1, 2, 3].map(i => `<div class="scan-h" data-i="${i}"><i></i></div>`).join('')}</div>
    <canvas class="scan-loupe hide"></canvas>`;
  const wrap = stage.firstElementChild;
  wrap.insertBefore(S.src, wrap.firstChild);
  S.src.className = 'scan-photo';
  S.el.querySelector('.scan-bar').innerHTML = `
    <div class="seg scan-seg" id="scanMode"><div class="ind"></div>${MODES.map(([k, l]) => `<button data-m="${k}" class="${S.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="scan-btns">
      <button class="btn scan-glass press" data-a="retake">Retake</button>
      <button class="btn scan-glass press" data-a="whole">Whole photo</button>
      <button class="btn acc press" data-a="keep">${I.check(16, 3)} Keep scan</button>
    </div>`;
  const seg = S.el.querySelector('#scanMode');
  const moveInd = () => { const on = seg.querySelector('button.on'), ind = seg.querySelector('.ind'); if (on) { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft - 4}px)`; } };
  seg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    S.mode = b.dataset.m; seg.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); moveInd();
    saveSettings({ scanMode: S.mode });
  });
  requestAnimationFrame(moveInd);
  const bar = S.el.querySelector('.scan-bar');
  bar.querySelector('[data-a="retake"]').onclick = () => S.input.click();
  bar.querySelector('[data-a="whole"]').onclick = (e) => {
    const whole = e.currentTarget.dataset.whole !== '1';
    S.quad = whole ? insetQuad(S.src.width, S.src.height, 0) : S.auto.map(p => p.slice());
    e.currentTarget.dataset.whole = whole ? '1' : '';
    e.currentTarget.textContent = whole ? 'Find page' : 'Whole photo';
    drawQuad();
  };
  bar.querySelector('[data-a="keep"]').onclick = keep;
  wrap.querySelectorAll('.scan-h').forEach(hd => dragHandle(hd, +hd.dataset.i));
  layoutCrop();
}

function layoutCrop() {
  const stage = S.el.querySelector('.scan-stage'), wrap = stage.querySelector('.scan-wrap');
  if (!wrap) return;
  const sw = stage.clientWidth - 32, sh = stage.clientHeight - 32;
  S.k = Math.min(sw / S.src.width, sh / S.src.height);
  wrap.style.width = Math.round(S.src.width * S.k) + 'px';
  wrap.style.height = Math.round(S.src.height * S.k) + 'px';
  drawQuad();
}

function drawQuad() {
  const wrap = S.el.querySelector('.scan-wrap'); if (!wrap) return;
  const k = S.k, pts = S.quad.map(([x, y]) => [x * k, y * k]);
  const W = S.src.width * k, H = S.src.height * k;
  wrap.querySelector('.scan-poly').setAttribute('points', pts.map(p => p.join(',')).join(' '));
  wrap.querySelector('.scan-shade').setAttribute('d', `M0,0H${W}V${H}H0Z M${pts.map(p => p.join(',')).join(' L')}Z`);
  wrap.querySelectorAll('.scan-h').forEach((hd, i) => { hd.style.transform = `translate(${pts[i][0]}px,${pts[i][1]}px)`; });
}

// Drag a corner with a finger or the Pencil. A magnifier above the finger shows exactly where it is.
function dragHandle(hd, i) {
  const loupe = S.el.querySelector('.scan-loupe');
  hd.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hd.setPointerCapture(e.pointerId);
    hd.classList.add('on');
    const wrap = S.el.querySelector('.scan-wrap');
    const r0 = wrap.getBoundingClientRect();
    const start = S.quad[i].slice(), sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      const x = Math.max(0, Math.min(S.src.width, start[0] + (ev.clientX - sx) / S.k));
      const y = Math.max(0, Math.min(S.src.height, start[1] + (ev.clientY - sy) / S.k));
      S.quad[i] = [x, y];
      drawQuad();
      showLoupe(loupe, x, y, r0.left + x * S.k, r0.top + y * S.k);
    };
    const up = () => {
      hd.classList.remove('on'); loupe.classList.add('hide');
      hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
    };
    hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
    move(e);
  });
}

function showLoupe(c, x, y, px, py) {
  const size = 120, dpr = window.devicePixelRatio || 1, zoom = 3;
  if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; }
  const ctx = c.getContext('2d');
  const span = size / (S.k * zoom); // photo pixels shown across the loupe
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(S.src, x - span / 2, y - span / 2, span, span, 0, 0, c.width, c.height);
  ctx.strokeStyle = '#2F5BEA'; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(c.width / 2, 0); ctx.lineTo(c.width / 2, c.height); ctx.moveTo(0, c.height / 2); ctx.lineTo(c.width, c.height / 2); ctx.stroke();
  c.classList.remove('hide');
  // above the finger (below it near the top of the screen)
  const top = py - size - 70 < 10 ? py + 70 : py - size - 70;
  c.style.transform = `translate(${Math.max(8, Math.min(window.innerWidth - size - 8, px - size / 2))}px,${top}px)`;
}

// ---------- step 2: flatten and clean ----------
async function keep() {
  setBusy('Flattening the page...');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // let the spinner show
  try {
    const { w, h: hh } = outputSize(S.quad, S.src.width, S.src.height);
    const sctx = S.src.getContext('2d', { willReadFrequently: true });
    let px = sctx.getImageData(0, 0, S.src.width, S.src.height).data;
    // a hair inside the edge, so no line of desk shows along the sides
    const cut = shrinkQuad(S.quad, 2.5); // 2.5 photo pixels: enough to drop the blended edge, too little to stretch the page
    let out = warp(px, S.src.width, S.src.height, cut, w, hh);
    px = null;
    out = enhance(out, w, hh, S.mode);
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').putImageData(new ImageData(out, w, hh), 0, 0);
    out = null;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    c.width = 0; c.height = 0;
    if (!S) return;
    if (!blob) throw new Error('jpeg');
    const url = URL.createObjectURL(blob); S.urls.push(url);
    S.pages.push({ blob, w, h: hh, url, quad: S.quad.map(p => p.slice()), mode: S.mode });
    showReview();
  } catch (e) {
    console.warn(e);
    if (S) { setBusy(''); toast('Could not flatten that page, try again'); }
  }
}

// ---------- step 3: review, scan the next page, save ----------
function showReview() {
  S.step = 'review';
  setBusy('');
  const last = S.pages[S.pages.length - 1];
  setHead(`Page ${S.pages.length}`);
  S.el.querySelector('.scan-count').textContent = '';
  const stage = S.el.querySelector('.scan-stage');
  stage.innerHTML = `<img class="scan-result" src="${last.url}" alt="Scanned page ${S.pages.length}">
    ${S.pages.length > 1 ? `<div class="scan-tray">${S.pages.map((p, i) => `<img src="${p.url}" alt="Page ${i + 1}">`).join('')}</div>` : ''}`;
  S.el.querySelector('.scan-bar').innerHTML = `<div class="scan-btns">
      <button class="btn scan-glass press" data-a="redo">Fix last</button>
      <button class="btn scan-glass press" data-a="next">${I.scan(18)} Scan next</button>
      <button class="btn acc press" data-a="save">Save ${S.pages.length} page${S.pages.length > 1 ? 's' : ''}</button>
    </div>`;
  const bar = S.el.querySelector('.scan-bar');
  bar.querySelector('[data-a="next"]').onclick = () => S.input.click();
  // back to the corners of the last photo (still in memory) to fix them
  bar.querySelector('[data-a="redo"]').onclick = () => {
    const p = S.pages.pop(); URL.revokeObjectURL(p.url);
    S.quad = p.quad; S.mode = p.mode; showCrop();
  };
  bar.querySelector('[data-a="save"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    setBusy('Saving...');
    const pages = S.pages.map(({ blob, w, h: hh }) => ({ blob, w, h: hh })), cb = S.onSave;
    try { await cb(pages); finish(); }
    catch (err) { console.warn(err); if (S) { setBusy(''); e.currentTarget.disabled = false; toast('Could not save, try again'); } }
  };
}

export const scannerOpen = () => !!S;
