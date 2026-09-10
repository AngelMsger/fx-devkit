// One tool in full: the resolved entry, where each field came from, and
// which providers depend on it.

import type { ResolvedTool } from '../../domain/toolchain/resolve.js';

import { selectTools } from './select.js';

export interface ToolShowInput {
  readonly tools: readonly ResolvedTool[];
  readonly name: string;
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
  readonly auth: { command: readonly string[]; docs: string | null } | null;
  readonly setup_steps: readonly { id: string; kind: string; title: string }[];
  readonly fields: Readonly<Record<string, 'base' | 'patch'>>;
  readonly depended_on_by: readonly string[];
}

export class ToolShow {
  execute(input: ToolShowInput): ToolDetail {
    const tool = selectTools(input.tools, [input.name])[0] as ResolvedTool;
    const fields: Record<string, 'base' | 'patch'> = {};
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
          : { command: tool.auth.command, docs: tool.auth.docs ?? null },
      setup_steps: tool.setup.map((s) => ({ id: s.id, kind: s.kind, title: s.title })),
      fields,
      depended_on_by: input.dependants[tool.name] ?? [],
    };
  }
}
