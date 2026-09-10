// The registry of personal settings. Everything that mentions a key — the
// resolver, `config list`, "did you mean", help text — derives from this
// table. The domain config codec owns the stored shape.

import type { ConfigFile } from '../../domain/config/file.js';
import { DEFAULT_FORMAT, FORMATS } from '../../domain/format.js';
import { COMMAND_SHELLS } from '../../domain/shell.js';

export type KeyName = Exclude<keyof ConfigFile, 'workspaces'>;
export type KeyKind = 'string' | 'enum' | 'list' | 'bool';

export interface Key {
  readonly name: KeyName;
  readonly env: string;
  readonly flag?: string;
  readonly kind: KeyKind;
  readonly default?: string;
  readonly options?: readonly string[];
  readonly desc: string;
}

export const KEYS: readonly Key[] = [
  {
    name: 'command_shell',
    env: 'FX_COMMAND_SHELL',
    flag: 'command-shell',
    kind: 'enum',
    default: 'auto',
    options: COMMAND_SHELLS,
    desc: 'shell used for generated commands; auto selects PowerShell on Windows and POSIX elsewhere',
  },
  {
    name: 'hooks',
    env: 'FX_HOOKS',
    kind: 'bool',
    default: 'true',
    desc: 'allow workspace lifecycle hooks; each workspace can also disable them',
  },
  {
    name: 'default_workspace',
    env: 'FX_WORKSPACE',
    flag: 'workspace',
    kind: 'string',
    desc: 'workspace used when the current directory is not inside one',
  },
  {
    name: 'user',
    env: 'FX_USER',
    kind: 'string',
    desc: 'code-host username, the namespace of your forks',
  },
  {
    name: 'format',
    env: 'FX_FORMAT',
    flag: 'format',
    kind: 'enum',
    default: DEFAULT_FORMAT,
    options: FORMATS,
    desc: 'default output format',
  },
  {
    name: 'agents',
    env: 'FX_AGENTS',
    kind: 'list',
    desc: 'coding agents that receive Skills and lifecycle hooks; omit to auto-detect',
  },
  {
    name: 'read_only',
    env: 'FX_READ_ONLY',
    kind: 'bool',
    desc: 'refuse every write unless --allow-writes is passed',
  },
  {
    name: 'skill_notice',
    env: 'FX_SKILL_NOTICE',
    kind: 'bool',
    default: 'true',
    desc: 'tell an agent (json/ndjson output) when the fx Skill is missing, outdated or not loaded',
  },
  {
    name: 'update_check',
    env: 'FX_UPDATE_CHECK',
    kind: 'bool',
    default: 'true',
    desc: 'say on stderr when a newer fx is published or the manifest repository moved upstream',
  },
];
