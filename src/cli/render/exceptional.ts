// Keep exceptional evidence in compact reports. This display filter never decides readiness.

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

export function hasExceptionalEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExceptionalEvidence);
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (
    row['preparation_required'] === false &&
    (row['failure'] === undefined || row['failure'] === null) &&
    (row['error'] === undefined || row['error'] === null)
  )
    return false;
  if (row['preparation_required'] === true && row['state'] === 'disabled') return true;
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
    if (
      key === 'stages' &&
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      Object.values(item).includes('not_implemented')
    )
      return true;
    if ((key === 'failure' || key === 'error') && item !== undefined && item !== null) return true;
    if (key === 'coverage' && item === 'incomplete') return true;
    if (STATE_KEYS.has(key) && typeof item === 'string' && INCOMPLETE.has(item)) return true;
    if (
      typeof item === 'number' &&
      item > 0 &&
      (COUNT_SUFFIX.test(key) || key === 'missing_regions')
    )
      return true;
    return typeof item === 'object' && item !== null && hasExceptionalEvidence(item);
  });
}
