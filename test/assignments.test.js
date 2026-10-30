import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import CFB from 'cfb';
import { readMpp } from '../src/mpp/reader.js';

const samples = join(import.meta.dirname, '..', 'samples');
const mpp14 = readdirSync(samples)
  .filter(f => f.endsWith('.mpp'))
  .map(name => ({ name, expected: JSON.parse(readFileSync(join(samples, 'expected', name.replace(/\.mpp$/, '.json')), 'utf8')) }))
  .filter(s => s.expected.format === 'MSProject.MPP14');

// Work is a decimal: compare with the same tolerance as MPXJ Duration (1e-5).
const round = d => (d ? { value: Math.round(d.value * 1e5) / 1e5, units: d.units } : d);
const normalize = a => ({ ...a, work: round(a.work) });

let compared = 0;

for (const { name, expected } of mpp14) {
  test(`assegnazioni uguali a MPXJ: ${name}`, () => {
    const model = readMpp(new Uint8Array(readFileSync(join(samples, name))), CFB);
    assert.deepEqual(model.assignments.map(a => a.uid), expected.assignments.map(a => a.uid), 'elenco e ordine degli ID univoci');
    for (let i = 0; i < expected.assignments.length; i++) {
      assert.deepEqual(normalize(model.assignments[i]), normalize(expected.assignments[i]), `assegnazione uid ${expected.assignments[i].uid}`);
    }
    compared += expected.assignments.length;

    // Every assignment points to an existing task and an existing resource (or none).
    const taskUids = new Set(model.tasks.map(t => t.uid));
    const resourceUids = new Set(model.resources.map(r => r.uid));
    for (const a of model.assignments) {
      assert.ok(taskUids.has(a.taskUid), `attività ${a.taskUid} inesistente`);
      assert.ok(a.resourceUid === null || resourceUids.has(a.resourceUid), `risorsa ${a.resourceUid} inesistente`);
    }
  });
}

test('almeno 250 assegnazioni confrontate con MPXJ', () => {
  assert.ok(compared >= 250, `confrontate ${compared}`);
});
