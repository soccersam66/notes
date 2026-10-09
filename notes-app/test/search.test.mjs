// Search tests: node notes-app/test/search.test.mjs
import { search, snippet, highlight, words } from '../js/search.js';

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want))); };

const idx = {
  notebooks: [{ id: 'n1', name: 'Unit 2 Quadratics', cls: 'Precalc' }, { id: 'n2', name: 'Lab notes', cls: 'Chemistry' }],
  pages: [
    { nbId: 'n1', pageId: 'p1', nb: 'Unit 2 Quadratics', cls: 'Precalc', n: 1, text: 'Unit 2 Worksheet\n1) Solve x^2 - 4x - 5 = 0\n2) Factor 6x + 9' },
    { nbId: 'n1', pageId: 'p2', nb: 'Unit 2 Quadratics', cls: 'Precalc', n: 2, text: 'Vertex form: factor first, then factor again. Factor everything.' },
    { nbId: 'n2', pageId: 'p3', nb: 'Lab notes', cls: 'Chemistry', n: 1, text: 'Molar mass of water' },
    { nbId: 'n2', pageId: 'p4', nb: 'Lab notes', cls: 'Chemistry', n: 2, text: '' }
  ]
};
t('empty query finds nothing', search(idx, '   '), { notebooks: [], pages: [] });
t('notebook by name, any case', search(idx, 'quadRATICS').notebooks.map(n => n.id), ['n1']);
t('notebook by class name', search(idx, 'chemistry').notebooks.map(n => n.id), ['n2']);
t('page text, most hits first', search(idx, 'factor').pages.map(p => p.pageId), ['p2', 'p1']);
t('every word must match', search(idx, 'solve factor').pages.map(p => p.pageId), ['p1']);
t('words in any order', search(idx, 'water molar').pages.map(p => p.pageId), ['p3']);
t('no match', search(idx, 'photosynthesis'), { notebooks: [], pages: [] });
t('math text matches', search(idx, 'x^2').pages.map(p => p.pageId), ['p1']);
t('words() splits and lowercases', words('  Hello   WORLD '), ['hello', 'world']);
const long = 'a '.repeat(60) + 'target word here ' + 'b '.repeat(80);
const sn = snippet(long, ['target']);
t('snippet contains the match', sn.includes('target word here'), true);
t('snippet is short with dots', sn.startsWith('...') && sn.endsWith('...') && sn.length < 150, true);
t('snippet keeps capitals', search(idx, 'factor').pages[1].snippet.includes('2) Factor 6x + 9'), true);
t('highlight marks matches', highlight('Factor 6x + 9', ['factor']), '<mark>Factor</mark> 6x + 9');
t('highlight escapes html', highlight('<b>x</b> & y', ['y']), '&lt;b&gt;x&lt;/b&gt; &amp; <mark>y</mark>');
t('highlight escapes regex characters', highlight('solve x^2 = 4', ['x^2']), 'solve <mark>x^2</mark> = 4');
console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
