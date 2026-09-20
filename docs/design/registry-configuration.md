# Distribution and registry contract

The project and binary remain `fx-devkit` and `fx`. Package identity determines
the distribution and npm scope; `src/domain/distribution.js` owns that mapping.

| Package          | Runtime fallback         | Publication target                                           | Access     |
| ---------------- | ------------------------ | ------------------------------------------------------------ | ---------- |
| `@fx/devkit`     | No guessed public source | Private Registry selected by injected npmrc or `FX_REGISTRY` | restricted |
| `@angelmsger/fx` | npmjs                    | npmjs only                                                   | public     |

Public release remains gated as described in [delivery](../delivery.md).
Preparing a public artifact does not publish it.

## Runtime selection

`FX_REGISTRY`, when present, has priority. Otherwise `NpmRegistryLocator` asks npm
for the package scope Registry and default Registry in global mode. npm resolves
its environment, userconfig, globalconfig and built-in settings; a project's
npmrc is excluded because self-update is a global installation. Scope configuration
wins over the default. `NPM_CONFIG_USERCONFIG` is honored without copying credentials.
The lookup is local, capped at two seconds and memoized within an invocation.

`self info` reports the validated `registry` and `registry_source`: `environment`,
`npm_scope`, `npm_default`, `distribution_default` or `unavailable`. Invalid explicit
or scoped settings are retained as unresolved, not silently bypassed. Internal
packages never use a public target. Addresses must be HTTP(S) without embedded
credentials, query strings or fragments. Cache identities include package and Registry.

This is current configuration, not a claim about historical installation origin.
One-time install flags need not be persisted, and a Git or tarball source need not
identify a Registry API. fx does not infer one by trimming a downloaded URL.

## Metadata and self-update

Normal metadata reads use bounded `npm view` with the chosen target pinned,
retries and npm's own update notifier disabled. Each live read uses a temporary
cache removed afterward: npm may otherwise return cached metadata when an upstream
returns 5xx, contradicting a live-check result. fx retains its own cross-invocation
probe cache. npm owns authentication and
configuration interpolation. Diagnostics do not expose its raw output. The explicit
legacy `FX_REGISTRY_TOKEN` remains supported when paired with an explicit private
`FX_REGISTRY` through HTTP;
it is never sent to npmjs or passed as a process argument. fx no longer parses
npmrc authentication itself.

Self-update pins only fx's package scope to the selected Registry. npm's default
Registry continues to route public dependencies, avoiding an unnecessary private
proxy requirement. Companion installation policy remains owned by its declarations.

## Publication

`scripts/select-distribution.mjs internal|public` changes metadata in a disposable
CI checkout without writing private coordinates or credentials. The source defaults
to internal metadata. `scripts/publish.mjs` accepts optional `--dry-run`, pins both
default and scoped npm Registry options and enables lifecycle checks. Internal
publication requires an explicit private target; public publication is npmjs-only.
The guard rejects direct publication and embedded registry metadata.

Jenkins supplies a Managed npmrc through `NPM_CONFIG_USERCONFIG` and binds
`NPM_TOKEN` only while publishing. `publish-ci.mjs` resolves that npm scope target
and invokes the controlled publisher. GitHub Actions uses its own trusted publishing.
Runtime discovery does not relax either publication boundary.

## Distribution boundary

`check-package.mjs` scans paths owned by the package file list, including implicit
metadata/README/LICENSE and source maps. Both channel artifacts must pass.
Tests cover a real npm client using isolated configuration and a loopback Registry;
actual release acceptance still requires the Registry and installation checks in
[delivery](../delivery.md).
