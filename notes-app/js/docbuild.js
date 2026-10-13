// Turn a scanned page into a real PDF page: printed words become actual text (searchable,
// readable by Solve without AI), in the same places and sizes as on the paper; pictures,
// graphs and handwriting are cut out of the scan and placed where they were.
// Pure: the prompt, reading Gemini's answer, layout, and a PDF writer with an embedded font.

export const LAYOUT_PROMPT = `You read one scanned school page (a worksheet, notes or a handout) so it can be rebuilt as a clean digital page.
Return JSON only: {"lines":[...],"pictures":[...]}
"lines": every line of PRINTED (typed) text, top to bottom, one entry per line:
  {"t": the exact text of the line, "b": [x0,y0,x1,y1] a tight box around that line, "s": "title" or "normal" or "small", "w": "bold" or "normal"}
  If a line has parts far apart (like "Name: ____" on the left and "Period: __" on the right), give each part as its own entry with its own box.
  Copy every character exactly. Write math in the line as plain text: x^{2} for powers, x_{1} for subscripts, sqrt(x) or √x, π, θ, °, ≤, ≥, ≠, ±, ·, ÷.
"pictures": everything that is NOT printed text, each as {"b": [x0,y0,x1,y1], "k": "handwriting" or "figure" or "graph" or "table" or "other"}
  Handwriting (anything written by hand, including answers and scribbles) is ALWAYS a picture, never a line.
  A diagram, graph, number line, table or drawing is one picture, including its labels.
Boxes: numbers 0 to 1000 across the page width (x) and down the page height (y). Keep boxes tight.
Do not solve anything and do not add anything that is not on the page.`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Gemini's answer -> clean { lines: [{t, b, s, w}], pictures: [{b, k}] } (boxes 0..1000, ordered)
export function parseLayout(json) {
  const okBox = (b) => Array.isArray(b) && b.length === 4 && b.every(v => typeof v === 'number' && isFinite(v));
  const box = (b) => { const x0 = clamp(Math.min(b[0], b[2]), 0, 1000), x1 = clamp(Math.max(b[0], b[2]), 0, 1000), y0 = clamp(Math.min(b[1], b[3]), 0, 1000), y1 = clamp(Math.max(b[1], b[3]), 0, 1000); return [x0, y0, x1, y1]; };
  const lines = [], pictures = [];
  for (const l of (json && Array.isArray(json.lines) ? json.lines : [])) {
    if (!l || typeof l.t !== 'string' || !okBox(l.b)) continue;
    const t = l.t.replace(/\s+/g, ' ').trim(); if (!t) continue;
    const b = box(l.b); if (b[2] - b[0] < 2 || b[3] - b[1] < 2) continue;
    lines.push({ t: t.slice(0, 400), b, s: ['title', 'small'].includes(l.s) ? l.s : 'normal', w: l.w === 'bold' ? 'bold' : 'normal' });
  }
  for (const p of (json && Array.isArray(json.pictures) ? json.pictures : [])) {
    if (!p || !okBox(p.b)) continue;
    const b = box(p.b); if (b[2] - b[0] < 3 || b[3] - b[1] < 3) continue;
    pictures.push({ b, k: typeof p.k === 'string' ? p.k : 'other' });
  }
  // printed labels inside a picture are already in the picture
  const inside = (l) => { const cx = (l.b[0] + l.b[2]) / 2, cy = (l.b[1] + l.b[3]) / 2; return pictures.some(p => cx > p.b[0] && cx < p.b[2] && cy > p.b[1] && cy < p.b[3]); };
  return { lines: lines.filter(l => !inside(l)).sort((a, b) => a.b[1] - b.b[1] || a.b[0] - b.b[0]), pictures };
}

// "x^{2}+3x_{1}" -> runs of normal / raised / lowered text
export function mathRuns(text) {
  const runs = []; let cur = '';
  const push = (t, pos) => { if (!t) return; const last = runs[runs.length - 1]; if (last && last.pos === pos) last.t += t; else runs.push({ t, pos }); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ((c === '^' || c === '_') && i + 1 < text.length) {
      const pos = c === '^' ? 1 : -1;
      let t;
      if (text[i + 1] === '{') { const j = text.indexOf('}', i + 2); if (j < 0) { cur += c; continue; } t = text.slice(i + 2, j); i = j; }
      else if (text[i + 1] === '(') { let d = 0, j = i + 1; for (; j < text.length; j++) { if (text[j] === '(') d++; if (text[j] === ')' && --d === 0) break; } t = text.slice(i + 1, j + 1); i = j; }
      else { const m = text.slice(i + 1).match(/^-?[0-9.]+|^-?[a-zA-Zπθ]/); if (!m) { cur += c; continue; } t = m[0]; i += m[0].length; }
      push(cur, 0); cur = ''; push(t, pos);
      continue;
    }
    cur += c;
  }
  push(cur, 0);
  return runs;
}

// How a run is drawn. Powers and subscripts made only of digits, signs and n/i use the real
// superscript/subscript characters (x² reads as "x²" in the PDF's text, which Solve understands).
// Other raised text is drawn small and raised, with invisible ^( ) or _( ) around it, so the
// text still reads "e^(x+1)" for Solve and search.
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
export function drawRun(r, font) {
  if (!r.pos) return { t: r.t, small: false };
  const table = r.pos > 0 ? SUP : SUB;
  const chars = Array.from(r.t);
  if (chars.every(c => table[c] && (!font || font.has(table[c].codePointAt(0))))) return { t: chars.map(c => table[c]).join(''), small: false };
  return { t: r.t, small: true, before: r.pos > 0 ? '^(' : '_(', after: ')' };
}

// Where everything goes, in PDF points (page 612 wide). font: parsed regular font (for widths).
// pxW, pxH: the scan's size. Returns { w, h, texts: [{x, y, size, bold, scale, runs}], pictures: [{x0,y0,x1,y1 px, k}] }
export function planPage(layout, pxW, pxH, font, { pageW = 612 } = {}) {
  const k = pageW / pxW, pageH = Math.round(pxH * k);
  const em = font.unitsPerEm, lineH = (font.ascent - font.descent) / em; // about 1.16 for DejaVu
  const sized = layout.lines.map(l => {
    const x0 = l.b[0] / 1000 * pageW, x1 = l.b[2] / 1000 * pageW, y0 = l.b[1] / 1000 * pageH, y1 = l.b[3] / 1000 * pageH;
    return { ...l, x0, x1, y0, y1, size: clamp((y1 - y0) / lineH, 5, 48) };
  });
  // lines of about the same height share one size (normal text looks even, like print)
  const sizes = sized.filter(l => l.s === 'normal').map(l => l.size).sort((a, b) => a - b);
  const body = sizes.length ? sizes[sizes.length >> 1] : 11;
  const texts = sized.map(l => {
    let size = l.s === 'title' ? Math.max(l.size, body * 1.15) : Math.abs(l.size / body - 1) < 0.2 ? body : l.size;
    const runs = mathRuns(l.t);
    const widthAt = (sz) => runs.reduce((w, r) => { const d = drawRun(r, font); return w + font.width(d.t) / em * sz * (d.small ? 0.65 : 1); }, 0);
    // fit the line to its box; a box that is far too narrow (a misread box) may not shrink the
    // text to nothing: then the line may run on to the page margin instead
    let room = Math.max(4, l.x1 - l.x0) * 1.04;
    const w = widthAt(size);
    if (w * 0.78 > room) room = Math.max(room, pageW - 18 - l.x0);
    let scale = 1;
    if (w > room) { scale = Math.max(0.78, room / w); if (w * scale > room) size = size * room / (w * scale); }
    const baseline = l.y1 - (-font.descent / em) * size * 0.85;
    return { x: l.x0, y: baseline, size: +size.toFixed(2), bold: l.w === 'bold', scale: +scale.toFixed(3), runs };
  });
  const pictures = layout.pictures.map(p => ({ x0: p.b[0] / 1000 * pxW, y0: p.b[1] / 1000 * pxH, x1: p.b[2] / 1000 * pxW, y1: p.b[3] / 1000 * pxH, k: p.k }));
  return { w: pageW, h: pageH, k, texts, pictures };
}

// Gemini's boxes can stop short of the real end (or start) of a printed line. Stretch each line's
// box along its own row while the ink continues with word-sized gaps, so the whole printed line is
// replaced by text and no leftover piece of it is kept as a picture. A gap wider than about one
// line height ends the line (a handwritten answer is usually further away than that).
// gray: luminance (w x h); boxes: [{x0,y0,x1,y1}] in pixels. Returns new boxes.
export function snapLines(gray, w, h, boxes, { dark = 150, gapK = 1.1 } = {}) {
  return boxes.map(b => {
    const y0 = clamp(Math.round(b.y0), 0, h - 1), y1 = clamp(Math.round(b.y1), y0 + 1, h);
    const bandH = y1 - y0, maxGap = Math.max(6, bandH * gapK);
    const inkAt = (x) => { let n = 0; for (let y = y0; y < y1; y++) if (gray[y * w + x] < dark) n++; return n >= 1; };
    let x1 = clamp(Math.round(b.x1), 0, w - 1), x0 = clamp(Math.round(b.x0), 0, w - 1);
    for (let x = x1 + 1, gap = 0; x < w; x++) { if (inkAt(x)) { x1 = x; gap = 0; } else if (++gap > maxGap) break; }
    for (let x = x0 - 1, gap = 0; x >= 0; x--) { if (inkAt(x)) { x0 = x; gap = 0; } else if (++gap > maxGap) break; }
    return { ...b, x0, x1: x1 + 1 };
  });
}

// Ink on the scan that no line or picture covers (Gemini missed it): grouped into boxes so it can be
// kept as a picture. Nothing on the paper is lost. gray: luminance (pxW x pxH), boxes in pixels.
export function missedInk(gray, w, h, boxes, { cell = 8, dark = 150, minCells = 3, pad = 6, join = 3 } = {}) {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const ink = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] < dark) ink[((y / cell) | 0) * gw + ((x / cell) | 0)]++;
  const covered = new Uint8Array(gw * gh);
  for (const b of boxes) {
    const cx0 = clamp(Math.floor((b.x0 - pad) / cell), 0, gw - 1), cx1 = clamp(Math.floor((b.x1 + pad) / cell), 0, gw - 1);
    const cy0 = clamp(Math.floor((b.y0 - pad) / cell), 0, gh - 1), cy1 = clamp(Math.floor((b.y1 + pad) / cell), 0, gh - 1);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) covered[y * gw + x] = 1;
  }
  const on = new Uint8Array(gw * gh);
  for (let i = 0; i < on.length; i++) on[i] = !covered[i] && ink[i] >= 2 ? 1 : 0; // 2+ dark pixels, not a speck
  // group nearby cells (within `join` cells) into boxes
  const seen = new Uint8Array(gw * gh), out = [];
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1; let n = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % gw, y = (i / gw) | 0; n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -join; dy <= join; dy++) for (let dx = -join; dx <= join; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const j = yy * gw + xx; if (on[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (n >= minCells) out.push({ x0: Math.max(0, x0 * cell - 4), y0: Math.max(0, y0 * cell - 4), x1: Math.min(w, (x1 + 1) * cell + 4), y1: Math.min(h, (y1 + 1) * cell + 4), k: 'missed' });
  }
  return out;
}

// ---------- PDF writer: text with an embedded TrueType font (Type0 / Identity-H), plus JPEG pictures ----------
// pages: [{ w, h, texts: [{x, y, size, bold, scale, runs}], images: [{x, y, w, h (pt, from the top), jpeg: Uint8Array, pxW, pxH}] }]
// fonts: { regular, bold } from parseTTF. Returns a Blob-ready array of Uint8Array parts and the total length.
export function buildDocPdf(pages, fonts, title = 'Scan') {
  const enc = new TextEncoder();
  const parts = [], offsets = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  let nextId = 4; const alloc = () => nextId++;
  const objs = []; // [id, writer]
  const obj = (id, write) => objs.push([id, write]);
  const stream = (dict, data) => () => { const d = typeof data === 'string' ? enc.encode(data) : data; push(`<< ${dict} /Length ${d.length} >>\nstream\n`); push(d); push('\nendstream'); };
  const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const pdfStr = (t) => '(' + String(t).replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1') + ')';
  // glyphs used per font (for widths and the text-to-Unicode map)
  const used = { regular: new Map(), bold: new Map() };
  const encode = (fontKey, text) => {
    const f = fonts[fontKey]; let s = '';
    for (const ch of text) { const cp = ch.codePointAt(0); const g = f.glyph(cp); if (g) used[fontKey].set(g, cp); s += hex4(g); }
    return s;
  };
  const pageIds = [];
  const pageObjs = pages.map(pg => {
    const W = +pg.w.toFixed(2), H = +pg.h.toFixed(2);
    let ops = '';
    const xobj = [];
    (pg.images || []).forEach((im, i) => {
      const id = alloc(), name = 'Im' + i;
      xobj.push(`/${name} ${id} 0 R`);
      obj(id, stream(`/Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, im.jpeg));
      ops += `q ${im.w.toFixed(2)} 0 0 ${im.h.toFixed(2)} ${im.x.toFixed(2)} ${(H - im.y - im.h).toFixed(2)} cm /${name} Do Q\n`;
    });
    for (const t of pg.texts || []) {
      const fk = t.bold ? 'bold' : 'regular', fname = t.bold ? 'F2' : 'F1';
      ops += `BT ${Math.round(t.scale * 100)} Tz 0 g 1 0 0 1 ${t.x.toFixed(2)} ${(H - t.y).toFixed(2)} Tm\n`;
      for (const r of t.runs) {
        const d = drawRun(r, fonts[fk]);
        const sz = d.small ? t.size * 0.65 : t.size, rise = !d.small ? 0 : r.pos > 0 ? t.size * 0.38 : -t.size * 0.16;
        // invisible markers (render mode 3) keep e^(x+1) readable in the text without showing
        if (d.before) ops += `3 Tr /${fname} ${sz.toFixed(2)} Tf 0 Ts <${encode(fk, d.before)}> Tj 0 Tr\n`;
        ops += `/${fname} ${sz.toFixed(2)} Tf ${rise.toFixed(2)} Ts <${encode(fk, d.t)}> Tj\n`;
        if (d.after) ops += `3 Tr /${fname} ${sz.toFixed(2)} Tf 0 Ts <${encode(fk, d.after)}> Tj 0 Tr\n`;
      }
      ops += 'ET\n';
    }
    const pid = alloc(), cid = alloc();
    pageIds.push(pid);
    return { pid, cid, W, H, ops, xobj };
  });
  // fonts (written after the pages so the used glyphs are known)
  const fontIds = {};
  for (const [key, fname] of [['regular', 'F1'], ['bold', 'F2']]) {
    const f = fonts[key]; if (!f) continue;
    const t0 = alloc(), cidf = alloc(), desc = alloc(), file = alloc(), tou = alloc();
    fontIds[fname] = t0;
    const base = key === 'bold' ? 'DejaVuSans-Bold' : 'DejaVuSans';
    const s = 1000 / f.unitsPerEm;
    const gids = Array.from(used[key].keys()).sort((a, b) => a - b);
    const W = gids.length ? '[' + gids.map(g => `${g} [${Math.round(f.advance(g) * s)}]`).join(' ') + ']' : '[]';
    obj(t0, () => push(`<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cidf} 0 R] /ToUnicode ${tou} 0 R >>`));
    obj(cidf, () => push(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 600 /W ${W} >>`));
    const bb = f.bbox.map(v => Math.round(v * s));
    obj(desc, () => push(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${bb.join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * s)} /Descent ${Math.round(f.descent * s)} /CapHeight ${Math.round(f.ascent * s * 0.73)} /StemV ${key === 'bold' ? 120 : 80} /FontFile2 ${file} 0 R >>`));
    obj(file, stream(`/Length1 ${f.bytes.length}`, f.bytes));
    // which Unicode character each glyph stands for (copy, search and pdf.js text all use this)
    const entries = gids.map(g => {
      const cp = used[key].get(g);
      const u = cp > 0xFFFF ? hex4(0xD800 + ((cp - 0x10000) >> 10)) + hex4(0xDC00 + ((cp - 0x10000) & 0x3FF)) : hex4(cp);
      return `<${hex4(g)}> <${u}>`;
    });
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < entries.length; i += 100) { const chunk = entries.slice(i, i + 100); cmap += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`; }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    obj(tou, stream('', cmap));
  }
  const fontRes = Object.entries(fontIds).map(([n, id]) => `/${n} ${id} 0 R`).join(' ');
  for (const p of pageObjs) {
    obj(p.pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.W} ${p.H}] /Resources << /Font << ${fontRes} >> /XObject << ${p.xobj.join(' ')} >> >> /Contents ${p.cid} 0 R >>`));
    obj(p.cid, stream('', p.ops));
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const write = (id, fn) => { offsets[id] = len; push(`${id} 0 obj\n`); fn(); push('\nendobj\n'); };
  write(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  write(2, () => push(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] >>`));
  write(3, () => push(`<< /Title ${pdfStr(title)} /Producer (Notes) >>`));
  objs.sort((a, b) => a[0] - b[0]).forEach(([id, fn]) => write(id, fn));
  const total = nextId, xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i] || 0).padStart(10, '0') + (offsets[i] ? ' 00000 n \n' : ' 65535 f \n');
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return parts;
}
