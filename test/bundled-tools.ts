// The tools catalog fx ships, read the way a workspace context is handed it.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function bundledTools(): string {
  return readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');
}
