# Recording coordinate probes

`fx where <repo> --env <env> --platform <platform> --probe --record`
records a definite result in the registered source's environments.yaml. The
source remains editable and can then be contributed through source push.
`--dry-run` performs no readiness check, probe, lock acquisition or file write;
its `after` value is null because no result has been observed.

## Scope and evidence

A probe that uses repository-derived variables, or an environment/platform with
repository overrides or existing scoped observations, records under
`envs.<env>.platforms.<platform>.observations.<repo>`. The entry contains only
confidence, a dated note and a fingerprint of coordinate values. It does not copy
vars. A matching observation affects only that repository; a changed coordinate
invalidates the old observation. Deliberately uncovered coordinates stay uncovered.

Only repository-independent probes with no affected repository overrides update
the environment/platform's existing confidence and note. That confidence remains
a declared, dated coordinate fact, separate from current login/readiness checks.
Personal-only and dynamically derived manifest repositories cannot write shared
observations. Observation keys must name shared repositories.

The provider supplies its original probe template alongside the executable
vector. Recording writes the template and UTC date, never expanded machine paths,
variable values, native stderr, or login results. Inline credential-shaped values
are refused before fingerprints are recorded. Definite reachable/missing results
map to verified/not_found; other results retain the manifest and provide a handoff.
Unclassified native failures stay unknown rather than being guessed from text.

Jenkins probes honor an explicitly selected context. Job and stream identifiers
follow a literal argument separator. The Kubernetes probe queries the named
namespace, not a potentially empty collection of deployments. No probe runs a
manifest-supplied command template.

## File safety

Both workspace and environment documents must match the loaded context. The
workspace lease is acquired only after any readiness interaction; it serializes
recording with lifecycle synchronization and source contributions. Both documents
are rechecked before and after the actual probe, then the environment file is
atomically compared and replaced through the existing projection store.

The editor splices only target string values or missing mapping entries using
YAML parser ranges. Unrelated bytes, comments, flow mappings and line endings
are retained. Shared anchors and aliases are refused rather than changing another
scope. Existing note content remains, and an identical same-day record is not
rewritten. Both the prospective shape and final document are schema-validated.

Unit and built-binary tests cover conditional preview, uncertain outcomes,
explicit scope, stale snapshots, conflicting writes, literal identifiers, and
absence of expanded machine values in notes. These tests use temporary sources
and fake platform CLIs; they are not production permission evidence.
