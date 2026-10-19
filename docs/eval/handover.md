# Development handover

Team-specific delivery records and account state are maintained privately.

fx supports workspace initialization and synchronization, manifest maintenance,
companion setup/readiness, release checks, agent Skills, lifecycle resources and
selected-file source contributions. Using it does not require publishing a team's
manifest.

- Build and verify a checkout using [validation](../validation.md).
- Use [architecture and contracts](../design/README.md) for implementation behavior.
- Follow [installation guidance](../../README.md#install) for an existing package
  or a local source build. A version in package.json does not prove publication;
  the team's private installation source determines registry access and availability.
- Inspect [Windows limits](../design/windows.md) and native host trust separately.
  Source code or generated configuration alone does not establish native activation.
- Keep live trial receipts, deployment coordinates and authorization decisions in
  a private evidence store. The [evaluation protocol](README.md) remains reusable.
