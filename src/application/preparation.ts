// Bind preparation evidence to the registered workspace and an executable recovery action.
import {
  preparation,
  preparationCheck,
  type Preparation,
  type PreparationCheck,
  type PreparationScope,
  type PreparationAction,
} from '../domain/preparation.js';
import type { Finding } from '../domain/report.js';

import { workspaceToolScope } from './tool/scope.js';
import type { WorkspaceDeps } from './workspace/deps.js';

type Workspace = Pick<WorkspaceDeps, 'ctx'>;

export function verifyAction(deps: Workspace, tool: string): PreparationAction {
  return {
    id: `approve-check:${tool}`,
    actor: 'agent',
    description: `Review ${tool}'s exact verification commands, then approve the read-only check`,
    argv: ['fx', 'doctor', '--tool', tool, '--workspace', deps.ctx.name, '--yes'],
    cwd: deps.ctx.root,
    requires_approval: true,
  };
}

export function repairAction(deps: Workspace): PreparationAction {
  return {
    id: 'repair-managed-resources',
    actor: 'agent',
    description: "Repair the workspace's managed guides and Skills",
    argv: ['fx', 'doctor', '--fix', '--workspace', deps.ctx.name],
    cwd: deps.ctx.root,
    requires_approval: true,
  };
}

export function resumeAction(deps: Workspace): PreparationAction {
  return {
    id: 'resume-initialization',
    description: 'Continue preparing this workspace after resolving the blockers',
    argv: ['fx', 'init', '--resume', '--workspace', deps.ctx.name],
    cwd: deps.ctx.root,
    actor: 'agent',
    requires_approval: false,
  };
}

export function workspacePreparation(
  deps: Workspace,
  stages: readonly string[],
  checks: readonly PreparationCheck[],
  preview = false,
  selection: Partial<Pick<PreparationScope, 'tools' | 'environments'>> = {},
  resume: PreparationAction = resumeAction(deps),
): Preparation {
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
    preview,
    resume,
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
