// How often fx looks upstream and how long it is willing to wait. Family
// rule 10.2: a check is best-effort, cached, time-bounded and silent when
// it fails; it never changes the command's own result.

export const FX_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
export const MANIFEST_UPDATE_TTL_MS = 60 * 60 * 1000;
export const PROBE_TIMEOUT_MS = 2000;

export const UPDATE_CHECK_ENV = 'FX_UPDATE_CHECK';
export const SILENCE = `${UPDATE_CHECK_ENV}=0 or \`fx config set update_check false\``;
