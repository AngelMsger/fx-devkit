// Repairs independently, retaining each attempt, then reports fresh evidence from every check.

import { asDevkitError, toEnvelope } from '../../domain/errors.js';
import { report } from '../../domain/report.js';
import { DeriveDocs } from '../docs/derive.js';
import type { LoginDeps } from '../login/deps.js';
import { Login } from '../login/run.js';
import { validateSetupSelection } from '../login/selection.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { SkillStage } from '../skill/stage.js';
import type { SkillDeps } from '../skill/targets.js';
import type { FxUpdateCheck, FxUpdateInput } from '../update/fx.js';
import type { ManifestUpdateCheck } from '../update/manifest.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { checkAgents } from './agents.js';
import { checkLogin } from './login.js';
import { checkManifest } from './manifest.js';
import { checkRepos } from './repos.js';
import { checkSelf } from './self.js';
import { checkTools } from './tools.js';
import { GROUPS, type DoctorReport, type DoctorExtension, type RepairAttempt } from './types.js';

export interface DoctorDeps {
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

export interface DoctorInput {
  readonly envs?: readonly string[] | undefined;
  readonly tools?: readonly string[] | undefined;
  readonly fix: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly posture: WritePosture;
}

export class Doctor {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly doctor: DoctorDeps,
  ) {}

  async execute(input: DoctorInput): Promise<DoctorReport> {
    validateSetupSelection(this.deps.ctx, input);
    const repairs = input.fix ? await this.fix(input) : [];
    const groups = await Promise.all([
      checkRepos(this.deps),
      checkTools(this.deps, { names: input.tools, trust: this.doctor.login.trust }),
      checkLogin(this.deps, this.doctor.login, {
        tools: input.tools,
        envs: input.envs,
        dryRun: input.dryRun,
      }),
      checkAgents(this.deps, this.doctor.skills),
      checkManifest(this.deps, this.doctor.login, this.doctor.bundledTools, this.doctor.updates),
      checkSelf(this.doctor.updates),
      ...(this.doctor.extensions ?? []).map((extension) => extension.check()),
    ]);
    return {
      ...report(
        [...GROUPS, ...(this.doctor.extensions ?? []).map((extension) => extension.group)],
        groups.flat(),
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
