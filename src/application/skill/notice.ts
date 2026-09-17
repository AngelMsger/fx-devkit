// The Skill handshake: installed, version-aligned and loaded are three different states,
// only non-interactive callers receive guidance. A matching declared bundled
// version acknowledges loading without requiring global installation.

import path from 'node:path';

import type { Format } from '../../domain/format.js';
import { decideCopy, type CopyAction } from '../../domain/skills/projection.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Notice } from '../../ports/reporter.js';

import { FX_SKILL, observeCopy } from './observe.js';
import { skillTargets, type SkillDeps } from './targets.js';

export const SKILL_LOADED_ENV = 'FX_SKILL_LOADED';
export const SKILL_VERSION_ENV = 'FX_SKILL_VERSION';

export interface SkillNoticeInput {
  readonly format: Format;
  readonly terminal?: boolean;
  readonly loaded: boolean;
  readonly loadedVersion?: string | undefined;
  readonly enabled: boolean;
  readonly cliVersion: string;
}

const SILENCE = 'FX_SKILL_NOTICE=0 or `fx config set skill_notice false`';

export async function skillNotice(
  fs: FileSystem,
  skills: SkillDeps,
  input: SkillNoticeInput,
): Promise<Notice | undefined> {
  if ((input.terminal ?? input.format === 'human') || !input.enabled) return undefined;
  if (input.loadedVersion === input.cliVersion) return undefined;
  const file = path.join(skills.bundledSkillDir, 'SKILL.md');
  const nextSteps = [
    `Read ${file}, or run fx skill show.`,
    `After loading it, run fx with ${SKILL_LOADED_ENV}=1 and ${SKILL_VERSION_ENV}=${input.cliVersion}.`,
  ];
  if (input.loadedVersion !== undefined || input.loaded)
    return versionNotice(input, file, nextSteps);
  const targets = await skillTargets(skills, undefined);
  const actions: CopyAction[] = [];
  for (const target of targets) {
    actions.push(
      decideCopy(await observeCopy(fs, path.join(target.dir, FX_SKILL)), input.cliVersion),
    );
  }
  if (actions.length === 0 || actions.includes('install')) {
    return {
      code: 'SKILL_MISSING',
      message: `the ${FX_SKILL} Skill is not installed for every enabled agent; agents drive fx better with it`,
      nextSteps,
      silence: SILENCE,
    };
  }
  if (actions.includes('upgrade')) {
    return {
      code: 'SKILL_OUTDATED',
      message: `the installed ${FX_SKILL} Skill is older than this fx (${input.cliVersion})`,
      nextSteps,
      silence: SILENCE,
    };
  }
  if (actions.includes('foreign'))
    return {
      code: 'SKILL_FOREIGN',
      message:
        'A companion Skill location contains foreign content; inspect it before installation.',
      nextSteps,
      silence: SILENCE,
    };
  return {
    code: 'SKILL_AVAILABLE',
    message: `the ${FX_SKILL} Skill is installed but was not loaded for this call`,
    nextSteps,
    silence: SILENCE,
  };
}

function versionNotice(input: SkillNoticeInput, file: string, nextSteps: string[]): Notice {
  return {
    code: input.loadedVersion === undefined ? 'SKILL_VERSION_UNVERIFIED' : 'SKILL_VERSION_MISMATCH',
    message: `Loaded Skill version ${input.loadedVersion ?? 'unknown'}; this fx bundles ${input.cliVersion}.`,
    nextSteps,
    data: {
      bundled_skill: file,
      bundled_skill_version: input.cliVersion,
      loaded_version: input.loadedVersion ?? null,
    },
    silence: SILENCE,
  };
}
