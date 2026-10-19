# Harness projections

The optional `manifest/harness.yaml` declares team MCP resources and enables
workspace rules pointers.
`AgentHostSpec` owns native capabilities and locations; adapters own serialization.
Application code does not branch on agent names.

## References and readiness

Environment bindings and HTTP headers contain variable references only. Unsupported
native mappings produce a handoff. `fx can mcp:<name>` checks binary availability,
required variables and an optional read-only companion check; it never starts the
MCP server. A declared JSON assertion must pass as well as the exit-code check.
`--agent` also checks that the native projection matches its ownership record.
Native host activation remains separate from service readiness.

Startup and check vectors use the workspace trust store. The trust
identity includes the resource and reference bindings, without environment values.
Projection requires trust because the native host may subsequently run the command.

## Ownership

Reconciliation preserves foreign entries and unchanged bytes. A receipt proves
ownership of a native entry; a name or marker alone does not. Pending writes store
before/after hashes so interrupted updates can recover without caching configuration.
Intervening user edits are conflicts. Shared resources remain while another selected
agent needs them.

JSON/JSONC edits target individual properties. TOML edits target managed fragments
and validate the complete document without serializing it again. Rules contain a
fixed pointer to AGENTS.md and fx queries, with no copied prose or coordinates.

## Entry points

`sync` projects MCP resources and derives rules with docs. `doctor` inspects their
state and reuses reconciliation for repair. `agent unpick` cleans owned resources
across registered workspaces. Dry-run previews do not write files or trust records.

Protocol checks and activation limits are recorded in
[validation guidance](../validation.md#live-integrations).
