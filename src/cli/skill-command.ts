// Wiring and target flags shared by the standalone companion Skill commands.

import { Flags } from '@oclif/core';

import { StandaloneSkill } from '../application/skill/standalone.js';

import { FxCommand } from './base.js';
import { listFlag } from './flags.js';

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

export abstract class SkillCommand extends FxCommand {
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
}
