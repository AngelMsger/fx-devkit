// Cross-field rules of workspace.yaml that a schema cannot express. Every
// problem carries the path the reader would look for in the file.

import { isWindow } from '../../release/window.js';
import { isSemver } from '../../semver.js';
import {
  checkoutPathKey,
  checkoutPathsOverlap,
  isWorkspaceCheckoutPath,
} from '../../workspace/checkout.js';
import type { Problem, Workspace } from '../types.js';

export function workspaceRules(doc: Workspace): Problem[] {
  const problems: Problem[] = [];
  if (doc.min_cli !== undefined && !isSemver(doc.min_cli)) {
    problems.push({ path: 'min_cli', message: 'must be a semantic version' });
  }
  const host = doc.defaults.host ?? doc.providers?.['code-host']?.vars?.['host'];
  if (host === undefined && doc.repos.some((r) => r.upstream === undefined)) {
    problems.push({
      path: 'defaults.host',
      message:
        'a git host is required (defaults.host or providers.code-host.vars.host) unless every repository names its upstream',
    });
  }

  if (doc.release?.since !== undefined && !isWindow(doc.release.since)) {
    problems.push({ path: 'release.since', message: 'must be a window such as 14d, 48h or 2w' });
  }

  const seenNames = new Map<string, number>();
  const seenPaths = new Map<string, number>();
  doc.repos.forEach((repo, i) => {
    const first = seenNames.get(repo.name);
    if (first !== undefined)
      problems.push({ path: `repos[${i}].name`, message: `duplicates repos[${first}]` });
    else seenNames.set(repo.name, i);

    const checkout = checkoutPathKey(repo.path ?? repo.name);
    if (!isWorkspaceCheckoutPath(repo.path ?? repo.name)) {
      problems.push({ path: `repos[${i}].path`, message: 'must stay inside the workspace root' });
    } else {
      const owner = [...seenPaths].find(([other]) => checkoutPathsOverlap(checkout, other));
      if (owner !== undefined)
        problems.push({
          path: `repos[${i}].path`,
          message: `overlaps the checkout at repos[${owner[1]}]`,
        });
      else seenPaths.set(checkout, i);
    }

    if (repo.branch === undefined && doc.defaults.branch === undefined) {
      problems.push({
        path: `repos[${i}].branch`,
        message: 'no branch, and defaults.branch is unset',
      });
    }
  });
  return problems;
}
