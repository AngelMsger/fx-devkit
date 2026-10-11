# Support and updates

## Troubleshooting

For interrupted initialization, start with its reported blockers and continuation
command. Completed work is retained:

```sh
fx init --resume --workspace <name>
```

Personal authentication and operator files require the named person; finish those
steps before continuing. For an existing workspace, `fx doctor --format json`
reports current preparation and concrete recovery actions. `fx can <capability>`
answers a specific capability question.

When a capability is not ready, read what its check answered before signing in
again. The pending step carries the tool's message and, where fx can tell, whether
authentication was not established, a permission was refused or a connection could
not be completed. A refused permission or a failed connection does not call for a
sign-in. When no cause is named, go by the tool's message and the step's guidance
rather than assuming either way. From `can` and `where`, a check that gave no answer
reports `unknown`: repair the tool it names, or repeat the query after a timeout.
`fx doctor --tool <tool> --env <env>` shows the same detail for one tool.

`preparation.state` is `ready` or `incomplete`; incomplete preparation exits 12.
`doctor.coverage` separately identifies missing diagnostic evidence. Release
checks still use `ok` and `complete`. Parse partial stdout even after a nonzero exit.

If the source cannot be loaded, inspect the reported file and field. Tools schema 3
requires each run step to identify local preparation or personal authentication.
After correcting the original source, retry the supplied full init command; after
registration, the resume command uses the managed source rather than recopying it.
`fx workspace list` and `fx self info` remain available for discovery. A moved root
needs `workspace relocate`; an absent source needs preparation from its recorded
source. Keep credentials in their companion tools.

## Updates

`fx self info --format json` reports the installed version, runtime, effective
`registry` and `registry_source`. fx reuses npm's user/global configuration:
package scope first, then the default Registry. `FX_REGISTRY` is an optional
higher-priority override. Project npmrc cannot redirect global self-update.
Normal metadata reads use npm's own authentication and `NPM_CONFIG_USERCONFIG`.
An invalid override is reported rather than silently ignored.

fx follows npm's `@angelmsger:registry` and default Registry; without a usable
npm configuration it defaults to npmjs. `FX_REGISTRY` can select
an explicit mirror. Preview with `fx self update --dry-run` before applying it.

For source installations, update Git and run `npm ci` and `npm run build` in the
checkout. Updating fx is separate from `fx sync`, which refreshes manifest sources.
`self update --format json` keeps stdout parseable; inspect installer `code` and
any failure `reason` rather than treating JSON output as success.

## Platform support

Node.js 22 or newer and Git are required. Bun is an alternative runtime; npm is
still needed for npm installation and self-update.

macOS and Linux are supported. Native Windows adapters are implemented, but
Windows execution, cross-volume junction behavior and native host activation
remain unverified. The intended Windows shells are PowerShell 5.1/7 and cmd on
local NTFS. Use `.cmd` entries if PowerShell policy blocks npm’s `.ps1` shims.

Agent hosts differ in Skill, hook, MCP and rule support. Inspect `fx agent list`,
`fx hook list` and `fx mcp list` for the selected host’s state.

## Report an issue

[Open a GitHub issue](https://github.com/AngelMsger/fx-devkit/issues) with the version,
operating system, command, expected behavior and a redacted reproduction.

## Security reports

Use [private vulnerability reporting](https://github.com/AngelMsger/fx-devkit/security/advisories/new).
Keep credentials, personal information and private team coordinates out of public reports.
