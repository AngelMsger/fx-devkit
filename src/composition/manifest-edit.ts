// Bind manifest editing to the shared compare-and-replace file port.
import {
  SetRepoField,
  type SetRepoFieldInput,
  type SetRepoFieldOutput,
} from '../application/manifest/set.js';

import type { Container } from './container.js';

export function editManifestRepo(
  container: Container,
  input: SetRepoFieldInput,
): Promise<SetRepoFieldOutput> {
  return new SetRepoField(container.projections).execute(input);
}
