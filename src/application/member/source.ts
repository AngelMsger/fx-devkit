// The members document, or the one error every member command shares.
// People data goes to stdout and nowhere else: never a notice, never the
// cache, never a log line.

import { DevkitError } from '../../domain/errors.js';
import type { Members } from '../../domain/manifest/types.js';
import type { WorkspaceContext } from '../workspace-context.js';

export function membersOf(ctx: WorkspaceContext): Members {
  const doc = ctx.manifest.members?.result.doc;
  if (doc === undefined) {
    throw new DevkitError(
      'not_found',
      'MEMBERS_MISSING',
      'This workspace has no manifest/members.yaml',
      {
        hint: 'The members document is private to the team and lives only in the workspace manifest.',
        nextSteps: ['fx manifest explain people --kind members'],
      },
    );
  }
  return doc;
}
