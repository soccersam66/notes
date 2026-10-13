// Page scanning maths (find the sheet, flatten it, clean it): node notes-app/test/scan.test.mjs
import { findQuad, refineQuad, shrinkQuad, toGray, boxBlur, orderQuad, quadAspect, trueAspect, homography, warp, enhance, outputSize, convexHull, polyArea, otsu, insetQuad } from '../js/scan.js';

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : (fail++, console.log('FAIL', name, info)); };

// a "photo": desk colour everywhere, a sheet (quad) filled with paper colour, optional ink and light falloff
function inside(q, x, y) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const z = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (z !== 0) { if (!s) s = Math.sign(z); else if (Math.sign(z) !== s) return false; }
  }
  return true;
}
function photo(w, h, q, { desk = [70, 60, 50], paper = [235, 232, 225], light = null, noise = 0, ink = null } = {}) {
  const a = new Uint8ClampedArray(w * h * 4);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, inS = inside(q, x + 0.5, y + 0.5);
    let c = inS ? paper : desk;
    if (inS && ink && ink(x, y)) c = [30, 40, 120];
    const f = light ? light(x, y) : 1;
    for (let k = 0; k < 3; k++) a[j + k] = c[k] * f + (noise ? (rnd() - 0.5) * noise : 0);
    a[j + 3] = 255;
  }
  return a;
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const maxErr = (a, b) => Math.max(...a.map((p, i) => dist(p, b[i])));

// helpers
ok('hull of a square + inside points', convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [1, 3]]).length === 4);
ok('area of 4x4 square', polyArea([[0, 0], [4, 0], [4, 4], [0, 4]]) === 16);
ok('otsu splits two levels', (() => { const t = otsu(Float32Array.from([...Array(50).fill(40), ...Array(50).fill(220)])); return t >= 40 && t < 220; })());
ok('order corners TL, TR, BR, BL', JSON.stringify(orderQuad([[10, 90], [90, 85], [12, 8], [95, 12]])) === JSON.stringify([[12, 8], [95, 12], [90, 85], [10, 90]]));

// finding the sheet
const W = 480, H = 360;
const cases = {
  'straight sheet': [[120, 30], [360, 30], [360, 330], [120, 330]],
  'tilted photo (perspective)': [[140, 40], [345, 50], [390, 320], [90, 330]],
  'rotated 20 degrees': (() => { const c = [240, 180], s = [110, 140], a = 20 * Math.PI / 180; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [c[0] + u * s[0] * Math.cos(a) - v * s[1] * Math.sin(a), c[1] + u * s[0] * Math.sin(a) + v * s[1] * Math.cos(a)]); })(),
  'rotated 45 degrees': (() => { const c = [240, 180], s = [100, 120], a = 45 * Math.PI / 180; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [c[0] + u * s[0] * Math.cos(a) - v * s[1] * Math.sin(a), c[1] + u * s[0] * Math.sin(a) + v * s[1] * Math.cos(a)]); })(),
};
for (const [name, q] of Object.entries(cases)) {
  const r = findQuad(photo(W, H, q, { noise: 18 }), W, H);
  const want = orderQuad(q);
  ok('finds ' + name, r.found && maxErr(r.quad, want) < 4, JSON.stringify({ found: r.found, got: r.quad.map(p => p.map(Math.round)), want: want.map(p => p.map(Math.round)) }));
}
{ // handwriting on the sheet and a shadow across it must not throw it off
  const q = cases['tilted photo (perspective)'];
  const r = findQuad(photo(W, H, q, { noise: 12, light: (x, y) => 0.75 + 0.25 * (x / W), ink: (x, y) => (y % 24 < 3) && x % 50 < 35 }), W, H);
  ok('finds a written-on sheet in uneven light', r.found && maxErr(r.quad, orderQuad(q)) < 5, JSON.stringify(r.quad.map(p => p.map(Math.round))));
}
{ // nothing to find: an evenly lit photo of a wall
  const r = findQuad(photo(W, H, [[0, 0], [1, 0], [1, 1], [0, 1]], { noise: 4 }), W, H);
  ok('no sheet: falls back to the whole photo', !r.found && maxErr(r.quad, insetQuad(W, H)) < 1e-9);
}
{ // the sheet filling the whole photo
  const r = findQuad(photo(W, H, [[-5, -5], [W + 5, -5], [W + 5, H + 5], [-5, H + 5]]), W, H);
  ok('sheet fills the photo: whole photo', !r.found);
}

// sharpening the corners at a higher resolution
{
  const w = 1200, hh = 900;
  const q = [[300.4, 101.7], [905.2, 128.9], [978.6, 820.3], [222.1, 790.8]];
  const img = photo(w, hh, q, { noise: 14, light: (x, y) => 0.7 + 0.3 * (x / w) });
  const g = boxBlur(toGray(img, w, hh), w, hh, 1); // a little camera blur
  const rough = q.map(([x, y], i) => [x + [6, -5, 4, -7][i], y + [-5, 6, -6, 4][i]]);
  const fine = refineQuad(g, w, hh, rough);
  ok('refine: corners within 1.5 px', maxErr(fine, q) < 1.5, JSON.stringify(fine.map(p => p.map(v => +v.toFixed(1)))));
  ok('refine: much better than the rough corners', maxErr(fine, q) < maxErr(rough, q) / 4);
  // a thumb over one side: that side still fits (the worst points are dropped)
  const img2 = photo(w, hh, q, { noise: 10, ink: (x, y) => x > 560 && x < 640 && y > 760 });
  const fine2 = refineQuad(toGray(img2, w, hh), w, hh, rough);
  ok('refine: a dark spot on one edge does not pull it', maxErr(fine2, q) < 2.5, JSON.stringify(fine2.map(p => p.map(v => +v.toFixed(1)))));
  // a printed line or box near the edge (like a worksheet's answer box) is not the paper's edge,
  // even in shade where the line has more contrast than the paper against the desk
  const nearLine = (x, y) => Math.abs(y - (790.8 + (820.3 - 790.8) * (x - 222) / 756 - 14)) < 1.6 && x > 260 && x < 940;
  const img3 = photo(w, hh, q, { noise: 8, desk: [95, 80, 65], paper: [235, 232, 225], light: (x, y) => 0.55 + 0.45 * (1 - y / hh), ink: nearLine });
  const fine3 = refineQuad(boxBlur(toGray(img3, w, hh), w, hh, 1), w, hh, rough);
  ok('refine: a printed line near the bottom is not taken for the edge', maxErr(fine3, q) < 2, JSON.stringify(fine3.map(p => p.map(v => +v.toFixed(1)))));
  // nothing to sharpen (flat photo): the corners stay put
  const flat = new Float32Array(w * hh).fill(128);
  ok('refine: no edges, no change', maxErr(refineQuad(flat, w, hh, rough), rough) === 0);
}

ok('shrink a square by 2 px', maxErr(shrinkQuad([[0, 0], [10, 0], [10, 10], [0, 10]], 2), [[2, 2], [8, 2], [8, 8], [2, 8]]) < 1e-9);

// page shape
// A real camera: a page (width x height) tilted in 3D, seen by a pinhole camera with focal length f,
// projected into a photo (pw x ph). Returns the corners TL, TR, BR, BL in the photo.
function cameraQuad(pageW, pageH, { tiltX = 0, tiltY = 0, spin = 0, dist = 1.6, f = 3000, pw = 3024, ph = 4032, shiftX = 0, shiftY = 0 } = {}) {
  const r = (a) => a * Math.PI / 180;
  const [cx, sx] = [Math.cos(r(tiltX)), Math.sin(r(tiltX))], [cy, sy] = [Math.cos(r(tiltY)), Math.sin(r(tiltY))], [cz, sz] = [Math.cos(r(spin)), Math.sin(r(spin))];
  const scale = Math.max(pageW, pageH);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    let X = u * pageW / 2 / scale, Y = v * pageH / 2 / scale, Z = 0;
    [X, Y] = [X * cz - Y * sz, X * sz + Y * cz];        // spin on the desk
    [Y, Z] = [Y * cx - Z * sx, Y * sx + Z * cx];        // tilt away from the camera
    [X, Z] = [X * cy + Z * sy, -X * sy + Z * cy];       // turn sideways
    Z += dist; X += shiftX; Y += shiftY;
    return [pw / 2 + f * X / Z, ph / 2 + f * Y / Z];
  });
}
const L = 8.5 / 11;
const near = (a, b, tol) => Math.abs(a / b - 1) < tol;
for (const [name, opt] of [
  ['straight on', {}], ['tilted 30 degrees', { tiltX: 30 }], ['tilted 45 degrees', { tiltX: 45 }],
  ['tilted and turned', { tiltX: 35, tiltY: 15, spin: 8 }], ['off to one side', { tiltX: 25, shiftX: 0.15, shiftY: -0.1 }],
  ['close up, wide lens', { tiltX: 30, tiltY: -10, f: 2300, dist: 1.1 }]]) {
  const q = cameraQuad(8.5, 11, opt);
  const raw = trueAspect(q, 1512, 2016);
  // tilted straight back, the photo cannot show the lens, so a typical lens is assumed: a little looser
  const tol = opt.tiltY || opt.spin || opt.shiftX ? 0.02 : 0.05;
  ok('true shape of a Letter page, ' + name, near(raw, L, tol), raw.toFixed(4) + ' vs ' + L.toFixed(4));
  ok('snaps to Letter, ' + name, quadAspect(q, 1512, 2016) === L);
}
{ // the old way (edge lengths) is badly off for a tilted page; the camera way is not
  const q = cameraQuad(8.5, 11, { tiltX: 40 });
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lengths = (d(q[0], q[1]) + d(q[3], q[2])) / (d(q[0], q[3]) + d(q[1], q[2]));
  ok('edge lengths alone would be wrong by >10%', !near(lengths, L, 0.1), lengths.toFixed(3));
}
for (const [name, W0, H0, opt] of [['index card 5x3', 5, 3, { tiltX: 30, spin: 5 }], ['square sticky note', 3, 3, { tiltX: 35, tiltY: 10 }], ['A4', 210, 297, { tiltX: 25 }]]) {
  const q = cameraQuad(W0, H0, opt), want = W0 / H0;
  const got = quadAspect(q, 1512, 2016);
  ok('true shape of ' + name, near(got, want, 0.02), got.toFixed(4) + ' vs ' + want.toFixed(4));
}
ok('A4 does not snap to Letter', quadAspect(cameraQuad(210, 297, { tiltX: 20 }), 1512, 2016) !== L);
ok('landscape Letter', quadAspect(cameraQuad(11, 8.5, { tiltX: 30 }), 1512, 2016) === 11 / 8.5);
ok('no photo centre: plain edge lengths', Math.abs(quadAspect([[0, 0], [500, 0], [500, 500], [0, 500]]) - 1) < 1e-9);
ok('output size of Letter', JSON.stringify(outputSize(cameraQuad(8.5, 11, { tiltX: 30 }), 3024, 4032)) === JSON.stringify({ w: 1632, h: 2112 }));
ok('output size never too tall', outputSize([[0, 0], [100, 0], [100, 900], [0, 900]], 100, 900).h === 2400);

// flattening
{
  const H0 = homography([[10, 20], [110, 20], [110, 220], [10, 220]], 100, 200);
  const map = (x, y) => { const z = H0[6] * x + H0[7] * y + H0[8]; return [(H0[0] * x + H0[1] * y + H0[2]) / z, (H0[3] * x + H0[4] * y + H0[5]) / z]; };
  ok('homography maps corners', maxErr([map(0, 0), map(100, 0), map(100, 200), map(0, 200)], [[10, 20], [110, 20], [110, 220], [10, 220]]) < 1e-6);
  const Hp = homography(cases['tilted photo (perspective)'], 300, 400);
  const mp = (x, y) => { const z = Hp[6] * x + Hp[7] * y + Hp[8]; return [(Hp[0] * x + Hp[1] * y + Hp[2]) / z, (Hp[3] * x + Hp[4] * y + Hp[5]) / z]; };
  ok('homography maps perspective corners', maxErr([mp(0, 0), mp(300, 0), mp(300, 400), mp(0, 400)], cases['tilted photo (perspective)']) < 1e-6);
}
{ // a checkerboard drawn in perspective comes out straight
  const q = [[60, 30], [400, 50], [440, 330], [30, 310]];
  const sw = 480, sh = 360, src = new Uint8ClampedArray(sw * sh * 4);
  const Hq = homography(q, 8, 8); // page units: 8x8 squares
  // draw the board by forward-mapping a fine grid of page points into the photo
  for (let py = 0; py < 8; py += 1 / 120) for (let px = 0; px < 8; px += 1 / 120) {
    const z = Hq[6] * px + Hq[7] * py + Hq[8], u = Math.floor((Hq[0] * px + Hq[1] * py + Hq[2]) / z), v = Math.floor((Hq[3] * px + Hq[4] * py + Hq[5]) / z);
    if (u < 0 || v < 0 || u >= sw || v >= sh) continue;
    const c = ((Math.floor(px) + Math.floor(py)) % 2) ? 20 : 240, j = (v * sw + u) * 4;
    src[j] = src[j + 1] = src[j + 2] = c; src[j + 3] = 255;
  }
  const out = warp(src, sw, sh, q, 160, 160);
  let good = 0, total = 0;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const fx = (x + 0.5) / 20, fy = (y + 0.5) / 20;
    if (Math.abs(fx - Math.round(fx)) < 0.15 || Math.abs(fy - Math.round(fy)) < 0.15) continue; // skip square edges
    const want = ((Math.floor(fx) + Math.floor(fy)) % 2) ? 20 : 240;
    total++; if (Math.abs(out[(y * 160 + x) * 4] - want) < 40) good++;
  }
  ok('perspective checkerboard comes out straight', good / total > 0.99, `${good}/${total}`);
  ok('output is opaque', out[3] === 255 && out[out.length - 1] === 255);
}

// cleaning up
{ // light falls off from 1.0 to 0.55 across the page, with ink lines
  const w = 400, h = 520;
  const inkAt = (x, y) => y % 40 < 3 && x > 40 && x < 360;
  const img = photo(w, h, [[-1, -1], [w + 1, -1], [w + 1, h + 1], [-1, h + 1]], { paper: [225, 222, 215], light: (x, y) => 1 - 0.45 * (x / w) * (y / h), ink: inkAt });
  const clean = enhance(img.slice(), w, h, 'clean');
  let paperMin = 255, inkMax = 0, blueKept = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, l = (clean[j] + clean[j + 1] + clean[j + 2]) / 3;
    if (inkAt(x, y)) { inkMax = Math.max(inkMax, l); if (clean[j + 2] <= clean[j]) blueKept = false; }
    else if (y % 40 > 6 && y % 40 < 37) paperMin = Math.min(paperMin, l);
  }
  ok('clean: shadowed paper turns white', paperMin > 238, 'paper min ' + paperMin.toFixed(1));
  ok('clean: ink stays dark', inkMax < 110, 'ink max ' + inkMax.toFixed(1));
  ok('clean: blue ink stays blue', blueKept);
  const bw = enhance(img.slice(), w, h, 'bw');
  let grey = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = (y * w + x) * 4; if (bw[j] !== bw[j + 1] || bw[j] !== bw[j + 2]) grey = true; }
  ok('bw: black and white only', !grey);
  ok('bw: paper white, ink black', bw[(20 * w + 200) * 4] > 245 && bw[(41 * w + 200) * 4] < 40, bw[(20 * w + 200) * 4] + ' ' + bw[(41 * w + 200) * 4]);
  const same = enhance(img.slice(), w, h, 'color');
  ok('color: left as photographed', same.every((v, i) => v === img[i]));
}

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
