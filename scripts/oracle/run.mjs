// Regenerates samples/expected/ by reading every samples/*.mpp with the original MPXJ (docs/decisions/0004).
// With --fields it regenerates src/mpp/field-tables.js from MPXJ field definitions instead.
// With --private it reads samples-private/ (real files, git-ignored) and writes to samples-private/expected/.
// Needs a JDK and MPXJ in .tools/ (dev machine only). Usage: npm run oracle | npm run fields
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const java = join(root, '.tools', 'jdk', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const mpxj = join(root, '.tools', 'mpxj');
const samples = join(root, process.argv.includes('--private') ? 'samples-private' : 'samples');
const expected = join(samples, 'expected');

if (!existsSync(java) || !existsSync(join(mpxj, 'mpxj.jar'))) {
  console.error('JDK o MPXJ mancanti in .tools/ — vedi docs/decisions/0004-oracolo-mpxj.md');
  process.exit(1);
}

mkdirSync(expected, { recursive: true });
const sep = process.platform === 'win32' ? ';' : ':';
const classpath = [join(mpxj, 'mpxj.jar'), join(mpxj, 'lib', '*')].join(sep);
const dump = join(root, 'scripts', 'oracle', 'Dump.java');
const javaArgs = ['-Dlog4j2.statusLoggerLevel=OFF', '-cp', classpath];

if (process.argv.includes('--fields')) {
  const out = join(root, 'src', 'mpp', 'field-tables.js');
  execFileSync(java, [...javaArgs, join(root, 'scripts', 'oracle', 'FieldTables.java'), out], { stdio: 'inherit' });
  console.log('ok  src/mpp/field-tables.js');
  process.exit(0);
}

for (const name of readdirSync(samples).filter(f => f.endsWith('.mpp'))) {
  const out = join(expected, name.replace(/\.mpp$/, '.json'));
  execFileSync(java, [...javaArgs, dump, join(samples, name), out], { stdio: 'inherit' });
  console.log(`ok  ${name}`);
}
