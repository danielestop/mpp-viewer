import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import CFB from 'cfb';
import { readMpp, openProject, fieldMapFor, openTable } from '../src/mpp/reader.js';
import { convertRateFromHours, currentStandardRate, currentMaxUnits, readResources } from '../src/mpp/resources.js';

const samples = join(import.meta.dirname, '..', 'samples');
const mpp14 = readdirSync(samples)
  .filter(f => f.endsWith('.mpp'))
  .map(name => ({ name, expected: JSON.parse(readFileSync(join(samples, 'expected', name.replace(/\.mpp$/, '.json')), 'utf8')) }))
  .filter(s => s.expected.format === 'MSProject.MPP14');

const read = name => readMpp(new Uint8Array(readFileSync(join(samples, name))), CFB);

let compared = 0;
const types = new Set();

for (const { name, expected } of mpp14) {
  test(`risorse uguali a MPXJ: ${name}`, () => {
    const model = read(name);
    assert.deepEqual(model.resources.map(r => r.uid), expected.resources.map(r => r.uid), 'elenco e ordine degli ID univoci');
    for (let i = 0; i < expected.resources.length; i++) {
      assert.deepEqual(model.resources[i], expected.resources[i], `risorsa uid ${expected.resources[i].uid}`);
      types.add(`${model.applicationName}:${model.resources[i].type}`);
    }
    compared += expected.resources.length;
  });
}

test('almeno 65 risorse confrontate con MPXJ', () => {
  assert.ok(compared >= 65, `confrontate ${compared}`);
});

test('tipi di risorsa coperti per Project 2010 e 2013+', () => {
  // Type bits sit in different spots before and after Project 2013.
  for (const t of ['Microsoft.Project 14.0:MATERIAL', 'Microsoft.Project 14.0:COST',
    'Microsoft.Project 16.0:WORK', 'Microsoft.Project 16.0:MATERIAL', 'Microsoft.Project 16.0:COST']) {
    assert.ok(types.has(t), `manca ${t}`);
  }
});

test('conversione della tariffa dall\'unità oraria', () => {
  const calendar = { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 };
  const rate = { amount: 50, units: 'HOURS' };
  assert.deepEqual(convertRateFromHours(rate, 'HOURS', calendar), { amount: 50, units: 'HOURS' });
  assert.deepEqual(convertRateFromHours(rate, 'DAYS', calendar), { amount: 400, units: 'DAYS' });
  assert.deepEqual(convertRateFromHours(rate, 'WEEKS', calendar), { amount: 2000, units: 'WEEKS' });
  assert.deepEqual(convertRateFromHours(rate, 'MONTHS', calendar), { amount: 8000, units: 'MONTHS' });
  assert.deepEqual(convertRateFromHours(rate, 'MINUTES', calendar), { amount: 0.83, units: 'MINUTES' });
  assert.deepEqual(convertRateFromHours(rate, 'YEARS', calendar), { amount: 104000, units: 'YEARS' });
  // Flat rates: Project stores elapsed minutes, they stay in hours.
  assert.deepEqual(convertRateFromHours(rate, 'ELAPSED_MINUTES', calendar), { amount: 50, units: 'HOURS' });
  assert.equal(convertRateFromHours(null, 'DAYS', calendar), null);
  assert.deepEqual(convertRateFromHours(rate, null, calendar), rate);
});

// MPP date in tenths of a minute since the format epoch (1983-12-31).
const tenthsOf = ms => Math.round((ms - Date.UTC(1983, 11, 31)) / 6000);

test('tariffa in vigore dalla tabella costi A', () => {
  const calendar = { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 };
  const data = new Uint8Array(16 + 44 * 2);
  const view = new DataView(data.buffer);
  // First entry: 10/h until 2020-01-01 00:00 (saved as 00:00, read back as 23:59 the day before).
  view.setFloat64(16, 10, true);
  view.setUint16(16 + 8, 2, true); // HOURS
  view.setInt32(16 + 40, tenthsOf(Date.UTC(2020, 0, 1)), true);
  // Second entry: 20/h expressed per day, no end date.
  view.setFloat64(60, 20, true);
  view.setUint16(60 + 8, 3, true); // DAYS
  view.setInt32(60 + 40, tenthsOf(Date.UTC(2060, 0, 1)), true);
  assert.deepEqual(currentStandardRate(data, null, calendar, Date.UTC(2019, 5, 1)), { amount: 10, units: 'HOURS' });
  assert.deepEqual(currentStandardRate(data, null, calendar, Date.UTC(2025, 5, 1)), { amount: 160, units: 'DAYS' });
  assert.equal(currentStandardRate(data, null, calendar, Date.UTC(2050, 5, 1)), null);
  const fallback = { amount: 5, units: 'HOURS' };
  assert.equal(currentStandardRate(null, fallback, calendar, Date.UTC(2025, 5, 1)), fallback);
  assert.equal(currentStandardRate(null, fallback, calendar, Date.UTC(2050, 5, 1)), null, 'oltre la data massima di Project');
});

test('unità massime in vigore dalla tabella disponibilità', () => {
  const data = new Uint8Array(12 + 20 * 3 + 4);
  const view = new DataView(data.buffer);
  view.setUint16(0, 3, true);
  const entry = (i, from, to, units) => {
    const at = 12 + i * 20;
    view.setInt32(at, tenthsOf(from), true);
    view.setFloat64(at + 4, units, true);
    view.setInt32(at + 20, tenthsOf(to), true);
  };
  // Next entry's start acts as the previous one's end (minus a minute).
  entry(0, Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1), 5000);
  entry(1, Date.UTC(2021, 0, 1), Date.UTC(2022, 0, 1), 0);
  entry(2, Date.UTC(2022, 0, 1), Date.UTC(2023, 0, 1), 20000);
  assert.equal(currentMaxUnits(data, 100, Date.UTC(2020, 5, 1)), 50);
  assert.equal(currentMaxUnits(data, 100, Date.UTC(2021, 5, 1)), null, 'voce a 0: non conta');
  assert.equal(currentMaxUnits(data, 100, Date.UTC(2019, 5, 1)), null);
  assert.equal(currentMaxUnits(null, 100, Date.UTC(2025, 5, 1)), 100);
  // No table: only applies within "Available from / to".
  assert.equal(currentMaxUnits(null, 100, Date.UTC(2025, 5, 1), '2026-01-01T08:00', null), null);
  assert.equal(currentMaxUnits(null, 100, Date.UTC(2026, 5, 1), '2026-01-01T08:00', '2026-12-31T17:00'), 100);
  assert.equal(currentMaxUnits(null, 100, Date.UTC(2027, 5, 1), null, '2026-12-31T17:00'), null);
  assert.equal(currentMaxUnits(null, 100, Date.UTC(2050, 5, 1)), null);
});

test('la tariffa dipende dalla data, come in MPXJ', () => {
  const ctx = openProject(new Uint8Array(readFileSync(join(samples, 'mpp14costratetable.mpp'))), CFB);
  const rateAt = year => readResources(ctx, fieldMapFor(ctx, 'resource'), openTable(ctx, 'TBkndRsc'), Date.UTC(year, 5, 1))
    .find(r => r.uid === 3).standardRate;
  assert.deepEqual(rateAt(2000), { amount: 5, units: 'HOURS' });
  assert.deepEqual(rateAt(2015), { amount: 20, units: 'MINUTES' });
});
