// Every directory a test file creates lives under one root that the file
// removes when it finishes, so a run leaves nothing in the system temporary
// directory. Vitest isolates modules per file, so each file gets its own.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

// Windows can hand out a short (8.3) temporary path; the native real path is the
// long name git and fs.promises.realpath report, so tests compare like with like.
const sessionRoot = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'fx-test-')));
// Windows removes a file only once every handle on it closes, so files a process
// that just ended still held can leave a directory briefly not empty.
afterAll(() => rmSync(sessionRoot, { recursive: true, force: true, maxRetries: 10 }));

// The prefix carries its own separator: mkdtemp appends six random characters.
export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(sessionRoot, prefix));
}
