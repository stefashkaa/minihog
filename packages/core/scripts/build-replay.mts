import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// rrweb repairs Array.from on pages that replace the native method with a broken
// shim. MiniHog targets modern browsers with native built-ins. Keep the recorder,
// remove that global mutation, and fail closed when the audited upstream changes.
const expectedHash = '2421f11e7da76d7bfaa81d21c1ffc58280d9c7f59188223185662010c810bfe4';
const sourcePath = fileURLToPath(import.meta.resolve('@rrweb/record'));
const upstream = await readFile(sourcePath, 'utf8');
if (createHash('sha256').update(upstream).digest('hex') !== expectedHash) {
  throw new Error('rrweb source changed. Review its compatibility code and update the pinned hash before building.');
}
const shim = `try {
\tif (Array.from([1], (x) => x * 2)[0] !== 2) {
\t\tconst cleanFrame = document.createElement("iframe");
\t\tdocument.body.appendChild(cleanFrame);
\t\tArray.from = cleanFrame.contentWindow?.Array.from || Array.from;
\t\tdocument.body.removeChild(cleanFrame);
\t}
} catch (err) {
\tconsole.debug("Unable to override Array.from", err);
}`;
if (upstream.split(shim).length !== 2) throw new Error('Expected exactly one rrweb compatibility shim.');

// rrweb lists selector methods as accessors, so even an untouched Element
// prototype fails its native check and creates a temporary iframe. Classify
// them as methods instead; patched methods/getters still use the clean realm.
const elementAccessors = `Element: [
\t\t"shadowRoot",
\t\t"querySelector",
\t\t"querySelectorAll"
\t]`;
const elementMethods = 'Element: []';
const methodCheck =
  'methodNames.every((method) => typeof defaultPrototype[method] === "function" && defaultPrototype[method]?.toString().includes("[native code]"))';
if (upstream.split(elementAccessors).length !== 2 || upstream.split(elementMethods).length !== 2) {
  throw new Error('Expected exactly one rrweb Element accessor and method list.');
}
if (upstream.split(methodCheck).length !== 2) throw new Error('Expected exactly one rrweb native method check.');
const modernSource = upstream
  .replace(shim, '')
  .replace(elementAccessors, 'Element: ["shadowRoot"]')
  .replace(elementMethods, 'Element: ["querySelector", "querySelectorAll"]')
  // Inspect descriptors without executing page-defined getters or toString methods.
  .replace(
    methodCheck,
    `methodNames.every((method) => {
      const value = Object.getOwnPropertyDescriptor(defaultPrototype, method)?.value;
      return typeof value === "function" && Function.prototype.toString.call(value).includes("[native code]");
    })`
  );

await build({
  entryPoints: ['src/replay.ts'],
  outfile: 'dist/replay.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  // The core and replay must share the same client context, not bundled copies.
  external: ['./internal/state.js'],
  banner: { js: '/*! Includes rrweb 2.2.2, Copyright (c) 2018 rrweb contributors. MIT: see LICENSE-RRWEB. */' },
  plugins: [
    {
      name: 'modern-rrweb',
      setup(builder) {
        builder.onLoad({ filter: /[/\\]@rrweb[/\\]record[/\\]dist[/\\]record\.js$/ }, async () => ({
          contents: modernSource,
          loader: 'js'
        }));
      }
    }
  ]
});
