// Explicit replacement of user-owned paths: approve the concrete paths first,
// preserve each original at a unique sibling, then free the destinations.

import type { FileSystem } from '../../ports/fs.js';
import type { Prompter } from '../../ports/prompter.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import type { Reporter } from '../../ports/reporter.js';

export function replacementFor(
  fs: FileSystem,
  prompter: Prompter,
  reporter: Reporter,
  yes: boolean,
): ReplaceFiles {
  return async (paths) => {
    if (paths.length === 0) return true;
    if (
      !yes &&
      !(await prompter.confirm(`Back up and replace these existing paths?\n${paths.join('\n')}`))
    )
      return false;
    for (const target of paths) {
      const backup = await fs.moveToBackup(target);
      reporter.notice({ code: 'FILE_BACKED_UP', message: `${target} preserved at ${backup}` });
    }
    return true;
  };
}
