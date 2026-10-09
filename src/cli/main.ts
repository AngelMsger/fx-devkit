// Process entry. Routes the argv first (see route.ts), then hands it to
// oclif; anything that escapes oclif without a command's own error boundary
// still leaves through the family error contract.

import { Errors, flush, run } from '@oclif/core';

import { createContainer } from '../composition/container.js';
import { traceFor } from '../composition/trace.js';
import { asDevkitError, DevkitError, exitCodeFor } from '../domain/errors.js';

import { commandIds } from './commands/index.js';
import { readInvocationFormat } from './invocation-format.js';
import { createRenderer, FORMATS, processIo } from './render/index.js';
import { normalizeArgv, routeArgv, type Route } from './route/index.js';
import { invocation } from './trace.js';

export async function main(argv: string[]): Promise<void> {
  invocation.trace = traceFor(process.env, Date.now());
  const normalized = normalizeArgv(argv, commandIds());
  await dispatch(normalized);
  await invocation.trace?.end(
    normalized,
    process.exitCode === undefined ? 0 : Number(process.exitCode),
    Date.now(),
  );
}

async function dispatch(normalized: string[]): Promise<void> {
  const route = routeArgv(normalized, commandIds(), { discoverableIds: commandIds(false) });
  const refusal = routeError(route);
  if (refusal !== undefined) {
    await fail(normalized, refusal);
    return;
  }
  try {
    // oclif knows --version but not its short form.
    await run(
      normalized.length === 1 && normalized[0] === '-v' ? ['--version'] : normalized,
      import.meta.url,
    );
    await flush();
  } catch (err) {
    if (err instanceof Errors.ExitError) {
      process.exitCode = err.oclif.exit;
      return;
    }
    await fail(normalized, asDevkitError(err));
  }
}

// Every way an invocation can fail before oclif parses it, as one envelope.
function routeError(route: Route): DevkitError | undefined {
  switch (route.kind) {
    case 'run':
      return undefined;
    case 'misplaced-flag':
      return new DevkitError('usage', 'BAD_FLAG', `"${route.flag}" comes before any command`, {
        hint: 'Only global flags may appear before a command.',
        nextSteps: ['fx <command> --help', 'fx --help'],
      });
    case 'bad-flag-value': {
      const accepted = route.flag === '--format' ? ` (${FORMATS.join(', ')})` : '';
      return new DevkitError(
        'usage',
        'BAD_FLAG',
        route.value === undefined || route.value === ''
          ? `${route.flag} needs a value${accepted}`
          : `"${route.value}" is not a value ${route.flag} accepts${accepted}`,
        { nextSteps: ['fx --help', 'fx <command> --help'] },
      );
    }
    case 'stray-flag':
      return new DevkitError(
        'usage',
        'BAD_FLAG',
        `"${route.flag}" is not a flag of \`fx ${route.topic}\``,
        {
          hint: `\`fx ${route.topic}\` is a topic; pick one of its commands.`,
          nextSteps: [`fx ${route.topic} --help`],
        },
      );
    case 'unknown': {
      if (route.replacement !== undefined)
        return new DevkitError(
          'usage',
          'UNKNOWN_COMMAND',
          `Unknown command "fx ${route.attempted}"`,
          {
            hint: `\`fx ${route.attempted}\` was retired; run \`fx ${route.replacement[0]}\`.`,
            nextSteps: [...route.replacement.map((r) => `fx ${r}`), `fx ${route.help}`],
          },
        );
      const suggestion =
        route.nearest === undefined ? '' : ` Did you mean \`fx ${route.nearest}\`?`;
      return new DevkitError(
        'usage',
        'UNKNOWN_COMMAND',
        `Unknown command "fx ${route.attempted}"`,
        {
          hint: `\`fx ${route.attempted}\` is not a command.${suggestion}`,
          nextSteps: [`fx ${route.help}`],
        },
      );
    }
  }
}

async function fail(argv: readonly string[], err: DevkitError): Promise<void> {
  invocation.trace?.failed(err);
  const format = await readInvocationFormat(argv, process.env, createContainer(process.env).config);
  createRenderer(format, processIo()).error(err);
  process.exitCode = exitCodeFor(err.category);
}
