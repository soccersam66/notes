// Import PDFs (teacher slides, worksheets) as pages you can write on.
import * as S from './store.js';
import { db, uid } from './db.js';

let lib = null;
async function pdfjs() {
  if (lib) return lib;
  lib = await import('../vendor/pdfjs/pdf.min.js');
  lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
  return lib;
}
const docs = new Map(); // pdfId -> Promise<PDFDocumentProxy>
async function loadDoc(pdfId) {
  if (!docs.has(pdfId)) {
    docs.set(pdfId, (async () => {
      const rec = await db.get('pdfs', pdfId);
      if (!rec) throw new Error('PDF missing');
      const L = await pdfjs();
      const data = new Uint8Array(await rec.blob.arrayBuffer());
      return L.getDocument({ data, isEvalSupported: false }).promise;
    })());
    if (docs.size > 3) { const first = docs.keys().next().value; docs.get(first).then(d => d.destroy()).catch(() => {}); docs.delete(first); }
  }
  return docs.get(pdfId);
}

export async function importPdfFile(file, classId, progress = () => {}, notebookId = null) {
  try {
    const L = await pdfjs();
    progress('Reading ' + file.name + '...');
    const pdfId = uid();
    await db.put('pdfs', { id: pdfId, name: file.name, blob: file, added: Date.now() });
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await L.getDocument({ data, isEvalSupported: false }).promise;
    let nb = notebookId ? await S.getNotebook(notebookId) : null;
    if (!nb) nb = await S.createNotebook(classId, file.name.replace(/\.pdf$/i, ''));
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const k = S.PAGE_W / vp.width;
      const tc = await page.getTextContent();
      const text = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = L.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]);
        text.push({ s: it.str, x: +(tx[4] * k).toFixed(1), y: +((tx[5] - fh) * k).toFixed(1), w: +((it.width || fh * it.str.length * 0.5) * k).toFixed(1), h: +(fh * k).toFixed(1) });
      }
      await S.createPage(nb.id, { paper: 'pdf', atEnd: true, extra: { pdfId, pdfPage: i, w: S.PAGE_W, h: Math.round(vp.height * k), text } });
      if (i % 5 === 0) progress(`Imported ${i} of ${doc.numPages} pages...`);
      page.cleanup();
    }
    doc.destroy();
    return nb;
  } catch (e) {
    console.error(e);
    progress('Could not import that PDF');
    return null;
  }
}

// Pages with a picture behind the ink: PDF slides and photos.
export const hasBg = (p) => !!p && (p.paper === 'pdf' || p.paper === 'photo');

// The background picture of a page as a JPEG blob (PDF renders are cached in 'renders').
export async function pageBgBlob(p) {
  if (p.paper === 'photo') { const r = await db.get('pdfs', p.imgId); return r ? r.blob : null; }
  if (p.paper !== 'pdf') return null;
  const r = await db.get('renders', p.id);
  if (r) return r.blob;
  try { const blob = await renderPdfPageBlob(p.pdfId, p.pdfPage, 1632); await db.put('renders', { pageId: p.id, blob }); return blob; }
  catch (e) { console.warn(e); return null; }
}

// A photo becomes a page: scaled to at most 1632 px wide (memory on the old iPad), saved as JPEG.
export async function importPhotoFile(file, notebookId) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not an image')); i.src = url; });
    const k = Math.min(1, 1632 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height); // Safari applies the photo's rotation (EXIF) for <img>
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    const h = Math.round(S.PAGE_W * c.height / c.width);
    c.width = 0; c.height = 0;
    const imgId = uid();
    await db.put('pdfs', { id: imgId, name: file.name || 'Photo', blob, added: Date.now() });
    return S.createPage(notebookId, { paper: 'photo', atEnd: true, extra: { imgId, w: S.PAGE_W, h: Math.min(h, S.PAGE_W * 4) } });
  } finally { URL.revokeObjectURL(url); }
}

// Turn a photo page 90 degrees (right = clockwise). Ink turns with it, so it stays on the same spot of the photo.
export async function rotatePhotoPage(pageId, right = true) {
  const p = await S.getPage(pageId); if (!p || p.paper !== 'photo') return null;
  const rec = await db.get('pdfs', p.imgId); if (!rec) return null;
  const bmp = await createImageBitmap(rec.blob);
  const c = document.createElement('canvas'); c.width = bmp.height; c.height = bmp.width;
  const ctx = c.getContext('2d');
  if (right) { ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); } else { ctx.translate(0, c.height); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const newH = Math.round(S.PAGE_W * c.height / c.width), k = S.PAGE_W / p.h; // old height becomes the new width
  c.width = 0; c.height = 0;
  await db.put('pdfs', { ...rec, blob });
  const ink = await S.getInk(pageId);
  (ink.strokes || []).forEach(s => { for (let i = 0; i < s.p.length; i += 3) { const x = s.p[i], y = s.p[i + 1]; s.p[i] = (right ? p.h - y : y) * k; s.p[i + 1] = (right ? x : p.w - x) * k; } });
  await S.saveInk(pageId, ink.strokes || []);
  return S.updatePage(pageId, { h: newH, thumb: '' });
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name || '');

// Import several PDFs and photos in one go, one file at a time (memory).
// Into a notebook: everything is added at the end. From a class: each PDF gets its own notebook,
// and all the photos go into one new "Photos" notebook. Returns the notebooks that got pages.
export async function importFiles(files, { classId, notebookId = null, progress = () => {} }) {
  files = Array.from(files || []);
  const touched = [], skipped = [];
  let photoNb = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (files.length > 1) progress(`Importing ${i + 1} of ${files.length}: ${f.name || 'photo'}`);
    try {
      if (isPdf(f)) {
        const nb = await importPdfFile(f, classId, progress, notebookId);
        if (nb) touched.push(nb.id); else skipped.push(f.name);
      } else if (isImage(f)) {
        let target = notebookId;
        if (!target) {
          if (!photoNb) photoNb = await S.createNotebook(classId, 'Photos, ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
          target = photoNb.id;
        }
        await importPhotoFile(f, target);
        touched.push(target);
      } else skipped.push(f.name);
    } catch (e) { console.warn(e); skipped.push(f.name); }
  }
  return { notebooks: Array.from(new Set(touched)), skipped };
}

// Render one PDF page to a JPEG blob (cached by the editor).
export async function renderPdfPageBlob(pdfId, pageNo, widthPx = 1632) {
  const doc = await loadDoc(pdfId);
  const page = await doc.getPage(pageNo);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: widthPx / vp0.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  c.width = 0; c.height = 0; page.cleanup();
  return blob;
}
