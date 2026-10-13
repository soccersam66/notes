// Page scanning maths: find the sheet of paper in a photo, flatten it (perspective warp) and
// clean it up (white paper, dark ink, no shadows). Pure, works on RGBA arrays, testable in Node.

// RGBA -> luminance 0..255
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

// Box blur (radius r), separable, edges clamped.
export function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0; const row = y * w;
    for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Otsu's threshold for values 0..255
export function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = g.length - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; t = i; }
  }
  return t;
}

// Convex hull (monotone chain), points as [x, y]
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

export function polyArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

// The biggest 4-corner shape whose corners are hull points (start from the extreme points, then improve).
function bestQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  const pick = (f) => { let bi = 0, bv = -Infinity; hull.forEach((p, i) => { const v = f(p); if (v > bv) { bv = v; bi = i; } }); return bi; };
  let idx = Array.from(new Set([pick(p => -p[0] - p[1]), pick(p => p[0] - p[1]), pick(p => p[0] + p[1]), pick(p => p[1] - p[0])]));
  for (let i = 0; idx.length < 4 && i < n; i++) if (!idx.includes(i)) idx.push(i);
  const area = (ix) => polyArea(ix.slice().sort((a, b) => a - b).map(i => hull[i]));
  let best = area(idx);
  for (let iter = 0; iter < 12; iter++) {
    let improved = false;
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < n; i++) {
        if (idx.includes(i)) continue;
        const t = idx.slice(); t[c] = i;
        const a = area(t);
        if (a > best + 1e-6) { best = a; idx = t; improved = true; }
      }
    }
    if (!improved) break;
  }
  return idx.sort((a, b) => a - b).map(i => hull[i]);
}

// Corners in the order top-left, top-right, bottom-right, bottom-left.
export function orderQuad(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const byAngle = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // angles from -pi: roughly TL first... rotate so the corner with the smallest x+y is first
  let s = 0; byAngle.forEach((p, i) => { if (p[0] + p[1] < byAngle[s][0] + byAngle[s][1]) s = i; });
  return byAngle.slice(s).concat(byAngle.slice(0, s)).map(p => [p[0], p[1]]);
}

const isConvex = (q) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
};

// A rectangle a little inside the photo, used when no sheet is found.
export const insetQuad = (w, h, k = 0.04) => [[w * k, h * k], [w * (1 - k), h * k], [w * (1 - k), h * (1 - k)], [w * k, h * (1 - k)]];

// Find the sheet of paper: the bright region (Otsu) that holds the middle of the photo,
// its convex hull, and the biggest 4-corner shape on that hull. Returns { quad, found }.
export function findQuad(rgba, w, h) {
  const g = boxBlur(toGray(rgba, w, h), w, h, Math.max(1, Math.round(Math.max(w, h) / 200)));
  const t = otsu(g);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = g[i] > t ? 1 : 0;
  // connected parts of the bright mask (4-neighbours); keep the biggest, preferring one that covers the centre
  const label = new Int32Array(w * h), sizes = [0];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    let sp = 0, size = 0; stack[sp++] = s; label[s] = next;
    while (sp) {
      const i = stack[--sp]; size++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = next; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = next; stack[sp++] = i + w; }
    }
    sizes.push(size); next++;
  }
  if (next === 1) return { quad: insetQuad(w, h), found: false };
  let best = 1;
  for (let l = 2; l < next; l++) if (sizes[l] > sizes[best]) best = l;
  const mid = label[((h / 2) | 0) * w + ((w / 2) | 0)];
  if (mid && sizes[mid] > 0.12 * w * h) best = mid;
  // left and right edge of the part on every row -> hull
  const pts = [];
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (label[y * w + x] === best) { if (l < 0) l = x; r = x; }
    if (l >= 0) { pts.push([l, y]); if (r !== l) pts.push([r + 1, y]); }
  }
  const q = bestQuad(convexHull(pts));
  if (!q) return { quad: insetQuad(w, h), found: false };
  const quad = orderQuad(q), a = polyArea(quad) / (w * h);
  if (a < 0.12 || a > 0.985 || !isConvex(quad)) return { quad: insetQuad(w, h), found: false };
  return { quad, found: true };
}

// Sharpen rough corners: along each side, find where the brightness jumps most (paper edge)
// across the line, fit a straight line through those spots, and meet the lines at the corners.
// gray is luminance (w x h); quad is in the same pixels. Corners move at most `reach` pixels.
export function refineQuad(gray, w, h, quad, reach = Math.max(4, Math.round(Math.max(w, h) / 80))) {
  const at = (x, y) => {
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0)), i = y0 * w + x0;
    return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
  };
  const lines = [];
  for (let e = 0; e < 4; e++) {
    const a = quad[e], b = quad[(e + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 20) return quad;
    const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
    let nx = -ty, ny = tx; // normal; make it point out of the sheet
    const cx = quad.reduce((s, p) => s + p[0], 0) / 4, cy = quad.reduce((s, p) => s + p[1], 0) / 4;
    if ((a[0] - cx) * nx + (a[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const pts = [];
    const n = Math.max(12, Math.min(80, Math.round(L / 6)));
    for (let k = 1; k < n; k++) {
      const t = (0.08 + 0.84 * k / n) * L; // stay away from the corners
      const px = a[0] + tx * t, py = a[1] + ty * t;
      let best = 0, bo = null;
      for (let o = -reach; o <= reach; o += 0.5) {
        const x = px + nx * o, y = py + ny * o;
        if (x < 7 || y < 7 || x > w - 8 || y > h - 8) continue;
        // a step: a band of paper inside brighter than a band of desk outside. A thin printed line
        // has paper on both sides, so it scores low here even when its own contrast is high.
        let inside = 0, outside = 0;
        for (let k = 1.5; k <= 5.5; k += 1) { inside += at(x - nx * k, y - ny * k); outside += at(x + nx * k, y + ny * k); }
        const g = (inside - outside) / 5;
        if (g > best) { best = g; bo = o; }
      }
      if (bo !== null && best > 6) pts.push([px + nx * bo, py + ny * bo]);
    }
    if (pts.length < 6) { lines.push(null); continue; }
    lines.push(fitLine(pts));
  }
  return quad.map((c, i) => {
    const l1 = lines[(i + 3) % 4], l2 = lines[i]; // the two sides that meet at corner i
    if (!l1 || !l2) return c;
    const p = meet(l1, l2);
    return p && Math.hypot(p[0] - c[0], p[1] - c[1]) <= reach * 2 ? p : c;
  });
}
// Move every side of the quad d pixels inwards, so the page edge (a blend of paper and desk) is cut off.
export function shrinkQuad(q, d) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const lines = q.map((a, e) => {
    const b = q[(e + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    let nx = -dy, ny = dx; if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
    return { x: a[0] + nx * d, y: a[1] + ny * d, dx, dy };
  });
  return q.map((c, i) => meet(lines[(i + 3) % 4], lines[i]) || c);
}

// best straight line through points (total least squares): point + direction. With trim, the
// worst tenth of the points (a finger or a shadow on the edge) is dropped and the line fitted again.
function fitLine(pts, trim = true) {
  let mx = 0, my = 0; pts.forEach(p => { mx += p[0]; my += p[1]; }); mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0; pts.forEach(p => { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(ang), dy = Math.sin(ang);
  if (trim && pts.length >= 10) {
    const dist = (p) => Math.abs((p[0] - mx) * dy - (p[1] - my) * dx);
    return fitLine(pts.slice().sort((p, q) => dist(p) - dist(q)).slice(0, Math.ceil(pts.length * 0.9)), false);
  }
  return { x: mx, y: my, dx, dy };
}
function meet(l1, l2) {
  const den = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / den;
  return [l1.x + l1.dx * t, l1.y + l1.dy * t];
}

// True width / height of the sheet from where its corners are in the photo, undoing the camera's
// tilt (Zhang and He, "Whiteboard scanning and image enhancement", 2007): the corners give the
// camera's focal length, and with it the real shape. (cx, cy) is the photo's centre.
// Close to US Letter (8.5 x 11, either way round) snaps to exactly Letter.
export function quadAspect(q, cx, cy) {
  const raw = trueAspect(q, cx, cy);
  for (const s of [8.5 / 11, 11 / 8.5]) if (Math.abs(raw / s - 1) < 0.07) return s;
  return raw;
}
export function trueAspect(q, cx, cy) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const simple = (d(q[0], q[1]) + d(q[3], q[2])) / (d(q[0], q[3]) + d(q[1], q[2]));
  if (cx === undefined) return simple;
  // corners relative to the centre, as m1 top-left, m2 top-right, m3 bottom-left, m4 bottom-right
  const m = [q[0], q[1], q[3], q[2]].map(([x, y]) => [x - cx, y - cy, 1]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [m1, m2, m3, m4] = m;
  const c14 = cross(m1, m4);
  const k2 = dot(c14, m3) / dot(cross(m2, m4), m3);
  const k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  if (!isFinite(k2) || !isFinite(k3)) return simple;
  // focal length from the corners; when the photo hides it (edges still parallel, e.g. a page tilted
  // straight away from the camera) or it comes out odd, use a typical phone/iPad lens instead
  const long = 2 * Math.max(cx, cy), zz = n2[2] * n3[2];
  let f2 = Math.abs(zz) > 1e-9 ? -(n2[0] * n3[0] + n2[1] * n3[1]) / zz : NaN;
  if (!(f2 > (0.45 * long) ** 2 && f2 < (2.5 * long) ** 2)) f2 = (0.75 * long) ** 2; // iPad 7th gen back camera: 3.3 mm lens on a 4.54 mm sensor, about 0.73
  const len = (n) => (n[0] ** 2 + n[1] ** 2) / f2 + n[2] ** 2;
  const r = Math.sqrt(len(n2) / len(n3));
  return isFinite(r) && r > 0.1 && r < 10 ? r : simple;
}

// Homography that maps the output rectangle (0..dw, 0..dh) onto the quad in the photo.
export function homography(q, dw, dh) {
  const src = [[0, 0], [dw, 0], [dw, dh], [0, dh]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const m = b.map((v, i) => v / A[i][i]);
  return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], 1];
}

// Flatten: every output pixel takes the (bilinear) colour of its spot in the photo.
export function warp(src, sw, sh, q, dw, dh) {
  const H = homography(q, dw, dh);
  const out = new Uint8ClampedArray(dw * dh * 4);
  let o = 0;
  for (let y = 0; y < dh; y++) {
    const yy = y + 0.5;
    let X = H[0] * 0.5 + H[1] * yy + H[2], Y = H[3] * 0.5 + H[4] * yy + H[5], Z = H[6] * 0.5 + H[7] * yy + H[8];
    for (let x = 0; x < dw; x++, X += H[0], Y += H[3], Z += H[6], o += 4) {
      const u = X / Z - 0.5, v = Y / Z - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(u))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(v)));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src[a + k] + (src[b + k] - src[a + k]) * fx, bot = src[c + k] + (src[d + k] - src[c + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

// The paper's brightness everywhere (so shadows and uneven light can be divided out):
// brightest spots in a coarse grid, smoothed, then read back per pixel.
export function paperLight(rgba, w, h) {
  const cell = Math.max(8, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  let grid = new Float32Array(gw * gh);
  const hist = new Uint16Array(64);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    // 90th percentile of a sparse sample in the cell (ignores ink, and a single glare pixel), from a histogram
    hist.fill(0); let n = 0;
    for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 2) {
      const j = (y * w + x) * 4; hist[(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) >> 2]++; n++;
    }
    let want = Math.floor(n * 0.9), b = 0;
    while (b < 63 && want >= hist[b]) { want -= hist[b]; b++; }
    grid[gy * gw + gx] = n ? b * 4 + 2 : 255;
  }
  // a cell that is all ink (a big dark drawing) borrows from brighter neighbours
  const sorted = Array.from(grid).sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  for (let i = 0; i < grid.length; i++) grid[i] = Math.max(grid[i], median * 0.6);
  for (let pass = 0; pass < 2; pass++) {
    const g2 = new Float32Array(grid.length);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.max(0, Math.min(gh - 1, gy + dy)), xx = Math.max(0, Math.min(gw - 1, gx + dx));
        mx = Math.max(mx, grid[yy * gw + xx]);
      }
      g2[gy * gw + gx] = mx;
    }
    grid = boxBlur(g2, gw, gh, 1);
  }
  return { grid, gw, gh, cell };
}

// mode: 'clean' (white paper, colours kept), 'bw' (black and white), 'color' (as photographed)
export function enhance(rgba, w, h, mode = 'clean') {
  if (mode === 'color') return rgba;
  const { grid, gw, gh, cell } = paperLight(rgba, w, h);
  const bw = mode === 'bw';
  // value / paper light -> output, as a table (much faster than maths per pixel on the old iPad)
  const lo = bw ? 0.5 : 0.25, hi = bw ? 0.86 : 0.9, N = 1024, lut = new Uint8ClampedArray(N + 1);
  for (let i = 0; i <= N; i++) {
    const v = Math.max(0, Math.min(1, (i / 512 - lo) / (hi - lo)));
    lut[i] = Math.round(255 * (bw ? v * v * (3 - 2 * v) : Math.pow(v, 1.15)));
  }
  const rowBg = new Float32Array(gw), inv = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const gyf = Math.max(0, Math.min(gh - 1, y / cell - 0.5)), gy0 = Math.floor(gyf), gy1 = Math.min(gh - 1, gy0 + 1), fy = gyf - gy0;
    for (let gx = 0; gx < gw; gx++) rowBg[gx] = grid[gy0 * gw + gx] + (grid[gy1 * gw + gx] - grid[gy0 * gw + gx]) * fy;
    for (let x = 0; x < w; x++) {
      const gxf = Math.max(0, Math.min(gw - 1, x / cell - 0.5)), gx0 = Math.floor(gxf), gx1 = Math.min(gw - 1, gx0 + 1);
      inv[x] = 512 / Math.max(30, rowBg[gx0] + (rowBg[gx1] - rowBg[gx0]) * (gxf - gx0));
    }
    let j = y * w * 4;
    if (bw) {
      for (let x = 0; x < w; x++, j += 4) {
        const v = lut[Math.min(N, ((0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * inv[x]) | 0)];
        rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
      }
    } else {
      for (let x = 0; x < w; x++, j += 4) {
        const k = inv[x];
        rgba[j] = lut[Math.min(N, (rgba[j] * k) | 0)];
        rgba[j + 1] = lut[Math.min(N, (rgba[j + 1] * k) | 0)];
        rgba[j + 2] = lut[Math.min(N, (rgba[j + 2] * k) | 0)];
      }
    }
  }
  return rgba;
}

// Output size in pixels for a quad: at most maxW wide, height from the page's shape.
export function outputSize(q, photoW, photoH, maxW = 1632, maxH = 2400) {
  const r = quadAspect(q, photoW / 2, photoH / 2); // width / height
  let w = maxW, hh = Math.round(maxW / r);
  if (hh > maxH) { hh = maxH; w = Math.round(maxH * r); }
  return { w, h: hh };
}

// ---------- auto capture (live camera) ----------
// A small, lighting-proof fingerprint of the page inside the quad: flattened to 48 x 62,
// softened, then shifted and scaled to mean 0 and spread 1. Two looks at the same page
// match closely (sigMatch near 1); a different page does not.
export const SIG_W = 48, SIG_H = 62;
export function pageSignature(rgba, w, h, quad) {
  const big = warp(rgba, w, h, quad, SIG_W * 2, SIG_H * 2);
  const g = new Float32Array(SIG_W * SIG_H);
  for (let y = 0; y < SIG_H; y++) for (let x = 0; x < SIG_W; x++) {
    let s = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const j = ((y * 2 + dy) * SIG_W * 2 + x * 2 + dx) * 4;
      s += 0.299 * big[j] + 0.587 * big[j + 1] + 0.114 * big[j + 2];
    }
    g[y * SIG_W + x] = s / 4;
  }
  const b = boxBlur(g, SIG_W, SIG_H, 1);
  let m = 0; for (const v of b) m += v; m /= b.length;
  let sd = 0; for (const v of b) sd += (v - m) * (v - m); sd = Math.sqrt(sd / b.length) || 1;
  for (let i = 0; i < b.length; i++) b[i] = (b[i] - m) / sd;
  return b;
}
// correlation of two fingerprints: 1 = same picture, 0 = unrelated
export function sigMatch(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
}

// One step of the auto shutter, called for every camera frame that was checked.
// det: { found, quad (in 0..1 of the frame), sig }. Returns { capture, hint, progress, same }.
// A page that holds still for holdMs is taken. After that the shutter waits until the page is
// turned: two pages of one worksheet look almost the same at camera-preview size, so "turned"
// means the page left the view for a moment (a hand turning it), jumped, or clearly changed.
export const AUTO = { still: 0.012, holdMs: 900, same: 0.9, jump: 0.08, goneFrames: 2 };
export function autoStep(st, det, now) {
  if (st.armed === undefined) st.armed = true;
  if (!det.found) {
    st.since = null; st.lastQuad = null;
    if (!st.armed && ++st.gone >= AUTO.goneFrames) st.armed = true;
    return { capture: false, hint: 'Point at a page', progress: 0 };
  }
  const dist = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
  if (!st.armed && ((st.takenQuad && dist(det.quad, st.takenQuad) > AUTO.jump) || sigMatch(det.sig, st.taken) < AUTO.same)) st.armed = true;
  const moved = st.lastQuad ? dist(det.quad, st.lastQuad) : 1;
  st.lastQuad = det.quad;
  if (!st.armed) return { capture: false, hint: 'Turn to the next page', progress: 0, same: true };
  if (moved > AUTO.still || st.since === null) { st.since = now; return { capture: false, hint: 'Hold still', progress: 0 }; }
  const progress = Math.min(1, (now - st.since) / AUTO.holdMs);
  if (progress < 1) return { capture: false, hint: 'Hold still', progress };
  taken(st, det);
  return { capture: true, hint: 'Got it', progress: 1 };
}
// The page was taken (by the auto shutter or the button): wait for the next one.
export function taken(st, det) {
  st.armed = false; st.gone = 0; st.since = null;
  st.taken = det.sig; st.takenQuad = det.quad;
}
