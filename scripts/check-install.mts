import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'minihog-npm-'));
try {
  await mkdir('output', { recursive: true });
  const archive = resolve('output/minihog-core.tgz');
  execFileSync('pnpm', ['--filter', '@minihog/core', 'pack', '--out', archive], { stdio: 'pipe' });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      name: 'minihog-install-check',
      private: true,
      type: 'module',
      dependencies: { '@minihog/core': `file:${archive}` }
    })
  );
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temporary, stdio: 'pipe' });
  const metadata = JSON.parse(await readFile('packages/core/package.json', 'utf8')) as {
    exports: Record<string, unknown>;
  };
  const entries = Object.keys(metadata.exports).filter((entry) => entry !== './package.json');
  const source = entries
    .map(
      (entry) => `await import(${JSON.stringify(entry === '.' ? '@minihog/core' : `@minihog/core/${entry.slice(2)}`)});`
    )
    .join('\n');
  execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd: temporary, stdio: 'pipe' });
  await writeFile(
    'output/npm-consumer.json',
    JSON.stringify(
      {
        npm: execFileSync('npm', ['--version'], { cwd: temporary, encoding: 'utf8' }).trim(),
        onlyDirectDependency: '@minihog/core',
        requiredPeersInstalled: true,
        importedEntriesDuringSSR: entries.length
      },
      null,
      2
    ) + '\n'
  );
  console.log(`Clean npm installation resolved required peers; all ${entries.length} entry points import during SSR.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
