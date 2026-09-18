// The generated regions of AGENTS.md: what an agent needs before it loads any Skill or
// asks fx anything. Facts that vary by person or machine — coordinates, credentials,
// versions, people — stay out; the text points at the fx command that answers instead.

import {
  CAPABILITY_INFO,
  knownCapability,
  type Capability,
  type CapabilityName,
} from '../capability.js';
import type { Binding, PlatformBinding } from '../manifest/providers.js';
import type { Environments, Workspace } from '../manifest/types.js';
import type { ResolvedTool } from '../toolchain/resolve.js';

export const REGIONS = [
  'project-index',
  'capabilities',
  'environments',
  'ask-fx',
  'team-skills',
] as const;
export type Region = (typeof REGIONS)[number];

export interface TeamSkillEntry {
  readonly name: string;
  readonly description: string;
  readonly source: string;
}

export interface TemplateInput {
  readonly teamSkills?: readonly TeamSkillEntry[];
  readonly workspace: Workspace;
  readonly environments: Environments | undefined;
  readonly bindings: readonly Binding[];
  readonly platforms: readonly PlatformBinding[];
  readonly tools: readonly ResolvedTool[];
  readonly toolsOf: (provider: string) => readonly string[];
}

export function renderAll(input: TemplateInput): Record<Region, string> {
  return {
    'project-index': projectIndex(input.workspace),
    capabilities: capabilities(input),
    environments: environments(input.environments),
    'ask-fx': askFx(),
    'team-skills': teamSkillIndex(input.teamSkills ?? []),
  };
}

export function projectIndex(workspace: Workspace): string {
  const groups = new Map<string, Workspace['repos']>();
  for (const repo of workspace.repos) {
    const tag = repo.tags?.[0] ?? 'other';
    groups.set(tag, [...(groups.get(tag) ?? []), repo]);
  }
  const lines = [
    '## Repositories',
    '',
    'One line per repository, grouped by its first tag. `fx repo show <name>` has the rest.',
  ];
  for (const [tag, repos] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      '',
      `### ${tag}`,
      '',
      '| Repository | Project | Description |',
      '| --- | --- | --- |',
    );
    for (const repo of repos) {
      const project = repo.project ?? workspace.defaults.upstream_project ?? '';
      lines.push(`| \`${repo.name}\` | ${project} | ${cell(repo.desc)} |`);
    }
  }
  return lines.join('\n');
}

const WHEN: Partial<Record<Capability, string>> = {
  'code-host': 'read or fork a repository, open a pull request',
  'issue-tracker': 'find or update a work item',
  'knowledge-base': 'read team documentation',
  im: 'reach a person',
  'error-tracker': 'look at runtime errors of a service',
  'log-store': 'search the logs of a service',
  ci: 'check a build or its console output',
  cluster: 'see what is running (read-only)',
};

export function capabilities(input: TemplateInput): string {
  const lines = [
    '## Capabilities',
    '',
    'What the workspace can reach, who provides it, and the command to run **before** using the tool. `fx can` answers whether it works on this machine right now and explains what is missing when it does not; `fx where <repo> --env <env>` answers per platform for one repository, with the coordinate.',
    '',
    '| Need to | Capability | Provider | Tool | Ask fx first |',
    '| --- | --- | --- | --- | --- |',
  ];
  const workspaceRows = input.bindings
    .filter((b) => b.provider !== null)
    .map((b) => row(b.capability, b.provider ?? '', input, `fx can ${b.capability}`));
  const platformRows = input.platforms
    .filter((b) => b.provider !== null)
    .map((b) =>
      row(
        b.capability,
        b.provider ?? '',
        input,
        `fx where <repo> --env <env> --platform ${b.platform}`,
      ),
    );
  lines.push(...workspaceRows, ...platformRows);
  lines.push(
    '',
    'People and ownership are not a capability: `fx member show <name>`; `fx repo show <repo>` names the owners.',
  );
  return lines.join('\n');
}

function row(
  capability: CapabilityName,
  provider: string,
  input: TemplateInput,
  command: string,
): string {
  const known = knownCapability(capability);
  const when = known === null ? capability : (WHEN[known] ?? CAPABILITY_INFO[known].desc);
  const tools = input
    .toolsOf(provider)
    .map((name) => input.tools.find((t) => t.name === name)?.binary ?? name)
    .map((t) => `\`${t}\``)
    .join(', ');
  return `| ${when} | ${capability} | ${provider} | ${tools} | \`${command}\` |`;
}

export function environments(doc: Environments | undefined): string {
  const lines = ['## Environments', ''];
  if (doc === undefined) {
    lines.push('This workspace declares no environments.');
    return lines.join('\n');
  }
  lines.push(
    'Names and what each one is. Coordinates (projects, streams, jobs, namespaces) are not written here: `fx where <repo> --env <env>` derives them from the manifest.',
    '',
    '| Environment | Label | Platforms | Note |',
    '| --- | --- | --- | --- |',
  );
  for (const [name, env] of Object.entries(doc.envs)) {
    lines.push(
      `| \`${name}\` | ${cell(env.label)} | ${Object.keys(env.platforms ?? {}).join(', ')} | ${cell(env.note)} |`,
    );
  }
  return lines.join('\n');
}

export function askFx(): string {
  return [
    '## Ask fx',
    '',
    'Start with the read-only command `fx self info --format json`. Verify `name` is `@fx/devkit` (internal) or `@angelmsger/fx` (public) and check `version`, then read `SKILL.md` inside the returned `bundled_skill` directory. A valid response establishes the entry for this task; do not repeat wrapper, package-file or `--version` probes for the same entry. A matching executable name or a global Skill copy alone does not establish identity.',
    '',
    'If the command is missing, cannot start or returns a different identity, use `command -v fx` (or the shell equivalent) and inspect the resolved executable/package. Read the manifest source README for the team installation source. In a derived guide the first-line `fx:derived from` marker locates that source; otherwise use this manifest checkout. This recovery works without fx.',
    '',
    'For recovery, use only a verified installation or a local checkout identified by package.json as `@fx/devkit` or `@angelmsger/fx` with bin `fx`. Check its runtime requirements and README; an available build can run as `node <checkout>/bin/fx.js` without global installation. If runtime/dependencies/build are missing, perform authorized local preparation from that README. Do not guess a package registry, publication state, credentials or a checkout outside this workspace. If no usable source is documented or reachable, ask for that specific source/access and retain the original task.',
    '',
    'After recovering or changing the entry, repeat `self info --format json` and load its bundled Skill. Use the verified entry with `FX_SKILL_LOADED=1` and `FX_SKILL_VERSION` set to the returned `bundled_skill_version`. A startup failure is a runtime/PATH/source problem to diagnose; do not repeat an unchanged failure.',
    '',
    'Coordinates, people, tool state and machine setup are answered by `fx`, always with `--format json` when an agent is asking. Do not guess any of them.',
    '',
    '`fx` answers; you act. It prints the command a coordinate resolves to and never runs it — running it is yours to do, once `fx` says the platform is ready.',
    '',
    '| Question | Command |',
    '| --- | --- |',
    '| Where are the errors / logs / builds / pods of a service, and can I use them now | `fx where <repo> --env <env>` |',
    '| Can I use a capability or tool right now | `fx can <capability\\|tool> [--env <env>]` |',
    '| Who is this person; who owns this repository | `fx member show <name>`; `fx repo show <repo>` |',
    '| Is this machine set up; what is missing | `fx doctor`; `fx login --list` |',
    '| What environments exist | `fx env list`; `fx env show <env>` |',
    '',
    'For a non-ready answer or `LOGIN_REQUIRED`, follow the Skill recovery flow: inspect the cause, perform authorized local installation/setup, hand off only necessary human interaction, then re-check the same capability and resume the original task. A handoff is guidance, not authorization: preserve read-only posture and exact-command trust; do not repeat an unchanged failure or overwrite existing configuration without approval and backup.',
  ].join('\n');
}

function cell(text: string | undefined): string {
  return (text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function teamSkillIndex(skills: readonly TeamSkillEntry[]): string {
  const lines = [
    '## Team Skills',
    '',
    'The fx-workspace companion Skill teaches the fx CLI and readiness recovery. These manifest Skills supply team workflows. Read the matching SKILL.md when its description fits the task; follow its references only as needed. Do not load every Skill at once.',
    '',
    'These source links provide discovery even when native project Skill delivery is unavailable. A listing does not prove installation, host trust or loading. Start the agent at the workspace root; child-repository sessions are not covered by this guide.',
    '',
  ];
  if (skills.length === 0) return [...lines, 'This manifest contains no team Skills.'].join('\n');
  lines.push('| Skill | When to use | Read |', '| --- | --- | --- |');
  for (const skill of skills) {
    const target = skill.source.split('/').map(encodeURIComponent).join('/');
    lines.push(`| ${cell(skill.name)} | ${cell(skill.description)} | [SKILL.md](<${target}>) |`);
  }
  return lines.join('\n');
}
