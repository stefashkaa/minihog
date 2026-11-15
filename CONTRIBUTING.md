# Contributing

Use Node.js 24.15 or newer supported by `package.json`, and pnpm 12.18.0. Install dependencies with `pnpm install`; CI uses the frozen lockfile.

## Checks

```sh
pnpm build
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit:coverage
pnpm exec playwright install chromium
pnpm test:e2e
pnpm size
pnpm publish:check
pnpm check:peers
pnpm audit:prod
```

`pnpm check:release` runs the full sequence. `pnpm format` applies Prettier formatting. The Husky pre-commit hook runs ESLint and Prettier through lint-staged.

Vitest tests import source files. Coverage includes every runtime source file and requires at least 95% statements, branches, functions, and lines in each package. Use behavior assertions for wire formats, consent, retries, identity, browser listeners, and teardown. Keep real browser tests for DOM recording and Nuxt integration.

Playwright builds npm archives, installs them into an isolated Nuxt consumer with no direct core dependency, checks types, and builds with optional features both disabled and enabled. It verifies that disabled features produce no chunks, then exercises the built application. All analytics traffic is intercepted locally with a synthetic public token.

## Package boundaries

- `packages/core/src/index.ts` must remain independent of optional features and browser import effects.
- Each optional feature has a separate export and owns its listeners, timers, and cleanup.
- `packages/nuxt` generates only the imports selected in module options. Its proxy accepts a fixed endpoint allowlist and never forwards site credentials.
- Public exports resolve to `dist`. Test packed archives when changing exports, declarations, or runtime assets.
- Keep the rrweb version and checksum pinned. Recorder updates require review of the compatibility patch, browser tests, and a PostHog ingestion/playback compatibility check.

## Pull requests

Describe the behavior that changes and how it was verified. Include a regression test for a bug fix, update API documentation when behavior changes, and add a Changeset for public package changes with `pnpm changeset`.

Do not put project tokens, captured customer events, private recordings, or credentials in tests or issue reports. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).
