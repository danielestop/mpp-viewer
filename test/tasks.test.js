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

// Durations are decimals: compare with the same tolerance as MPXJ Duration (1e-5).
function normalize(task) {
  const round = d => (d ? { value: Math.round(d.value * 1e5) / 1e5, units: d.units } : d);
  return { ...task, duration: round(task.duration), work: round(task.work), remainingWork: round(task.remainingWork), predecessors: task.predecessors.map(p => ({ ...p, lag: round(p.lag) })) };
}

let compared = 0;

for (const { name, expected } of mpp14) {
  test(`attività uguali a MPXJ: ${name}`, () => {
    const model = readMpp(new Uint8Array(readFileSync(join(samples, name))), CFB);
    assert.deepEqual(model.tasks.map(t => t.uid), expected.tasks.map(t => t.uid), 'elenco e ordine degli ID univoci');
    for (let i = 0; i < expected.tasks.length; i++) {
      assert.deepEqual(normalize(model.tasks[i]), normalize(expected.tasks[i]), `attività uid ${expected.tasks[i].uid}`);
    }
    compared += expected.tasks.length;
  });
}

test('almeno 190 attività confrontate con MPXJ', () => {
  assert.ok(compared >= 190, `confrontate ${compared}`);
});
