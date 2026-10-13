// Scans -> one real PDF: Gemini reads each cleaned scan once (where the printed lines, pictures and
// handwriting are), the printed words become real text, and pictures and handwriting are cut out
// of the scan. Ink Gemini did not account for is kept as a picture, so nothing on the paper is lost.
// A page Gemini cannot read (no key, offline, busy) goes in as a picture of the page.
import { parseTTF } from './ttf.js';
import { parseLayout, planPage, missedInk, snapLines, buildDocPdf } from './docbuild.js';
import { readLayout, hasKeys } from './gemini.js';

let fontsP = null;
export function loadFonts() {
  if (!fontsP) {
    const get = (n) => fetch(new URL('../vendor/fonts/' + n, import.meta.url)).then(r => { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); });
    fontsP = Promise.all([get('DejaVuSans-notes.ttf'), get('DejaVuSans-Bold-notes.ttf')])
      .then(([r, b]) => ({ regular: parseTTF(r), bold: parseTTF(b) }))
      .catch(e => { fontsP = null; throw e; });
  }
  return fontsP;
}

const blobB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
const toBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
const fileName = (s) => (String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Scan') + '.pdf';

// pages: [{ blob, w, h }] (cleaned scans, in order). Returns { file, read, pictures } where
// read = pages turned into text, pictures = page numbers that stayed a picture.
export async function scansToPdf(pages, title, progress = () => {}) {
  const fonts = await loadFonts();
  const keys = await hasKeys();
  const out = [], asPicture = [];
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    progress(pages.length > 1 ? `Reading page ${i + 1} of ${pages.length}...` : 'Reading the page...');
    let layout = null;
    if (keys) {
      try {
        const r = await readLayout(await blobB64(pg.blob));
        layout = parseLayout(r.json);
        if (!layout.lines.length) layout = null; // nothing printed found: keep the page as it is
      } catch (e) { console.warn('layout', e.message); }
    }
    const pageH = Math.round(612 * pg.h / pg.w);
    if (!layout) {
      asPicture.push(i + 1);
      out.push({ w: 612, h: pageH, texts: [], images: [{ x: 0, y: 0, w: 612, h: pageH, jpeg: await toBytes(pg.blob), pxW: pg.w, pxH: pg.h }] });
      continue;
    }
    // the scan: to fit each line to its real ink, cut pictures from, and look for ink nobody accounted for
    const bmp = await createImageBitmap(pg.blob);
    const c = document.createElement('canvas'); c.width = pg.w; c.height = pg.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0); bmp.close && bmp.close();
    const px = ctx.getImageData(0, 0, pg.w, pg.h).data;
    const gray = new Uint8Array(pg.w * pg.h);
    for (let j = 0, q = 0; j < gray.length; j++, q += 4) gray[j] = (px[q] * 77 + px[q + 1] * 150 + px[q + 2] * 29) >> 8;
    const lineBoxes = snapLines(gray, pg.w, pg.h, layout.lines.map(l => ({ x0: l.b[0] / 1000 * pg.w, y0: l.b[1] / 1000 * pg.h, x1: l.b[2] / 1000 * pg.w, y1: l.b[3] / 1000 * pg.h })));
    layout.lines.forEach((l, j) => { const b = lineBoxes[j]; l.b = [b.x0 / pg.w * 1000, l.b[1], b.x1 / pg.w * 1000, l.b[3]]; });
    const plan = planPage(layout, pg.w, pg.h, fonts.regular);
    const pics = plan.pictures.concat(missedInk(gray, pg.w, pg.h, lineBoxes.concat(plan.pictures)));
    const images = [];
    for (const p of pics) {
      const x0 = Math.max(0, Math.floor(p.x0 - 3)), y0 = Math.max(0, Math.floor(p.y0 - 3));
      const x1 = Math.min(pg.w, Math.ceil(p.x1 + 3)), y1 = Math.min(pg.h, Math.ceil(p.y1 + 3));
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const cc = document.createElement('canvas'); cc.width = x1 - x0; cc.height = y1 - y0;
      cc.getContext('2d').drawImage(c, x0, y0, cc.width, cc.height, 0, 0, cc.width, cc.height);
      const jb = await new Promise(r => cc.toBlob(r, 'image/jpeg', 0.88));
      images.push({ x: x0 * plan.k, y: y0 * plan.k, w: cc.width * plan.k, h: cc.height * plan.k, jpeg: await toBytes(jb), pxW: cc.width, pxH: cc.height });
      cc.width = 0; cc.height = 0;
    }
    c.width = 0; c.height = 0;
    out.push({ w: plan.w, h: plan.h, texts: plan.texts, images });
  }
  const parts = buildDocPdf(out, fonts, title);
  return { file: new File(parts, fileName(title), { type: 'application/pdf' }), read: pages.length - asPicture.length, pictures: asPicture, keys };
}
