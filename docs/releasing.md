# Releasing

The project is always **fx-devkit** and the executable is always **fx**. One codebase
and version serve two distributions:

| Channel  | Code host         | npm package      | Package delivery                   | Website         |
| -------- | ----------------- | ---------------- | ---------------------------------- | --------------- |
| Internal | Private code host | `@fx/devkit`     | Jenkins → private Registry         | Private Dokploy |
| Public   | GitHub            | `@angelmsger/fx` | GitHub Actions → npmjs (+ Release) | GitHub Pages    |

Both code hosts carry the same history. No private address, credential or
deployment coordinate is committed: the internal channel reads them from Jenkins
and platform configuration, the public channel needs none.

The maintained checkout defaults to internal metadata. `scripts/select-distribution.mjs`
selects the package name, access and public metadata in a disposable CI checkout;
never commit its public output back to the internal baseline. Private addresses and
credentials are never written by this script. The license remains Apache-2.0.

## Internal delivery

Use the internal shared repository as `upstream`, your personal fork as `origin`,
and the public GitHub repository as `github`. Push to `origin` and merge through a
PR; then push the reviewed `main` and its release tags to `github` so both hosts
carry the same history.
An empty shared repository needs an explicitly authorized initial seed. Never
import predecessor history; actual URLs stay in Git/platform configuration.

Jenkins reads `Jenkinsfile` from the reviewed internal source. Use a multibranch
job with main and version-tag discovery. The Docker-capable default agent runs
pinned Node and Bun versions with `--init`, so terminated subprocess trees are
reaped instead of remaining as zombies in the build container.
Bun is invoked from its temporary installation path; the Bun test step sets PATH inside the shell instead of relying on the
Docker agent inheriting Jenkins PATH overrides. Branch checks require no
publication credentials.

After checks pass, exact `v<package.json version>` tags publish. A maintainer can
also run main with `PUBLISH_PACKAGE=true` for the initial release or a deliberate
retry. Ordinary branches and pull requests do not publish. Existing npm versions
must not be overwritten.

The publish stage uses Config File Provider with `npm-ci-config`, exposed through
`NPM_CONFIG_USERCONFIG`, and binds Jenkins credential `npm-token` as `NPM_TOKEN`.
Keep the Registry and token mapping in the Managed file. `publish-ci.mjs` asks npm
for the effective package-scope Registry, validates it, and invokes the controlled
publisher. No npmrc content is logged or stored in this repository. Never archive
managed files or pass credentials through Docker build arguments.

Configure Dokploy using the [static container guide](website/README.md). Deploy the
reviewed revision after Jenkins succeeds. The runtime contains user pages only.

## Public delivery

The public channel follows the same contract as the sibling CLIs
(`bitbucket-cli`, `confluence-cli`, ...): pull requests and `main` run
`.github/workflows/ci.yml`; pushing a `v<version>` tag to GitHub runs
`.github/workflows/release.yml`; `.github/workflows/pages.yml` deploys `main` to
GitHub Pages. Every workflow first selects public metadata with
`scripts/select-distribution.mjs public`.

The release workflow checks that the tag matches `package.json`, runs the quality
gates and tests, creates (or refreshes) the GitHub Release with the packed tarball
and `checksums.txt`, then publishes `@angelmsger/fx` to npmjs through
`scripts/publish.mjs`. It is idempotent: a version already on npmjs is skipped,
so a failed run can be re-run.

Publication uses npm trusted publishing (OIDC); there is no npm token or
repository secret. One-time setup:

1. The package must exist before a trusted publisher can be attached. Publish
   the first version from a maintainer machine on the public checkout:
   `node scripts/select-distribution.mjs public`, `npm ci`, `npm login`, then
   `node scripts/publish.mjs`. Discard the metadata change afterwards.
2. On npmjs, open `@angelmsger/fx` → Settings → Trusted Publisher → GitHub
   Actions: organization or user `AngelMsger`, repository `fx-devkit`, workflow
   `release.yml`, environment blank.
3. In the GitHub repository, set Settings → Pages → Source to _GitHub Actions_.

Keep these constraints, shared with the sibling CLIs: no `registry-url` on
`actions/setup-node` (its empty-token `.npmrc` disables the OIDC exchange); Node
24 for npm ≥ 11.5.1; `repository.url` casing must match `AngelMsger/fx-devkit`
for provenance. Official references:
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

A native Windows acceptance job (`windows` in `ci.yml`) runs on manual dispatch.

## Documentation and acceptance

`FX_DISTRIBUTION=internal|public` selects website copy and installation instructions.
Markdown channel blocks keep one reviewed source for both audiences. English is
default; all four locales select the same channel. Runtime self-update uses the
installed package identity and npm's effective user/global Registry settings;
`FX_REGISTRY` remains an optional override. Internal packages still require a
validated private target. Explicit mirrors are validated; private environment
tokens never go to the public default.

A delivery is complete only with evidence of:

1. Passing CI for the delivered revision.
2. The released version in the intended Registry, and an isolated installation
   passing `fx --version` and `fx self info` with the correct package identity.
3. A successful deployment of that revision and working four-language routes,
   assets and real HTTP 404 responses for missing/maintainer paths.

Dry-run publication and local container tests do not establish server-side
publication or deployment. Store real deployment coordinates and receipts in the
private platform/evidence store. This maintainer guide is excluded from the user site.
