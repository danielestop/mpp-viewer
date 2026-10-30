import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import CFB from 'cfb';
import { readMpp } from '../src/mpp/reader.js';
import { readFieldAliases, readFieldDefinitions, readCustomFieldInfo, customFlagBits, enterpriseFlagBits, readCustomFields, readEnterpriseFields } from '../src/mpp/custom-fields.js';
import { createFieldMap, createEnterpriseFieldMap } from '../src/mpp/fieldmap.js';

const samples = join(import.meta.dirname, '..', 'samples');
const mpp14 = readdirSync(samples)
  .filter(f => f.endsWith('.mpp'))
  .map(name => ({ name, expected: JSON.parse(readFileSync(join(samples, 'expected', name.replace(/\.mpp$/, '.json')), 'utf8')) }))
  .filter(s => s.expected.format === 'MSProject.MPP14');

// Synthetic CUSTOM_FIELDS block: size (twice), name count, entries (field ID, position - 4), UTF-16 text;
// then two empty unknown blocks and the 88-byte definitions (field ID, type at offset 12).
function aliasBlock(entries, definitions = []) {
  const header = 12 + entries.length * 8;
  const texts = entries.map(([, alias]) => Buffer.from(`${alias}\0`, 'utf16le'));
  const aliasSize = header + texts.reduce((n, t) => n + t.length, 0);
  const data = Buffer.alloc(aliasSize + 16 + definitions.length * 88);
  data.writeInt32LE(aliasSize - 4, 0);
  data.writeInt32LE(aliasSize - 4, 4);
  data.writeInt32LE(entries.length, 8);
  let at = header;
  entries.forEach(([fieldId], i) => {
    data.writeInt32LE(fieldId, 12 + i * 8);
    data.writeInt32LE(at - 4, 16 + i * 8);
    texts[i].copy(data, at);
    at += texts[i].length;
  });
  data.writeInt32LE(definitions.length, aliasSize + 8);
  definitions.forEach(([fieldId, type], i) => {
    data.writeInt32LE(fieldId, aliasSize + 16 + i * 88);
    data.writeUInt16LE(type, aliasSize + 16 + i * 88 + 12);
  });
  return new Uint8Array(data);
}

// Synthetic Props14 with a single entry.
function props14(key, value) {
  const data = Buffer.alloc(16 + 12 + value.length + (value.length % 2));
  data.writeUInt16LE(1, 12);
  data.writeInt32LE(value.length, 16);
  data.writeInt32LE(key, 20);
  Buffer.from(value).copy(data, 28);
  return new Uint8Array(data);
}

// Synthetic field map: 28-byte entries (fixed block position at offset 4, field ID at offset 12).
function fieldMapData(entries) {
  const data = Buffer.alloc(entries.length * 28);
  entries.forEach(([fieldId, offset], i) => {
    data.writeUInt16LE(offset, i * 28 + 4);
    data.writeInt32LE(fieldId, i * 28 + 12);
  });
  return new Uint8Array(data);
}

test('nomi dei campi: ID del campo → nome, nomi vuoti ignorati', () => {
  const aliases = readFieldAliases(aliasBlock([[0x0b400033, 'Fase'], [0x0c400008, ''], [0x0f400058, 'Centro di costo']]));
  assert.deepEqual([...aliases], [[0x0b400033, 'Fase'], [0x0f400058, 'Centro di costo']]);
  assert.equal(readFieldAliases(null).size, 0);
  assert.equal(readFieldAliases(new Uint8Array(4)).size, 0);
});

test("nomi e tipi dei campi per classe, dall'ID; campi non personalizzati esclusi", () => {
  const block = aliasBlock([
    [0x0b400033, 'Fase'], // task TEXT1 (index 51)
    [0x0c400008, 'Reparto'], // resource TEXT1 (index 8)
    [0x0f400058, 'Centro di costo'], // assignment TEXT1 (index 88)
    [0x0b408007, 'Codice'], // task, org-defined enterprise field #8
    [0x0c408002, 'Area'], // resource, enterprise field with no definition: unknown type
    [0x0b400001, 'Nome'], // not a custom field
  ], [[0x0b408007, 5], [0x0f408001, 7], [0x0b408009, 9]]);
  const info = readCustomFieldInfo([props14(71303169, block), null]);
  assert.deepEqual(info.names, {
    task: { TEXT1: 'Fase', ENTERPRISE_CUSTOM_FIELD8: 'Codice' },
    resource: { TEXT1: 'Reparto', ENTERPRISE_CUSTOM_FIELD3: 'Area' },
    assignment: { TEXT1: 'Centro di costo' },
  });
  assert.deepEqual(info.types, {
    task: { ENTERPRISE_CUSTOM_FIELD8: 'NUMERIC', ENTERPRISE_CUSTOM_FIELD10: 'CUSTOM' },
    resource: { ENTERPRISE_CUSTOM_FIELD3: 'CUSTOM' },
    assignment: { ENTERPRISE_CUSTOM_FIELD2: 'STRING' },
  });
});

test('definizioni: tipo dal codice (0 costo … 7 testo); il primo tipo trovato resta', () => {
  const block = aliasBlock([], [[0x0b408000, 0], [0x0b408001, 1], [0x0b408002, 2], [0x0b408003, 3],
    [0x0b408004, 4], [0x0b408005, 5], [0x0b408006, 6], [0x0b408007, 7]]);
  assert.deepEqual([...readFieldDefinitions(block).values()],
    ['CURRENCY', 'DATE', 'DURATION', 'DATE', 'BOOLEAN', 'NUMERIC', 'DATE', 'STRING']);
  assert.equal(readFieldDefinitions(null).size, 0);
  const first = props14(71303169, aliasBlock([], [[0x0b408000, 7]]));
  const second = props14(71303169, aliasBlock([], [[0x0b408000, 0]]));
  assert.equal(readCustomFieldInfo([first, second]).types.task.ENTERPRISE_CUSTOM_FIELD1, 'STRING');
});

test('dimensione del blocco fisso: i campi aziendali contano secondo il loro tipo', () => {
  const data = fieldMapData([[0x0b400000, 0], [0x0b408000, 100]]);
  assert.equal(createFieldMap(data, 'task', new Map([[0x0b408000, 'CURRENCY']])).maxFixedDataSize[0], 108);
  assert.equal(createFieldMap(data, 'task', new Map([[0x0b408000, 'STRING']])).maxFixedDataSize[0], 100);
  assert.equal(createFieldMap(data, 'task').maxFixedDataSize[0], 100);
});

test('mappa dei campi aziendali: solo i campi della classe, chiave = ID & 0xFFFF', () => {
  const data = Buffer.alloc(16);
  data.writeInt32LE(0x0b408007, 4);
  data.writeInt32LE(0x0c408001, 8);
  data.writeInt32LE(0x0b400033, 12);
  const map = createEnterpriseFieldMap(new Uint8Array(data), 'task', new Map([[0x0b408007, 'NUMERIC']]));
  assert.deepEqual(map.enterpriseNames(), ['ENTERPRISE_CUSTOM_FIELD8']);
  assert.equal(map.items.get('ENTERPRISE_CUSTOM_FIELD8').varDataKey, 0x8007);
  assert.equal(map.items.get('ENTERPRISE_CUSTOM_FIELD8').type, 'NUMERIC');
  assert.deepEqual(createEnterpriseFieldMap(null, 'task', new Map()).enterpriseNames(), []);
});

test("campi aziendali: nome fisso prima, poi quelli dell'organizzazione; flag dai metadati 2", () => {
  const map = values => ({
    has: f => f in values, values,
    enterpriseNames: () => Object.keys(values).filter(f => f.startsWith('ENTERPRISE_CUSTOM_FIELD')),
  });
  const read = (m, f) => m.values[f];
  const main = map({ ENTERPRISE_TEXT1: 'x', ENTERPRISE_NUMBER1: 0, ENTERPRISE_CUSTOM_FIELD10: 'principale', ENTERPRISE_CUSTOM_FIELD2: 'solo principale' });
  const enterprise = map({ ENTERPRISE_CUSTOM_FIELD10: 'aziendale', ENTERPRISE_CUSTOM_FIELD8: 42 });
  const meta2 = new Uint8Array(40);
  meta2[30] = 0x08; // 0x800 from offset 29 = task ENTERPRISE_FLAG1
  assert.deepEqual(readEnterpriseFields(main, enterprise, read, meta2, enterpriseFlagBits('task')), [
    { field: 'ENTERPRISE_TEXT1', value: 'x' }, { field: 'ENTERPRISE_FLAG1', value: true },
    { field: 'ENTERPRISE_CUSTOM_FIELD2', value: 'solo principale' }, { field: 'ENTERPRISE_CUSTOM_FIELD8', value: 42 },
    { field: 'ENTERPRISE_CUSTOM_FIELD10', value: 'aziendale' },
  ]);
  assert.deepEqual(enterpriseFlagBits('assignment'), []);
  assert.deepEqual(enterpriseFlagBits('resource')[19], [16, 0x800000]);
});

test('posizione dei flag personalizzati per versione, come MPXJ', () => {
  assert.deepEqual(customFlagBits('task', 14)[0], [35, 0x40]);
  assert.deepEqual(customFlagBits('task', 14)[19], [35, 0x2000000]);
  assert.deepEqual(customFlagBits('task', 16)[9], [24, 0x400]);
  assert.deepEqual(customFlagBits('task', 16)[10], [33, 0x2]);
  assert.deepEqual(customFlagBits('resource', 14)[9], [28, 0x20]);
  assert.deepEqual(customFlagBits('resource', 15)[0], [19, 0x80]);
  assert.deepEqual(customFlagBits('resource', 15)[19], [24, 0x10000]);
  assert.deepEqual(customFlagBits('assignment', 14)[19], [28, 0x100000]);
  assert.deepEqual(customFlagBits('assignment', 16)[9], [20, 0x1]);
  assert.deepEqual(customFlagBits('assignment', null)[0], [28, 0x4]);
});

test('solo campi con valore; posizione di riserva usata se il valore manca', () => {
  const map = values => ({ has: f => f in values, values });
  const read = (m, f) => m.values[f];
  const main = map({ TEXT1: '', TEXT2: 'a', NUMBER1: 0, NUMBER2: 3.5, COST1: 0, DURATION1: { value: 0, units: 'DAYS' } });
  const alternate = map({ COST1: 12, TEXT1: 'riserva', TEXT2: 'non usato' });
  const meta = new Uint8Array(40);
  meta[24] = 0x04; // FLAG2 for Project 2013+
  const result = readCustomFields(main, read, meta, customFlagBits('task', 16), alternate);
  assert.deepEqual(result, [
    { field: 'TEXT2', value: 'a' }, { field: 'NUMBER2', value: 3.5 }, { field: 'COST1', value: 12 }, { field: 'FLAG2', value: true },
  ]);
});

test('nomi e tipi dei campi uguali a MPXJ su tutti i file', () => {
  for (const { name, expected } of mpp14) {
    const model = readMpp(new Uint8Array(readFileSync(join(samples, name))), CFB);
    assert.deepEqual(model.customFieldNames, expected.customFieldNames, name);
    assert.deepEqual(model.enterpriseFieldTypes, expected.enterpriseFieldTypes, name);
  }
});

test('valori personalizzati confrontati: tutti i tipi per attività, risorse e assegnazioni', () => {
  // Field-by-field checks live in the task, resource and assignment tests: this is for coverage.
  const seen = new Set();
  for (const { expected } of mpp14) {
    for (const cls of ['tasks', 'resources', 'assignments']) {
      for (const item of expected[cls]) for (const { field } of item.customFields) seen.add(`${cls}.${field.replace(/\d+$/, '')}`);
    }
  }
  for (const cls of ['tasks', 'resources', 'assignments']) {
    for (const type of ['TEXT', 'NUMBER', 'COST', 'DATE', 'START', 'FINISH', 'DURATION', 'FLAG']) {
      assert.ok(seen.has(`${cls}.${type}`), `manca ${cls}.${type}`);
    }
  }
});

test('campi aziendali con nome fisso confrontati con MPXJ', () => {
  const seen = new Set();
  for (const { expected } of mpp14) {
    for (const cls of ['tasks', 'resources', 'assignments']) {
      for (const item of expected[cls]) for (const { field } of item.enterpriseFields) seen.add(`${cls}.${field.replace(/\d+$/, '')}`);
    }
  }
  assert.ok(seen.size >= 5, [...seen].join(', '));
});

test('flag personalizzati confrontati su file di Project 2010 e 2013+', () => {
  // Flag positions differ before and after Project 2013: cover each class both ways.
  const covered = new Set();
  for (const { name, expected } of mpp14) {
    const { applicationName } = readMpp(new Uint8Array(readFileSync(join(samples, name))), CFB, { propertiesOnly: true });
    const recent = !applicationName.startsWith('Microsoft.Project 14.');
    for (const cls of ['tasks', 'resources', 'assignments']) {
      if (expected[cls].some(i => i.customFields.some(f => f.field.startsWith('FLAG')))) covered.add(`${cls}:${recent ? '2013+' : '2010'}`);
    }
  }
  for (const cls of ['tasks', 'resources', 'assignments']) {
    for (const version of ['2010', '2013+']) assert.ok(covered.has(`${cls}:${version}`), `manca ${cls} ${version}`);
  }
});
