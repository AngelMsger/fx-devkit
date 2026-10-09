// A failure case names a cause only when everything it states holds; output that no
// case answers to keeps its cause unknown rather than borrowing the nearest one.

import { expect, it } from 'vitest';

import { failureCaseOf } from '../../../../src/domain/setup/failure-case.js';
import type { FailureCase } from '../../../../src/domain/setup/types.js';

const denied: FailureCase = {
  cause: 'permission',
  exitCode: 1,
  stdout: '^no$',
  stderr: '^$',
  instructions: 'Ask for a role.',
};
const rejected: FailureCase = {
  cause: 'credential',
  stderr: 'Unauthorized',
  instructions: 'Sign in again.',
};

it('takes the first case whose every stated condition holds', () => {
  const cases = [rejected, denied];
  expect(failureCaseOf({ code: 1, stdout: 'no', stderr: '' }, cases)).toBe(denied);
  expect(failureCaseOf({ code: 1, stdout: '', stderr: 'error: Unauthorized' }, cases)).toBe(
    rejected,
  );
  expect(
    failureCaseOf({ code: 1, stdout: '', stderr: 'Unauthorized' }, [
      { ...rejected, cause: 'network' },
      rejected,
    ])?.cause,
  ).toBe('network');
});

it('leaves the cause unknown when one stated condition does not hold', () => {
  expect(failureCaseOf({ code: 2, stdout: 'no', stderr: '' }, [denied])).toBeUndefined();
  expect(failureCaseOf({ code: 1, stdout: 'no', stderr: 'warning' }, [denied])).toBeUndefined();
  expect(failureCaseOf({ code: 1, stdout: '', stderr: 'x509: bad cert' }, [rejected])).toBe(
    undefined,
  );
  expect(failureCaseOf({ code: 1, stdout: 'no', stderr: '' })).toBeUndefined();
});
