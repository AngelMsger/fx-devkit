// Repairs independently, retaining each attempt, then reports fresh evidence from every check.

import { asDevkitError, toEnvelope } from '../../domain/errors.js';
import { report } from '../../domain/report.js';
import { DeriveDocs } from '../docs/derive.js';
import { setupActions } from '../init/setup.js';
import type { LoginDeps } from '../login/deps.js';
import { Login } from '../login/run.js';
import { validateSetupSelection } from '../login/selection.js';
import { findingCheck, workspacePreparation } from '../preparation.js';
import { assertWritable } from '../safety/posture.js';
import { SkillStage } from '../skill/stage.js';
import type { SkillDeps } from '../skill/targets.js';
import { Tally } from '../tally.js';
import type { ToolInstalled } from '../tool/installed.js';
import { workspaceToolScope, type WorkspaceToolScope } from '../tool/scope.js';
import type { FxUpdateCheck, FxUpdateInput } from '../update/fx.js';
import type { ManifestUpdateCheck } from '../update/manifest.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { checkAgents } from './agents.js';
import { checkInstallations } from './installations.js';
import { checkLogin } from './login.js';
import { checkManifest } from './manifest.js';
import { checkRepos } from './repos.js';
import { checkRoot } from './root.js';
import { checkSelf } from './self.js';
import { checkTools } from './tools.js';
import {
  GROUPS,
  type DoctorInput,
  type DoctorReport,
  type DoctorExtension,
  type Finding,
  type RepairAttempt,
} from './types.js';

export type { DoctorInput };

export interface DoctorDeps {
  readonly inventory?: ToolInstalled;
  readonly extensions?: readonly DoctorExtension[] | undefined;
  readonly login: LoginDeps;
  readonly skills: SkillDeps;
  readonly bundledTools: () => string;
  readonly updates: {
    readonly fx: FxUpdateCheck;
    readonly manifest: ManifestUpdateCheck;
    readonly self: FxUpdateInput;
    // The same switch as the end-of-command notices: off means no probe.
    readonly enabled: boolean;
  };
}

export class Doctor {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly doctor: DoctorDeps,
  ) {}

  async execute(input: DoctorInput): Promise<DoctorReport> {
    validateSetupSelection(this.deps.ctx, input, this.deps.commandShell);
    const toolScope = workspaceToolScope(this.deps.ctx, input, this.deps.commandShell);
    const repairs = input.fix ? await this.fix({ ...input, tools: toolScope.configuredNames }) : [];
    const groups = await Tally.during(this.deps.activity, 'checks', (checks) =>
      this.check(input, toolScope, checks),
    );
    return this.summarize(input, toolScope, groups.flat(), repairs);
  }

  // One unit per group, except the two that run a companion per tool and per step.
  private check(
    input: DoctorInput,
    toolScope: WorkspaceToolScope,
    checks: Tally,
  ): Promise<(readonly Finding[])[]> {
    const group = (name: string, check: () => Promise<readonly Finding[]>) =>
      checks.plan(1).unit(name, check);
    return Promise.all([
      toolScope.problems,
      group('repos', () => checkRepos(this.deps)),
      group('root', () =>
        checkRoot(this.deps, { hosts: this.doctor.skills.hosts, login: this.doctor.login }),
      ),
      group('installations', () => checkInstallations(this.doctor.inventory, input.tools)),
      checkTools(this.deps, { ...toolScope, trust: this.doctor.login.trust }, checks),
      checkLogin(
        this.deps,
        this.doctor.login,
        {
          tools: toolScope.configuredNames,
          requiredTools: toolScope.required,
          envs: input.envs,
          dryRun: input.dryRun,
        },
        checks,
      ),
      group('agents', () => checkAgents(this.deps, this.doctor.skills)),
      group('manifest', () =>
        checkManifest(this.deps, this.doctor.login, this.doctor.bundledTools, this.doctor.updates),
      ),
      group('self', () => checkSelf(this.doctor.updates)),
      ...(this.doctor.extensions ?? []).map((extension) =>
        group(extension.group, () => extension.check()),
      ),
    ]);
  }

  private async summarize(
    input: DoctorInput,
    toolScope: WorkspaceToolScope,
    findings: readonly Finding[],
    repairs: readonly RepairAttempt[],
  ): Promise<DoctorReport> {
    const groupOrder = [
      ...GROUPS,
      ...(this.doctor.extensions ?? []).map((extension) => extension.group),
    ];
    const diagnostic = report(groupOrder, findings);
    const plan = await new Login(this.deps, this.doctor.login).plan({
      tools: toolScope.configuredNames,
      envs: input.envs,
    });
    const checks = diagnostic.findings.map((item) => {
      const step =
        item.group === 'login' ? plan.steps.find((step) => step.id === item.id) : undefined;
      const required = step ? toolScope.required.has(step.tool) : item.required;
      return {
        ...findingCheck(item, required),
        ...(step && item.level !== 'ok' && !item.actions
          ? { actions: setupActions(this.deps, step, this.doctor.login.home) }
          : {}),
      };
    });
    return {
      findings: diagnostic.findings,
      summary: diagnostic.summary,
      coverage: diagnostic.complete ? 'complete' : 'incomplete',
      preparation: workspacePreparation(
        this.deps,
        groupOrder,
        checks,
        input.dryRun,
        {
          tools: toolScope.configuredNames,
          ...(input.envs ? { environments: input.envs } : {}),
        },
        {
          id: 'recheck-preparation',
          description:
            'Recheck the same workspace and selected tools after the prerequisites change',
          argv: [
            'fx',
            'doctor',
            '--workspace',
            this.deps.ctx.name,
            ...(input.tools ? input.tools.flatMap((tool) => ['--tool', tool]) : []),
            ...(input.envs ? input.envs.flatMap((env) => ['--env', env]) : []),
            ...(input.fix ? ['--fix'] : []),
          ],
          cwd: this.deps.ctx.root,
          actor: 'agent',
          requires_approval: input.dryRun,
        },
      ),
      repairs,
    };
  }

  private async fix(input: DoctorInput): Promise<RepairAttempt[]> {
    if (!input.dryRun) assertWritable(input.posture, 'doctor --fix');
    const repairs: RepairAttempt[] = [];
    const attempt = async (group: string, run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
        repairs.push({ group, status: input.dryRun ? 'planned' : 'completed' });
      } catch (err) {
        const failure = asDevkitError(err);
        if (failure.code === 'READONLY_BLOCKED') throw failure;
        repairs.push({ group, status: 'failed', failure: toEnvelope(failure).error });
      }
    };
    for (const extension of this.doctor.extensions ?? []) {
      if (extension.fix) await attempt(extension.group, () => extension.fix!(input));
    }
    await attempt('agents', () =>
      new SkillStage(this.deps, this.doctor.skills).execute({
        dryRun: input.dryRun,
        posture: input.posture,
      }),
    );
    await attempt('manifest', () =>
      new DeriveDocs(this.deps, this.doctor.login).execute({
        check: false,
        dryRun: input.dryRun,
        posture: input.posture,
      }),
    );
    await attempt('login', () =>
      new Login(this.deps, this.doctor.login).execute({
        mode: 'prepare',
        tools: input.tools,
        envs: input.envs,
        skipManual: true,
        dryRun: input.dryRun,
        noInput: input.noInput,
        posture: input.posture,
      }),
    );
    return repairs;
  }
}
