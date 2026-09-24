// Keep a native setup failure actionable without retaining command output or credentials.
import { CATEGORIES, DevkitError, toEnvelope, type ErrorEnvelope } from '../../domain/errors.js';
import { errorEnvelope, stderrReason } from '../../domain/toolchain/stderr.js';

export function setupCommandFailure(stderr: string, exitCode: number): ErrorEnvelope['error'] {
  const native = errorEnvelope(stderr);
  const category = CATEGORIES.find((value) => value === native?.['category']) ?? 'config';
  const code = typeof native?.['code'] === 'string' ? native['code'] : 'SETUP_COMMAND_FAILED';
  const hint = typeof native?.['hint'] === 'string' ? native['hint'] : undefined;
  const steps = native?.['next_steps'];
  const nextSteps = Array.isArray(steps)
    ? steps.filter((step): step is string => typeof step === 'string')
    : undefined;
  return toEnvelope(
    new DevkitError(category, code, stderrReason(stderr, exitCode), {
      ...(hint === undefined ? {} : { hint }),
      ...(nextSteps === undefined ? {} : { nextSteps }),
    }),
  ).error;
}
