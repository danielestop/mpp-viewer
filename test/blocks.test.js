// Checks the read plumbing (field map, fixed and var blocks) before tasks:
// names read from var data by unique ID match MPXJ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import CFB from 'cfb';
import { openProject, openTable, fieldMapFor } from '../src/mpp/reader.js';
import { readFixedMeta, readFixedData, readVarMeta12, VarData } from '../src/mpp/blocks.js';
import { getTimestamp, formatDateTime, getUnicodeString, getDouble } from '../src/mpp/bytes.js';
import { adjustedDuration, durationTimeUnits } from '../src/mpp/units.js';
import { createFieldMap } from '../src/mpp/fieldmap.js';

// One field map entry (28 bytes): fixed block offset (65535 = var data) and field ID.
function fieldMapEntry(fieldId, offset) {
  const entry = new Uint8Array(28);
  const view = new DataView(entry.buffer);
  view.setUint16(4, offset, true);
  view.setInt32(12, fieldId, true);
  return entry;
}

const samples = join(import.meta.dirname, '..', 'samples');
const mpp14 = readdirSync(samples)
  .filter(f => f.endsWith('.mpp'))
  .map(name => ({ name, expected: JSON.parse(readFileSync(join(samples, 'expected', name.replace(/\.mpp$/, '.json')), 'utf8')) }))
  .filter(s => s.expected.format === 'MSProject.MPP14');

for (const { name, expected } of mpp14) {
  test(`nomi di attività e risorse dai dati variabili uguali a MPXJ: ${name}`, () => {
    const ctx = openProject(new Uint8Array(readFileSync(join(samples, name))), CFB);
    for (const [cls, dir, list] of [['task', 'TBkndTask', expected.tasks], ['resource', 'TBkndRsc', expected.resources]]) {
      const fieldMap = fieldMapFor(ctx, cls);
      assert.ok(fieldMap.has('NAME'), `${cls}: campo NAME assente nella mappa`);
      const table = openTable(ctx, dir);
      const varData = new VarData(readVarMeta12(table.varMeta), table.varData);
      for (const item of list.filter(i => i.name)) {
        assert.equal(fieldMap.read('NAME', item.uid, [], varData, ctx.calendar), item.name, `${cls} uid ${item.uid}`);
      }
    }
  });

  test(`blocchi fissi delle attività leggibili e coerenti: ${name}`, () => {
    const ctx = openProject(new Uint8Array(readFileSync(join(samples, name))), CFB);
    const fieldMap = fieldMapFor(ctx, 'task');
    const table = openTable(ctx, 'TBkndTask');
    const meta = readFixedMeta(table.fixedMeta, 47);
    const fixed = readFixedData(meta, table.fixedData, fieldMap.maxFixedDataSize[0]);
    const uids = new Set(fixed.items.filter(Boolean).map(d => fieldMap.read('UNIQUE_ID', null, [d], null, ctx.calendar)));
    for (const task of expected.tasks) assert.ok(uids.has(task.uid), `uid ${task.uid} non trovato nei blocchi fissi`);
  });
}

test('date: epoca 31/12/1983, decimi di minuto, valori "ND"', () => {
  const ts = (days, tenths) => Uint8Array.from([tenths & 0xff, tenths >> 8, days & 0xff, days >> 8]);
  assert.equal(getTimestamp(ts(1, 0), 0), null);
  assert.equal(getTimestamp(ts(65535, 0), 0), null);
  assert.equal(getTimestamp(ts(12710, 4800), 0), '2018-10-18T08:00');
  assert.equal(getTimestamp(ts(12710, 4805), 0), '2018-10-18T08:00:30');
  assert.equal(getTimestamp(ts(50, 5), 0), null);
  assert.equal(formatDateTime(Date.UTC(2024, 1, 29, 23, 59)), '2024-02-29T23:59');
});

test('durate: unità e conversione con il calendario del progetto', () => {
  const cal = { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 };
  assert.deepEqual(adjustedDuration(cal, 4800, 'DAYS'), { value: 1, units: 'DAYS' });
  assert.deepEqual(adjustedDuration(cal, 24000, 'WEEKS'), { value: 1, units: 'WEEKS' });
  assert.deepEqual(adjustedDuration(cal, 96000, 'MONTHS'), { value: 1, units: 'MONTHS' });
  assert.deepEqual(adjustedDuration(cal, 14400, 'ELAPSED_DAYS'), { value: 1, units: 'ELAPSED_DAYS' });
  assert.deepEqual(adjustedDuration(cal, 600, 'HOURS'), { value: 1, units: 'HOURS' });
  assert.equal(adjustedDuration(cal, -1, 'DAYS'), null);
  assert.equal(durationTimeUnits(5), 'HOURS');
  assert.equal(durationTimeUnits(21, 'WEEKS'), 'WEEKS');
  assert.equal(durationTimeUnits(0), 'DAYS');
  assert.equal(durationTimeUnits(99), 'MINUTES'); // only the low 5 bits count (99 & 0x1F = 3)
});

test('numeri decimali: un NaN nel file vale 0, come in MPXJ', () => {
  const nan = new Uint8Array(8);
  new DataView(nan.buffer).setFloat64(0, NaN, true);
  assert.equal(getDouble(nan, 0), 0);
  const fm = createFieldMap(fieldMapEntry(0x0c400000 | 4, 0), 'resource'); // MAX_UNITS in the fixed block
  assert.equal(fm.read('MAX_UNITS', 1, [nan], null, {}), 0);
});

test('date nei dati variabili: valore da elenco con sola data, testo di 512 byte', () => {
  const fm = createFieldMap(fieldMapEntry(0x0b400000 | 93, 65535), 'task'); // CREATED in var data
  const varData = data => ({ getByteArray: () => data, getShort: () => data[0] | (data[1] << 8) });
  assert.equal(fm.read('CREATED', 1, [], varData(Uint8Array.from([0x01, 0x07, 0xa6, 0x31])), {}), '2018-10-18T00:00');
  assert.equal(fm.read('CREATED', 1, [], varData(new Uint8Array(512).fill(0x41)), {}), null);
  assert.equal(fm.read('CREATED', 1, [], varData(Uint8Array.from([0xc0, 0x12, 0xa6, 0x31])), {}), '2018-10-18T08:00');
});

test('TASK_MODE e RESOURCE_TYPE non si leggono dalla mappa dei campi (vengono dai bit flag)', () => {
  const fm = createFieldMap(fieldMapEntry(0x0b400000 | 1280, 0), 'task');
  assert.equal(fm.read('TASK_MODE', 1, [Uint8Array.from([1, 0])], null, {}), null);
});

test('stringhe UTF-16 terminate da zero', () => {
  assert.equal(getUnicodeString(Uint8Array.from([0x41, 0, 0xe0, 0, 0, 0, 0x42, 0]), 0), 'Aà');
});
