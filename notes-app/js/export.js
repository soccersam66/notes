// Export a page or a whole notebook as a PDF: paper, PDF slides and ink, one picture per page.
// A tiny PDF writer (JPEG pages) keeps it dependency-free and light on the old iPad's memory.
import * as S from './store.js';
import { db } from './db.js';
import { renderPdfPageBlob } from './pdfimport.js';
import { paintStroke, drawPaper } from './editor.js';
import { sheet, toast, I, esc } from './ui.js';

const EXPORT_W = 1440; // pixels across a page (about 170 dpi on Letter): sharp ink, small files

// Draw one page (light colours, whatever the app theme) and return its JPEG bytes.
async function pageJpeg(p) {
  const scale = EXPORT_W / p.w;
  const c = document.createElement('canvas');
  c.width = EXPORT_W; c.height = Math.round(p.h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  if (p.paper === 'pdf') {
    let r = await db.get('renders', p.id);
    if (!r) { try { r = { pageId: p.id, blob: await renderPdfPageBlob(p.pdfId, p.pdfPage, 1632) }; await db.put('renders', r); } catch (e) { r = null; } }
    if (r) { const bmp = await createImageBitmap(r.blob); ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close(); }
  } else drawPaper(ctx, p, scale, 0, 0, c.width, c.height, true);
  const strokes = (await S.getInk(p.id)).strokes || [];
  strokes.forEach(s => { if (s.t === 'hi') paintStroke(ctx, { ...s, forceLight: true }, scale); });
  strokes.forEach(s => { if (s.t !== 'hi') paintStroke(ctx, { ...s, forceLight: true }, scale); });
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.88));
  const out = { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, ptW: p.w * 0.75, ptH: p.h * 0.75 };
  c.width = 0; c.height = 0; // free the canvas memory now
  return out;
}

// Minimal PDF 1.4: catalog, pages, and per page an image XObject + a content stream that draws it.
export function buildPdf(pages, title = 'Notes') {
  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const pdfStr = (t) => '(' + String(t).replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1') + ')';
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${4 + i * 3} 0 R`);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`));
  obj(3, () => push(`<< /Title ${pdfStr(title)} /Producer (Notes) >>`));
  pages.forEach((pg, i) => {
    const pn = 4 + i * 3, cn = pn + 1, im = pn + 2;
    const W = +pg.ptW.toFixed(2), H = +pg.ptH.toFixed(2);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(pn, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`));
    obj(cn, () => { push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); });
    obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`); push(pg.bytes); push('\nendstream'); });
  });
  const total = 4 + n * 3;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

const fileName = (s) => (String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Notes') + '.pdf';

// Export pages (in order) and offer the iPad share sheet.
export async function exportPages(pages, name) {
  if (!pages.length) return;
  const done = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      if (pages.length > 1) toast(`Making PDF, page ${i + 1} of ${pages.length}...`, 60000);
      done.push(await pageJpeg(pages[i]));
    }
  } catch (e) { toast('Could not make the PDF'); return; }
  const file = new File([buildPdf(done, name)], fileName(name), { type: 'application/pdf' });
  done.length = 0;
  toast(`PDF ready, ${(file.size / 1048576).toFixed(1)} MB`, 1500);
  shareSheet(file);
}
export async function exportPage(pageId, name) {
  const p = await S.getPage(pageId); if (p) return exportPages([p], name);
}
export async function exportNotebook(notebookId) {
  const nb = await S.getNotebook(notebookId); if (!nb) return;
  return exportPages(await S.listPages(notebookId), nb.name);
}

// Safari only allows the share sheet straight from a tap, and making the PDF takes a moment,
// so the finished file waits on a sheet with its own Share button.
function shareSheet(file) {
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  sheet(`<h3>PDF ready</h3>
    <div class="row" style="gap:12px"><span class="mono">${I.file(20)}</span><div style="min-width:0"><div class="ellip" style="font-weight:700">${esc(file.name)}</div><div class="sub" style="font-size:13px">${(file.size / 1048576).toFixed(1)} MB. Save to Files or Google Drive, or turn it in.</div></div></div>
    <div class="row"><button class="btn big grow press" data-x>Close</button><button class="btn big acc grow press" data-share>${canShare ? 'Share' : 'Download'}</button></div>`, (el, close) => {
    el.querySelector('[data-x]').onclick = close;
    el.querySelector('[data-share]').onclick = async () => {
      if (canShare) {
        try { await navigator.share({ files: [file], title: file.name }); close(); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      close();
    };
  });
}
