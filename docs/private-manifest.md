# Public source, private team configuration

fx-devkit is a toolkit for engineering teams. Publishing its source does not
publish a team's workspace. Members still use their organization's repositories,
service environments, companion CLIs and existing access controls.

## Keep in this repository

- CLI implementation, provider adapters and native agent protocols.
- Schema definitions, general usage documentation and fictional examples.
- Synthetic fixtures and offline tests that preserve meaningful protocol cases.
- The bundled fx-workspace Skill and generic contributor guidance.

## Keep in the team's private source

- Actual repository URLs, branches, ownership and access contacts.
- Environment hosts, log streams, error-tracker projects, build jobs and cluster coordinates.
- Cross-repository business architecture and product-specific procedures.
- Team Skills, authorized case definitions and private evaluation evidence.

The private manifest can be a versioned Git repository, and every fx command works
against it. Provider and installer configuration is data in that manifest: the
published toolkit neither disables an integration nor replaces a private endpoint
with a public service at runtime.

## Keep on each machine

Credentials remain owned by companion tools. FX_HOME carries workspace selection,
preferences, trust records and operation state. Exported profiles exclude secrets,
trust records and manifest clones. A successful check from another machine never
establishes this member's readiness.

## Examples and compatibility

Names containing `example` and hosts under `example.com` are fictional. They are
not defaults for a real organization. Repository and service identifiers can differ;
set `obs.svc` explicitly when needed. The legacy `fx-` service-name convention is
retained for compatibility, without requiring that convention in new manifests.

The internal `@fx/devkit` package uses a private Registry; the public
`@angelmsger/fx` package uses npmjs.
Team manifests, companion packages and services retain their separate controls.
See the [registry contract](design/registry-configuration.md). The toolkit uses
[Apache-2.0](../LICENSE); its license does not grant access to private manifests
or connected services.
