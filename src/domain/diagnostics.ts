// Diagnostic redaction keeps troubleshooting useful without moving credentials
// or unbounded companion output onto fx's stderr data channel.

const SECRET_FLAG = /^--?(?:api[-_]?key|auth|credential|password|secret|token)$/i;
const SECRET_ASSIGNMENT = /^(--?(?:api[-_]?key|auth|credential|password|secret|token))=(.*)$/i;
const URL_CREDENTIALS = /(https?:\/\/[^\s:/@]+:)[^\s@]+@/gi;
const BEARER = /(\b(?:authorization\s*:\s*)?bearer\s+)[^\s,;]+/gi;
const ASSIGNMENT = /(\b(?:api[-_]?key|password|secret|token)\s*[=:]\s*)[^\s,;]+/gi;
const LIMIT = 4096;

export interface DiagnosticEvent {
  readonly kind: 'process' | 'manifest' | 'provider' | 'cause';
  readonly phase: string;
  readonly vector?: readonly string[];
  readonly cwd?: string;
  readonly timeout_ms?: number;
  readonly exit_code?: number;
  readonly stderr?: string;
  readonly file?: string;
  readonly field?: string;
  readonly line?: number;
  readonly capability?: string;
  readonly provider?: string;
  readonly binding?: string;
  readonly cause_chain?: readonly string[];
}

export function redactVector(vector: readonly string[]): string[] {
  let hidesNext = false;
  return vector.map((argument) => {
    if (hidesNext) {
      hidesNext = false;
      return '[REDACTED]';
    }
    if (SECRET_FLAG.test(argument)) {
      hidesNext = true;
      return argument;
    }
    const assigned = SECRET_ASSIGNMENT.exec(argument);
    if (assigned !== null) return `${assigned[1] ?? ''}=[REDACTED]`;
    return redactText(argument);
  });
}

export function redactText(input: string): string {
  return input
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(BEARER, '$1[REDACTED]')
    .replace(ASSIGNMENT, '$1[REDACTED]');
}

export function summarizeDiagnostic(input: string): string | undefined {
  const text = redactText(input.trim());
  if (text === '') return undefined;
  if (text.length <= LIMIT) return text;
  return `[truncated ${text.length - LIMIT} chars]\n${text.slice(-LIMIT)}`;
}

export function causeChain(error: Error): string[] {
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    chain.push(redactText(`${current.name}: ${current.message}`));
    current = current.cause;
  }
  return chain;
}
