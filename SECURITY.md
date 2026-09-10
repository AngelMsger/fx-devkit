# Security reporting

fx-devkit is preparing its first public release. Report findings against the
current source revision and include the exact version or commit. The project does
not yet have an established supported release series.

## Report a suspected vulnerability

Use the repository's [private vulnerability reporting](https://github.com/AngelMsger/fx-devkit/security/advisories/new)
when it is available. Include the affected command, operating system, impact,
reproduction steps and a minimal redacted example.

If private reporting is unavailable, open a public issue requesting a private
contact route without including exploit details, credentials or sensitive data.
Do not put tokens, private manifest contents, personnel details or internal service
addresses into a public report.

## Trust boundaries

- Companion tools own their authentication and access controls.
- Manifest execution vectors require trust; acknowledging a setup step does not
  prove readiness.
- Read-only posture and `--dry-run` are distinct from permission to make a change.
- Native agent hosts retain control over project, hook and MCP trust.

These are behavioral contracts to preserve, not a claim of a completed external
security audit. See the [runtime contract](docs/design/runtime.md) and
[public/private boundary](docs/private-manifest.md).
