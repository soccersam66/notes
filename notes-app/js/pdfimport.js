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
