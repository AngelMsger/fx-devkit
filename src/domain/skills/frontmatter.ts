// The three frontmatter fields fx reads off a SKILL.md. Only the leading
// `---` block counts; a `version:` in the body is prose.

export interface Frontmatter {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const out: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const match = /^(name|version|description):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined)
      out[match[1]] = unquote(match[2].trim());
  }
  return out;
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}
