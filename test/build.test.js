import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildHtml, bundle } from '../scripts/build.mjs';

const html = buildHtml();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('il file finale pesa meno di 1 MB', () => {
  assert.ok(Buffer.byteLength(html) < 1024 * 1024, `${Buffer.byteLength(html)} byte`);
});

test('nessun segnaposto resta nel file finale', () => {
  assert.doesNotMatch(html, /\/\*__[A-Z_]+__\*\//);
});

test('la pagina blocca ogni connessione di rete tramite Content-Security-Policy', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'meta CSP mancante');
  assert.match(csp[1], /default-src 'none'/);
  assert.doesNotMatch(csp[1], /connect-src|https?:/);
});

test('nessuna risorsa esterna e nessuna API di rete nel file finale', () => {
  const forbidden = [
    /<script[^>]+src=/i, /<link[^>]+href=/i, /<img[^>]+src=["']?https?:/i, /url\(\s*["']?https?:/i, /@import/i,
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /importScripts/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(html, pattern);
});

test('gli script inline sono JavaScript valido (niente nomi duplicati tra moduli)', () => {
  assert.equal(scripts.length, 2);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
});

test('nomi di primo livello unici tra tutti i moduli (anche funzioni, che JavaScript lascia ridefinire)', () => {
  const app = bundle('src/ui/app.js');
  const names = [...app.matchAll(/^(?:async\s+)?(?:function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  assert.deepEqual(duplicates, []);
});

test('la pagina ha le quattro schede con i rispettivi pannelli', () => {
  for (const name of ['project', 'tasks', 'resources', 'assignments']) {
    assert.match(html, new RegExp(`role="tab" id="tab-${name}" aria-controls="panel-${name}"`));
    assert.match(html, new RegExp(`id="panel-${name}" class="panel" role="tabpanel"`));
  }
  assert.match(html, /id="search" type="search"/);
});

test('la pagina è in inglese (markup senza testi italiani, licenze escluse)', () => {
  assert.match(html, /<html lang="en">/);
  const markup = html
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<pre>[\s\S]*?<\/pre>/g, '');
  // Unicode word boundaries: \b doesn't match words ending in an accented letter.
  const italian = /(?<!\p{L})(attività|risorse|assegnazioni|progetto|trascina|oppure|cerca|apri|inizio|fine|durata|tariffa|gruppo|licenze)(?!\p{L})/iu;
  assert.match('le attività', italian, 'il controllo deve riconoscere le parole accentate');
  assert.doesNotMatch(markup, italian);
});

test('la tabella attività ha le colonne Unique ID, Work e Remaining work', () => {
  const head = html.match(/<section id="panel-tasks"[\s\S]*?<\/thead>/)[0];
  const columns = [...head.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(m => m[1]);
  assert.deepEqual(columns, ['ID', 'Unique ID', 'WBS', 'Task name', 'Duration', 'Work', 'Remaining work',
    'Start', 'Finish', '% complete', 'Predecessors', 'Resources']);
});
