// Standalone Skill writes must never edit the bundled tree or a shared manifest source.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { isAtOrInside } from '../../domain/path.js';
import type { FileSystem } from '../../ports/fs.js';

import { canonicalSkillPath } from './copies.js';

export async function assertSkillDestination(
  fs: FileSystem,
  target: string,
  bundled: string,
): Promise<void> {
  const canonical = await canonicalSkillPath(fs, target);
  const physical = await fs.realpath(canonical);
  const source = await fs.realpath(bundled);
  for (const location of new Set([canonical, physical])) {
    if (isAtOrInside(location, source) || isAtOrInside(source, location)) reject(target);
    for (let parent = path.dirname(location); ; parent = path.dirname(parent)) {
      if (
        isAtOrInside(location, path.join(parent, 'skills')) &&
        ((await fs.exists(path.join(parent, 'manifest', 'workspace.yaml'))) ||
          (await fs.exists(path.join(parent, 'workspace.yaml'))))
      )
        reject(target);
      if (parent === path.dirname(parent)) break;
    }
  }
}

function reject(target: string): never {
  throw new DevkitError('conflict', 'SKILL_SOURCE_PROTECTED', `${target} overlaps a Skill source`, {
    hint: 'Project Skill links may point into the shared manifest. Install the fx companion separately.',
    nextSteps: [
      'Use fx skill install --agent <id> without --project, or choose an independent --dir.',
    ],
  });
}
