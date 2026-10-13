// A contribution PR names both repositories and branches. Its state comes from
// one known remote request, never from a missing response or local timestamp.

import { scanBoundary } from '../boundary/scan.js';
import { DevkitError } from '../errors.js';
import type { RepoRef } from '../workspace/ref.js';

export interface PullRequestBranch {
  readonly repo: RepoRef;
  readonly branch: string;
}

export interface ContributionPullRequest {
  readonly id: string;
  readonly url: string;
  readonly state: 'open' | 'merged' | 'declined' | 'superseded';
  readonly source: PullRequestBranch;
  readonly target: PullRequestBranch;
}

export interface PullRequestLookup {
  readonly repo: RepoRef;
  // A native ID or repository website URL; the provider owns its syntax.
  readonly id: string;
}

export interface CreatePullRequest {
  readonly source: PullRequestBranch;
  readonly target: PullRequestBranch;
  readonly title: string;
  readonly description: string;
  readonly allowWrites: boolean;
}

// The PR text leaves the machine like the files it describes, so it is held to the same
// boundary whichever code host carries it.
export function assertPullRequestText(
  input: Pick<CreatePullRequest, 'title' | 'description'>,
): void {
  if (scanBoundary({ text: `${input.title}\n${input.description}`, policy: 'manifest' }).length)
    throw new DevkitError(
      'usage',
      'SOURCE_CONTENT_SENSITIVE',
      'The PR text contains protected content',
      {
        nextSteps: [
          'Remove credentials, personal names and email addresses from --title and --message, then retry.',
        ],
      },
    );
}
