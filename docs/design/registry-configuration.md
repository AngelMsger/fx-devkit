# Package registry transition

The public release of `@angelmsger/fx` is intended to use public npm without a
private registry prerequisite. This page separates that target from the current
implementation so installation guidance does not imply that publishing and
self-update have already been migrated.

## Public-release target

- Install with `npm install -g @angelmsger/fx` from public npm.
- Use `https://registry.npmjs.org/` for metadata lookup and self-update when
  `FX_REGISTRY` is unset. Keep an explicit registry override for mirrors and
  teams that choose their own distribution endpoint.
- Publish the scoped package with public access through the controlled publishing
  entry point. No team registry address belongs in package metadata.
- Keep npm authentication with npm. `FX_REGISTRY_TOKEN`, when used for metadata
  queries, is not a publishing credential configuration.

npm documents [registry selection](https://docs.npmjs.com/cli/v11/using-npm/registry/)
and [publishConfig](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#publishconfig).
Scoped registry settings can redirect a package independently of the general
registry. Explicit install or publishing vectors must select both when pinning a
target.

## Current implementation and required changes

| Area                | Current checkout                                                                                  | Required for public npm                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shared policy       | `src/adapters/registry/registry-policy.js` rejects missing values and known public registry hosts | Accept public npm and define the default separately from URL validation                 |
| Runtime             | `configuredRegistry` returns null without a private `FX_REGISTRY`                                 | Resolve the public default for info, metadata checks and self-update                    |
| Publication         | `scripts/publish.mjs` and `scripts/guard-registry.mjs` require a private registry                 | Permit the public target while retaining wrapper and target-consistency checks          |
| Package access      | `publishConfig.access` is `public`                                                                | Configured; verify publishing credentials and scope access                              |
| Help and recovery   | `self update`, doctor and the bundled Skill request a private coordinate                          | Describe the public default and recovery from an invalid override                       |
| Regression coverage | Registry and publishing tests expect public npm to be rejected                                    | Cover the default, explicit public/private overrides, unsafe URLs and target mismatches |

Change these together before advertising self-update as ready for public npm.
Keep malformed URLs, embedded credentials, query strings and fragments rejected.
An invalid explicit override should produce an actionable configuration error,
not silently send requests to a different registry. Review metadata-token routing
when changing the default so a legacy private token is not forwarded to public npm.

## Controls to preserve

The shared JavaScript policy is used by both pre-build scripts and compiled
runtime adapters. Update cache keys include package and registry identity.

The publishing wrapper accepts only an optional `--dry-run`, pins both general
and scoped npm registry options, enables lifecycle checks and runs from this
repository. The lifecycle guard rejects direct publication, embedded registry
metadata and mismatched targets. It prevents accidental routing through ambient
settings; it is not a security boundary against deliberate lifecycle bypass.
Publishing tests use a fake npm executable and do not publish to a server.

`check-package.mjs` derives scan coverage from the package file list and implicit
metadata/readme/license files, including source maps. Missing or unsupported
paths fail instead of disappearing from coverage.

## Existing private installations

Until the transition is implemented, existing users can continue supplying their
team's private `FX_REGISTRY` for self-update. This compatibility path is not a
prerequisite for the planned public installation. Keep team coordinates outside
this repository.

npm owns installation and publishing authentication. The current metadata reader
uses `FX_REGISTRY_TOKEN` when present, otherwise a matching token from `~/.npmrc`.
It does not persist the environment token. Manifest source access, companion
package installers and source pull requests have separate configuration; changing
fx's package registry must not redirect them.
