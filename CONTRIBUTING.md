# Contributing

Use Node.js 26.x and pnpm 12.18.0.

```sh
pnpm install
pnpm dev:demo
```

`dev:demo` builds the packages and starts the Nuxt demo.

## Checks

```sh
pnpm exec playwright install chromium
pnpm check:release
```

`check:release` runs formatting, lint, peer and dependency checks, builds, type checks, package validation, bundle budgets, consumer installation checks, and tests. For individual checks, see the [workspace scripts](package.json). `pnpm format` applies formatting; the pre-commit hook checks staged files with ESLint and Prettier.

Run `pnpm test:unit:coverage` for Vitest tests. They import source files and require at least 95% statements, branches, functions, and lines across all runtime files in each package. Test observable behavior, including wire formats, consent, retries, identity, and cleanup.

Run `pnpm test:e2e` for Playwright tests against packed packages. These cover peer installation, Nuxt builds with features enabled and disabled, DOM recording, and diagnostics. Tests live in [`packages/nuxt/tests/e2e`](packages/nuxt/tests/e2e), with fixtures in [`packages/nuxt/tests/fixtures`](packages/nuxt/tests/fixtures). Intercept analytics traffic locally and use synthetic tokens.

`pnpm check:install` verifies the core archive in a clean npm consumer, including peer resolution and SSR imports of every entry point.

CI runs on pushes to `main`. To request a coverage report for a pull request, dispatch the [Coverage workflow](https://github.com/stefashkaa/minihog/actions/workflows/coverage.yml) with `pr_number`, or use `ref` for a branch, tag, or commit.

For bundle and runtime measurements, follow [COMPARISON.md](COMPARISON.md#reproduce).

## Package boundaries

- `packages/core/src/index.ts` must remain independent of optional features and browser import effects.
- Each optional feature has a separate export and owns its listeners, timers, and cleanup.
- `packages/nuxt` generates only the imports selected in module options. Its proxy accepts a fixed endpoint allowlist and never forwards site credentials.
- Public exports resolve to `dist`. Test packed archives when changing exports, declarations, or runtime assets.
- Keep the rrweb version and checksum pinned in [`build-replay.mts`](packages/core/scripts/build-replay.mts). When updating rrweb, review its `Array.from` and native DOM method patches, run browser tests, and verify PostHog ingestion and playback.

## Pull requests

Describe the behavior that changes and how it was verified. Include a regression test for a bug fix, update API documentation when behavior changes, and add a [Changeset](.changeset/README.md) for public package changes. Maintainers can follow [RELEASE.md](RELEASE.md) to publish versions.

Do not put project tokens, captured customer events, private recordings, or credentials in tests or issue reports. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).
