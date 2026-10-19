# Working on fx-devkit

Read this file before changing the repository. It defines engineering constraints;
[architecture and contracts](docs/design/README.md) explain the implementation,
and [validation](docs/validation.md) defines checks and support boundaries.

## Repository and task boundaries

This repository has an independent history. Never import predecessor history,
private manifests, live evaluation evidence or business patches. Keep migration
provenance in a private record outside this repository.

Preserve existing changes and verify repository identity and remotes before
committing or pushing. The public GitHub repository `AngelMsger/fx-devkit` is
canonical; a checkout fx clones for the agent-clis family workspace has it as
`upstream`. Every change merges into its `main` through a GitHub pull request:
push a topic branch to it, or to a personal fork when you lack write access, and
never push `main` directly. A scheduled job mirrors GitHub, release tags included,
into the internal shared repository, whose Jenkins job releases the internal
channel and therefore runs behind GitHub. Never push to or merge in the mirror.
Never merge predecessor or unrelated histories. Keep actual remote URLs in Git
configuration.

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
registration in composition. The descriptor is also where a provider declares what a
manifest may say about it: the shared service settings and authentication methods it
accepts, and the names a schema 1 document writes in place of its id. Validation reads
those from the catalog it is handed, never from a table of its own. Application code
does not name providers.
`AgentHostSpec` is the sole inventory of native agent capabilities and paths;
protocol adapters own serialization. Platform differences belong to adapters,
not provider-specific application branches.

## Command and Agent contracts

- Default output is human; `--format json` and `FX_FORMAT=json` serve agents.
  stdout contains data only. Notices, progress and diagnostics go to stderr.
  Errors use the same JSON envelope in every output format; only a terminal in
  the human format reads it as text. An error raised before parsing follows the
  format the invocation asks for, and an undecided format means the envelope.
- Decoration belongs to the stream, not the format. Only a terminal receives
  colour, symbols and width fitting, each stream decided on its own; a pipe, a
  file and every machine format stay plain and byte-stable, and no environment
  variable changes that. A human view states
  what its text means through `Display` roles and marks. It never writes a control
  sequence, picks a colour or measures a terminal itself.
- A person watching a terminal must always see that fx is working. The status line
  is fed by the command base and the one subprocess port, so start every external
  call through `Process` and write to the streams only through the renderer; a
  question goes through the prompter. Count work of known size with `Tally`. A call
  without a deadline keeps the terminal and may ask there, so the line is not
  redrawn under it; give a read-only probe a deadline. What goes through `Activity`
  is never a record: programs keep reading `Reporter` records, and a change for
  watchers must not change what a pipe or JSON receives.
- Collections use `{items, has_more, next?}`. Absent facts are explicit values;
  never confuse not configured, not covered and a failed check. Preserve
  structured errors when returning batch or report results.
- Use `DevkitError`; keep released codes and category exit codes stable. Every
  error carries recovery steps, and `LOGIN_REQUIRED` carries a user handoff.
  Unknown commands, config keys and resource selectors offer nearest matches.
- Resolve settings as explicit flag > environment > file > default. Effective
  configuration and `--explain` must describe that same invocation. Keep parser
  metadata, routing, completion and generated help consistent. The parser reads a
  command's own static members only, so `strict`, `args` and `flags` stay declared
  on each command even where a shared base would carry identical values. Register compatibility
  names in the alias map; primary discovery uses canonical commands, while typed
  aliases retain execution and flag completion.
- Every write has `--dry-run`: build its plan first, then gate actual effects
  through `assertWritable`. Preserve `read_only` / `FX_READ_ONLY` and the explicit
  one-invocation `--allow-writes` override. Reads are not write-gated.
- No TTY or `--no-input` means no waiting: missing input becomes `INPUT_REQUIRED`
  or `CONFIRM_REQUIRED`. A command vector the team patch authors passes through
  `TrustGate`, and a changed one requires new trust. Bundled commands run freely
  whatever service settings the manifest fills in: where a companion may send
  credentials is the companion's contract, not a decision fx takes for it. Install
  vectors are assembled from installer/package data, never supplied as shell code.
- Manual/file setup steps belong to the user and are followed by verification.
  Authorized local preparation may be assisted, but acknowledgement alone never
  establishes readiness. `doctor --fix` is limited to local prepare steps and managed
  projections; report repair attempts separately from subsequent verification.
- Init/sync/doctor share `preparation.state` and explicit scope. Ready returns zero;
  incomplete required work returns 12 with all blockers and executable next actions.
  Optional native activation stays separate. Doctor's coverage is diagnostic coverage;
  workspace registration availability is not preparation readiness. Release retains
  its independent `ok`/`complete` checklist and exit-zero report contract.
- Tools schema 3 run steps declare `phase: prepare` or `phase: authenticate`.
  Init, every explicit sync and doctor --fix execute only authorized local prepare
  steps, verify before and after, and leave personal authentication/manual files to
  the person. Background hooks only check them.
  Init --resume uses the managed source and current selection, never reimports it.

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
- `init` writes workspace data only into the user-selected target or registered directories.
  Tools explicitly marked `install_on_init` may also install missing global packages
  through approved installer/probe vectors before repository and Skill synchronization.
  Explicit service declarations also let init/sync prepare public companion settings
  through the companions' native commands. Credentials and personal identities stay in each
  member's own CLI storage; never distribute them through service declarations.
  Configuration conflicts preserve existing values. Background hooks only check services.
  Existing installations are preserved; ordinary sync and lifecycle hooks never install packages.
  `repo remove` removes a reference, not files. Import reads checkouts and writes
  only to an explicit output outside the imported directory.
- Companion package operations persist immutable checkpoints in the personal tool
  history ledger before execution and after outcomes. Keep audit failures visible;
  reconcile all registered manifests before suggesting manual removal. Sync and
  doctor never uninstall packages or adopt unrecorded PATH tools. Keep installation
  origin separate from definition provenance; updating external tools never transfers
  ownership. Legacy evidence remains unknown rather than inferred.
- Source prose is preserved; missing regions are appended to generated target guides.
  Only marked guides, a marked `go.work`, owned Skill links/copies and receipted host
  resources are managed. Preserve foreign files/entries; supported replacement requires
  confirmation and backup. Recheck plans before writing and preserve recovery
  journals rather than guessing through unrecognized state.
- Keep stored schemas aligned with their domain types and preserve each store's
  read/write and compatibility policy. The [personal-store contract](docs/design/runtime.md#personal-stores)
  distinguishes strict configuration inputs from forward-compatible metadata
  and versioned ledgers; do not generalize one store's policy to all personal files.
- Team Skills use one directory link per selected agent to the manifest's Skills
  tree. Windows uses junctions; do not silently substitute copies. The bundled
  fx Skill is a copy recognized by its name and version frontmatter. An unversioned
  same-name directory is foreign.
- Standalone Skill commands follow the agent-clis target surface and work without a workspace.
  Explicit install refreshes recognized copies; init/sync never downgrade them.
  Shared manifest Skill sources are not companion installation destinations.
  The generated team-skills guide region owns the root discovery catalog.
- Lifecycle hooks live only at the registered root. Dispatch reads local state
  under an independent deadline and fails open. Background work may refresh the
  manifest, docs, Skills and readiness observations; it never syncs business
  repositories, confirms trust, overrides read-only posture or publishes changes.
  No high-frequency/transcript-processing behavior is added implicitly.
- Shared coordinates live in the private manifest. Generated guides carry routes
  and references, not duplicated addresses, versions or people. Maintained team
  rules remain prose; malformed/unknown generated regions are preserved.
- `.workbench/` at the root belongs to the person and their agents. fx names it in
  the derived guide and recognizes it when inspecting the root; it never creates,
  moves or removes anything there. Stray root entries are reported, never repaired.
- `where` prints coordinates; it does not execute them. Provider query ports are
  read-only. Generated kubectl vectors are confined to `get`, `describe`, `logs`,
  `top`, `auth can-i` and `config get-contexts`.

See [lifecycle](docs/design/lifecycle.md), [harness](docs/design/harness.md),
[import](docs/design/import.md), [root layout](docs/design/root-layout.md) and
[source contributions](docs/design/source-contributions.md) for their complete
behavioral contracts.

## Sensitive data and distribution

The generic CLI ships no team manifest. `members.yaml` is a sensitive document
tracked in the private manifest repository; a nested directory is not an access
boundary. Require its `sensitive: true` marker. People results reach stdout only,
never caches, logs or notices, and an unreadable document has no stale fallback.
The package boundary scanner must run against actual built distribution paths.

Internal hosts, registries, repository coordinates, credentials and personnel
identifiers do not belong in generic source, fixtures, errors or distributed
assets. Use `example.com` examples. Public SSH examples omit deployment-specific
ports; a test that needs a non-default port uses the designated synthetic port
`12345`. Do not carry real service ports over when anonymizing a hostname.
`npm run check:examples` enforces the public-example convention without recording
internal coordinates in a committed denylist. Private-manifest contributions may contain
internal coordinates under their separate scanner policy; credential/personnel
protections are not relaxed. Exported profiles carry settings and personal
layers, never trust records, caches, manifest clones or credentials.

The project is always `fx-devkit` and its binary is always `fx`. Maintain two
channels from the same code: internal `@fx/devkit` through Jenkins/private Registry
and private Dokploy; public `@angelmsger/fx` through GitHub Actions/npmjs and GitHub
Pages. The source checkout defaults to internal metadata. CI selects metadata with
`scripts/select-distribution.mjs`; never commit public build metadata over the
internal baseline. The public workflows (`ci.yml`, `release.yml`, `pages.yml`) follow
the sibling CLIs' release contract; see [releasing](docs/releasing.md). User documentation
must render the matching installation commands for its channel in all four languages.
Keep private endpoints and credentials in platform configuration, never generic
source or package metadata. Use Apache-2.0 consistently in both distributions.

Runtime Registry discovery follows npm's effective user/global scope and default
configuration, with `FX_REGISTRY` as an optional override. Project npmrc cannot
redirect global self-update. Publication still requires an explicit private
coordinate or Jenkins Managed npmrc; package metadata carries no Registry. Keep the
shared registry policy, version grammar and boundary scanner as the checked
JavaScript implementations used by scripts and compiled code, so a gate that runs
before the build decides the same way fx does and no script loads its logic from
build output. Delivery scripts belong to the type-checked project and the full
rule set; JavaScript opts in per file with `// @ts-check`.
Publishing uses `scripts/publish.mjs`; the lifecycle guard
rejects direct publication. Package file lists own scanner coverage. Remotes,
tags and publication remain separate task effects; see the
[registry contract](docs/design/registry-configuration.md).

## Code, comments and documentation

Use English for code, comments, output and commits. Prefer named inputs/results,
readonly data, explicit narrowing and small modules with one responsibility.
Export the minimum; avoid `any`, nested ternaries and policy hidden in factories.
Functions name actions; boolean names state a predicate. Keep implementations
readable rather than splitting them only to satisfy a line limit.

An error `message` is a headline: it starts with a capital letter, unless it
starts with an identifier, path, command or flag that keeps its own spelling,
and it carries no trailing period; `hint` and `next_steps` are sentences and do.

A file begins with a short responsibility/contract paragraph. Command classes
normally need only their description. Inline comments explain a non-obvious
constraint, not the neighboring statement or another module's rationale.
If explanation dominates the implementation, improve the abstraction first.

README is the user entry point, CONTRIBUTING.md owns the contribution workflow,
SECURITY.md owns reporting guidance, this file owns agent rules, design pages own
current contracts, [releasing](docs/releasing.md) owns both delivery channels, and
`docs/cli/README.md` is generated syntax reference.
Keep one owner for each fact. A flag's meaning lives in its definition, which feeds
`--help` and the generated reference; other documents link there rather than
restate it. Remove feature-history narration and resolved
blockers from maintained guidance. Keep team-specific plans, raw reports, traces and private source patches outside
this repository. Preserve their originals in the team's private evidence store.
Public validation notes describe scope and limits without identifying deployments,
accounts or business repositories.

## User website and documentation consistency

`docs/website/` presents documentation for people using fx, not for the fx
maintainer. `docs/user-guide.md` owns user onboarding; README is the repository
entry point and must not be rendered wholesale into the user site. Only sources
explicitly approved in `docs/website/audience.mjs` may appear in `pages.mjs`.

Never publish AGENTS.md, CONTRIBUTING.md, website-maintenance instructions,
internal design/evaluation documents, fx package-release procedures, maintainer
validation checklists, personal preview bindings, or build-source metadata as user
documentation. Do not add indirect links to excluded documents from public pages,
translations, homepage sections, navigation or sitemaps. Explain how users operate
fx (including checking their own repositories with `fx release check`), not how the
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
The internal channel uses Dokploy with `docs/website/Dockerfile` as its static
deployment baseline. The public channel uses the GitHub Pages workflow. Both channels
check root and subpath builds; the supplied NGINX container
serves at the origin root. Keep locale routes, assets, 404 navigation and
canonical/hreflang URLs consistent. Only reviewed main revisions deploy. Hosting
configuration and maintainer delivery procedures never enter user documentation.
Keep the website static without a server-side application runtime.

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

For visual website changes, open a running local preview for the user to inspect.
Wait for the user's approval before pushing or deploying the change. Screenshots
supplement the live preview; they do not replace this review step.

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
and failure recovery rather than snapshots of implementation mechanics. Before
adding a regression test, identify its recurring user scenario, consequence and
existing coverage owner; a historical bug alone does not justify another case.
Remove obsolete or duplicate cases instead of preserving implementation milestones.
Use the [test-value guidance](docs/validation.md#test-value-and-ownership) to choose
the narrowest layer that proves the behavior. POSIX
or injected-input checks do not establish Windows support: native acceptance
uses `npm run check:windows` and separate host/cross-volume checks described in
[Windows](docs/design/windows.md). Keep unavailable native evidence explicit.

Use Conventional Commits and include an issue reference when one is available
and appropriate for public history (for example, `fix: handle missing configuration`).
Check the final diff and preserve unrelated work. Push only topic branches to the
verified GitHub repository or fork, and only within the user's authorized task scope.

## Existing-login reuse

Family adapters run the companion's `auth reuse` before credential readiness, in
init and every explicit sync; fx never reads or copies native secrets or keeps a
parallel identity store. [Setup](docs/design/setup.md#existing-login-reuse) owns
the full contract.
