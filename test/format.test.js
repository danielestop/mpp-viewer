import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import CFB from 'cfb';
import { openMpp } from '../src/mpp/format.js';

const samples = join(import.meta.dirname, '..', 'samples');
const expectedFor = name => JSON.parse(readFileSync(join(samples, 'expected', name.replace(/\.mpp$/, '.json')), 'utf8'));
const sampleFiles = readdirSync(samples).filter(f => f.endsWith('.mpp'));

test('ci sono file di prova sia MPP14 sia di versioni precedenti', () => {
  const formats = sampleFiles.map(f => expectedFor(f).format);
  assert.ok(formats.filter(f => f === 'MSProject.MPP14').length >= 4);
  assert.ok(formats.some(f => f !== 'MSProject.MPP14'));
});

for (const name of sampleFiles) {
  const expected = expectedFor(name);
  const bytes = new Uint8Array(readFileSync(join(samples, name)));

  if (expected.format === 'MSProject.MPP14') {
    test(`riconosce MPP14: ${name}`, () => {
      const mpp = openMpp(bytes, CFB);
      assert.equal(mpp.format, expected.format);
    });
  } else {
    test(`rifiuta con messaggio chiaro ${expected.format}: ${name}`, () => {
      assert.throws(() => openMpp(bytes, CFB), err => {
        assert.equal(err.code, 'unsupported-version');
        assert.match(err.message, /Project (2000|2007|98)/);
        assert.match(err.message, /Project 2010 or later/);
        return true;
      });
    });
  }
}

test('rifiuta un file che non è un contenitore OLE', () => {
  const bytes = new TextEncoder().encode('questo non è un file di Project');
  assert.throws(() => openMpp(bytes, CFB), { code: 'not-ole' });
});

const oleWith = (name, content) => {
  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, name, content);
  return Uint8Array.from(CFB.write(container, { type: 'array' }));
};

// Synthetic CompObj: 28-byte header and length-prefixed (int32 LE), null-terminated strings.
const compObj = (...strings) => {
  const parts = [new Uint8Array(28)];
  for (const s of strings) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setInt32(0, s.length + 1, true);
    parts.push(len, new TextEncoder().encode(s), new Uint8Array(1));
  }
  return Uint8Array.from(parts.flatMap(p => [...p]));
};

test('rifiuta un contenitore OLE senza CompObj', () => {
  assert.throws(() => openMpp(oleWith('/Altro', new TextEncoder().encode('x')), CFB), { code: 'not-mpp' });
});

test('rifiuta un contenitore OLE di un altro programma (es. Word)', () => {
  const bytes = oleWith('/\u0001CompObj', compObj('Microsoft Word-Dokument', 'Word.Document.8'));
  assert.throws(() => openMpp(bytes, CFB), { code: 'not-mpp' });
});

test('accetta un modello di Project (MPT14) costruito ad hoc', () => {
  const bytes = oleWith('/\u0001CompObj', compObj('Microsoft.Project 16.0', 'MSProject.MPT14'));
  assert.equal(openMpp(bytes, CFB).format, 'MSProject.MPT14');
});
