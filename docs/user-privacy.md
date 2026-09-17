# Your data and credentials

Your team’s manifest describes its repositories, tools and service coordinates.
Keep it in a repository whose access matches the people who need that information.
Installing fx does not require making that manifest public.

## What stays on your machine

fx stores registered workspaces, personal selections, preferences, trust decisions
and operation state under `~/.fx`. `FX_HOME` can relocate this directory. The
manifest checkout is kept separately from business repositories.

`fx config export` carries supported preferences and personal layers. It excludes
credentials, trust records and manifest clones. Review an exported profile before
sharing it: repository selections and personal overrides may reveal team context.

Tool installation history stays in `tool-history.json` under FX_HOME and is
excluded from profile exports. It retains workspace names, package and command
metadata, timestamps, versions and local executable paths. Credentials in command
URLs and secret arguments are redacted; raw installer output is not stored.
The history may still reveal private package names and registry addresses. Review
it before sharing. It records future fx operations, not pre-existing installations,
and can be edited by the local account; it is not a tamper-proof audit service.

## Authentication

Companion tools own credentials for their services. Use their normal login flows;
do not paste tokens into the manifest or shared agent instructions. fx reads their
readiness and directs you to the necessary setup when access is missing.

An environment selected on one machine is not evidence that another machine has
access. Check with `fx can <capability> --env <environment>` or `fx doctor`.

## Sharing team knowledge

Shared repository information, environment coordinates and team Skills belong in
your team’s controlled manifest source. Member documents require `sensitive: true`;
the marker does not replace repository access controls.

`fx source push` can submit selected manifest-source changes when you explicitly
run it. Review the selected files and destination with `--dry-run`. Ordinary
workspace synchronization is not an instruction to publish your team’s source.

## Reporting a problem

Include only a minimal, redacted example in public reports. Remove credentials,
member information and private service addresses. See [support](support.md).
