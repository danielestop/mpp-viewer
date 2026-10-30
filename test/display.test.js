import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setDateFormat, getDateFormat,
  formatDate, formatDuration, formatPercent, formatPredecessor, formatRate, formatMaxUnits,
  formatAssignmentUnits, formatAssignmentWork, matchesQuery,
  customFieldLabel, formatCustomValue, customFieldRows,
  customFieldName, customFieldValues, availableColumns, customColumnText, progressWidth, projectSummary,
} from '../src/ui/display.js';

test('date nei tre formati selezionabili, secondi ignorati', () => {
  assert.equal(formatDate('2018-10-18T08:00', '', 'dmy'), '18/10/2018 08:00');
  assert.equal(formatDate('2018-10-18T08:00:30', '', 'dmy'), '18/10/2018 08:00');
  assert.equal(formatDate('2018-10-18T08:05', '', 'mdy'), '10/18/2018 8:05 AM');
  assert.equal(formatDate('2018-10-18T17:00', '', 'mdy'), '10/18/2018 5:00 PM');
  assert.equal(formatDate('2018-10-18T00:30', '', 'mdy'), '10/18/2018 12:30 AM');
  assert.equal(formatDate('2018-10-18T12:00', '', 'mdy'), '10/18/2018 12:00 PM');
  assert.equal(formatDate('2018-10-18T08:00', '', 'ymd'), '2018-10-18 08:00');
  assert.equal(formatDate(null), '');
  assert.equal(formatDate(null, '—'), '—');
});

test('il formato scelto vale per tutte le date; valori sconosciuti ignorati', () => {
  const before = getDateFormat();
  setDateFormat('ymd');
  assert.equal(formatDate('2018-10-18T08:00'), '2018-10-18 08:00');
  setDateFormat('xyz');
  assert.equal(getDateFormat(), 'ymd');
  setDateFormat(before);
});

test('durate con le abbreviazioni inglesi di Project', () => {
  assert.equal(formatDuration({ value: 2.5, units: 'DAYS' }), '2.5 d');
  assert.equal(formatDuration({ value: 16, units: 'HOURS' }), '16 h');
  assert.equal(formatDuration({ value: 1.43, units: 'WEEKS' }), '1.43 wk');
  assert.equal(formatDuration({ value: 1, units: 'ELAPSED_DAYS' }), '1 ed');
  assert.equal(formatDuration(null), '');
  assert.equal(formatPercent(50), '50%');
  assert.equal(formatPercent(null), '');
});

test('predecessori come in Project inglese', () => {
  assert.equal(formatPredecessor({ type: 'FINISH_START', lag: { value: 0, units: 'DAYS' } }, 5), '5');
  assert.equal(formatPredecessor({ type: 'START_START', lag: null }, 5), '5SS');
  assert.equal(formatPredecessor({ type: 'FINISH_START', lag: { value: 2, units: 'DAYS' } }, 5), '5FS+2 d');
  assert.equal(formatPredecessor({ type: 'FINISH_FINISH', lag: { value: -1, units: 'HOURS' } }, 7), '7FF−1 h');
  assert.equal(formatPredecessor({ type: 'START_FINISH', lag: { value: 50, units: 'PERCENT' } }, 3), '3SF+50 %');
});

test('tariffa e unità massime per tipo di risorsa', () => {
  assert.equal(formatRate({ type: 'WORK', standardRate: { amount: 50, units: 'HOURS' } }), '50/h');
  assert.equal(formatRate({ type: 'WORK', standardRate: { amount: 400, units: 'DAYS' } }), '400/d');
  assert.equal(formatRate({ type: 'WORK', standardRate: { amount: 1234.5, units: 'WEEKS' } }), '1,234.5/wk');
  assert.equal(formatRate({ type: 'MATERIAL', standardRate: { amount: 12, units: 'HOURS' } }), '12');
  assert.equal(formatRate({ type: 'COST', standardRate: { amount: 0, units: 'HOURS' } }), '');
  assert.equal(formatRate({ type: 'WORK', standardRate: null }), '');
  assert.equal(formatMaxUnits({ type: 'WORK', maxUnits: 100 }), '100%');
  assert.equal(formatMaxUnits({ type: 'MATERIAL', maxUnits: 100 }), '');
  assert.equal(formatMaxUnits({ type: 'WORK', maxUnits: null }), '');
});

test('unità e lavoro delle assegnazioni per tipo di risorsa', () => {
  const work = { type: 'WORK' }, material = { type: 'MATERIAL' }, cost = { type: 'COST' };
  // Real values from timephased-material-resource.mpp (MPXJ: units 1000, work 10 h = 10 material units).
  assert.equal(formatAssignmentUnits({ units: 1000 }, material), '10');
  assert.equal(formatAssignmentWork({ work: { value: 10, units: 'HOURS' } }, material), '10');
  assert.equal(formatAssignmentUnits({ units: 25 }, work), '25%');
  assert.equal(formatAssignmentWork({ work: { value: 40, units: 'HOURS' } }, work), '40 h');
  assert.equal(formatAssignmentUnits({ units: 100 }, cost), '');
  assert.equal(formatAssignmentUnits({ units: 100 }, undefined), '100%');
  assert.equal(formatAssignmentUnits({ units: null }, work), '');
  assert.equal(formatAssignmentWork({ work: null }, material), '');
});

test('ricerca senza maiuscole e accenti', () => {
  assert.ok(matchesQuery('', 'qualsiasi'));
  assert.ok(matchesQuery('attivita', 'Prima Attività'));
  assert.ok(matchesQuery('DESIGN', 'Detailed design'));
  assert.ok(matchesQuery('  PROVA ', null, 'collaudo prova'));
  assert.ok(matchesQuery('1.2', '1.2.3'));
  assert.ok(!matchesQuery('xyz', 'Prima attività', null));
});

test('campi personalizzati: nomi standard inglesi e valori per tipo', () => {
  setDateFormat('dmy');
  assert.equal(customFieldLabel('TEXT30'), 'Text30');
  assert.equal(customFieldLabel('DURATION1'), 'Duration1');
  assert.equal(formatCustomValue('TEXT1', 'abc'), 'abc');
  assert.equal(formatCustomValue('NUMBER1', 1234.567), '1,234.567');
  assert.equal(formatCustomValue('NUMBER2', 0.001), '0.001');
  assert.equal(formatCustomValue('COST1', 1500), '1,500.00');
  assert.equal(formatCustomValue('START2', '2018-10-18T08:00'), '18/10/2018 08:00');
  assert.equal(formatCustomValue('DURATION3', { value: 2, units: 'DAYS' }), '2 d');
  assert.equal(formatCustomValue('FLAG4', true), 'Yes');
});

test('righe dei campi personalizzati: nome dato in Project con quello standard tra parentesi', () => {
  const rows = customFieldRows([{ field: 'TEXT1', value: 'Design' }, { field: 'FLAG2', value: true }], { TEXT1: 'Phase' });
  assert.deepEqual(rows, [['Phase (Text1)', 'Design'], ['Flag2', 'Yes']]);
  assert.deepEqual(customFieldRows(undefined), []);
});

test("campi aziendali: nomi standard, nome dell'organizzazione da solo, valore secondo il tipo definito", () => {
  setDateFormat('dmy');
  assert.equal(customFieldLabel('ENTERPRISE_COST2'), 'Enterprise Cost2');
  assert.equal(customFieldLabel('ENTERPRISE_CUSTOM_FIELD8'), 'Enterprise field 8');
  assert.equal(formatCustomValue('ENTERPRISE_DATE3', '2018-10-18T08:00'), '18/10/2018 08:00');
  assert.equal(formatCustomValue('ENTERPRISE_CUSTOM_FIELD1', 1500, 'CURRENCY'), '1,500.00');
  assert.equal(formatCustomValue('ENTERPRISE_CUSTOM_FIELD2', true, 'BOOLEAN'), 'Yes');
  assert.equal(formatCustomValue('ENTERPRISE_CUSTOM_FIELD3', 'abc', 'CUSTOM'), 'abc');
  const rows = customFieldRows(
    [{ field: 'ENTERPRISE_TEXT1', value: 'x' }, { field: 'ENTERPRISE_CUSTOM_FIELD8', value: 3 }, { field: 'ENTERPRISE_CUSTOM_FIELD9', value: 0.5 }],
    { ENTERPRISE_TEXT1: 'Area', ENTERPRISE_CUSTOM_FIELD8: 'Code' },
    { ENTERPRISE_CUSTOM_FIELD8: 'NUMERIC', ENTERPRISE_CUSTOM_FIELD9: 'NUMERIC' });
  assert.deepEqual(rows, [['Area (Enterprise Text1)', 'x'], ['Code', '3'], ['Enterprise field 9', '0.5']]);
});

test('colonne proponibili: solo campi con valore, locali poi aziendali, per tipo e numero', () => {
  const items = [
    { customFields: [{ field: 'TEXT10', value: 'a' }, { field: 'FLAG1', value: true }], enterpriseFields: [{ field: 'ENTERPRISE_CUSTOM_FIELD8', value: 2 }] },
    { customFields: [{ field: 'TEXT2', value: 'b' }, { field: 'NUMBER1', value: 5 }], enterpriseFields: [{ field: 'ENTERPRISE_TEXT1', value: 'x' }] },
    { customFields: [], enterpriseFields: [] },
  ];
  const columns = availableColumns(items, { TEXT2: 'Phase', ENTERPRISE_CUSTOM_FIELD8: 'Code' });
  assert.deepEqual(columns.map(c => c.field), ['TEXT2', 'TEXT10', 'NUMBER1', 'FLAG1', 'ENTERPRISE_TEXT1', 'ENTERPRISE_CUSTOM_FIELD8']);
  assert.deepEqual(columns.map(c => c.label), ['Phase (Text2)', 'Text10', 'Number1', 'Flag1', 'Enterprise Text1', 'Code']);
  assert.deepEqual(availableColumns([{ customFields: [], enterpriseFields: [] }]), []);
});

test('celle delle colonne aggiunte: valore formattato, vuoto se manca', () => {
  setDateFormat('dmy');
  const values = customFieldValues({ customFields: [{ field: 'START1', value: '2018-10-18T08:00' }], enterpriseFields: [{ field: 'ENTERPRISE_CUSTOM_FIELD1', value: 1500 }] });
  assert.equal(customColumnText(values, 'START1'), '18/10/2018 08:00');
  assert.equal(customColumnText(values, 'ENTERPRISE_CUSTOM_FIELD1', { ENTERPRISE_CUSTOM_FIELD1: 'CURRENCY' }), '1,500.00');
  assert.equal(customColumnText(values, 'TEXT1'), '');
  assert.equal(customFieldName('TEXT1', { TEXT1: 'Phase' }), 'Phase (Text1)');
});

test('barra di avanzamento: limiti 0–100, nulla se il valore manca', () => {
  assert.equal(progressWidth(45), 45);
  assert.equal(progressWidth(0), 0);
  assert.equal(progressWidth(100), 100);
  assert.equal(progressWidth(130), 100);
  assert.equal(progressWidth(-5), 0);
  assert.equal(progressWidth(null), null);
  assert.equal(progressWidth(undefined), null);
});

test('card del progetto: % dal riepilogo del progetto, conteggi senza righe vuote né risorsa 0', () => {
  const model = {
    project: { start: '2026-01-05T08:00', finish: '2026-03-27T17:00' },
    tasks: [
      { uid: 0, percentComplete: 37 },
      { uid: 1, milestone: false },
      { uid: 2, null: true },
      { uid: 3, milestone: true },
    ],
    resources: [{ uid: 0 }, { uid: 1 }, { uid: 2 }],
    assignments: [{ resourceUid: 1 }, { resourceUid: null }, { resourceUid: 2 }],
  };
  assert.deepEqual(projectSummary(model), {
    start: '2026-01-05T08:00', finish: '2026-03-27T17:00', percentComplete: 37,
    tasks: 2, milestones: 1, resources: 2, assignments: 2,
  });
  const bare = projectSummary({ project: {}, tasks: [{ uid: 1 }], resources: [], assignments: [] });
  assert.equal(bare.percentComplete, null);
  assert.equal(bare.start, null);
  assert.equal(bare.tasks, 1);
});
