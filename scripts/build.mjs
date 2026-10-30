// Build: bundles the UI, reader and cfb into a single dist/lettore-mpp.html.
// No external references: works opened from disk (file://) and offline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

const IMPORT_LINE = /^import\s+\{[^}]*\}\s+from\s+'(\.{1,2}\/[^']+)';\s*$/;

// Tiny bundler for the project's modules: sorts by dependency, strips import/export
// and puts everything in one scope. Only single-line relative named imports.
export function bundle(entry) {
  const order = [];
  const seen = new Set();

  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const body = [];
    for (const line of lines) {
      if (/^\s*import[\s{]/.test(line)) {
        const match = line.match(IMPORT_LINE);
        if (!match) throw new Error(`Import non supportato in ${relative(root, file)}: ${line}`);
        visit(resolve(dirname(file), match[1]));
        continue;
      }
      if (/^export\s+(default\b|\{|\*)/.test(line)) {
        throw new Error(`Export non supportato in ${relative(root, file)}: ${line}`);
      }
      body.push(line.replace(/^export\s+(?=(async\s+)?(function|class|const|let)\b)/, ''));
    }
    order.push(`// --- ${relative(root, file).replaceAll('\\', '/')} ---\n${body.join('\n')}`);
  };

  visit(resolve(root, entry));
  return `(function () {\n'use strict';\n${order.join('\n\n')}\n})();`;
}

const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// Keep a "</script" inside the code from closing the tag early.
const inlineScript = code => code.replace(/<\/(script)/gi, '<\\/$1');

export function buildHtml() {
  const parts = {
    '/*__STYLE__*/': read('src/ui/style.css'),
    '/*__LICENSE_LGPL__*/': escapeHtml(read('LICENSE')),
    '/*__LICENSE_APACHE__*/': escapeHtml(read('node_modules/cfb/LICENSE')),
    '/*__CFB__*/': inlineScript(read('node_modules/cfb/dist/cfb.min.js')),
    '/*__APP__*/': inlineScript(bundle('src/ui/app.js')),
  };
  let html = read('src/ui/page.html');
  for (const [placeholder, content] of Object.entries(parts)) {
    if (!html.includes(placeholder)) throw new Error(`Segnaposto mancante in page.html: ${placeholder}`);
    html = html.split(placeholder).join(content);
  }
  return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = buildHtml();
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'lettore-mpp.html'), html);
  console.log(`dist/lettore-mpp.html — ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}
