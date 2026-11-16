# Maintainer release procedure

Both packages share a version through the fixed Changesets group. The root workspace and demo application are private.

1. Add a Changeset describing the public change: `pnpm changeset`.
2. Apply versions and changelogs: `pnpm changeset:version`.
3. Run `pnpm check:release` and review the packed consumer test and bundle-size report.
4. Merge the version changes with commit message `chore: Release packages`, or dispatch the Release workflow on `main`.

The workflow checks the shared version, reads the core changelog, runs all release checks, publishes unpublished package versions, and creates one GitHub release. It does not create package-specific tags. Failed publication can be retried; published versions are skipped.

Configure a GitHub Actions `NPM_TOKEN` secret with permission to publish both `@minihog/core` and `@minihog/nuxt`. The workflow uses npm provenance and requires `id-token: write`; GitHub release creation requires `contents: write`. Configure `CODECOV_TOKEN` for coverage uploads. No credentials belong in the repository.

The `pnpm changeset:publish` command publishes packages; use it only as part of an intentional release. The `pnpm publish:check` command packs and scans packages without publishing.
