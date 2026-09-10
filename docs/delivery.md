# Distribution channels

The project is always **fx-devkit** and the executable is always **fx**. One codebase
and version serve two distributions:

| Channel  | npm package      | Package delivery           | Website         |
| -------- | ---------------- | -------------------------- | --------------- |
| Internal | `@fx/devkit`     | Jenkins → private Registry | Private Dokploy |
| Public   | `@angelmsger/fx` | GitHub Actions → npmjs     | GitHub Pages    |

The maintained checkout defaults to internal metadata. `scripts/select-distribution.mjs`
selects the package name, access and public metadata in a disposable CI checkout;
never commit its public output back to the internal baseline. Private addresses and
credentials are never written by this script. The license remains Apache-2.0.

## Internal delivery

Use the internal shared repository as `upstream`, your personal fork as `origin`,
and the former GitHub remote as `github`. Push to `origin` and merge through a PR.
An empty shared repository needs an explicitly authorized initial seed. Never
import predecessor history; actual URLs stay in Git/platform configuration.

Jenkins reads `Jenkinsfile` from the reviewed internal source. Use a multibranch
job with main and version-tag discovery. The Docker-capable default agent runs
pinned Node and Bun versions. Bun is invoked from its temporary installation
path; the Bun test step sets PATH inside the shell instead of relying on the
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

## Public delivery (currently paused)

`.github/workflows/npm.yml` selects public metadata, runs the checks and validates
packaging with `--dry-run`. Real publication requires a `v<version>` tag and the
repository variable `PUBLIC_RELEASE_ENABLED=true`. `.github/workflows/pages.yml`
builds public documentation and uses the same gate for Pages deployment. Leave the
variable unset while external release is on hold; no real npmjs or Pages release
is authorized merely by preparing this configuration.

Before enabling publication, configure npm trusted publishing for the public
package and this repository's `npm.yml` workflow. The workflow uses GitHub OIDC
(`id-token: write`), not an internal npm token or Managed file. Confirm initial
package/scope ownership and the trusted publisher's allowed publish action. Enable
GitHub Pages with GitHub Actions as its source. Official references:
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Documentation and acceptance

`FX_DISTRIBUTION=internal|public` selects website copy and installation instructions.
Markdown channel blocks keep one reviewed source for both audiences. English is
default; all four locales select the same channel. Runtime self-update uses the
installed package identity: internal needs a private `FX_REGISTRY`, public defaults
to npmjs. Explicit mirrors are validated; private environment tokens never go to
the public default.

A delivery is complete only with evidence of:

1. Passing CI for the delivered revision.
2. The released version in the intended Registry, and an isolated installation
   passing `fx --version` and `fx self info` with the correct package identity.
3. A successful deployment of that revision and working four-language routes,
   assets and real HTTP 404 responses for missing/maintainer paths.

Dry-run publication and local container tests do not establish server-side
publication or deployment. Store real deployment coordinates and receipts in the
private platform/evidence store. This maintainer guide is excluded from the user site.
