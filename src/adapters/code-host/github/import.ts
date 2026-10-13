// A remote on github.com names its provider by its host alone: nothing else answers
// there. A GitHub Enterprise server is any host name, so it is never guessed.

import type { ImportProvider } from '../../../domain/import/infer.js';
import { DEFAULT_HOSTNAME } from '../../github/gh.js';

export function identifyGitHubRemote(upstream: string): ImportProvider | undefined {
  // The scp-like git@HOST:OWNER/NAME.git, the form GitHub offers for SSH clones.
  const scp = /^git@([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(upstream);
  if (scp !== null)
    return scp[1] === DEFAULT_HOSTNAME
      ? { provider: 'github', host: `ssh://git@${DEFAULT_HOSTNAME}` }
      : undefined;
  let url: URL;
  try {
    url = new URL(upstream);
  } catch {
    return undefined;
  }
  const path = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (url.hostname !== DEFAULT_HOSTNAME || url.port || path.length !== 2) return undefined;
  if (url.protocol === 'https:' && !url.username) return { provider: 'github', host: url.origin };
  if (url.protocol === 'ssh:' && url.username === 'git')
    return { provider: 'github', host: `ssh://git@${DEFAULT_HOSTNAME}` };
  return undefined;
}
