// The AGENTS.md a fresh workspace starts from: a title, one sentence on how
// the file works, and the active regions, empty. Prose belongs outside them.

import { region } from './regions.js';
import { REGIONS } from './templates.js';

export function agentsSkeleton(workspaceName: string): string {
  return [
    `# ${workspaceName} workspace`,
    '',
    'This workspace is built and kept in step by `fx`. The blocks between `<!-- fx:begin … -->` and `<!-- fx:end … -->` are generated from the manifest by `fx manifest render` in the manifest repository and are replaced as a whole; write routing rules, conventions and anything else people should know **outside** them.',
    '',
    ...REGIONS.flatMap((name) => [region(name, ''), '']),
  ].join('\n');
}
