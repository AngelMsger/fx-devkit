# Distribution and registry contract

The project and binary are `fx-devkit` and `fx`; the package is `@angelmsger/fx`
with public access. `src/domain/distribution.js` owns that identity and the npmjs
address. Updates fall back to npmjs; publication goes to npmjs only. Releasing is
described in [delivery](../delivery.md).

## Runtime selection

`FX_REGISTRY`, when present, has priority. Otherwise `NpmRegistryLocator` asks npm
for the package scope Registry and default Registry in global mode. npm resolves
its environment, userconfig, globalconfig and built-in settings; a project's
npmrc is excluded because self-update is a global installation. Scope configuration
wins over the default. `NPM_CONFIG_USERCONFIG` is honored without copying credentials.
The lookup is local, capped at two seconds and memoized within an invocation.

`self info` reports the validated `registry` and `registry_source`: `environment`,
`npm_scope`, `npm_default`, `distribution_default` or `unavailable`. Invalid explicit
or scoped settings are retained as unresolved, not silently bypassed. A valid
configured mirror is followed. Addresses must be HTTP(S) without embedded
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
legacy `FX_REGISTRY_TOKEN` remains supported when paired with an explicit mirror
`FX_REGISTRY` through HTTP;
it is never sent to npmjs or passed as a process argument. fx no longer parses
npmrc authentication itself.

Self-update pins only fx's package scope to the selected Registry. npm's default
Registry continues to route the other dependencies. Companion installation policy remains owned by its declarations.

## Publication

`npm run release` (`scripts/publish.mjs`) accepts optional `--dry-run`, pins both
default and scoped npm Registry options to npmjs and enables lifecycle checks. The
`prepublishOnly` guard rejects direct `npm publish`, any other target and embedded
registry metadata. GitHub Actions publishes through npm trusted publishing; a
maintainer can run the same command after `npm login`. Runtime discovery does not
relax the publication boundary.

## Distribution boundary

`check-package.mjs` scans paths owned by the package file list, including implicit
metadata/README/LICENSE and source maps.
Tests cover a real npm client using isolated configuration and a loopback Registry;
actual release acceptance still requires the Registry and installation checks in
[delivery](../delivery.md).
