// Workspace reference providers return data only. Commands are handed to
// the caller; incomplete templates never become executable-looking entries.

import { DevkitError } from '../../domain/errors.js';
import type { Coordinate } from '../../domain/obs/types.js';
import { placeholders, substitute, substituteAll, type Vars } from '../../domain/template.js';

export function referenceEntry(input: {
  readonly template: Coordinate;
  readonly vars: Vars;
}): Coordinate {
  const { template, vars } = input;
  const command = substituteAll(template.command, vars).vector;
  const missing = [...new Set(command.flatMap(placeholders))];
  if (missing.length > 0)
    throw new DevkitError(
      'config',
      'PROVIDER_VAR_MISSING',
      `Missing provider variables: ${missing.join(', ')}`,
      {
        nextSteps: ['fx manifest providers', 'fx manifest explain providers'],
      },
    );
  return {
    label: substitute(template.label, vars).text,
    command,
    ...(template.url === undefined ? {} : { url: substitute(template.url, vars).text }),
  };
}
