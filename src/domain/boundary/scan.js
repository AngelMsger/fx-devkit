// @ts-check
// Boundary findings identify locations, never matched values. Private manifest
// addresses are permitted; credential and personnel protections apply everywhere.
// JavaScript, because the package check loads the scanner without a build.

/**
 * @typedef {{
 *   readonly text: string,
 *   readonly policy: 'manifest' | 'distributable',
 *   readonly internalHosts?: readonly string[],
 *   readonly syntax?: 'code' | 'text',
 * }} BoundaryInput
 */

/**
 * @typedef {{
 *   readonly rule: 'credential' | 'personnel' | 'email' | 'internal-address',
 *   readonly line: number,
 *   readonly column: number,
 * }} BoundaryFinding
 */

/** @type {readonly { readonly rule: BoundaryFinding['rule'], readonly pattern: RegExp }[]} */
const RULES = [
  {
    rule: 'personnel',
    pattern: /^[ \t]*(?:["']?sensitive["']?:[ \t]*true\b|["']?people["']?:[ \t]*(?=\[|\{|$))/gm,
  },
  { rule: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { rule: 'credential', pattern: /-{5}BEGIN (?:[A-Z]+ )?PRIVATE KEY-{5}/g },
  {
    rule: 'credential',
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
  },
  { rule: 'credential', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi },
  {
    rule: 'credential',
    pattern:
      /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b["']?\s*(?::|=(?!=))\s*(["']?)([^\s,;\r\n]+)\1/gi,
  },
  { rule: 'credential', pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/g },
];

/**
 * @param {BoundaryInput} input
 * @returns {readonly BoundaryFinding[]}
 */
export function scanBoundary(input) {
  /** @type {BoundaryFinding[]} */
  const findings = [];
  for (const definition of RULES) {
    for (const match of input.text.matchAll(new RegExp(definition.pattern))) {
      if (match[2] !== undefined && isPlaceholder(match[2])) continue;
      if (match[2] !== undefined && input.syntax === 'code' && !match[1]) continue;
      if (definition.rule === 'email' && isExampleEmail(match[0])) continue;
      findings.push(at(input.text, match.index, definition.rule));
    }
  }
  if (input.policy === 'distributable') findings.push(...scanAddresses(input));
  return findings.sort(
    (a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule),
  );
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isExampleEmail(value) {
  return /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
  const plain = value.replace(/["']$/, '');
  return /^(?:\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|<[^>]+>|null|undefined|true|false)$/u.test(plain);
}

/**
 * @param {BoundaryInput} input
 * @returns {BoundaryFinding[]}
 */
function scanAddresses(input) {
  const matches = input.text.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z0-9-]+\b/gi);
  const known = new Set((input.internalHosts ?? []).map((host) => host.toLowerCase()));
  /** @type {BoundaryFinding[]} */
  const findings = [];
  for (const match of matches) {
    const host = match[0].toLowerCase();
    if (input.syntax === 'code' && !isAddressLiteral(input.text, match.index, host.length))
      continue;
    if (/\.(?:internal|local|lan|corp)$/.test(host) || isPrivateIp(host) || known.has(host))
      findings.push(at(input.text, match.index, 'internal-address'));
  }
  return findings;
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isPrivateIp(host) {
  const octets = host.split('.');
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
  )
    return false;
  const [a, b] = octets.map(Number);
  return (
    a === 10 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

/**
 * @param {string} text
 * @param {number} offset
 * @param {BoundaryFinding['rule']} rule
 * @returns {BoundaryFinding}
 */
function at(text, offset, rule) {
  const before = text.slice(0, offset);
  return { rule, line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} length
 * @returns {boolean}
 */
function isAddressLiteral(text, start, length) {
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text[start + length];
  return (
    before.endsWith('://') ||
    (/["'`]$/.test(before) && (after === '"' || after === "'" || after === '`'))
  );
}

/**
 * @param {readonly string[]} vector
 * @returns {boolean}
 */
export function containsCommandCredentials(vector) {
  const literals = [
    vector.join(' '),
    ...vector.flatMap((arg, index) =>
      arg.startsWith('-') && vector[index + 1] !== undefined ? [`${arg}=${vector[index + 1]}`] : [],
    ),
  ];
  return literals.some((text) =>
    scanBoundary({ text, policy: 'manifest' }).some((finding) => finding.rule === 'credential'),
  );
}
