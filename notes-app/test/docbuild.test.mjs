// Scans rebuilt as real PDF pages (text with an embedded font, pictures cut from the scan):
// node notes-app/test/docbuild.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTTF } from '../js/ttf.js';
import { parseLayout, mathRuns, drawRun, planPage, missedInk, snapLines, buildDocPdf } from '../js/docbuild.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const font = parseTTF(readFileSync(path.join(here, '../vendor/fonts/DejaVuSans-notes.ttf')));
const bold = parseTTF(readFileSync(path.join(here, '../vendor/fonts/DejaVuSans-Bold-notes.ttf')));
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : (fail++, console.log('FAIL', name, info)); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want));

// the font
ok('font: units per em', font.unitsPerEm === 2048, font.unitsPerEm);
for (const ch of 'Aaz09^π√≤≥≠±θ°·÷∞∪→') ok('font has ' + ch, font.has(ch.codePointAt(0)));
ok('font: W wider than i', font.width('W') > font.width('i'));
ok('bold font is wider', bold.width('Worksheet') > font.width('Worksheet'));

// powers and subscripts
eq('x^{2}', mathRuns('x^{2}+1'), [{ t: 'x', pos: 0 }, { t: '2', pos: 1 }, { t: '+1', pos: 0 }]);
eq('x^2 short form', mathRuns('3x^2 - 4x'), [{ t: '3x', pos: 0 }, { t: '2', pos: 1 }, { t: ' - 4x', pos: 0 }]);
eq('x_{1}', mathRuns('x_{1} + x_2'), [{ t: 'x', pos: 0 }, { t: '1', pos: -1 }, { t: ' + x', pos: 0 }, { t: '2', pos: -1 }]);
eq('e^(x+1)', mathRuns('e^(x+1)'), [{ t: 'e', pos: 0 }, { t: '(x+1)', pos: 1 }]);
eq('negative power', mathRuns('x^-2'), [{ t: 'x', pos: 0 }, { t: '-2', pos: 1 }]);
eq('plain text untouched', mathRuns('Name: Sam'), [{ t: 'Name: Sam', pos: 0 }]);
eq('a lone caret stays', mathRuns('a ^ b'), [{ t: 'a ^ b', pos: 0 }]);

// how powers are drawn: real superscript characters when possible
eq('x^2 draws ²', drawRun({ t: '2', pos: 1 }, font), { t: '²', small: false });
eq('x^-1 draws ⁻¹', drawRun({ t: '-1', pos: 1 }, font), { t: '⁻¹', small: false });
eq('x_1 draws ₁', drawRun({ t: '1', pos: -1 }, font), { t: '₁', small: false });
eq('e^(x+1) is raised with hidden ^( )', drawRun({ t: '(x+1)', pos: 1 }, font), { t: '(x+1)', small: true, before: '^(', after: ')' });

// reading Gemini's answer
const L = parseLayout({ lines: [
  { t: '1. Solve  x^{2} - 4x - 5 = 0', b: [60, 180, 520, 200] },
  { t: 'Unit 4 Worksheet', b: [60, 50, 600, 80], s: 'title', w: 'bold' },
  { t: 'y', b: [700, 400, 710, 410] },          // a label inside the graph: dropped (the graph keeps it)
  { t: '', b: [1, 2, 3, 4] }, { t: 'bad box', b: [1, 2] }, null,
  { t: 'Name: Sam', b: [1100, 95, -5, 115] }   // reversed and out of range: fixed
], pictures: [{ b: [650, 300, 950, 600], k: 'graph' }, { b: [100, 210, 400, 260], k: 'handwriting' }, { b: [5, 5, 6, 6] }] });
eq('lines kept, top to bottom', L.lines.map(l => l.t), ['Unit 4 Worksheet', 'Name: Sam', '1. Solve x^{2} - 4x - 5 = 0']);
eq('box fixed', L.lines[1].b, [0, 95, 1000, 115]);
eq('title + bold kept', [L.lines[0].s, L.lines[0].w], ['title', 'bold']);
eq('pictures kept (tiny one dropped)', L.pictures.map(p => p.k), ['graph', 'handwriting']);
eq('empty answer', parseLayout(null), { lines: [], pictures: [] });

// layout on a 1632 x 2112 scan (Letter)
const plan = planPage(parseLayout({ lines: [
  { t: 'Unit 4 Worksheet', b: [70, 40, 560, 62], s: 'title', w: 'bold' },
  { t: '1. Solve x^{2} - 4x - 5 = 0', b: [70, 180, 420, 196] },
  { t: '2. Factor 6x^{2} + x - 2', b: [70, 330, 360, 347] },
  { t: '3. Find the vertex of y = x^{2} - 4x + 1', b: [70, 480, 520, 495] },
  { t: 'This line was read with a box much too narrow for it', b: [70, 600, 200, 615] }
], pictures: [{ b: [100, 200, 420, 260], k: 'handwriting' }] }), 1632, 2112, font);
eq('page is Letter in points', [plan.w, plan.h], [612, 792]);
const bodySizes = plan.texts.slice(1, 4).map(t => t.size);
ok('normal lines share one size', new Set(bodySizes).size === 1, bodySizes);
ok('title is bigger than body', plan.texts[0].size > bodySizes[0] * 1.1);
ok('text sits in its box (x)', Math.abs(plan.texts[1].x - 0.07 * 612) < 0.5);
ok('baseline inside its box', plan.texts[1].y > 0.180 * 792 && plan.texts[1].y <= 0.196 * 792, plan.texts[1].y);
const narrow = plan.texts[4];
const runW = (t) => t.runs.reduce((w, r) => { const d = drawRun(r, font); return w + font.width(d.t) / 2048 * t.size * (d.small ? 0.65 : 1); }, 0) * t.scale;
const narrowW = runW(narrow);
ok('a far too narrow box does not shrink the text to nothing', narrow.size >= bodySizes[0] * 0.75, narrow.size);
ok('...it runs on but stays on the page', narrow.x + narrowW <= 612 - 17, narrow.x + narrowW);
const near = planPage(parseLayout({ lines: [{ t: '1. Solve x^{2} - 4x - 5 = 0', b: [70, 180, 420, 196] }, { t: '2. Factor 6x^{2} + x - 2 and more', b: [70, 330, 300, 347] }] }), 1632, 2112, font).texts[1];
const nearW = runW(near);
ok('a slightly too-long line is squeezed into its box', nearW <= 0.23 * 612 * 1.05 && near.scale < 1, nearW + ' scale ' + near.scale);
eq('handwriting picture in pixels', Object.fromEntries(Object.entries(plan.pictures[0]).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])), { x0: 163.2, y0: 422.4, x1: 685.44, y1: 549.12, k: 'handwriting' });

// ink nobody accounted for is kept
{
  const w = 400, h = 300, g = new Float32Array(w * h).fill(250);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = 30; };
  ink(20, 20, 200, 30);   // a text line Gemini read
  ink(250, 150, 330, 200); // a scribble it missed
  ink(100, 250, 101, 251); // a speck of dust
  const m = missedInk(g, w, h, [{ x0: 18, y0: 18, x1: 202, y1: 32 }]);
  ok('missed scribble found', m.length === 1 && m[0].x0 <= 250 && m[0].x1 >= 330 && m[0].y0 <= 150 && m[0].y1 >= 200, JSON.stringify(m));
  ok('nothing missed when all is covered', missedInk(g, w, h, [{ x0: 18, y0: 18, x1: 202, y1: 32 }, { x0: 245, y0: 145, x1: 335, y1: 205 }]).length === 0);
}

// a box that stops short of the printed line is stretched to the line's real ends,
// but not across to a handwritten answer further along the same row
{
  const w = 600, h = 120, g = new Float32Array(w * h).fill(250);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = 30; };
  for (let x = 40; x < 300; x += 14) ink(x, 40, x + 9, 60);   // printed words with small gaps, x 40..297
  ink(420, 36, 500, 64);                                          // a handwritten answer, far to the right
  const [b] = snapLines(g, w, h, [{ x0: 60, y0: 38, x1: 200, y1: 62 }]);
  ok('short box stretched to the end of the printed line', b.x1 >= 297 && b.x1 < 320, b.x1);
  ok('...and back to its start', b.x0 <= 40, b.x0);
  ok('...but not over the handwritten answer', b.x1 < 420);
  const left = missedInk(g, w, h, [b]);
  ok('only the handwriting is left as a picture', left.length === 1 && left[0].x0 >= 400, JSON.stringify(left));
}

// a real PDF: other PDF readers find the text, with the right characters
{
  // a tiny grey JPEG (8x8) for the picture
  const jpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAAIAAgBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64'));
  const page = { w: plan.w, h: plan.h, texts: plan.texts, images: [{ x: 61.2, y: 158.4, w: 195.8, h: 47.5, jpeg, pxW: 8, pxH: 8 }] };
  const page2 = { w: 612, h: 792, texts: [{ x: 50, y: 100, size: 14, bold: false, scale: 1, runs: mathRuns('Page 2: θ ≤ 90°, √2 ≈ 1.414, π') }, { x: 50, y: 140, size: 14, bold: false, scale: 1, runs: mathRuns('Grow: y = e^{x+1} and 2^{n} - x_{1}') }], images: [] };
  const parts = buildDocPdf([page, page2], { regular: font, bold }, 'Unit 4 Worksheet');
  const dir = mkdtempSync(path.join(tmpdir(), 'docpdf-'));
  const file = path.join(dir, 'scan.pdf');
  writeFileSync(file, Buffer.concat(parts.map(p => Buffer.from(p))));
  let text = '', info = '';
  try { text = execFileSync('pdftotext', ['-layout', file, '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { text = 'ERROR ' + e.stderr; }
  ok('pdftotext reads the title', /Unit 4 Worksheet/.test(text), text.slice(0, 300));
  ok('pdftotext reads a question, power and all', /1\. Solve x² - 4x - 5 = 0/.test(text), text.slice(0, 400));
  ok('raised text keeps hidden ^( ) for Solve', /y = e\^\(x\+1\) and 2ⁿ - x₁/.test(text), text.match(/Grow.*/));
  ok('pdftotext reads math symbols', /θ ≤ 90°, √2 ≈ 1\.414, π/.test(text), text);
  ok('two pages', (text.match(/\f/g) || []).length >= 1);
  try { info = execFileSync('python3', ['-c', 'import sys,pypdf;r=pypdf.PdfReader(sys.argv[1]);print(len(r.pages), r.pages[0].mediabox.width, r.pages[0].mediabox.height, sorted(r.pages[0]["/Resources"]["/Font"].keys()))', file]).toString().trim(); } catch (e) { info = 'ERROR ' + e.message; }
  ok('pypdf opens it: 2 Letter pages with both fonts', info === "2 612 792 ['/F1', '/F2']", info);
  try { execFileSync('pdftoppm', ['-r', '40', '-png', '-f', '1', '-l', '1', file, path.join(dir, 'p')], { stdio: 'pipe' }); ok('pdftoppm draws it', true); }
  catch (e) { ok('pdftoppm draws it', false, String(e.stderr)); }
  if (process.env.KEEP) console.log('pdf kept at', file);
}

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
