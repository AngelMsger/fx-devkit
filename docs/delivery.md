# Delivery

The project is **fx-devkit**, the npm package is **`@angelmsger/fx`** and the
executable is **fx**. GitHub Actions is the only CI, npmjs is the only package
Registry and GitHub Pages hosts the website. This maintainer guide is excluded
from the user site.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

- `linux`: lint, typecheck, CLI reference freshness, Node and Bun unit tests,
  end-to-end tests, the package boundary scan, the website build and check, and
  `npm run release -- --dry-run`.
- `windows`: `npm run check:windows`, the native Windows acceptance entry. Its
  JSON report is uploaded as the `windows-acceptance` artifact.

`.github/workflows/pages.yml` builds the website for both origin-root and
repository-subpath hosting on every change, and deploys `main` to GitHub Pages.

## One-time setup

1. **Pages.** In the repository's Settings → Pages, set Source to
   _GitHub Actions_. Until then the Pages deploy step on `main` fails.
2. **First npm release.** Trusted publishing can only be configured for a
   package that exists, so publish the first version from a maintainer machine:

   ```sh
   git checkout main && git pull
   npm ci
   npm login
   npm run release -- --dry-run   # review the file list
   npm run release
   ```

3. **Trusted publishing.** On npmjs, open the package's Settings → Trusted
   Publisher and add GitHub Actions with owner `AngelMsger`, repository
   `fx-devkit`, workflow `ci.yml` and environment `npm`. Then set the repository
   variable `NPM_PUBLISH_ENABLED` to `true`. Reference:
   [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Releasing a version

1. Update `version` in `package.json` and `package-lock.json`, move the
   `Unreleased` CHANGELOG entries under the new version, and regenerate anything
   `npm run docs:check` reports. Merge that change to `main` with green CI.
2. Tag the merged commit `v<version>` and push the tag. With
   `NPM_PUBLISH_ENABLED=true`, the `publish` job checks that the tag matches
   `package.json`, waits for both test jobs and publishes with provenance. Without
   it, publish manually with `npm run release` as above.

`npm run release` (`scripts/publish.mjs`) always pins npmjs and public access;
the `prepublishOnly` guard refuses a bare `npm publish`. Published versions are
never overwritten.

## Acceptance

A delivery is complete with:

1. Green CI for the released commit.
2. The version on npmjs, and a clean `npm install -g @angelmsger/fx` passing
   `fx --version` and `fx self info --format json` with name `@angelmsger/fx`.
3. A Pages deployment of that commit with working four-language routes, assets
   and real 404 responses for missing paths.
