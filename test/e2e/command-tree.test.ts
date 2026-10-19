// Two readings of the command tree must agree: the registry that main, help and
// the docs generator read, and oclif's loaded tree that completion walks.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Config } from '@oclif/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { COMMANDS } from '../../src/cli/commands/index.js';
import { globalFlags } from '../../src/cli/flags.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let loaded: Config;

beforeAll(async () => {
  loaded = await Config.load(root);
});

describe('command tree', () => {
  it('hides the same commands in both readings', () => {
    const registry = Object.entries(COMMANDS)
      .filter(([, command]) => command.hidden)
      .map(([id]) => id)
      .sort();
    expect(
      loaded.commands
        .filter((command) => command.hidden)
        .map((command) => command.id)
        .sort(),
    ).toEqual(registry);
  });

  // oclif caches the global flags onto every loaded command; the registry class
  // declares only its own.
  it('offers each command the same flags in both readings', () => {
    for (const command of loaded.commands) {
      const registered = COMMANDS[command.id as keyof typeof COMMANDS];
      expect(command.description).toBe(registered.description);
      expect(Object.keys(command.flags).sort()).toEqual(
        [...new Set([...Object.keys(registered.flags ?? {}), ...Object.keys(globalFlags)])].sort(),
      );
    }
  });
});
