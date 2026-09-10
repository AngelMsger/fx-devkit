// Assets shipped inside the package: the toolchain baseline now, the
// companion Skill later. Located relative to the compiled module so a global
// install and a checkout resolve the same files.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function bundledToolsText(): string {
  return readFileSync(new URL('../../defaults/tools.yaml', import.meta.url), 'utf8');
}

export function bundledSkillDir(): string {
  return fileURLToPath(new URL('../../skills/fx-workspace', import.meta.url));
}
