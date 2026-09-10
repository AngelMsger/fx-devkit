// Appends a line to the trace file. Missing directories are not created:
// the file is the caller's to place.

import { promises as fs } from 'node:fs';

export function appendLineTo(file: string): (line: string) => Promise<void> {
  return (line) => fs.appendFile(file, line, 'utf8');
}
