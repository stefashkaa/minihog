# Maintainer release procedure

Both packages share a version through the fixed Changesets group.

1. Confirm public package changes have [Changesets](.changeset/README.md).
2. Apply versions and changelogs: `pnpm changeset:version`.
3. Run `pnpm check:release` and review the packed consumer test and bundle-size report.
4. Merge the version changes with commit message `chore: Release packages`, or dispatch the Release workflow on `main`.

The workflow publishes unpublished package versions and creates one GitHub release from the core changelog. Failed publication can be retried; published versions are skipped.

Configure a GitHub Actions `NPM_TOKEN` secret with permission to publish both `@minihog/core` and `@minihog/nuxt`. The workflow uses npm provenance and requires `id-token: write`; GitHub release creation requires `contents: write`. Configure `CODECOV_TOKEN` for coverage uploads.

For local package validation without publishing, run `pnpm publish:check`.
