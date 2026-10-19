// What a preparation stage and a doctor group report, and how their evidence is bound to
// the registered workspace and an executable recovery action.
import {
  preparation,
  preparationCheck,
  type Preparation,
  type PreparationCheck,
  type PreparationScope,
  type PreparationAction,
} from '../domain/preparation.js';
import type { Finding } from '../domain/report.js';
import type { SetupStep } from '../domain/setup/types.js';

import type { WritePosture } from './safety/posture.js';
import { toolRecoveryCommand, type ToolStatus } from './tool/check.js';
import { workspaceToolScope } from './tool/scope.js';
import type { WorkspaceDeps } from './workspace/deps.js';

type Workspace = Pick<WorkspaceDeps, 'ctx'>;

export type StageSummary = Readonly<Record<string, number | string>>;

// What one stage of preparing a workspace reports: its evidence, its counts and the rows
// behind them.
export interface StageResult<Details extends object = object> {
  readonly checks: readonly PreparationCheck[];
  // Explicit stage selection requires its requested effects, while native activation stays advisory.
  readonly operationChecks?: readonly PreparationCheck[];
  readonly summary: StageSummary;
  readonly details?: Details;
}

// The group a lifecycle resource adds to the doctor report, and the repair `doctor --fix`
// runs for it.
export interface DoctorExtension {
  readonly group: string;
  readonly check: () => Promise<readonly Finding[]>;
  readonly fix?: (input: {
    readonly dryRun: boolean;
    readonly posture: WritePosture;
  }) => Promise<void>;
}

// Approving a tool's read-only check and running it. Every check that asks for it gets
// this command, so the actions coalesce in `preparation`; each words it for its own report.
export function approveCheckAction(
  deps: Workspace,
  tool: string,
  label: Pick<PreparationAction, 'id' | 'description'>,
): PreparationAction {
  return {
    ...label,
    argv: ['fx', 'doctor', '--tool', tool, '--workspace', deps.ctx.name, '--yes'],
    cwd: deps.ctx.root,
    actor: 'agent',
    requires_approval: true,
  };
}

function inspectToolAction(
  deps: Workspace,
  tool: string,
  command: ReturnType<typeof toolRecoveryCommand>,
): PreparationAction {
  return {
    id: `tool:${tool}`,
    description: `Inspect ${tool} preparation`,
    argv: [
      'fx',
      'tool',
      command,
      tool,
      '--workspace',
      deps.ctx.name,
      ...(command === 'show' ? [] : ['--dry-run']),
    ],
    cwd: deps.ctx.root,
    actor: 'agent',
    requires_approval: false,
  };
}

// What an agent does about a tool its check found unusable: approve the probe that was
// withheld, otherwise look at what the tool's preparation would do.
export function toolRecovery(
  deps: Workspace,
  tool: Pick<ToolStatus, 'name' | 'state' | 'failure'> & { readonly preparation_required: boolean },
): PreparationAction[] {
  if (tool.state === 'ok' || (tool.state === 'disabled' && !tool.preparation_required)) return [];
  if (tool.failure?.code === 'VECTOR_UNTRUSTED')
    return [
      approveCheckAction(deps, tool.name, {
        id: `tool:${tool.name}`,
        description: `Review the exact ${tool.name} probe and approve it to continue`,
      }),
    ];
  return [inspectToolAction(deps, tool.name, toolRecoveryCommand(tool.state))];
}

export function verifyAction(deps: Workspace, tool: string): PreparationAction {
  return approveCheckAction(deps, tool, {
    id: `approve-check:${tool}`,
    description: `Review ${tool}'s exact verification commands, then approve the read-only check`,
  });
}

// What an agent does about a check that gave no answer: preview installing the tool that
// did not start, or ask the check that ran out of time again, within its environment.
export function noAnswerAction(
  deps: Workspace,
  step: Pick<SetupStep, 'id' | 'tool' | 'env'>,
  code: string,
): PreparationAction {
  if (code === 'TOOL_MISSING') return inspectToolAction(deps, step.tool, 'install');
  return {
    id: `recheck:${step.id}`,
    description: `Check ${step.tool} again; its check did not finish`,
    argv: [
      'fx',
      'doctor',
      '--tool',
      step.tool,
      ...(step.env ? ['--env', step.env] : []),
      '--workspace',
      deps.ctx.name,
    ],
    cwd: deps.ctx.root,
    actor: 'agent',
    requires_approval: false,
  };
}

export function repairAction(deps: Workspace): PreparationAction {
  return {
    id: 'repair-managed-resources',
    description: "Repair the workspace's managed guides and Skills",
    argv: ['fx', 'doctor', '--fix', '--workspace', deps.ctx.name],
    cwd: deps.ctx.root,
    actor: 'agent',
    requires_approval: true,
  };
}

// Initialization can fail before the workspace has a context, so the caller says where the
// command runs.
export function resumeAction(input: {
  readonly workspace: string;
  readonly cwd: string;
  readonly description?: string;
}): PreparationAction {
  return {
    id: 'resume-initialization',
    description:
      input.description ?? 'Continue preparing this workspace after resolving the blockers',
    argv: ['fx', 'init', '--resume', '--workspace', input.workspace],
    cwd: input.cwd,
    actor: 'agent',
    requires_approval: false,
  };
}

interface WorkspacePreparationInput {
  readonly stages: readonly string[];
  readonly checks: readonly PreparationCheck[];
  readonly preview?: boolean;
  // What the command narrowed its tools or environments to, when it did.
  readonly selection?: Partial<Pick<PreparationScope, 'tools' | 'environments'>>;
  // The command to run again once the blockers change; resuming initialization otherwise.
  readonly resume?: PreparationAction | undefined;
}

export function workspacePreparation(
  deps: Workspace,
  input: WorkspacePreparationInput,
): Preparation {
  const { stages, checks, selection = {} } = input;
  return preparation({
    scope: {
      workspace: deps.ctx.name,
      stages,
      repositories: stages.includes('repos')
        ? deps.ctx.workspace.repos.map((repo) => repo.name)
        : [],
      tools:
        selection.tools ??
        (stages.some((stage) => ['tools', 'setup', 'services'].includes(stage))
          ? workspaceToolScope(deps.ctx, {}).configuredNames
          : []),
      environments:
        selection.environments ??
        deps.ctx.local.scope?.envs ??
        Object.keys(deps.ctx.manifest.environments?.result.doc.envs ?? {}),
    },
    checks,
    preview: input.preview ?? false,
    resume: input.resume ?? resumeAction({ workspace: deps.ctx.name, cwd: deps.ctx.root }),
  });
}

export function findingCheck(
  finding: Finding,
  required = finding.required ?? finding.level === 'fail',
): PreparationCheck {
  let state: PreparationCheck['state'] = 'blocked';
  if (finding.coverage === 'incomplete') state = 'unknown';
  if (finding.level === 'ok') state = 'ready';
  let owner: PreparationCheck['owner'] = 'agent';
  if (finding.group === 'manifest') owner = 'maintainer';
  if (finding.handoff) owner = 'user';
  return preparationCheck(`${finding.group}:${finding.id}`, state, finding.message, {
    required,
    resource: finding.id,
    owner,
    ...(finding.actions ? { actions: finding.actions } : {}),
  });
}
