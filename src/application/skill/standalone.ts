// Manage the bundled companion independently of workspace and third-party Skill distribution.

import path from 'node:path';

import { asDevkitError, DevkitError, toEnvelope, withPartialResult } from '../../domain/errors.js';
import { compareSemver, parseSemver } from '../../domain/semver.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Prompter } from '../../ports/prompter.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { SkillCopies, withSkillLock } from './copies.js';
import { assertSkillDestination } from './destination.js';
import { SKILL_LOADED_ENV } from './notice.js';
import { observeCopy } from './observe.js';
import {
  standaloneTargets,
  type StandaloneTarget,
  type StandaloneTargetsInput,
} from './standalone-targets.js';
import type { SkillDeps } from './targets.js';

export interface StandaloneSkillDeps {
  readonly fs: FileSystem;
  readonly skills: SkillDeps;
  readonly version: string;
  readonly prompter: Prompter;
  readonly replace: ReplaceFiles;
}

export interface SkillInstallation extends StandaloneTarget {
  readonly status: 'installed' | 'not_installed' | 'foreign';
  readonly version: string | null;
  readonly version_state: 'matching' | 'older' | 'newer' | 'unknown' | 'missing';
}

export interface SkillMutation extends StandaloneTarget {
  readonly action: 'install' | 'refresh' | 'replace' | 'remove' | 'skip';
  readonly status:
    | 'planned'
    | 'not_started'
    | 'installed'
    | 'removed'
    | 'not_installed'
    | 'foreign'
    | 'skipped'
    | 'failed';
  readonly version: string | null;
  readonly failure?: Readonly<Record<string, unknown>>;
}

export interface SkillWriteInput extends StandaloneTargetsInput {
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly yes: boolean;
}

export interface SkillStatus {
  readonly loaded: boolean;
  readonly loaded_env: string;
  readonly embedded_version: string;
  readonly installs: readonly SkillInstallation[];
  readonly next: string;
}

export class StandaloneSkill {
  constructor(private readonly deps: StandaloneSkillDeps) {}

  async paths(input: StandaloneTargetsInput): Promise<SkillInstallation[]> {
    const targets = await standaloneTargets(this.deps.fs, this.deps.skills.hosts, input, true);
    return Promise.all(targets.map((target) => this.inspect(target)));
  }

  async status(input: StandaloneTargetsInput, loaded: boolean): Promise<SkillStatus> {
    const installs = await this.paths(input);
    let next = '';
    if (installs.some((i) => i.status === 'installed' && i.version_state !== 'matching'))
      next = 'Run fx skill install for the selected target to refresh it, then reload the Skill.';
    else if (!loaded)
      next = installs.some((i) => i.status === 'installed')
        ? 'Load the fx-workspace Skill before composing commands.'
        : 'Run fx skill install, or read fx skill show, then load the Skill.';
    return {
      loaded,
      loaded_env: SKILL_LOADED_ENV,
      embedded_version: this.deps.version,
      installs,
      next,
    };
  }

  async show(): Promise<string> {
    const text = await this.deps.fs.readText(
      path.join(this.deps.skills.bundledSkillDir, 'SKILL.md'),
    );
    if (text === undefined)
      throw new DevkitError('config', 'SKILL_MISSING', 'The bundled Skill is missing', {
        nextSteps: ['Check fx self info and repair the fx installation.'],
      });
    return text;
  }

  async write(
    operation: 'install' | 'uninstall',
    input: SkillWriteInput,
  ): Promise<SkillMutation[]> {
    const targets = await standaloneTargets(this.deps.fs, this.deps.skills.hosts, input);
    const rows: SkillMutation[] = [];
    for (const target of targets) {
      await this.validate(target.path);
      const observed = await this.inspect(target);
      rows.push({
        ...target,
        action: mutationAction(operation, observed),
        status: input.dryRun ? 'planned' : 'not_started',
        version: observed.version,
      });
    }
    if (input.dryRun) return rows;
    if (rows.some((r) => r.action !== 'skip')) assertWritable(input.posture, `skill ${operation}`);
    if (operation === 'uninstall' && !(await this.confirmRemoval(rows, input.yes)))
      return rows.map((r) => ({ ...r, status: 'skipped' }));
    for (const [index, row] of rows.entries()) {
      try {
        rows[index] = await this.apply(operation, row, input.posture);
      } catch (error) {
        rows[index] = { ...row, status: 'failed', failure: toEnvelope(asDevkitError(error)).error };
        const observed = await Promise.all(
          rows.map(async (item) => {
            try {
              return { ...item, observed: await this.inspect(item) };
            } catch {
              return { ...item, observed: { status: 'unknown' } };
            }
          }),
        );
        throw withPartialResult(error, { items: observed, has_more: false });
      }
    }
    return rows;
  }

  private async apply(
    operation: 'install' | 'uninstall',
    row: SkillMutation,
    posture: WritePosture,
  ): Promise<SkillMutation> {
    if (operation === 'install') {
      const action = await new SkillCopies(
        this.deps.fs,
        this.deps.version,
        this.deps.skills,
      ).install(row.path, {
        posture,
        refresh: true,
        replace: this.deps.replace,
        validate: (target) => this.validate(target),
      });
      if (action === 'foreign') return { ...row, status: 'foreign' };
      return { ...row, status: 'installed', version: this.deps.version };
    }
    return withSkillLock(this.deps.fs, this.deps.skills.globalLock, row.path, async (target) => {
      await this.validate(target);
      const current = await observeCopy(this.deps.fs, target);
      if (current.kind === 'foreign') return { ...row, status: 'foreign' };
      if (current.kind === 'absent') return { ...row, status: 'not_installed', version: null };
      if (row.action !== 'remove')
        throw new DevkitError(
          'conflict',
          'SKILL_TARGET_CHANGED',
          'An unplanned Skill appeared before removal',
          {
            nextSteps: ['Inspect fx skill path and preview the uninstall again.'],
          },
        );
      await this.deps.fs.remove(target);
      return { ...row, status: 'removed', version: current.version };
    });
  }

  private async confirmRemoval(rows: readonly SkillMutation[], yes: boolean): Promise<boolean> {
    const remove = rows.filter((r) => r.action === 'remove');
    return (
      remove.length === 0 ||
      yes ||
      this.deps.prompter.confirm(
        `Remove these fx Skill copies?\n${remove.map((r) => r.path).join('\n')}`,
      )
    );
  }

  private validate(target: string): Promise<void> {
    return assertSkillDestination(this.deps.fs, target, this.deps.skills.bundledSkillDir);
  }

  private async inspect(target: StandaloneTarget): Promise<SkillInstallation> {
    const observed = await observeCopy(this.deps.fs, target.path);
    if (observed.kind === 'absent')
      return { ...target, status: 'not_installed', version: null, version_state: 'missing' };
    if (observed.kind === 'foreign')
      return { ...target, status: 'foreign', version: null, version_state: 'unknown' };
    return {
      ...target,
      status: 'installed',
      version: observed.version,
      version_state: versionState(observed.version, this.deps.version),
    };
  }
}

function versionState(installed: string, bundled: string): SkillInstallation['version_state'] {
  const left = parseSemver(installed);
  const right = parseSemver(bundled);
  if (!left || !right) return 'unknown';
  const compared = compareSemver(left, right);
  if (compared === 0) return 'matching';
  return compared < 0 ? 'older' : 'newer';
}

function mutationAction(
  operation: 'install' | 'uninstall',
  row: SkillInstallation,
): SkillMutation['action'] {
  if (operation === 'uninstall') return row.status === 'installed' ? 'remove' : 'skip';
  if (row.status === 'foreign') return 'replace';
  return row.status === 'installed' ? 'refresh' : 'install';
}
