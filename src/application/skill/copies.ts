// Share locked, recoverable bundled Skill replacement between explicit installation and sync.

import path from 'node:path';

import { busyError, DevkitError } from '../../domain/errors.js';
import { pathKey } from '../../domain/path.js';
import { decideCopy, type CopyAction } from '../../domain/skills/projection.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Lock } from '../../ports/lock.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { observeCopy } from './observe.js';
import type { SkillDeps } from './targets.js';
import { skillWriteError } from './write-error.js';

export async function canonicalSkillPath(fs: FileSystem, target: string): Promise<string> {
  const absolute = path.resolve(target);
  const parent = path.dirname(absolute);
  if (parent === absolute) return fs.realpath(absolute);
  const real = await fs.realpath(parent);
  if (real !== parent || (await fs.exists(parent))) return path.join(real, path.basename(absolute));
  return path.join(await canonicalSkillPath(fs, parent), path.basename(absolute));
}

export async function withSkillLock<T>(
  fs: FileSystem,
  lock: Lock | undefined,
  target: string,
  work: (canonical: string) => Promise<T>,
): Promise<T> {
  try {
    return await lockedSkillWork(fs, lock, target, work);
  } catch (error) {
    throw skillWriteError(error, target);
  }
}

async function lockedSkillWork<T>(
  fs: FileSystem,
  lock: Lock | undefined,
  target: string,
  work: (canonical: string) => Promise<T>,
): Promise<T> {
  const canonical = await canonicalSkillPath(fs, target);
  const lease = await lock?.acquire({ key: `skill:${pathKey(canonical)}`, waitMs: 2000 });
  if (lease === null)
    throw busyError('SKILL_BUSY', 'The Skill', {
      nextSteps: ['Retry the Skill command after the other update completes.'],
    });
  try {
    if (pathKey(await canonicalSkillPath(fs, target)) !== pathKey(canonical))
      throw new DevkitError('conflict', 'SKILL_TARGET_CHANGED', 'The Skill target changed', {
        nextSteps: ['Inspect the target directory and retry.'],
      });
    return await work(canonical);
  } finally {
    await lease?.release();
  }
}

export interface CopySkillInput {
  readonly posture?: WritePosture;
  readonly refresh?: boolean;
  readonly replace?: ReplaceFiles;
  readonly validate?: (target: string) => Promise<void>;
}

export class SkillCopies {
  constructor(
    private readonly fs: FileSystem,
    private readonly version: string,
    private readonly skills: Pick<SkillDeps, 'globalLock' | 'bundledSkillDir'>,
  ) {}

  async install(target: string, input: CopySkillInput = {}): Promise<CopyAction> {
    return withSkillLock(this.fs, this.skills.globalLock, target, async (canonical) => {
      await input.validate?.(canonical);
      const observed = await observeCopy(this.fs, canonical);
      let action = decideCopy(observed, this.version);
      if (input.refresh && observed.kind === 'ours') action = 'upgrade';
      if (
        input.posture &&
        (action === 'install' || action === 'upgrade' || (action === 'foreign' && input.replace))
      )
        assertWritable(input.posture, 'install companion Skill');
      if (action === 'foreign' && input.replace && (await input.replace([canonical])))
        action = 'install';
      if (action === 'install' || action === 'upgrade')
        await this.fs.replaceDir(this.skills.bundledSkillDir, canonical);
      return action;
    });
  }
}
