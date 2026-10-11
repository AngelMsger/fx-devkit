# Native Windows

The implementation targets Windows 10/11 with Node 22 or newer, npm and Git
for Windows. Bun remains an alternative runtime. Normal use does not require
Git Bash, WSL, administrator privileges or Developer Mode. Native acceptance
is tracked separately in [validation guidance](../validation.md).

## Terminal boundary

[Installation](../user-guide.md#install) owns shell examples and
[configuration](../user-guide.md#configuration) owns preferences and completion.
This page specifies the Windows adapters. Shell profiles, execution policy and
native host trust remain the user's responsibility. fx does not change them.

Browser opening uses a fixed PowerShell program with the URL passed as an
environment value. Failure leaves the URL available with a nonblocking notice.
Command presentation is independent of execution, as specified in the
[runtime contract](runtime.md).

## Processes and local storage

The process adapter shares one resolver between detection and execution. It
handles PATH casing, PATHEXT order, explicit paths and invocation environment
overrides. Bare names search PATH only, not an implicit current directory.
Native executables launch directly; cross-spawn handles batch shims and escaping.
No caller-facing raw-shell option is introduced. Missing commands remain exit
127, and piped output remains byte-decoded UTF-8 with diagnostics separate.

Noninteractive children do not open console windows. Cancellation uses only the
owned PID with bounded `taskkill /T /F`, followed by direct-child cleanup when
needed. This is best-effort resource cleanup, not a Windows Job Object or a
containment boundary. A root already terminated by the OS cannot reliably identify
or clean up detached descendants. POSIX process-group behavior is retained.

Workspace roots and FX_HOME must be on local NTFS storage. Different local
volumes are supported; UNC and mapped network storage are outside the support
contract. UNC inputs are rejected, but fx does not probe drive mappings. Paths
with spaces and Unicode are supported. Windows reserved names and checkout
aliases are rejected during local planning.

Team Skills use absolute directory junctions on Windows and directory symlinks
elsewhere. Junctions retain live sharing without symlink privileges. Reconciliation
recognizes their targets; removing one never removes the source directory. Foreign
directories, files and links retain the existing ownership/confirmation rules.
fx's bundled Skill is still a recoverably replaced copy. Local Git contribution
capture preserves the index/HEAD executable bit on Windows and defaults new files
to nonexecutable instead of interpreting Windows filesystem modes as Git modes.

## Host protocols

The AgentHostSpec table owns platform-specific protocol selection. Windows
command hooks use a fixed encoded PowerShell wrapper that launches the bound
runtime directly and copies binary stdin/stdout. It suppresses stderr and returns
zero on missing runtimes or failure. No execution-policy override is added.

| Host        | Windows projection                                                 |
| ----------- | ------------------------------------------------------------------ |
| Claude Code | Command handler with explicit `shell: powershell`                  |
| Codex       | Windows command with `commandWindows` override                     |
| Grok        | Windows command entry invoking the PowerShell wrapper              |
| Pi          | Native extension with bounded supervision and Windows tree cleanup |

Current host protocols are the baseline. Older hosts may require an upgrade;
fx does not promise legacy-host fallback. A matching projection remains
`activation: unverified` until the host accepts the project and hook trust.
fx does not change host trust or bypass it. Existing owned POSIX handlers are
migrated, and unrelated handler fields and entries are retained.

Windows stdio MCP entries point at the absolute fx runtime and bundled
`bin/mcp-stdio.js` bridge, followed by the original vector. The bridge inherits
streams and returns the server's exit code; it does not initialize the ordinary
CLI, buffer protocol output, check updates or print notices. Host-provided
environment references remain references, never persisted values. Original
resource trust and projection ownership checks apply before configuration is
written. HTTP MCP is unchanged. An fx installation moved or removed after
projection requires a subsequent sync to refresh absolute entry paths.

## Acceptance

Run `npm run check:windows` on a prepared native Windows machine with Node,
npm, Git, Bun, Windows PowerShell 5.1 and PowerShell 7 installed. It runs quality
gates, unit suites under Node and Bun, end-to-end tests, command-reference checks,
the package scanner, and installs a local tarball into an isolated prefix to
exercise its `.cmd` entry. It never publishes or installs globally. Missing
prerequisites and failed checks return nonzero. The temporary report records
the platform, runtime, each completed check and overall outcome.
`FX_WINDOWS_REPORT` can select a report destination; the `windows` CI job runs
this entry on GitHub's `windows-latest` runner for every change and uploads the
report even when a check fails. Run it locally under Node 22 as well. Native host activation and a junction across
two local volumes are additional manual checks, not implied by a passing report.

The automated suite uses portable Node/cmd fixtures and isolates both HOME and
USERPROFILE. POSIX-only shell/signal/file-symlink tests are explicitly scoped;
Windows process, junction, hook and PowerShell cases cover the corresponding
native behavior. No core flow suite is skipped wholesale.

References: [cross-spawn](https://github.com/moxystudio/node-cross-spawn),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Windows junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions).
