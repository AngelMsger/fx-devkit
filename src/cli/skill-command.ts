// Wiring and target flags shared by the standalone companion Skill commands.

import { Flags } from '@oclif/core';

import type { StandaloneTargetsInput } from '../application/skill/standalone-targets.js';
import { StandaloneSkill, type SkillMutation } from '../application/skill/standalone.js';

import { FxCommand } from './base.js';
import { listFlag, writeIntent } from './flags.js';

export const skillTargetFlags = {
  agent: listFlag('target agent ids'),
  project: Flags.boolean({
    default: false,
    description: 'use agent Skill directories in the current directory instead of the user home',
  }),
  dir: Flags.string({
    description: 'explicit Skill parent directory; excludes --agent and --project',
  }),
};

export interface SkillTargetFlags {
  readonly agent?: readonly string[] | undefined;
  readonly project?: boolean | undefined;
  readonly dir?: string | undefined;
}

export abstract class SkillCommand extends FxCommand {
  static override announcesSkill = false;

  protected companionSkill(): StandaloneSkill {
    this.skipUpdateChecks();
    return new StandaloneSkill({
      fs: this.container.fs,
      skills: this.skillDeps(),
      version: this.config.version,
      prompter: this.container.prompter(this.noInput),
      replace: this.replacement(),
    });
  }

  protected skillTarget(flags: SkillTargetFlags): StandaloneTargetsInput {
    return {
      agents: flags.agent,
      project: flags.project,
      dir: flags.dir,
      cwd: process.cwd(),
    };
  }

  protected skillWrite(
    operation: 'install' | 'uninstall',
    flags: SkillTargetFlags & { readonly 'dry-run': boolean },
  ): Promise<SkillMutation[]> {
    return this.companionSkill().write(operation, {
      ...this.skillTarget(flags),
      ...writeIntent(flags, this.posture),
      yes: this.yes,
    });
  }
}
