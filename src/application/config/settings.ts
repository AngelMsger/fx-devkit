// Every personal setting of one invocation, already typed. Coercion follows the
// kind each key declares in the catalog, so a default such as "hooks are on
// unless the value spells false" is written once rather than at every reader.

import { parseBoolean, parseList } from '../../domain/values.js';
import type { ConfigFile } from '../../ports/stores.js';

import { KEYS, type Key, type KeyName } from './keys.js';
import { resolveKey } from './resolve.js';

export interface SettingsInput {
  readonly env: NodeJS.ProcessEnv;
  readonly file: ConfigFile;
  readonly flags?: Readonly<Partial<Record<KeyName, string | undefined>>>;
}

export interface Settings {
  readonly commandShell: string | undefined;
  readonly defaultWorkspace: string | undefined;
  readonly user: string | undefined;
  readonly format: string | undefined;
  readonly agents: readonly string[] | undefined;
  readonly hooks: boolean;
  readonly readOnly: boolean;
  readonly skillNotice: boolean;
  readonly updateCheck: boolean;
}

export function readSettings(input: SettingsInput): Settings {
  const values = new Map(KEYS.map((key) => [key.name, valueOf(key, input)]));
  // The kind table decides each shape; the accessors only name the expectation.
  const text = (name: KeyName): string | undefined => values.get(name) as string | undefined;
  const flag = (name: KeyName): boolean => values.get(name) as boolean;
  const list = (name: KeyName): readonly string[] | undefined =>
    values.get(name) as readonly string[] | undefined;
  return {
    commandShell: text('command_shell'),
    defaultWorkspace: text('default_workspace'),
    user: text('user'),
    format: text('format'),
    agents: list('agents'),
    hooks: flag('hooks'),
    readOnly: flag('read_only'),
    skillNotice: flag('skill_notice'),
    updateCheck: flag('update_check'),
  };
}

function valueOf(key: Key, input: SettingsInput): string | boolean | readonly string[] | undefined {
  const flag = input.flags?.[key.name];
  const resolved = resolveKey(key.name, { flag, env: input.env, file: input.file }).value;
  switch (key.kind) {
    case 'bool':
      // An unreadable spelling keeps the built-in answer rather than inverting it.
      return parseBoolean(resolved) ?? parseBoolean(key.default) ?? false;
    case 'list':
      return parseList(resolved);
    case 'string':
    case 'enum':
      return resolved;
  }
}
