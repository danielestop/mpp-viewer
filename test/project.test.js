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

for (const { name, expected } of mpp14) {
  test(`informazioni progetto uguali a MPXJ: ${name}`, () => {
    const model = readMpp(new Uint8Array(readFileSync(join(samples, name))), CFB);
    assert.deepEqual(model.project, expected.project);
  });
}
