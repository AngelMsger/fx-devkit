# Working on fx-devkit

Read this file before changing the repository. It defines engineering constraints;
[architecture and contracts](docs/design/README.md) explain the implementation,
and [validation](docs/validation.md) defines checks and support boundaries.

## Repository and task boundaries

This repository has an independent history. Never import predecessor history,
private manifests, live evaluation evidence or business patches. Keep migration
provenance in a private record outside this repository.

Preserve existing changes and verify repository identity and remotes before
committing or pushing. This project checkout uses only `origin`, pointing to
`git@github.com:AngelMsger/fx-devkit.git`; there is no `upstream` remote.
Authorized maintainer pushes go to `origin`. External contributors use their
personal forks as described in CONTRIBUTING.md. Do not force-push to repair
unrelated history or merge unrelated histories.

Work in the target checkout or an isolated worktree. Workspace migration,
publication and tags need task-specific authorization. User authorization takes
precedence over historical task notes; delivery documents are evidence, not
permission policies. Never copy authentication or bypass an agent host's trust.

`fx` serves people maintaining a multi-repository workspace and agents querying
it through structured commands. Preserve both uses: readable defaults and a
predictable machine contract. Prefer fixing a shared cause over adding another
special-case command or provider branch. Do not expand a quality pass into new
product capabilities without a concrete need in the task.

## Architecture

| Layer         | Responsibility                                                       |
| ------------- | -------------------------------------------------------------------- |
| `domain`      | Pure decisions, shared types, declarative configuration codecs       |
| `ports`       | Narrow interfaces for external effects                               |
| `application` | Workflows, policy, planning, recovery and diagnostic interpretation  |
| `adapters`    | Filesystem/process/Git effects, providers and native agent protocols |
| `infra`       | Personal persistence, locks, caches and logging                      |
| `cli`         | Parse arguments, call use cases and render results                   |
| `composition` | Construct dependencies and register implementations                  |

Domain imports no outer layer; ports import domain; application imports domain
and ports. Adapters and infra may import domain/ports, but not application or
each other. CLI accesses adapters/infra only through composition. Composition
may see every layer, but it does not own workflow policy.

Inner layers may use pure `node:path` and `node:crypto` helpers. YAML/Zod belong
in declarative codecs under `domain/manifest`, `domain/config` and
`domain/import/render`; they do not authorize IO there. Dynamic imports do not
bypass dependency boundaries. ESLint enforces imports; reviewers still verify
responsibility and data flow.

A provider is one `ProviderDescriptor` under `adapters/<capability>/<id>/` plus
registration in composition. Application code does not name providers.
`AgentHostSpec` is the sole inventory of native agent capabilities and paths;
protocol adapters own serialization. Platform differences belong to adapters,
not provider-specific application branches.

## Command and Agent contracts

- Default output is human; `--format json` and `FX_FORMAT=json` serve agents.
  stdout contains data only. Notices, progress and diagnostics go to stderr.
  Errors use the same JSON envelope in every output format.
- Collections use `{items, has_more, next?}`. Absent facts are explicit values;
  never confuse not configured, not covered and a failed check. Preserve
  structured errors when returning batch or report results.
- Use `DevkitError`; keep released codes and category exit codes stable. Every
  error carries recovery steps, and `LOGIN_REQUIRED` carries a user handoff.
  Unknown commands, config keys and resource selectors offer nearest matches.
- Resolve settings as explicit flag > environment > file > default. Effective
  configuration and `--explain` must describe that same invocation. Keep parser
  metadata, routing, completion and generated help consistent.
- Every write has `--dry-run`: build its plan first, then gate actual effects
  through `assertWritable`. Preserve `read_only` / `FX_READ_ONLY` and the explicit
  one-invocation `--allow-writes` override. Reads are not write-gated.
- No TTY or `--no-input` means no waiting: missing input becomes `INPUT_REQUIRED`
  or `CONFIRM_REQUIRED`. A manifest vector passes through `TrustGate`; bundled
  defaults run freely, changed vectors require new trust. Install vectors are
  assembled from installer/package data, never supplied as shell code.
- Manual/file setup steps belong to the user and are followed by verification.
  Authorized local preparation may be assisted, but acknowledgement alone never
  establishes readiness. `doctor --fix` is limited to run steps and managed
  projections; report repair attempts separately from subsequent verification.
- `doctor` and `release` exit zero even with failing findings. `ok` means no
  failure findings; `complete` means no requested check lacks coverage. Neither
  alone proves readiness. A platform that cannot be checked yields a warning
  and handoff, not an invented success.

The [runtime contract](docs/design/runtime.md) owns output, deadlines and trust
semantics; [setup](docs/design/setup.md) owns readiness selection and verification.

## Workspace and data ownership

The managed workspace root is a plain directory. The manifest source is a
separate checkout under `~/.fx/workspaces/<name>/source`, registered in personal
configuration. Never run Git at the managed root. Business checkouts retain their
own branches and histories.

- `sync` never checks out, resets, stashes, rebases or merges user work. It clones
  missing checkouts, fast-forwards eligible clean branches, and reports dirty or
  diverged state. Separate source-contribution ports may prepare controlled commits;
  they do not widen the repository-sync Git port.
- `init` writes only into the user-selected target or registered directories.
  `repo remove` removes a reference, not files. Import reads checkouts and writes
  only to an explicit output outside the imported directory.
- Only marked guides, owned Skill links/copies and receipted host resources are
  managed. Preserve foreign files/entries; supported replacement requires
  confirmation and backup. Recheck plans before writing and preserve recovery
  journals rather than guessing through unrecognized state.
- Team Skills use one directory link per selected agent to the manifest's Skills
  tree. Windows uses junctions; do not silently substitute copies. The bundled
  fx Skill is a copy recognized by its name and version frontmatter. An unversioned
  same-name directory is foreign.
- Lifecycle hooks live only at the registered root. Dispatch reads local state
  under an independent deadline and fails open. Background work may refresh the
  manifest, docs, Skills and readiness observations; it never syncs business
  repositories, confirms trust, overrides read-only posture or publishes changes.
  No high-frequency/transcript-processing behavior is added implicitly.
- Shared coordinates live in the private manifest. Generated guides carry routes
  and references, not duplicated addresses, versions or people. Maintained team
  rules remain prose; malformed/unknown generated regions are preserved.
- `where` prints coordinates; it does not execute them. Provider query ports are
  read-only. Generated kubectl vectors are confined to `get`, `describe`, `logs`,
  `top`, `auth can-i` and `config get-contexts`.

See [lifecycle](docs/design/lifecycle.md), [harness](docs/design/harness.md),
[import](docs/design/import.md) and [source contributions](docs/design/source-contributions.md)
for their complete behavioral contracts.

## Sensitive data and distribution

The generic CLI ships no team manifest. `members.yaml` is a sensitive document
tracked in the private manifest repository; a nested directory is not an access
boundary. Require its `sensitive: true` marker. People results reach stdout only,
never caches, logs or notices, and an unreadable document has no stale fallback.
The package boundary scanner must run against actual built distribution paths.

Internal hosts, registries, repository coordinates, credentials and personnel
identifiers do not belong in generic source, fixtures, errors or distributed
assets. Use `example.com` examples. Private-manifest contributions may contain
internal coordinates under their separate scanner policy; credential/personnel
protections are not relaxed. Exported profiles carry settings and personal
layers, never trust records, caches, manifest clones or credentials.

Public package metadata follows the `oa-cli` convention: repository
`https://github.com/AngelMsger/fx-devkit`, homepage
`https://angelmsger.github.io/fx-devkit/`, and the repository's `/issues` page.
These coordinates were inferred for publication; they do not prove provisioning
or deployment. Use Apache-2.0 consistently in package metadata, lockfiles and
license documentation, and include the full root LICENSE in distribution checks.
Keep npm-facing README links usable without shipping the documentation toolchain.

Registry coordinates come from `FX_REGISTRY`, not package metadata. Keep the
shared registry policy as the checked JavaScript implementation used by scripts
and compiled adapters. Publishing uses `scripts/publish.mjs`; the lifecycle guard
rejects direct publication. Package file lists own scanner coverage. Remotes,
tags and publication remain separate task effects; see the
[registry contract](docs/design/registry-configuration.md).

## Code, comments and documentation

Use English for code, comments, output and commits. Prefer named inputs/results,
readonly data, explicit narrowing and small modules with one responsibility.
Export the minimum; avoid `any`, nested ternaries and policy hidden in factories.
Functions name actions; boolean names state a predicate. Keep implementations
readable rather than splitting them only to satisfy a line limit.

A file begins with a short responsibility/contract paragraph. Command classes
normally need only their description. Inline comments explain a non-obvious
constraint, not the neighboring statement or another module's rationale.
If explanation dominates the implementation, improve the abstraction first.

README is the user entry point, CONTRIBUTING.md owns the public contribution
workflow, SECURITY.md owns reporting guidance, this file owns agent rules, and design pages
own current contracts, and `docs/cli/README.md` is generated syntax reference.
Keep one owner for each fact. Remove feature-history narration and resolved
blockers from maintained guidance. Keep team-specific plans, raw reports, traces and private source patches outside
this repository. Preserve their originals in the team's private evidence store.
Public validation notes describe scope and limits without identifying deployments,
accounts or business repositories.

## Public website and documentation consistency

`docs/website/` presents documentation for people using fx, not for the fx
maintainer. `docs/user-guide.md` owns user onboarding; README is the repository
entry point and must not be rendered wholesale into the user site. Only sources
explicitly approved in `docs/website/audience.mjs` may appear in `pages.mjs`.

Never publish AGENTS.md, CONTRIBUTING.md, website-maintenance instructions,
internal design/evaluation documents, fx package-release procedures, maintainer
validation checklists, personal preview bindings, or build-source metadata as user
documentation. Do not add indirect links to excluded documents from public pages,
translations, homepage sections, navigation or sitemaps. Explain how users operate
fx (including checking their own repositories with `fx release`), not how the
maintainer builds or publishes fx. Personal machine paths, preview project IDs and
credential configuration belong outside the public repository.

Build state stays in the ignored `docs/website/.build-state.json`, outside the
static output directory. The audience checks must reject non-user sources and
maintainer content in deployable HTML. Keep removed routes absent from fresh
build output; verify their removal after deployment.

Every feature addition, behavior change, removal or design-contract update MUST
update the affected external documentation in the same change. This includes
commands/flags, configuration/defaults, output/error contracts, setup steps,
compatibility/support boundaries and deprecations. A task is not complete while
implementation, design documents and public guidance disagree. For intentional
future designs, label them as planned and retain an accurate description of
current behavior rather than advertising unfinished work as available.

Update the owning user guide and README when affected; update homepage claims in
`docs/website/src/home.html` and navigation/descriptions in `docs/website/pages.mjs` when
affected. Regenerate `docs/cli/README.md` from command definitions for CLI changes.
If a change has no external impact, state why in its delivery or PR description.

Run `npm run docs:check`, `npm run site:build` and `npm run site:check` before
delivering affected changes. The website check verifies source freshness,
generated routes, internal links/anchors, local assets and JavaScript syntax.
GitHub Pages (including repository subpaths) is the deployment baseline. Keep
`SITE_BASE_PATH`, locale routes, assets, 404 navigation and canonical/hreflang URLs
consistent. The GitHub workflow validates root and subpath builds; PRs never deploy.
Do not introduce a proprietary hosting dependency or a server-side runtime.

The public site supports English, Japanese, Simplified Chinese and Traditional
Chinese (`en`, `ja`, `zh-Hans`, `zh-Hant`). English is the default UI language
and the technical source. The site root and unprefixed documentation routes must
serve English. Keep `x-default` pointing to English; do not auto-redirect based on
browser language, location or stored preferences. Other languages require an
explicit locale URL or language-menu selection.
Update localized guides and UI catalogs alongside affected English changes;
review and update `docs/website/i18n/translations.json` source digests only after
checking translation accuracy. Never bump digests merely to make CI pass.
Untranslated references must have an explicit English notice and `lang="en"`,
not silently appear as translated content. Commands, flags, identifiers and real
CLI output stay verbatim. Preserve the current page when switching languages.

Keep the site static, accessible, responsive and respectful of reduced-motion
preferences. Website dependencies and output remain separate from the CLI npm
package. Public pages must not include private manifests, real coordinates,
credentials or live evaluation evidence.

## Verification and delivery

Run the nearest meaningful regression tests while iterating, then the required
gates before delivery. Install website build dependencies with
`npm --prefix docs/website ci` after the root dependency install:

```text
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

Regenerate CLI docs after command changes. Test observable decisions, ownership
and failure recovery rather than snapshots of implementation mechanics. POSIX
or injected-input checks do not establish Windows support: native acceptance
uses `npm run check:windows` and separate host/cross-volume checks described in
[Windows](docs/design/windows.md). Keep unavailable native evidence explicit.

Use Conventional Commits and include an issue reference when one is available
and appropriate for public history (for example, `fix: handle missing configuration`).
Check the final diff and preserve unrelated work. Push only to the verified
`origin`, and only within the user's authorized task scope.
