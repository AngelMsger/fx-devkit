// Decode only leading YAML frontmatter; malformed Skill metadata remains unknown.

import { parse } from 'yaml';

export interface SkillFrontmatter {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

export function parseFrontmatter(text: string): SkillFrontmatter {
  const block = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (block?.[1] === undefined) return {};
  try {
    const value: unknown = parse(block[1]);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(
      ['name', 'version', 'description'].flatMap((key) => {
        const field = fields[key];
        return typeof field === 'string' && field.trim() ? [[key, field.trim()]] : [];
      }),
    );
  } catch {
    return {};
  }
}
