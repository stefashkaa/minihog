import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
for (const [name, fixture] of Object.entries(fixtures)) {
  const result = await bundle(fixture.source);
  const code = result.outputFiles[0].contents;
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
const unused = await bundle(
  `${fixtures.core.source}\nimport { createFeatureFlags } from '@minihog/core/flags';\nimport { getSurveys } from '@minihog/core/surveys';\nimport { captureException } from '@minihog/core/errors';\nimport { startSessionReplay } from '@minihog/core/replay';\nimport { startWebVitals } from '@minihog/core/web-vitals';\nimport { startHeatmaps } from '@minihog/core/heatmaps';`
);
assert.equal(
  unused.outputFiles[0].contents.length,
  report.core.minifiedBytes,
  'Unused optional imports must be eliminated completely'
);
await mkdir('output', { recursive: true });
await writeFile('output/bundle-sizes.json', `${JSON.stringify(report, null, 2)}\n`);
console.table(report);
console.log('Unused optional imports eliminated; no PostHog SDK or polyfill dependencies.');
