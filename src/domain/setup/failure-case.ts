// Which of a recipe's failure cases a failed check answers to. Nothing from the output
// is quoted: a case only names a cause its recipe wrote down beforehand.

import type { FailureCase } from './types.js';

export interface CheckOutput {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function failureCaseOf(
  output: CheckOutput,
  cases: readonly FailureCase[] = [],
): FailureCase | undefined {
  return cases.find(
    (candidate) =>
      (candidate.exitCode === undefined || candidate.exitCode === output.code) &&
      answers(candidate.stdout, output.stdout) &&
      answers(candidate.stderr, output.stderr),
  );
}

function answers(pattern: string | undefined, text: string): boolean {
  return pattern === undefined || new RegExp(pattern).test(text);
}
