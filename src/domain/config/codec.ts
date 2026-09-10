// Profile serialization and validation are pure: filesystem access and write
// planning remain with the application use cases. Workspace names are checked
// before they can become registry keys or filesystem path components.

import { parse, stringify } from 'yaml';

import { DevkitError } from '../errors.js';
import { assertWorkspaceName } from '../workspace/name.js';

import { profileSchema, type Profile } from './profile.js';

export function parseProfile(text: string): Profile {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : String(err));
  }
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success)
    throw invalid(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  // Every name becomes a path component and a registry key; a profile is data.
  for (const name of [
    ...Object.keys(parsed.data.workspaces),
    ...Object.keys(parsed.data.config.workspaces ?? {}),
  ])
    assertWorkspaceName(name);
  return parsed.data;
}

function invalid(detail: string): DevkitError {
  return new DevkitError('parse', 'CONFIG_IMPORT_INVALID', `not an fx profile: ${detail}`, {
    hint: 'A profile is what `fx config export` writes.',
    nextSteps: ['fx config export -o profile.yaml'],
  });
}

export function renderProfile(profile: Profile): string {
  return stringify(profile);
}
