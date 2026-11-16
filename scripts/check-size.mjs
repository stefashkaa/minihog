import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const fixtures = {
  core: {
    source: "import { createMiniHog } from '@minihog/core'; window.analytics = createMiniHog('public');",
    budget: 5000
  },
  browser: {
    source:
      "import { createMiniHog } from '@minihog/core'; import { startBrowserCapture } from '@minihog/core/browser'; startBrowserCapture(createMiniHog('public'));",
    budget: 8000
  },
  flags: {
    source:
      "import { createMiniHog } from '@minihog/core'; import { createFeatureFlags } from '@minihog/core/flags'; window.flags = createFeatureFlags(createMiniHog('public'));",
    budget: 6500
  },
  replay: {
    source:
      "import { createMiniHog } from '@minihog/core'; import { startSessionReplay } from '@minihog/core/replay'; startSessionReplay(createMiniHog('public'));",
    budget: 50000
  },
  vitals: {
    source:
      "import { createMiniHog } from '@minihog/core'; import { startWebVitals } from '@minihog/core/web-vitals'; startWebVitals(createMiniHog('public'));",
    budget: 12000
  }
};

async function bundle(contents) {
  return build({
    stdin: { contents, resolveDir: new URL('../packages/core/', import.meta.url).pathname },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    treeShaking: true,
    write: false,
    metafile: true,
    logLevel: 'silent'
  });
}

const report = {};
let coreInputs;
const contributingInputs = (result) =>
  Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([path, input]) => path !== '<stdin>' && input.bytesInOutput > 0)
    .map(([path]) => path)
    .sort();
for (const [name, fixture] of Object.entries(fixtures)) {
  const result = await bundle(fixture.source);
  const code = result.outputFiles[0].contents;
  if (name === 'core') coreInputs = contributingInputs(result);
  const gzip = gzipSync(code).length;
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(gzip <= fixture.budget, `${name}: ${gzip} gzip bytes exceeds budget ${fixture.budget}`);
  assert.ok(
    inputs.every((path) => !/posthog-js|core-js|preact|dompurify/.test(path)),
    `${name} includes an unwanted dependency`
  );
  if (name === 'core' || name === 'browser')
    assert.ok(inputs.every((path) => !/rrweb|web-vitals|surveys|flags\.js/.test(path)));
  report[name] = { minifiedBytes: code.length, gzipBytes: gzip, budgetBytes: fixture.budget };
}
const metadata = JSON.parse(await readFile(new URL('../packages/core/package.json', import.meta.url), 'utf8'));
assert.equal(metadata.sideEffects, false);
const extensions = Object.keys(metadata.exports).filter((path) => path.startsWith('./') && path !== './package.json');
const unused = await bundle(
  `${fixtures.core.source}\n${extensions.map((entry, index) => `import * as unused${index} from '@minihog/core/${entry.slice(2)}';`).join('\n')}`
);
assert.deepEqual(
  contributingInputs(unused),
  coreInputs,
  'Unused optional entry points and peers must contribute no output'
);
await mkdir('output', { recursive: true });
await writeFile('output/bundle-sizes.json', `${JSON.stringify(report, null, 2)}\n`);
console.table(report);
console.log('Unused optional imports eliminated; no PostHog SDK or polyfill dependencies.');
