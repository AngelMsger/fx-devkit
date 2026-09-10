// What a failing tool's stderr means. A family tool writes its `_notice`/`_progress`
// lines first and its error envelope last, each a JSON object that may be pretty-
// printed; any other tool is read by its first plain line.

export function stderrReason(stderr: string, code: number): string {
  const { objects, text } = splitJsonObjects(stderr);
  const message = errorEnvelopeOf(objects)?.['message'];
  if (typeof message === 'string') return message;
  const plain = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  return plain ?? `exit ${code}`;
}

export function errorEnvelope(stderr: string): Record<string, unknown> | undefined {
  return errorEnvelopeOf(splitJsonObjects(stderr).objects);
}

function errorEnvelopeOf(objects: readonly Record<string, unknown>[]) {
  for (const object of objects) {
    const error = object['error'];
    if (isObject(error)) return error;
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
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
