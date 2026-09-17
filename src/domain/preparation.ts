// Interpret structured preparation outcomes without conflating protected work,
// missing prerequisites or host trust with completed preparation.

const INCOMPLETE = new Set([
  'failed',
  'blocked',
  'not_started',
  'missing',
  'outdated',
  'unknown',
  'foreign',
  'conflict',
  'unverified',
  'unreadable',
  'not_implemented',
  'skip_dirty',
  'skip_diverged',
  'skip_not_git',
  'skip_remote_mismatch',
  'diverged',
]);
const STATE_KEYS = new Set(['status', 'state', 'action', 'result', 'activation', 'outcome']);
const COUNT_SUFFIX =
  /(?:^|_)(failed|blocked|not_started|missing|outdated|unknown|foreign|conflict|unverified|unreadable|problems)$/;

export function hasPreparationIssue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPreparationIssue);
  if (typeof value !== 'object' || value === null) return value === 'not_implemented';
  const row = value as Record<string, unknown>;
  if (row['coverage'] === 'not_applicable' || row['status'] === 'not_covered') return false;
  if (
    (row['failure'] === undefined || row['failure'] === null) &&
    (row['error'] === undefined || row['error'] === null) &&
    [row['action'], row['status'], row['state']].some(
      (state) => state === 'disabled' || state === 'unsupported',
    )
  )
    return false;
  return Object.entries(row).some(([key, item]) => {
    if (item === 'not_implemented') return true;
    if ((key === 'failure' || key === 'error') && item !== undefined && item !== null) return true;
    if (key === 'coverage' && item === 'incomplete') return true;
    if (STATE_KEYS.has(key) && typeof item === 'string' && INCOMPLETE.has(item)) return true;
    if (
      typeof item === 'number' &&
      item > 0 &&
      (COUNT_SUFFIX.test(key) || key === 'missing_regions')
    )
      return true;
    return typeof item === 'object' && item !== null && hasPreparationIssue(item);
  });
}
