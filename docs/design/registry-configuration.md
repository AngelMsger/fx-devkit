# Registry configuration boundary

The generic repository and package contain no team registry coordinate.
`FX_REGISTRY` supplies that non-secret coordinate to runtime update checks,
self information, self update and the CI publishing entry point. Missing,
malformed, credential-bearing or known public-registry URLs are refused or
reported as unavailable; there is no implicit public fallback.

The policy is a small JavaScript module under adapters/registry so the runtime
and pre-build guard execute the same policy. TypeScript checks it through JSDoc
and includes it in dist. It has no IO or dependencies on another application
layer. Update cache keys include the package and registry identity.

## Publishing

CI must supply FX_REGISTRY and npm authentication through its own configuration.
The existing tag-only Jenkins stage invokes `node scripts/publish.mjs`; this
change does not authorize creating a tag or publishing a build.

The wrapper accepts only an optional --dry-run. It fixes both the general npm
registry and the package's scoped registry, enables lifecycle guards explicitly,
and runs from this repository. It never rewrites package.json with an address.
The prepublish guard refuses direct npm publish, embedded registry metadata and
mismatched targets. This prevents accidental routing through ambient npm settings;
like any lifecycle guard, it is not a security boundary against someone deliberately
bypassing the repository's publishing procedure.

This distinction matters because npm's registry selection prefers a scoped
registry over the general registry, and its lifecycle environment export omits
scoped keys. The installed npm 11.9.0 source and a read-only `npm config get`
experiment confirmed that explicitly setting both CLI options selects the intended
scope target. Tests invoke a fake npm executable and never publish to a server.

`check-package.mjs` derives coverage from package.json's files list and implicit
package metadata/readme/license files. It invokes the shared boundary scanner on
those paths, including source maps. Missing or unsupported paths fail instead of
silently disappearing from coverage.

## Runtime and installation

Obtain the private coordinate from the team's manifest or onboarding instructions.
Keep it in the shell, agent or CI environment. Do not commit its value here.
For example, replace the example address before using:

```sh
export FX_REGISTRY='https://npm.example.com/'
npm install -g @fx/devkit --registry="$FX_REGISTRY" --@fx:registry="$FX_REGISTRY"
fx self info --format json
fx self update --dry-run --format json
```

npm manages installation/publishing authentication. FX_REGISTRY_TOKEN optionally
supplies authentication for fx's read-only metadata query and is never persisted.
It is not an npm login setting. Source PRs and probe recording are independent
of this package publishing configuration.
