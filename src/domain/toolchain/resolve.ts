// From the merged toolchain to what fx can act on for each tool: inheritance resolved
// (entry → defaults → built-in), npm specs completed from the scope, and each executable
// field marked baseline or team patch, which is what decides whether it needs trust.

import { DEFAULTS_KEY, type Origin, type Provenance } from '../manifest/overlay.js';
import type { DeclaredSetupStep, InstallVia, Tool, Toolchain } from '../manifest/types.js';

export interface InstallMethod {
  readonly via: InstallVia;
  readonly spec?: string | undefined;
  readonly registry?: string | undefined;
}

export type VectorField = 'versionArgs' | 'install' | 'skill' | 'auth' | 'setup';

export interface ResolvedTool {
  readonly name: string;
  readonly binary: string;
  readonly desc?: string;
  readonly docs?: string;
  readonly required: boolean;
  readonly enabled: boolean;
  // The workspace named this tool, as opposed to inheriting it from the baseline.
  readonly declared: boolean;
  readonly minVersion?: string;
  readonly installOnInit?: boolean;
  readonly versionArgs: readonly string[];
  readonly install: readonly InstallMethod[];
  readonly skill?: {
    readonly command: readonly string[];
    readonly agentFlag?: string;
    readonly dirFlag?: string;
  };
  readonly auth?: { readonly command: readonly string[]; readonly docs?: string };
  readonly setup: readonly DeclaredSetupStep[];
  readonly origins: Readonly<Record<VectorField | 'binary', Origin>>;
  // Every field path the patch contributed, for `tool list` and `tool show`.
  readonly patchedFields: readonly string[];
  readonly baseFields: readonly string[];
}

const FIELD_PATHS: Record<VectorField, string> = {
  versionArgs: 'version_args',
  install: 'install',
  skill: 'skill',
  auth: 'auth',
  setup: 'setup',
};

export function resolveTools(
  toolchain: Toolchain,
  provenance: Provenance,
  declared: readonly string[] = [],
): ResolvedTool[] {
  const named = new Set(declared);
  return toolchain.tools.map((tool) => resolveTool(tool, toolchain, provenance, named));
}

function resolveTool(
  tool: Tool,
  toolchain: Toolchain,
  provenance: Provenance,
  declared: ReadonlySet<string>,
): ResolvedTool {
  const defaults = toolchain.defaults ?? {};
  const origin = (field: VectorField): Origin => {
    const own = originOf(provenance[tool.name], FIELD_PATHS[field]);
    const inherited = originOf(provenance[DEFAULTS_KEY], FIELD_PATHS[field]);
    const ownsField = (tool as Record<string, unknown>)[FIELD_PATHS[field]] !== undefined;
    return ownsField ? own : inherited;
  };
  const binaryOrigin = originOf(
    provenance[tool.name],
    tool.binary === undefined ? 'name' : 'binary',
  );
  const skill = tool.skill ?? defaults.skill;
  const auth = tool.auth ?? defaults.auth;
  return {
    name: tool.name,
    binary: tool.binary ?? tool.name,
    ...(tool.desc === undefined ? {} : { desc: tool.desc }),
    ...(tool.docs === undefined ? {} : { docs: tool.docs }),
    required: tool.required ?? false,
    enabled: tool.enabled ?? true,
    declared: declared.has(tool.name),
    installOnInit: tool.install_on_init ?? defaults.install_on_init ?? false,
    ...(tool.min_version === undefined ? {} : { minVersion: tool.min_version }),
    versionArgs: tool.version_args ?? defaults.version_args ?? ['--version'],
    install: (tool.install ?? defaults.install ?? []).map((m) =>
      completeSpec(m, tool.name, defaults.npm_scope),
    ),
    ...(skill === undefined || skill.command.length === 0
      ? {}
      : {
          skill: {
            command: skill.command,
            ...(skill.agent_flag === undefined ? {} : { agentFlag: skill.agent_flag }),
            ...(skill.dir_flag === undefined ? {} : { dirFlag: skill.dir_flag }),
          },
        }),
    ...(auth === undefined || auth.command.length === 0
      ? {}
      : {
          auth: { command: auth.command, ...(auth.docs === undefined ? {} : { docs: auth.docs }) },
        }),
    setup: tool.setup ?? [],
    patchedFields: fieldsWithOrigin(provenance[tool.name], 'patch'),
    baseFields: fieldsWithOrigin(provenance[tool.name], 'base'),
    origins: {
      binary: binaryOrigin,
      versionArgs: origin('versionArgs'),
      install: origin('install'),
      skill: origin('skill'),
      auth: origin('auth'),
      setup: origin('setup'),
    },
  };
}

// Initialization installs the tools the manifest opts in, unless it also disables them.
export function installsOnInit(tool: Pick<ResolvedTool, 'enabled' | 'installOnInit'>): boolean {
  return tool.enabled && tool.installOnInit === true;
}

export function commandOrigin(
  tool: Pick<ResolvedTool, 'origins'>,
  argumentsFrom?: Exclude<VectorField, 'install'>,
): Origin {
  return tool.origins.binary === 'patch' || tool.origins[argumentsFrom ?? 'binary'] === 'patch'
    ? 'patch'
    : 'base';
}

function fieldsWithOrigin(
  fields: Readonly<Record<string, Origin>> | undefined,
  origin: Origin,
): string[] {
  return Object.entries(fields ?? {})
    .filter(([, o]) => o === origin)
    .map(([key]) => key)
    .sort();
}

// A field is patch-origin when it, or anything under it, came from the patch.
function originOf(fields: Readonly<Record<string, Origin>> | undefined, path: string): Origin {
  if (fields === undefined) return 'base';
  return Object.entries(fields).some(
    ([key, origin]) => origin === 'patch' && (key === path || key.startsWith(`${path}.`)),
  )
    ? 'patch'
    : 'base';
}

function completeSpec(
  method: InstallMethod,
  name: string,
  scope: string | undefined,
): InstallMethod {
  if (method.via !== 'npm' || method.spec !== undefined) return method;
  return { ...method, spec: scope === undefined ? name : `${scope}/${name}` };
}
