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

The private manifest can still be a versioned Git repository. `fx init`, `sync`,
`manifest`, `member`, `where`, `release` and `source push` retain their existing
roles. Provider and installer configuration stays data-driven; public source
cleanup must not disable integrations or replace private endpoints with public
services at runtime.

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

The planned public npm package does not require private registry access. Teams
may still use private manifests, companion packages and services independently.
The current fx publishing and self-update implementation still needs the
[registry transition](design/registry-configuration.md). The toolkit uses [Apache-2.0](../LICENSE); its license does not grant access to
private manifests or connected services.
