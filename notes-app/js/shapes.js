// Clean up hand-drawn strokes: straight lines (hold the pen still), and with Shapes on,
// rough circles, ellipses and rectangles. Pure functions on flat [x, y, pressure, ...] arrays.

const P = 0.5; // even pressure for cleaned shapes

function stats(p) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, len = 0;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (i) len += Math.hypot(x - p[i - 3], y - p[i - 2]);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, len, n: p.length / 3 };
}

// points every `step` units along a polyline of [x, y] corners
function densify(corners, step = 4) {
  const out = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, P);
  }
  const [lx, ly] = corners[corners.length - 1];
  out.push(lx, ly, P);
  return out;
}

export function lineFrom(ax, ay, bx, by) { return densify([[ax, ay], [bx, by]]); }

// Is this stroke roughly straight? (so a pause while writing a letter does not turn it into a line)
export function straightLine(p) {
  const s = stats(p); if (s.n < 2) return null;
  const ax = p[0], ay = p[1], bx = p[p.length - 3], by = p[p.length - 2];
  const chord = Math.hypot(bx - ax, by - ay);
  if (chord < 24 || s.len > chord * 1.35) return null;
  let maxDev = 0;
  for (let i = 0; i < p.length; i += 3) {
    const d = Math.abs((by - ay) * p[i] - (bx - ax) * p[i + 1] + bx * ay - by * ax) / chord;
    if (d > maxDev) maxDev = d;
  }
  return maxDev <= Math.max(6, chord * 0.12) ? lineFrom(ax, ay, bx, by) : null;
}

// A closed rough shape becomes a clean rectangle or ellipse (circle when nearly round).
export function cleanShape(p) {
  const s = stats(p);
  const size = Math.max(s.w, s.h);
  if (s.n < 8 || size < 24 || Math.min(s.w, s.h) < 12) return null;
  const gap = Math.hypot(p[0] - p[p.length - 3], p[1] - p[p.length - 2]);
  if (gap > size * 0.5 || s.len < size * 2.2) return null; // not closed, or just a line
  const diag = Math.hypot(s.w, s.h), m = Math.min(s.w, s.h);
  // rectangle: every corner of the bounding box has ink near it, and the ink hugs the edges
  const corners = [[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]];
  const nearCorner = corners.every(([cx, cy]) => { for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - cx, p[i + 1] - cy) < diag * 0.12) return true; return false; });
  let edge = 0;
  for (let i = 0; i < p.length; i += 3) edge += Math.min(p[i] - s.x0, s.x1 - p[i], p[i + 1] - s.y0, s.y1 - p[i + 1]);
  edge /= s.n;
  if (nearCorner && edge < m * 0.07) return { kind: 'rect', p: densify([...corners, corners[0]]) };
  // ellipse: points sit close to the ellipse that fills the bounding box
  const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
  let rx = s.w / 2, ry = s.h / 2, err = 0;
  for (let i = 0; i < p.length; i += 3) err += Math.abs(Math.hypot((p[i] - cx) / rx, (p[i + 1] - cy) / ry) - 1);
  err /= s.n;
  if (err > 0.13) return null;
  let kind = 'ellipse';
  if (Math.abs(rx - ry) < Math.max(rx, ry) * 0.18) { rx = ry = (rx + ry) / 2; kind = 'circle'; }
  const pts = [], N = Math.max(48, Math.round((rx + ry) * Math.PI / 4));
  for (let k = 0; k <= N; k++) { const a = -Math.PI / 2 + k / N * Math.PI * 2; pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a), P); }
  return { kind, p: pts };
}
