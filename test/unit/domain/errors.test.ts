import { describe, expect, it } from 'vitest';

import {
  asDevkitError,
  CATEGORIES,
  DevkitError,
  exitCodeFor,
  toEnvelope,
} from '../../../src/domain/errors.js';

describe('DevkitError', () => {
  it('maps every category to the family exit code', () => {
    const expected = {
      internal: 1,
      usage: 2,
      config: 3,
      auth: 4,
      permission: 5,
      not_found: 6,
      rate_limit: 7,
      network: 8,
      server: 9,
      parse: 10,
      conflict: 11,
    };
    expect(Object.fromEntries(CATEGORIES.map((c) => [c, exitCodeFor(c)]))).toEqual(expected);
  });

  it('marks only rate_limit, network and server as retryable', () => {
    const retryable = CATEGORIES.filter((c) => new DevkitError(c, 'X', 'x').retryable);
    expect(retryable).toEqual(['rate_limit', 'network', 'server']);
  });

  it('always carries a hint and next steps, falling back to category guidance', () => {
    const bare = new DevkitError('auth', 'TOKEN_MISSING', 'no token');
    expect(bare.hint.length).toBeGreaterThan(0);
    expect(bare.nextSteps.length).toBeGreaterThan(0);

    const given = new DevkitError('auth', 'TOKEN_MISSING', 'no token', {
      hint: 'Log in first.',
      nextSteps: ['fx login bitbucket-cli'],
    });
    expect(given.hint).toBe('Log in first.');
    expect(given.nextSteps).toEqual(['fx login bitbucket-cli']);
  });

  it('renders the envelope with snake_case keys and omits an absent handoff', () => {
    const err = new DevkitError('config', 'LOGIN_REQUIRED', 'kubectl has no context for env test', {
      hint: 'Run the setup for this environment.',
      nextSteps: ['fx login kubectl --env test'],
      handoff: {
        summary: 'kubeconfig missing',
        userSteps: [],
        command: 'fx login kubectl --env test',
      },
    });
    expect(toEnvelope(err)).toEqual({
      error: {
        category: 'config',
        code: 'LOGIN_REQUIRED',
        message: 'kubectl has no context for env test',
        hint: 'Run the setup for this environment.',
        next_steps: ['fx login kubectl --env test'],
        retryable: false,
        handoff: {
          summary: 'kubeconfig missing',
          user_steps: [],
          command: 'fx login kubectl --env test',
        },
      },
    });
    expect(toEnvelope(new DevkitError('usage', 'BAD_FLAG', 'x')).error).not.toHaveProperty(
      'handoff',
    );
  });

  it('wraps a foreign error as internal and keeps the cause', () => {
    const cause = new Error('boom');
    const wrapped = asDevkitError(cause);
    expect(wrapped).toMatchObject({ category: 'internal', code: 'INTERNAL', message: 'boom' });
    expect(wrapped.cause).toBe(cause);
    expect(asDevkitError(wrapped)).toBe(wrapped);
  });
});
