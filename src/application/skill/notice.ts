// The Skill handshake: installed, version-aligned and loaded are three different states,
// and only an agent needs to hear about them. A person in a terminal never sees this; an
// agent that loaded the Skill says so with FX_SKILL_LOADED=1 and hears nothing either.

import path from 'node:path';

import type { Format } from '../../domain/format.js';
import { decideCopy, type CopyAction } from '../../domain/skills/projection.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Notice } from '../../ports/reporter.js';

import { FX_SKILL, observeCopy } from './observe.js';
import { skillTargets, type SkillDeps } from './targets.js';

export const SKILL_LOADED_ENV = 'FX_SKILL_LOADED';

export interface SkillNoticeInput {
  readonly format: Format;
  readonly loaded: boolean;
  readonly enabled: boolean;
  readonly cliVersion: string;
}

const SILENCE = 'FX_SKILL_NOTICE=0 or `fx config set skill_notice false`';

export async function skillNotice(
  fs: FileSystem,
  skills: SkillDeps,
  input: SkillNoticeInput,
): Promise<Notice | undefined> {
  if (input.format === 'human' || !input.enabled || input.loaded) return undefined;
  const targets = await skillTargets(skills, undefined);
  if (targets.length === 0) return undefined;
  const actions: CopyAction[] = [];
  for (const target of targets) {
    actions.push(
      decideCopy(await observeCopy(fs, path.join(target.dir, FX_SKILL)), input.cliVersion),
    );
  }
  if (actions.includes('install')) {
    return {
      code: 'SKILL_MISSING',
      message: `the ${FX_SKILL} Skill is not installed for every enabled agent; agents drive fx better with it`,
      nextSteps: ['fx sync --only skills'],
      silence: SILENCE,
    };
  }
  if (actions.includes('upgrade')) {
    return {
      code: 'SKILL_OUTDATED',
      message: `the installed ${FX_SKILL} Skill is older than this fx (${input.cliVersion})`,
      nextSteps: ['fx sync --only skills'],
      silence: SILENCE,
    };
  }
  return {
    code: 'SKILL_AVAILABLE',
    message: `the ${FX_SKILL} Skill is installed but was not loaded for this call`,
    nextSteps: [`load the ${FX_SKILL} Skill, then run fx with ${SKILL_LOADED_ENV}=1`],
    silence: SILENCE,
  };
}
