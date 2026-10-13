// Units (one notebook per unit): naming the next unit. node notes-app/test/units.test.mjs
// (store.js only touches IndexedDB when a function that needs it runs, so the pure helper loads in Node.)
import { nextUnitName, pickCurrent } from '../js/store.js';

let pass = 0, fail = 0;
const t = (name, got, want) => { got === want ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', got, '\n  want', want)); };

t('no notebooks yet', nextUnitName([]), 'Unit 1');
t('after Unit 1', nextUnitName(['Unit 1']), 'Unit 2');
t('after units with topics', nextUnitName(['Unit 1: Functions', 'Unit 2 - Quadratics', 'Unit 3 Polynomials']), 'Unit 4');
t('out of order', nextUnitName(['Unit 3', 'Unit 1', 'Unit 2']), 'Unit 4');
t('other notebooks do not count', nextUnitName(['Class notes', 'Scans, Oct 13', 'Quiz review']), 'Unit 1');
t('a mix', nextUnitName(['Class notes', 'Unit 5', 'Homework']), 'Unit 6');
t('any case, extra spaces', nextUnitName(['  unit 7', 'UNIT8']), 'Unit 9');
t('two-digit units', nextUnitName(['Unit 9', 'Unit 10']), 'Unit 11');
t('a number later in the name is not a unit', nextUnitName(['Chapter 4', 'Test 2 review']), 'Unit 1');
t('missing list', nextUnitName(undefined), 'Unit 1');

// which notebook is current in a class from before units
const nb = (...names) => names.map((name, i) => ({ id: 'n' + i, name }));
t('old class: the main (first) notebook, not the scans one', pickCurrent(nb('Class notes', 'Scans, Oct 13', 'Photos, Oct 12')).name, 'Class notes');
t('old class with units: the highest unit', pickCurrent(nb('Class notes', 'Unit 2', 'Unit 3: Trig', 'Scans, Oct 13')).name, 'Unit 3: Trig');
t('no notebooks', pickCurrent([]), null);

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
