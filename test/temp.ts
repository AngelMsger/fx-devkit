// Every directory a test file creates lives under one root that the file
// removes when it finishes, so a run leaves nothing in the system temporary
// directory. Vitest isolates modules per file, so each file gets its own.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

const sessionRoot = mkdtempSync(path.join(tmpdir(), 'fx-test-'));
afterAll(() => rmSync(sessionRoot, { recursive: true, force: true }));

// The prefix carries its own separator: mkdtemp appends six random characters.
export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(sessionRoot, prefix));
}
