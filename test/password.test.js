// Password-protected files: rejected if an open password is needed, XOR-decrypted otherwise.
// There are no public password-protected MPP14 files, so the containers are built by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import CFB from 'cfb';
import { readMpp } from '../src/mpp/reader.js';
import { PropsKey } from '../src/mpp/props.js';

const int32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); return [...b]; };
const utf16 = s => [...s].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]).concat([0, 0]);

function props14(entries) {
  const header = new Array(16).fill(0);
  header[12] = entries.length;
  const body = entries.flatMap(([key, data]) => [...int32(data.length), ...int32(key), ...int32(0), ...data, ...(data.length % 2 ? [0] : [])]);
  return Uint8Array.from([...header, ...body]);
}

function compObj() {
  const str = s => [...int32(s.length + 1), ...new TextEncoder().encode(s), 0];
  return Uint8Array.from([...new Array(28).fill(0), ...str('Microsoft.Project 16.0'), ...str('MSProject.MPP14')]);
}

function mppFile(rootProps, projectProps) {
  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, '/\u0001CompObj', compObj());
  CFB.utils.cfb_add(container, '/Props14', rootProps);
  CFB.utils.cfb_add(container, '/   114/Props', projectProps);
  return Uint8Array.from(CFB.write(container, { type: 'array' }));
}

test('file con password di apertura: rifiutato con messaggio chiaro', () => {
  const root = props14([[PropsKey.PASSWORD_FLAG, [1, 0]], [PropsKey.PROTECTION_PASSWORD_HASH, [1, 2, 3, 4]]]);
  const bytes = mppFile(root, props14([]));
  assert.throws(() => readMpp(bytes, CFB), err => {
    assert.equal(err.code, 'password');
    assert.match(err.message, /password protected/);
    return true;
  });
});

test('flag password senza dati di cifratura: il file si apre (come in Project)', () => {
  const root = props14([[PropsKey.PASSWORD_FLAG, [1, 0]]]);
  const bytes = mppFile(root, props14([[PropsKey.TITLE, utf16('Titolo')]]));
  assert.equal(readMpp(bytes, CFB, { propertiesOnly: true }).project.title, 'Titolo');
});

test('password di sola scrittura: le proprietà cifrate con XOR vengono decifrate', () => {
  const code = 0x5a;
  const mask = 0xff - code;
  const root = props14([[PropsKey.PASSWORD_FLAG, [2, 0]], [PropsKey.ENCRYPTION_CODE, [code, 0]]]);
  const encrypted = props14([[PropsKey.TITLE, utf16('Segreto')]]).map(b => b ^ mask);
  assert.equal(readMpp(mppFile(root, encrypted), CFB, { propertiesOnly: true }).project.title, 'Segreto');
});

test('proprietà del progetto mancanti: errore "danneggiato"', () => {
  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, '/\u0001CompObj', compObj());
  CFB.utils.cfb_add(container, '/Props14', props14([]));
  const bytes = Uint8Array.from(CFB.write(container, { type: 'array' }));
  assert.throws(() => readMpp(bytes, CFB), { code: 'corrupt' });
});
