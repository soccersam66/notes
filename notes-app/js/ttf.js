// Read what the PDF writer needs from a TrueType font: which glyph draws each character,
// how wide it is, and the font's height. Pure, works in Node and the browser.
export function parseTTF(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    tables[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) if (!tables[t]) throw new Error('font is missing ' + t);
  const head = tables.head.off, hhea = tables.hhea.off;
  const unitsPerEm = dv.getUint16(head + 18);
  const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
  const ascent = dv.getInt16(hhea + 4), descent = dv.getInt16(hhea + 6);
  const numHM = dv.getUint16(hhea + 34);
  const hm = tables.hmtx.off;
  const advance = (gid) => dv.getUint16(hm + 4 * Math.min(gid, numHM - 1));
  // cmap: prefer a Unicode format 12 subtable, else format 4
  const cm = tables.cmap.off, nSub = dv.getUint16(cm + 2);
  let f4 = null, f12 = null;
  for (let i = 0; i < nSub; i++) {
    const pid = dv.getUint16(cm + 4 + i * 8), eid = dv.getUint16(cm + 6 + i * 8), off = cm + dv.getUint32(cm + 8 + i * 8);
    const fmt = dv.getUint16(off);
    const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    if (!unicode) continue;
    if (fmt === 12 && !f12) f12 = off;
    if (fmt === 4 && !f4) f4 = off;
  }
  const map = new Map();
  if (f12) {
    const groups = dv.getUint32(f12 + 12);
    for (let g = 0; g < groups; g++) {
      const o = f12 + 16 + g * 12, s = dv.getUint32(o), e = dv.getUint32(o + 4), gid = dv.getUint32(o + 8);
      for (let c = s; c <= e; c++) map.set(c, gid + (c - s));
    }
  } else if (f4) {
    const segX2 = dv.getUint16(f4 + 6), segs = segX2 / 2;
    const ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segs; s++) {
      const end = dv.getUint16(ends + 2 * s), start = dv.getUint16(starts + 2 * s);
      const delta = dv.getInt16(deltas + 2 * s), ro = dv.getUint16(ranges + 2 * s);
      for (let c = start; c <= end && c !== 0xFFFF; c++) {
        let gid;
        if (!ro) gid = (c + delta) & 0xFFFF;
        else {
          const gi = dv.getUint16(ranges + 2 * s + ro + 2 * (c - start));
          gid = gi ? (gi + delta) & 0xFFFF : 0;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else throw new Error('font has no Unicode cmap');
  return {
    bytes, unitsPerEm, ascent, descent, bbox,
    glyph: (cp) => map.get(cp) || 0,
    has: (cp) => map.has(cp),
    advance,
    // width of a string in font units (characters the font lacks count as glyph 0)
    width(text) { let w = 0; for (const ch of text) w += advance(map.get(ch.codePointAt(0)) || 0); return w; }
  };
}
