import { describe, expect, it } from 'vitest';

import { COMMANDS } from '../../../src/cli/commands/index.js';
import { writeScopeOf } from '../../../src/cli/workspace-write-policy.js';

type CommandId = keyof typeof COMMANDS;

const registry = Object.entries(COMMANDS) as [CommandId, (typeof COMMANDS)[CommandId]][];

// Writers the command base holds no lease for, by what keeps them safe without it.
const UNLEASED: Readonly<Record<string, readonly CommandId[]>> = {
  'the use case takes the operation lease itself, for each workspace it resolves': [
    'init',
    'workspace:unregister',
    'workspace:relocate',
    'workspace:rebind',
    'source:push',
    'config:import',
    'agent:unpick',
  ],
  'it writes personal or machine-wide state that belongs to no workspace': [
    'agent:pick',
    'config:set',
    'config:unset',
    'config:export',
    'manifest:import',
    'skill:install',
    'skill:uninstall',
    'skill:update',
    'tool:install',
    'tool:update',
    'self:update',
  ],
};

function scope(id: CommandId, flags: Readonly<Record<string, unknown>> = {}) {
  return writeScopeOf(COMMANDS[id], flags);
}

describe('workspace write scope', () => {
  it('is declared by every command that offers --dry-run and is not listed as unleased', () => {
    const offering = registry
      .filter(([, command]) => 'dry-run' in (command.flags ?? {}))
      .map(([id]) => id);
    const declaring = registry
      .filter(([, command]) => command.writeScope !== undefined)
      .map(([id]) => id);
    expect([...declaring, ...Object.values(UNLEASED).flat()].sort()).toEqual(offering.sort());
  });

  it('leases a conditional writer only for the invocation that writes', () => {
    expect(scope('where', { record: true, check: true })).toBe('workspace');
    expect(scope('where', { record: true, check: false })).toBe('workspace');
    expect(scope('where', { probe: true, check: true })).toBeNull();
    expect(scope('status', { fetch: true })).toBe('workspace');
    expect(scope('status')).toBeNull();
    expect(scope('doctor', { fix: true })).toBe('workspace');
    expect(scope('doctor')).toBeNull();
    expect(scope('manifest:render')).toBe('source');
    expect(scope('manifest:render', { check: true })).toBeNull();
    expect(scope('login')).toBe('workspace');
    expect(scope('login', { list: true })).toBeNull();
  });

  it('never leases a preview, whatever else the invocation asks for', () => {
    const writing = { 'dry-run': true, record: true, fetch: true, fix: true };
    for (const [id, command] of registry) expect(writeScopeOf(command, writing), id).toBeNull();
  });

  it('holds the source lease for a manifest edit, and the same lease under a retired name', () => {
    expect(scope('manifest:repo-set')).toBe('source');
    expect(scope('manifest:set')).toBe('source');
    expect(scope('hook:inject')).toBe('workspace');
    expect(scope('hook:remove')).toBe('workspace');
  });
});
