// What a failing tool's stderr means. A family tool writes its `_notice`/`_progress`
// lines first and its error envelope last, each a JSON object that may be pretty-
// printed. Any other tool is read by its own words: the message of the error object
// it printed, alone or after a prefix such as kubectl's `Error from server (Forbidden):`,
// or where it failed and why, its first two lines of text once log records and
// warnings are set aside.

import { isRecord } from '../values.js';

const REASON_LIMIT = 240;
const MESSAGE_KEYS = ['message', 'errmsg', 'error'];
// A log record opens with a timestamp or a logfmt field.
const ASIDE =
  /^(?:[IWEF]\d{4} \d{2}:\d{2}|\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|(?:time|ts|level)=|warn(?:ing)?\b)/i;

export function stderrReason(stderr: string, code: number): string {
  const { objects, text } = splitJsonObjects(stderr);
  const message = errorEnvelopeOf(objects)?.['message'];
  if (typeof message === 'string') return message;
  return shorten(
    statedMessage(objects) ?? prefixedMessage(text) ?? textReason(text) ?? `exit ${code}`,
  );
}

// A wrapper around a remote API may print that service's error object as it is.
function statedMessage(objects: readonly Record<string, unknown>[]): string | undefined {
  for (const object of [...objects].reverse()) {
    const message = messageOf(object);
    if (message !== undefined) return message;
  }
  return undefined;
}

// A log record or warning that carries a JSON object is set aside as in plain text.
function prefixedMessage(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const at = line.indexOf('{');
    if (at <= 0 || ASIDE.test(line.trim())) continue;
    const object = parseObject(line.slice(at));
    const message = object === undefined ? undefined : messageOf(object);
    if (message !== undefined) return `${line.slice(0, at).trim()} ${message}`;
  }
  return undefined;
}

// Services spell the key their own way, `Message` as well as `message`.
function messageOf(object: Record<string, unknown>): string | undefined {
  for (const key of MESSAGE_KEYS) {
    const value = Object.entries(object).find(([name]) => name.toLowerCase() === key)?.[1];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function textReason(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const stated = lines.filter((line) => !ASIDE.test(line));
  return stated.length > 0 ? stated.slice(0, 2).join(' ') : lines.at(-1);
}

function shorten(reason: string): string {
  return reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT - 1).trimEnd()}…` : reason;
}

export function errorEnvelope(stderr: string): Record<string, unknown> | undefined {
  return errorEnvelopeOf(splitJsonObjects(stderr).objects);
}

function errorEnvelopeOf(objects: readonly Record<string, unknown>[]) {
  for (const object of objects) {
    const error = object['error'];
    if (isRecord(error)) return error;
  }
  return undefined;
}

// A JSON object begins on a line that opens with `{` and ends where its
// braces balance, one line or many; a line that opens one but never parses
// is plain text after all.
function splitJsonObjects(input: string): { objects: Record<string, unknown>[]; text: string } {
  const lines = input.split('\n');
  const objects: Record<string, unknown>[] = [];
  const plain: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const end = line.trimStart().startsWith('{') ? closingLine(lines, i) : -1;
    const parsed = end < 0 ? undefined : parseObject(lines.slice(i, end + 1).join('\n'));
    if (parsed === undefined) plain.push(line);
    else {
      objects.push(parsed);
      i = end;
    }
  }
  return { objects, text: plain.join('\n') };
}

function closingLine(lines: readonly string[], from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (inString) {
        if (ch === '\\') j += 1;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
