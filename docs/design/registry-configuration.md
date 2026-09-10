# Distribution and registry contract

The project and binary remain `fx-devkit` and `fx`. Package identity determines
the distribution; `src/domain/distribution.js` owns that mapping.

| Package          | Default metadata/update source | Publication target                                           | Access     |
| ---------------- | ------------------------------ | ------------------------------------------------------------ | ---------- |
| `@fx/devkit`     | Explicit private `FX_REGISTRY` | Private Registry selected by injected npmrc or `FX_REGISTRY` | restricted |
| `@angelmsger/fx` | npmjs                          | npmjs only                                                   | public     |

Public release is currently paused by the GitHub repository variable gate described
in [delivery](../delivery.md). Preparing a public artifact is not publication.

## Selection

`scripts/select-distribution.mjs internal|public` changes package metadata in a
disposable CI checkout. The source default is internal. It never writes a private
Registry or credential. Runtime chooses from the installed package name, so a
published package never depends on a leftover CI environment variable.

Private URLs must be explicit HTTP(S) coordinates without embedded credentials,
query strings or fragments; known public hosts are rejected. A public installation
defaults to npmjs and can use a validated explicit private mirror. An invalid override
fails instead of silently falling back. Cache identities include package and Registry.

## Publishing and authentication

`scripts/publish.mjs` accepts optional `--dry-run`, pins both default and scoped npm
Registry options, enables lifecycle checks and runs from the repository. Internal
publication requires a private target; public publication is restricted to npmjs.
The lifecycle guard rejects direct publication, embedded registry metadata and
mismatched targets. These prevent accidental routing, not deliberate lifecycle bypass.

Jenkins injects a Managed npmrc through `NPM_CONFIG_USERCONFIG`, with `NPM_TOKEN`
bound only in the publish stage. `publish-ci.mjs` resolves the scope target through
npm and supplies it to the controlled publisher. GitHub Actions uses npm trusted
publishing and never consumes the internal Managed file or token.

For metadata reads, `FX_REGISTRY_TOKEN` is used only for a private target; otherwise
only a matching entry in the user's npmrc may supply authentication. Environment
tokens are not persisted. Manifest sources, companion installers and source PRs
have separate configuration and are never redirected by fx's package Registry.

## Distribution boundary

`check-package.mjs` scans the paths owned by the package file list, including
implicit metadata/README/LICENSE and source maps. Missing paths fail. Both channel
artifacts must pass this check. Unit tests use fake npm and HTTP implementations;
actual release acceptance requires the Registry and installed package checks in
the delivery guide.
