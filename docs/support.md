# Support and updates

## Troubleshooting

Start with the current result from `fx doctor --format json`. For a particular
capability, use `fx can <capability> --env <environment> --format json`. Follow the
reported handoff instead of repeatedly retrying a command with missing access.

- Missing tool: inspect `fx tool show <tool>` and its installation requirements.
- Missing authentication: use `fx login --list`, then the relevant login flow.
- Environment outside your selection: inspect `fx env list` and select it only
  when it belongs in your workspace.
- Invalid manifest: run `fx manifest validate --strict` and use
  `fx manifest explain '<field>'` to inspect the reported field.
- Partial sync: inspect failed repository rows and resource stages, resolve the
  cause, then rerun the relevant `fx sync --only <stage>` operation.

A zero exit code from a report does not prove readiness. Read `ok`, `complete`,
individual findings and recovery information.

## Updates

<!-- distribution:internal -->

Use `fx self info --format json` to identify the version, runtime and configured
package registry. Package installations use the private Registry supplied by your team through
`FX_REGISTRY`. Source installations can be updated through Git, followed by
`npm ci` and `npm run build` in that checkout.

For a package installation with an available update source, inspect
`fx self update --dry-run` before applying it. The current version requires an
explicit private registry for package-based self-update. Source installations can
be updated without using that command. Updating fx and updating the team manifest
are separate operations; `fx sync` refreshes eligible manifest sources.
<!-- /distribution -->

<!-- distribution:public -->

The public package uses npmjs for update checks by default. `FX_REGISTRY` can select an explicit mirror. Inspect `fx self update --dry-run` before applying an update. For source installations, update Git and rebuild. Updating fx is separate from `fx sync`, which updates eligible manifest sources.
<!-- /distribution -->

## Platform support

Node.js 22 or newer and Git are required. Bun is an alternative runtime; npm is
still needed for npm installation and self-update.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution, cross-volume junction behavior and native host activation
remain unverified. The intended Windows shells are PowerShell 5.1/7 and cmd on
local NTFS. Use `.cmd` entries if PowerShell policy blocks npm’s `.ps1` shims.

Agent hosts differ in Skill, hook, MCP and rule support. Inspect `fx agent list`,
`fx hook list` and `fx mcp list` for the selected host’s state.

<!-- distribution:internal -->

## Report an issue

Contact your team's fx maintainers through the internal support channel with the
output of `fx --version`, your operating system, the command, expected behavior
and a redacted reproduction. Include the relevant finding and handoff for setup errors.

## Security reports

Report security findings privately to the maintainers. Keep credentials, personal
information and team coordinates out of shared reports and reproduction examples.
<!-- /distribution -->

<!-- distribution:public -->

## Report an issue

[Open a GitHub issue](https://github.com/AngelMsger/fx-devkit/issues) with the version,
operating system, command, expected behavior and a redacted reproduction.

## Security reports

Use [private vulnerability reporting](https://github.com/AngelMsger/fx-devkit/security/advisories/new).
Keep credentials, personal information and private team coordinates out of public reports.
<!-- /distribution -->
