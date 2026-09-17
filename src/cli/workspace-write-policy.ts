// Public commands that can mutate workspace identity-dependent resources share an operation lease.

const WORKSPACE_WRITERS = new Set([
  'sync',
  'login',
  'repo:add',
  'repo:remove',
  'repo:fork',
  'repo:pick',
  'repo:unpick',
  'repo:select',
  'env:pick',
  'env:unpick',
  'env:select',
  'hook:enable',
  'hook:disable',
  'hook:inject',
  'hook:remove',
  'manifest:record-probe',
]);
const SOURCE_WRITERS = new Set([
  'manifest:repo-set',
  'manifest:set',
  'manifest:render',
  'source:push',
]);
export function workspaceWriteMode(
  id: string | undefined,
  flags: Readonly<Record<string, unknown>>,
): 'workspace' | 'source' | null {
  if (!id || flags['dry-run'] || (id === 'login' && flags.list)) return null;
  if (id === 'manifest:render' && flags.check) return null;
  if (id === 'where') return flags.record ? 'workspace' : null;
  if (id === 'status') return flags.fetch ? 'workspace' : null;
  if (id === 'doctor') return flags.fix ? 'workspace' : null;
  if (WORKSPACE_WRITERS.has(id)) return 'workspace';
  return SOURCE_WRITERS.has(id) ? 'source' : null;
}
