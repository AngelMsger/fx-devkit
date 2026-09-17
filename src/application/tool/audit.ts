// Persist checkpoints before execution and after each irreversible installer outcome.
// Retain only redacted command metadata and stable failure codes, never process output.

import { randomUUID } from 'node:crypto';

import { redactText, redactVector } from '../../domain/diagnostics.js';
import { originBeforeInstallation } from '../../domain/toolchain/installation-origin.js';
import type { ToolInstallation } from '../../domain/toolchain/installation.js';
import type { Clock } from '../../ports/clock.js';
import type { ToolHistoryStore } from '../../ports/tool-history.js';

export class ToolAudit {
  constructor(
    private readonly store: ToolHistoryStore,
    private readonly clock: Clock,
  ) {}

  async start(
    input: Pick<
      ToolInstallation,
      'operation' | 'workspace' | 'name' | 'binary' | 'via' | 'spec' | 'vector'
    > & { readonly binary_path_before?: string | null | undefined },
  ): Promise<ToolInstallation> {
    const history = await this.store.read();
    const prior = history.filter((event) => event.via === input.via && event.spec === input.spec);
    const entry: ToolInstallation = {
      ...input,
      id: randomUUID(),
      at: this.clock.now().toISOString(),
      event: 'started',
      name: redactAuditText(input.name),
      binary: redactAuditText(input.binary),
      spec: redactAuditText(input.spec),
      vector: redactVector(input.vector).map(redactAuditText),
      code: null,
      version_after: null,
      binary_path: null,
      failure_code: null,
      installation_origin:
        input.binary_path_before === undefined
          ? 'unknown'
          : originBeforeInstallation(prior, input.binary_path_before),
      ...(input.binary_path_before === undefined
        ? {}
        : { binary_path_before: input.binary_path_before }),
    };
    await this.store.append(entry);
    return entry;
  }

  async checkpoint(
    entry: ToolInstallation,
    result: Pick<
      ToolInstallation,
      'event' | 'code' | 'version_after' | 'binary_path' | 'failure_code'
    >,
  ): Promise<void> {
    await this.store.append({ ...entry, ...result, at: this.clock.now().toISOString() });
  }
}

function redactAuditText(text: string): string {
  return redactText(text).replace(/https?:\/\/[^\s]+/gu, (value) => {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '[REDACTED_URL]';
    }
  });
}
