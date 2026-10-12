// Assets shipped inside the package: its own identity, the toolchain baseline
// and the companion Skill. Located relative to the compiled module so a global
// install and a checkout resolve the same files.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface PackageMetadata {
  readonly name: string;
  readonly version: string;
}

export function bundledPackage(): PackageMetadata {
  const { name, version } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as PackageMetadata;
  return { name, version };
}

export function bundledToolsPath(): string {
  return fileURLToPath(new URL('../../defaults/tools.yaml', import.meta.url));
}

export function bundledToolsText(): string {
  return readFileSync(bundledToolsPath(), 'utf8');
}

export function bundledSkillDir(): string {
  return fileURLToPath(new URL('../../skills/fx-workspace', import.meta.url));
}

export function fxExecutable(): readonly string[] {
  return [process.execPath, fileURLToPath(new URL('../../bin/fx.js', import.meta.url))];
}
