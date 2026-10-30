// Real files in samples-private/ (git-ignored): full comparison against MPXJ, local only.
// Expected values come from `npm run oracle -- --private` into samples-private/expected/.
// Without those files the test is skipped, so no real data ends up in the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import CFB from 'cfb';
import { readMpp } from '../src/mpp/reader.js';

const dir = join(import.meta.dirname, '..', 'samples-private');
const files = existsSync(join(dir, 'expected'))
  ? readdirSync(dir).filter(f => f.endsWith('.mpp') && existsSync(join(dir, 'expected', f.replace(/\.mpp$/, '.json'))))
  : [];

// Durations compared with the same tolerance as MPXJ Duration (1e-5).
const round = d => (d && typeof d === 'object' && 'units' in d ? { value: Math.round(d.value * 1e5) / 1e5, units: d.units } : d);
const fields = list => list.map(f => ({ ...f, value: round(f.value) }));
const task = t => ({
  ...t, duration: round(t.duration), work: round(t.work), remainingWork: round(t.remainingWork),
  predecessors: t.predecessors.map(p => ({ ...p, lag: round(p.lag) })),
  customFields: fields(t.customFields), enterpriseFields: fields(t.enterpriseFields),
});
const other = a => ({ ...a, work: round(a.work), customFields: fields(a.customFields), enterpriseFields: fields(a.enterpriseFields) });

test('file privati uguali a MPXJ (saltato se samples-private/expected manca)', { skip: files.length === 0 }, () => {
  for (const name of files) {
    const expected = JSON.parse(readFileSync(join(dir, 'expected', name.replace(/\.mpp$/, '.json')), 'utf8'));
    const model = readMpp(new Uint8Array(readFileSync(join(dir, name))), CFB);
    assert.deepEqual(model.tasks.map(task), expected.tasks.map(task), `${name}: attività`);
    assert.deepEqual(model.resources.map(other), expected.resources.map(other), `${name}: risorse`);
    assert.deepEqual(model.assignments.map(other), expected.assignments.map(other), `${name}: assegnazioni`);
    assert.deepEqual(model.customFieldNames, expected.customFieldNames, `${name}: nomi dei campi`);
    assert.deepEqual(model.enterpriseFieldTypes, expected.enterpriseFieldTypes, `${name}: tipi dei campi aziendali`);
  }
});
