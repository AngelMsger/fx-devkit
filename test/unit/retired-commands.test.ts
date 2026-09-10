// The M10 reshape retired a set of command names. Nothing fx generates,
// prints as a next step, or documents may still say them; the changelog's
// migration table is the one place they belong.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const RETIRED =
  /fx (bootstrap|setup|need|obs (where|probe)|docs render|profile (export|import)|skill (sync|install)|tool (check|explain)|agent (detect|enable|disable)|member (who|owners)|config path|self version|version(?!\s[a-z])|import)\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

// Prose may also name a retired command bare, in backticks; code may not be
// held to that (a `setup` recipe is a domain word).
const BARE =
  /`(bootstrap|obs (where|probe)|docs render|profile (export|import)|skill (sync|install)|tool (check|explain)|agent (detect|enable|disable)|member (who|owners)|config path|self version)`/;
const PROSE = /\.md$/;

const ROOTS = ['src', 'skills', 'docs/design', 'docs/cli', 'README.md', 'AGENTS.md'];

describe('retired command names', () => {
  it('appear nowhere outside the changelog', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      const list = statSync(root).isDirectory() ? files(root) : [root];
      for (const file of list) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (RETIRED.test(line) || (PROSE.test(file) && BARE.test(line)))
              offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
