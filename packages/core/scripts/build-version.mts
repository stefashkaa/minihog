import { readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const path = new URL('../src/internal/version.ts', import.meta.url);
const source = `// Generated from package.json by build-version.mts.\nexport const VERSION = '${version}';\n`;
if ((await readFile(path, 'utf8').catch(() => '')) !== source) await writeFile(path, source);
