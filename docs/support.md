# Support and updates

## Troubleshooting

Start with the current result from `fx doctor --format json`. For a particular
capability, use `fx can <capability> --env <environment> --format json`. Follow the
reported handoff instead of repeatedly retrying a command with missing access.

If workspace resolution or manifest loading fails, start with `fx workspace list`,
`fx workspace show <name>` and `fx self info`. These discovery commands retain
known registration and installation facts even when the workspace is unhealthy.
A missing root needs `workspace relocate` after the directory has moved; a missing
manifest needs preparation from its recorded source. `manifest validate --strict`
fails validation when the required workspace document is missing or invalid.
Optional undeclared documents may be absent.

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

`fx self info --format json` reports the installed version, runtime, effective
`registry` and `registry_source`. fx reuses npm's user/global configuration:
package scope first, then the default Registry. `FX_REGISTRY` is an optional
higher-priority override. Project npmrc cannot redirect global self-update.
Normal metadata reads use npm's own authentication and `NPM_CONFIG_USERCONFIG`.
An invalid override is reported rather than silently ignored.

<!-- distribution:internal -->

For `@fx/devkit`, an existing npm `@fx:registry` or private default is sufficient.
If neither is configured, obtain the team URL and associate the scope once:

```sh
npm login --registry=https://npm.example.com/ --scope=@fx
fx self update --dry-run
```

The URL is fictional. A one-time installation flag does not necessarily persist
that association; downloaded tarball URLs are not reliable Registry API addresses.
`FX_REGISTRY` remains available for a one-invocation override.

### Registry routing

Self-update pins the fx scope while leaving public dependencies on npm's default
Registry. If your private default fails while proxying public dependencies and
team policy permits npmjs, keep the configured `@fx` scope private and route the
other packages to npmjs for the installation:

```sh
npm install -g @fx/devkit --registry=https://registry.npmjs.org/
```

Configure the scope first. This changes one invocation, not stored credentials
or the private proxy. It does not require a separate fx Registry setting.

<!-- /distribution -->

<!-- distribution:public -->

The public package follows npm's `@angelmsger:registry` and default Registry;
without a usable npm configuration it defaults to npmjs. `FX_REGISTRY` can select
an explicit mirror. Preview with `fx self update --dry-run` before applying it.

<!-- /distribution -->

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
