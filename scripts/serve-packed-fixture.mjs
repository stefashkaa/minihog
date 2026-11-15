import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'minihog-consumer-'));
const children = [];
let closing = false;
const env = { ...process.env, HUSKY: '0' };
delete env.NO_COLOR;
const pnpm = process.env.npm_execpath ?? 'pnpm';
function run(args, cwd = temporary, extra = {}) {
  const script = /\.[cm]?js$/.test(pnpm);
  execFileSync(script ? process.execPath : pnpm, script ? [pnpm, ...args] : args, {
    cwd,
    env: { ...env, ...extra },
    stdio: 'inherit'
  });
}
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(
    children.map((child) => (child.exitCode !== null ? undefined : new Promise((done) => child.once('exit', done))))
  );
  await rm(temporary, { recursive: true, force: true });
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());

try {
  await mkdir('output', { recursive: true });
  for (const name of ['core', 'nuxt'])
    run(['pack', '--out', resolve(`output/minihog-${name}.tgz`)], join(root, 'packages', name));
  await cp('tests/fixtures/nuxt', temporary, {
    recursive: true,
    filter: (path) => !/\/(node_modules|\.nuxt|\.output)(\/|$)/.test(path)
  });
  const json = JSON.parse(await readFile(join(temporary, 'package.json'), 'utf8'));
  json.packageManager = JSON.parse(await readFile('package.json', 'utf8')).packageManager;
  json.dependencies['@minihog/nuxt'] = `file:${resolve('output/minihog-nuxt.tgz')}`;
  await writeFile(join(temporary, 'package.json'), JSON.stringify(json));
  await writeFile(
    join(temporary, 'pnpm-workspace.yaml'),
    `overrides:\n  '@minihog/core': 'file:${resolve('output/minihog-core.tgz')}'\nallowBuilds:\n  esbuild: true\n`
  );
  run(['install', '--ignore-scripts']);
  run(['run', 'typecheck']);
  run(['run', 'build'], temporary, { MINIHOG_TEST_FEATURES: 'off' });
  const assets = join(temporary, '.output/public/_nuxt');
  const code = (
    await Promise.all(
      (await readdir(assets)).filter((name) => name.endsWith('.js')).map((name) => readFile(join(assets, name), 'utf8'))
    )
  ).join('\n');
  assert.doesNotMatch(code, /rrweb|\$web_vitals_|\$heatmap_data/, 'Disabled features must have no output chunks');
  run(['run', 'build']);
  await writeFile(
    'output/packed-consumer.json',
    JSON.stringify(
      {
        standalone: true,
        coreDirectDependency: false,
        typecheck: true,
        disabledFeaturesHaveNoChunks: true,
        build: true
      },
      null,
      2
    ) + '\n'
  );
  for (const [port, key] of [
    [4317, 'phc_test'],
    [4318, '']
  ]) {
    const child = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: temporary,
      stdio: 'inherit',
      env: { ...env, HOST: '127.0.0.1', PORT: String(port), NUXT_PUBLIC_MINIHOG_KEY: key }
    });
    children.push(child);
    child.once('error', (error) => {
      console.error(error);
      process.exitCode = 1;
      void close();
    });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await close();
}
