// Inspect only declared public INI defaults; unrelated and credential sections stay opaque.
export function matchesPublicDefaults(
  text: string,
  expected: Readonly<Record<string, string>>,
): boolean {
  let section = '';
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed)) continue;
    const header = /^\[([^\]]+)\]$/.exec(trimmed);
    if (header) {
      section = header[1] ?? '';
      continue;
    }
    if (section !== 'defaults') continue;
    const equal = trimmed.indexOf('=');
    const key = trimmed.slice(0, equal).trim();
    if (equal < 0 || !(key in expected)) continue;
    values[key] = trimmed.slice(equal + 1).trim();
  }
  return Object.entries(expected).every(([key, value]) => values[key] === value);
}
