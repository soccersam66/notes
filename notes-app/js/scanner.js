// Scan pages with the camera. A live camera view finds the page and takes it by itself when it
// holds still (Auto), then waits for the next page; or tap the shutter. Each page is flattened
// and cleaned; all pages are saved together. Without a live camera, the camera app is used instead.
import { findQuad, refineQuad, shrinkQuad, toGray, insetQuad, warp, enhance, outputSize, pageSignature, autoStep, taken } from './scan.js';
import { getSettings, saveSettings } from './store.js';
import { h, toast, confirmSheet, I } from './ui.js';

const SRC_MAX = 2400;    // longest side kept from a photo or camera frame (memory on the old iPad)
const DETECT_MAX = 480;  // corners are found on a copy this big (photos)
const LIVE_MAX = 320;    // live camera frames are checked at this size (about 4 a second)
const REFINE_MAX = 1200; // corners are sharpened on a copy this big
const TICK_MS = 220;
const MODES = [['clean', 'Clean'], ['bw', 'B&W'], ['color', 'Photo']];

let S = null; // the open scanner

// Call straight from a tap (Safari only opens the camera from one). onSave(pages) gets
// [{ blob, w, h }] in page order when Sam taps Save.
export function startScan({ onSave }) {
  if (S) finish();
  S = { el: null, input: null, src: null, quad: null, found: false, pages: [], mode: 'clean', onSave, urls: [], auto: true, editing: null, step: '' };
  getSettings().then(s => {
    if (!S) return;
    if (MODES.some(m => m[0] === s.scanMode)) S.mode = s.scanMode;
    if (s.scanAuto === false) {
      S.auto = false;
      const b = S.el && S.el.querySelector('[data-a="auto"]');
      if (b) { b.classList.remove('on'); b.textContent = 'Auto off'; b.setAttribute('aria-pressed', 'false'); }
    }
  });
  const input = h('<input type="file" accept="image/*" capture="environment" class="hide">');
  document.body.appendChild(input);
  S.input = input;
  input.onchange = async () => {
    const f = input.files && input.files[0]; input.value = '';
    if (!f || !S) return;
    await loadPhoto(f);
  };
  build();
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) showCamera();
  else { setHead('Scan'); input.click(); } // no live camera here: the camera app
}

function finish() {
  if (!S) return;
  stopCamera();
  if (S.src) { S.src.width = 0; S.src.height = 0; }
  S.urls.forEach(u => URL.revokeObjectURL(u));
  if (S.el) S.el.remove();
  if (S.input) S.input.remove();
  if (S.onResize) window.removeEventListener('resize', S.onResize);
  if (S.onVis) document.removeEventListener('visibilitychange', S.onVis);
  S = null;
}

function build() {
  S.el = h(`<div id="scan" role="dialog" aria-label="Scan pages">
    <div class="scan-top">
      <button class="btn sm scan-glass press" data-a="cancel">Cancel</button>
      <b class="scan-title"></b>
      <span class="scan-right"></span>
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
  // the camera stops when the app goes to the background; start it again on the way back
  S.onVis = () => {
    if (!S) return;
    if (document.visibilityState === 'hidden') stopCamera();
    else if (S.step === 'camera') showCamera();
  };
  document.addEventListener('visibilitychange', S.onVis);
}

function setBusy(msg) {
  const b = S.el.querySelector('.scan-busy');
  b.classList.toggle('hide', !msg);
  if (msg) b.lastElementChild.textContent = msg;
}
function setHead(title, right = '') {
  S.el.querySelector('.scan-title').textContent = title;
  S.el.querySelector('.scan-right').innerHTML = right;
}
function modeSeg() {
  return `<div class="seg scan-seg" id="scanMode"><div class="ind"></div>${MODES.map(([k, l]) => `<button data-m="${k}" class="${S.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function wireModeSeg() {
  const seg = S.el.querySelector('#scanMode'); if (!seg) return;
  const moveInd = () => { const on = seg.querySelector('button.on'), ind = seg.querySelector('.ind'); if (on) { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft - 4}px)`; } };
  seg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    S.mode = b.dataset.m; seg.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); moveInd();
    saveSettings({ scanMode: S.mode });
  });
  requestAnimationFrame(moveInd);
}

// ---------- live camera with auto capture ----------
async function showCamera() {
  S.step = 'camera';
  S.editing = null;
  setBusy('');
  setHead('Scan', S.pages.length ? `<button class="btn sm acc press" data-a="done">Done (${S.pages.length})</button>` : '');
  const stage = S.el.querySelector('.scan-stage');
  stage.innerHTML = `<div class="scan-live"><video playsinline muted autoplay></video><canvas class="scan-overlay"></canvas>
    <div class="scan-hint">Starting the camera...</div><div class="scan-flash"></div></div>`;
  const last = S.pages[S.pages.length - 1];
  S.el.querySelector('.scan-bar').innerHTML = `${modeSeg()}
    <div class="scan-cam">
      <button class="scan-thumb press" data-a="review" aria-label="Scanned pages" ${last ? '' : 'disabled'}>${last ? `<img src="${last.url}" alt=""><b>${S.pages.length}</b>` : ''}</button>
      <button class="scan-shutter press" data-a="shoot" aria-label="Take this page"><i></i></button>
      <button class="btn scan-glass press scan-auto ${S.auto ? 'on' : ''}" data-a="auto" aria-pressed="${S.auto}">Auto ${S.auto ? 'on' : 'off'}</button>
    </div>`;
  wireModeSeg();
  const bar = S.el.querySelector('.scan-bar');
  bar.querySelector('[data-a="shoot"]').onclick = () => capture(true);
  bar.querySelector('[data-a="review"]').onclick = () => { if (S.pages.length) showReview(); };
  bar.querySelector('[data-a="auto"]').onclick = (e) => {
    S.auto = !S.auto; saveSettings({ scanAuto: S.auto });
    e.currentTarget.classList.toggle('on', S.auto); e.currentTarget.textContent = 'Auto ' + (S.auto ? 'on' : 'off');
    e.currentTarget.setAttribute('aria-pressed', S.auto);
  };
  const done = S.el.querySelector('[data-a="done"]'); if (done) done.onclick = showReview;
  const video = stage.querySelector('video');
  S.video = video;
  if (!S.stream) {
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3264 }, height: { ideal: 2448 } } });
    } catch (e) {
      console.warn(e);
      if (!S || S.step !== 'camera') return;
      cameraBlocked(e);
      return;
    }
    if (!S || S.step !== 'camera') { stopCamera(); return; }
  }
  video.srcObject = S.stream;
  try { await video.play(); } catch (e) { /* autoplay with muted + playsinline is allowed */ }
  S.st = {};
  if (S.timer) clearTimeout(S.timer);
  S.timer = setTimeout(tick, 400);
}

function cameraBlocked(e) {
  const hint = S.el.querySelector('.scan-hint');
  const why = e && e.name === 'NotAllowedError' ? 'The camera is not allowed for Notes. Allow it in Settings > Safari > Camera, or' : 'The live camera is not available here.';
  if (hint) hint.innerHTML = `${why}<br><button class="btn acc press" data-a="app" style="margin-top:12px">Use the camera app</button>`;
  const b = S.el.querySelector('[data-a="app"]'); if (b) b.onclick = () => { stopCamera(); S.input.click(); };
}

function stopCamera() {
  if (!S) return;
  if (S.timer) { clearTimeout(S.timer); S.timer = 0; }
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  if (S.video) { S.video.srcObject = null; S.video = null; }
}

// Every ~0.2 s: find the page in a small copy of the frame, draw its outline, and let the
// auto shutter decide. A page held still for about a second is taken, unless it is the same
// page as the last one (then it waits for the next page).
function tick() {
  if (!S || S.step !== 'camera') return;
  S.timer = 0;
  const v = S.video;
  if (S.busy || !v || v.readyState < 2 || !v.videoWidth) { S.timer = setTimeout(tick, TICK_MS); return; }
  const k = Math.min(1, LIVE_MAX / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.round(v.videoWidth * k), hh = Math.round(v.videoHeight * k);
  if (!S.det) S.det = document.createElement('canvas');
  if (S.det.width !== w || S.det.height !== hh) { S.det.width = w; S.det.height = hh; }
  const ctx = S.det.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, 0, 0, w, hh);
  const px = ctx.getImageData(0, 0, w, hh).data;
  const r = findQuad(px, w, hh);
  const det = r.found ? { found: true, quad: r.quad.map(([x, y]) => [x / w, y / hh]), sig: pageSignature(px, w, hh, r.quad) } : { found: false };
  S.lastDet = det;
  const step = autoStep(S.st, det, performance.now());
  drawLive(det, step);
  if (step.capture && S.auto) { capture(false); return; }
  S.timer = setTimeout(tick, TICK_MS);
}

function videoRect() {
  const v = S.video, stage = v.parentElement;
  const W = stage.clientWidth, H = stage.clientHeight, k = Math.min(W / v.videoWidth, H / v.videoHeight);
  return { x: (W - v.videoWidth * k) / 2, y: (H - v.videoHeight * k) / 2, w: v.videoWidth * k, h: v.videoHeight * k, W, H };
}

function drawLive(det, step) {
  const c = S.el.querySelector('.scan-overlay'), hint = S.el.querySelector('.scan-hint');
  if (!c || !S.video) return;
  const r = videoRect(), dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.W * dpr) || c.height !== Math.round(r.H * dpr)) { c.width = Math.round(r.W * dpr); c.height = Math.round(r.H * dpr); }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (det.found) {
    const pts = det.quad.map(([x, y]) => [(r.x + x * r.w) * dpr, (r.y + y * r.h) * dpr]);
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
    ctx.fillStyle = step.same ? 'rgba(255,255,255,.10)' : `rgba(47,91,234,${0.12 + 0.3 * step.progress})`;
    ctx.fill();
    ctx.lineWidth = 3 * dpr; ctx.lineJoin = 'round';
    ctx.strokeStyle = step.same ? 'rgba(255,255,255,.7)' : '#2F5BEA';
    ctx.stroke();
  }
  hint.textContent = !S.auto && det.found ? 'Tap the button to take it' : step.same && S.pages.length ? `Page ${S.pages.length} taken. Turn to the next page` : step.hint;
}

// Take the page now: grab the full camera frame, sharpen the corners, flatten and clean it.
async function capture(manual) {
  if (!S || S.busy || !S.video || !S.video.videoWidth) return;
  S.busy = true;
  const v = S.video, det = S.lastDet;
  const fl = S.el.querySelector('.scan-flash'); if (fl) { fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); }
  try {
    const k = Math.min(1, SRC_MAX / Math.max(v.videoWidth, v.videoHeight));
    const src = document.createElement('canvas');
    src.width = Math.round(v.videoWidth * k); src.height = Math.round(v.videoHeight * k);
    src.getContext('2d').drawImage(v, 0, 0, src.width, src.height);
    let quad = det && det.found ? det.quad.map(([x, y]) => [x * src.width, y * src.height]) : insetQuad(src.width, src.height, 0);
    if (det && det.found) quad = sharpen(src, quad);
    if (manual && det && det.found) taken(S.st, det); // the auto shutter waits for the next page after this one
    S.el.querySelector('.scan-hint').textContent = `Saving page ${S.pages.length + 1}...`;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const page = await flatten(src, quad, S.mode);
    page.srcBlob = await new Promise(r => src.toBlob(r, 'image/jpeg', 0.85)); // kept small, for fixing the corners later
    src.width = 0; src.height = 0;
    if (!S) return;
    addPage(page);
    if (S.step === 'camera') {
      const t = S.el.querySelector('.scan-thumb');
      if (t) { t.disabled = false; t.innerHTML = `<img src="${page.url}" alt=""><b>${S.pages.length}</b>`; t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); }
      setHead('Scan', `<button class="btn sm acc press" data-a="done">Done (${S.pages.length})</button>`);
      S.el.querySelector('[data-a="done"]').onclick = showReview;
    }
  } catch (e) {
    console.warn(e);
    toast('Could not take that page, try again');
  } finally {
    if (S) { S.busy = false; if (S.step === 'camera' && !S.timer) S.timer = setTimeout(tick, 600); }
  }
}

// corners from a small copy -> sharp corners on a 1200 px copy -> back to the photo's pixels
function sharpen(src, quad) {
  const k2 = Math.min(1, REFINE_MAX / Math.max(src.width, src.height));
  const md = document.createElement('canvas');
  md.width = Math.round(src.width * k2); md.height = Math.round(src.height * k2);
  const mctx = md.getContext('2d', { willReadFrequently: true });
  mctx.drawImage(src, 0, 0, md.width, md.height);
  const g = toGray(mctx.getImageData(0, 0, md.width, md.height).data, md.width, md.height);
  const out = refineQuad(g, md.width, md.height, quad.map(([x, y]) => [x * k2, y * k2])).map(([x, y]) => [x / k2, y / k2]);
  md.width = 0; md.height = 0;
  return out;
}

// Flatten and clean one page. Returns { blob, w, h, url, quad, mode }.
async function flatten(src, quad, mode) {
  const { w, h: hh } = outputSize(quad, src.width, src.height);
  let px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data;
  // 2.5 photo pixels inside the edge: drops the blended edge, too little to stretch the page
  let out = warp(px, src.width, src.height, shrinkQuad(quad, 2.5), w, hh);
  px = null;
  out = enhance(out, w, hh, mode);
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  c.getContext('2d').putImageData(new ImageData(out, w, hh), 0, 0);
  out = null;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  c.width = 0; c.height = 0;
  if (!blob) throw new Error('jpeg');
  const url = URL.createObjectURL(blob);
  if (S) S.urls.push(url);
  return { blob, w, h: hh, url, quad: quad.map(p => p.slice()), mode };
}

function addPage(page) {
  if (S.editing !== null && S.pages[S.editing]) {
    const old = S.pages[S.editing];
    page.srcBlob = page.srcBlob || old.srcBlob;
    S.pages[S.editing] = page;
  } else S.pages.push(page);
}

// ---------- a photo from the camera app (or fixing a page's corners) ----------
async function loadPhoto(file, quadIn = null) {
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
    let quad = quadIn, found = !!quadIn;
    if (!quad) {
      const d = Math.min(1, DETECT_MAX / Math.max(src.width, src.height));
      const sm = document.createElement('canvas');
      sm.width = Math.round(src.width * d); sm.height = Math.round(src.height * d);
      const sctx = sm.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(src, 0, 0, sm.width, sm.height);
      const r = findQuad(sctx.getImageData(0, 0, sm.width, sm.height).data, sm.width, sm.height);
      sm.width = 0; sm.height = 0;
      quad = r.quad.map(([x, y]) => [x / d, y / d]);
      found = r.found;
      if (found) quad = sharpen(src, quad);
    }
    if (!S) { src.width = 0; return; }
    if (S.src) { S.src.width = 0; S.src.height = 0; }
    S.src = src; S.quad = quad; S.found = found;
    S.auto0 = quad.map(p => p.slice()); // found corners (or a frame just inside the photo)
    S.srcFile = quadIn ? null : file;
    showCrop();
  } catch (e) {
    console.warn(e);
    toast('Could not open that photo');
    if (S && !S.pages.length) finish(); else if (S) showReview();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- corners ----------
function showCrop() {
  stopCamera();
  S.step = 'crop';
  setBusy('');
  setHead(S.editing !== null ? `Fix page ${S.editing + 1}` : S.found ? 'Check the corners' : 'Drag the corners to the page');
  const stage = S.el.querySelector('.scan-stage');
  stage.innerHTML = `<div class="scan-wrap"><svg class="scan-svg"><path class="scan-shade" fill-rule="evenodd"/><polygon class="scan-poly"/></svg>
    ${[0, 1, 2, 3].map(i => `<div class="scan-h" data-i="${i}"><i></i></div>`).join('')}</div>
    <canvas class="scan-loupe hide"></canvas>`;
  const wrap = stage.firstElementChild;
  wrap.insertBefore(S.src, wrap.firstChild);
  S.src.className = 'scan-photo';
  S.el.querySelector('.scan-bar').innerHTML = `${modeSeg()}
    <div class="scan-btns">
      <button class="btn scan-glass press" data-a="back">${S.editing !== null ? 'Cancel' : 'Retake'}</button>
      <button class="btn scan-glass press" data-a="whole">Whole photo</button>
      <button class="btn acc press" data-a="keep">${I.check(16, 3)} ${S.editing !== null ? 'Done' : 'Keep scan'}</button>
    </div>`;
  wireModeSeg();
  const bar = S.el.querySelector('.scan-bar');
  bar.querySelector('[data-a="back"]').onclick = () => { if (S.editing !== null) showReview(); else S.input.click(); };
  bar.querySelector('[data-a="whole"]').onclick = (e) => {
    const whole = e.currentTarget.dataset.whole !== '1';
    S.quad = whole ? insetQuad(S.src.width, S.src.height, 0) : S.auto0.map(p => p.slice());
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

async function keep() {
  setBusy('Flattening the page...');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // let the spinner show
  try {
    const page = await flatten(S.src, S.quad, S.mode);
    if (!S) return;
    if (S.srcFile) page.srcBlob = S.srcFile;
    addPage(page);
    S.editing = null;
    showReview();
  } catch (e) {
    console.warn(e);
    if (S) { setBusy(''); toast('Could not flatten that page, try again'); }
  }
}

// ---------- all pages: fix, delete, add more, save ----------
function showReview() {
  stopCamera();
  S.step = 'review';
  S.editing = null;
  setBusy('');
  if (!S.pages.length) { if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) showCamera(); else finish(); return; }
  setHead(`${S.pages.length} page${S.pages.length > 1 ? 's' : ''}`);
  const stage = S.el.querySelector('.scan-stage');
  stage.innerHTML = `<div class="scan-grid">${S.pages.map((p, i) => `
    <div class="scan-pg"><img src="${p.url}" alt="Page ${i + 1}"><span class="scan-n">${i + 1}</span>
      <div class="scan-pg-acts"><button class="btn sm scan-glass press" data-fix="${i}">Fix</button><button class="btn sm scan-glass press" data-del="${i}" aria-label="Delete page ${i + 1}">${I.trash(16)}</button></div></div>`).join('')}</div>`;
  S.el.querySelector('.scan-bar').innerHTML = `<div class="scan-btns">
      <button class="btn scan-glass press" data-a="more">${I.scan(18)} Add more</button>
      <button class="btn acc press" data-a="save">Save ${S.pages.length} page${S.pages.length > 1 ? 's' : ''} as PDF</button>
    </div>`;
  stage.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => {
    const i = +b.dataset.fix, p = S.pages[i];
    if (!p.srcBlob) { toast('That page cannot be fixed'); return; }
    S.editing = i; S.mode = p.mode;
    loadPhoto(p.srcBlob, p.quad.map(q => q.slice()));
  });
  stage.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const p = S.pages.splice(+b.dataset.del, 1)[0];
    if (p) URL.revokeObjectURL(p.url);
    showReview();
  });
  const bar = S.el.querySelector('.scan-bar');
  bar.querySelector('[data-a="more"]').onclick = () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) showCamera(); else S.input.click();
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
