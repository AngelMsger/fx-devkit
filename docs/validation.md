# Validation and support boundaries

This page describes how to verify a checkout and which conclusions each check
supports. Team-specific trial reports, source patches, issue identifiers and
machine/account state belong outside the public repository.

## Required local checks

Use the development runtime versions from `package.json`:

```sh
npm ci
npm --prefix docs/website ci
npm run lint
npm run typecheck
npm test
npm run test:bun
npm run test:e2e
npm run docs:check
npm run site:build
npm run site:check
node scripts/check-package.mjs
```

The unit suite covers domain decisions and application workflows with injected
ports. E2e tests run the built CLI with temporary configuration and repository
fixtures. The CLI documentation check rebuilds before comparing generated help.
The website build renders the canonical Markdown; its check rejects stale sources,
broken page/anchor links and missing assets. See the [website guide](website/README.md).
The package check scans the declared distributable paths, including the bundled
Skill and public entry documents.

Passing local checks does not establish a real account's permissions, remote
resource existence, publication status or native agent activation. Capture the
revision, runtime and exact command when recording results in your team's
private validation store. Do not commit live credentials, responses or transcripts.

## Live integrations

`npm run test:contract` is opt-in and read-only. It uses explicit environment
coordinates below and the companion's existing authentication. Missing inputs
skip that contract. The Bitbucket identity test accepts a structured authentication
handoff; repository-read, Jenkins and Sentry checks still require their selected
resources to be readable.

| Companion | Test inputs                                                           |
| --------- | --------------------------------------------------------------------- |
| Bitbucket | `FX_TEST_BITBUCKET_HOST`, `FX_TEST_BITBUCKET_REPO` (`project/repo`)   |
| Jenkins   | `FX_TEST_JENKINS_JOB`; optional `FX_TEST_JENKINS_CONTEXT`             |
| Sentry    | `FX_TEST_SENTRY_HOST`, `FX_TEST_SENTRY_ORG`, `FX_TEST_SENTRY_PROJECT` |

The script sets `FX_TEST_LIVE=1` for its child process. These variables contain
coordinates, not credentials; never place credential values in test fixtures.

Companions own authentication. Reuse supported local credentials rather than
copying them into fixtures. A native host's project trust is a separate boundary;
syntactically correct hook or MCP files do not prove that the host activated them.
Source contributions additionally require verified fork parentage from the
installed companion before a real push or pull request can be authorized.

## Platform coverage

POSIX automated checks cover process supervision, filesystem ownership and CLI
behavior. Native Windows adapters exist, but Windows execution, cross-volume
junction behavior and host activation require the separate
[`check:windows` acceptance](design/windows.md). Do not infer those results from
a POSIX run or injected platform flags.

Agent protocols vary. Use `fx hook list` and `fx mcp list/show` for supported,
unsupported and unverified states. Preserve these distinctions in release notes.

## Independent agent evaluation

The [evaluation protocol](eval/README.md) covers workspace discovery, readiness,
Skill selection, source provenance and task quality. Run it against fixtures or
an explicitly authorized private manifest. Keep the complete private evidence
outside this repository and publish only reviewed aggregate conclusions.

## Preparing a public source snapshot

The npm package scanner is not a review of the entire Git repository. Review
source, tests, examples, documentation, patches, ignored files and Git history
separately. Fictional examples must preserve meaningful protocol cases without
using an organization's actual topology or identifiers.

Removing a file from the working tree does not erase earlier commits. A public
source snapshot can omit `.git` entirely and begin a new public history. Preserve
the private original; rewriting or publishing that history is a separate action.
Apache-2.0 is selected for this project. Release review still includes
third-party notices and the license text in the actual distribution. Private package delivery does not publish the team's manifest or change the
distribution policy of companion packages. Track fx's own registry migration in
the [distribution delivery checklist](delivery.md).
