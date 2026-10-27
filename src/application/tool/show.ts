// One tool in full: the resolved entry, why the workspace has it, where each field came
// from, and which providers depend on it.

import type { Origin } from '../../domain/manifest/overlay.js';
import type { JsonExpectation } from '../../domain/setup/types.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { ToolSource, ToolSourceKind } from '../../domain/toolchain/select.js';
import type { CommandGuidance } from '../workspace/guidance.js';

import { selectTools } from './select.js';

export interface ToolShowInput extends CommandGuidance {
  readonly tools: readonly ResolvedTool[];
  readonly name: string;
  readonly sources: ReadonlyMap<string, ToolSource>;
  // Provider ids by tool name, from the registry.
  readonly dependants: Readonly<Record<string, readonly string[]>>;
}

export interface ToolDetail {
  readonly name: string;
  readonly binary: string;
  readonly desc: string | null;
  readonly docs: string | null;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly min_version: string | null;
  readonly install_on_init: boolean;
  readonly version_args: readonly string[];
  readonly install: readonly { via: string; spec: string | null; registry: string | null }[];
  readonly skill: {
    command: readonly string[];
    agent_flag: string | null;
    dir_flag: string | null;
  } | null;
  readonly auth: {
    command: readonly string[];
    json: JsonExpectation | null;
    login: readonly string[] | null;
    docs: string | null;
  } | null;
  readonly setup_steps: readonly { id: string; kind: string; title: string }[];
  readonly fields: Readonly<Record<string, Origin>>;
  readonly source: ToolSourceKind;
  readonly bound_by: readonly string[];
  readonly depended_on_by: readonly string[];
}

export class ToolShow {
  execute(input: ToolShowInput): ToolDetail {
    const tool = selectTools(input.tools, [input.name], input)[0] as ResolvedTool;
    const fields: Record<string, Origin> = {};
    for (const key of tool.baseFields) fields[key] = 'base';
    for (const key of tool.patchedFields) fields[key] = 'patch';
    return {
      name: tool.name,
      binary: tool.binary,
      desc: tool.desc ?? null,
      docs: tool.docs ?? null,
      required: tool.required,
      enabled: tool.enabled,
      min_version: tool.minVersion ?? null,
      install_on_init: tool.installOnInit ?? false,
      version_args: tool.versionArgs,
      install: tool.install.map((m) => ({
        via: m.via,
        spec: m.spec ?? null,
        registry: m.registry ?? null,
      })),
      skill:
        tool.skill === undefined
          ? null
          : {
              command: tool.skill.command,
              agent_flag: tool.skill.agentFlag ?? null,
              dir_flag: tool.skill.dirFlag ?? null,
            },
      auth:
        tool.auth === undefined
          ? null
          : {
              command: tool.auth.command,
              json: tool.auth.json ?? null,
              login: tool.auth.login ?? null,
              docs: tool.auth.docs ?? null,
            },
      setup_steps: tool.setup.map((s) => ({ id: s.id, kind: s.kind, title: s.title })),
      fields,
      source: input.sources.get(tool.name)?.kind ?? 'catalog',
      bound_by: input.sources.get(tool.name)?.boundBy ?? [],
      depended_on_by: input.dependants[tool.name] ?? [],
    };
  }
}
