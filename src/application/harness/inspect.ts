// Inspects declarations, native projections and current readiness without writes.

import type { McpResource } from '../../domain/manifest/types.js';
import type { Process } from '../../ports/process.js';

import { findMcpResource } from './names.js';
import { McpReadinessBatch } from './readiness-batch.js';
import type { McpVerdict } from './readiness.js';
import { ReconcileHarness } from './reconcile.js';
import type { HarnessDeps, HarnessInput, HarnessRow } from './types.js';

export interface InspectMcpInput extends HarnessInput {
  readonly name?: string | undefined;
}
export interface McpInfo {
  readonly name: string;
  readonly description: string | null;
  readonly transport: McpResource['transport'];
  readonly command: readonly string[] | null;
  readonly url: string | null;
  readonly env: NonNullable<McpResource['env']>;
  readonly headers: NonNullable<McpResource['headers']>;
  readonly variables: NonNullable<McpResource['variables']>;
  readonly check: McpResource['check'] | null;
  readonly readiness: McpVerdict;
  readonly projections: readonly HarnessRow[];
}
export interface InspectMcpOutput {
  readonly items: readonly McpInfo[];
  readonly orphaned: readonly HarnessRow[];
}
export class InspectMcp {
  constructor(private readonly deps: HarnessDeps & { readonly process: Process }) {}
  async execute(input: InspectMcpInput): Promise<InspectMcpOutput> {
    const resources = input.name
      ? [findMcpResource(input.harness, input.name)]
      : (input.harness?.mcp ?? []);
    const projections = await new ReconcileHarness(this.deps).execute({
      ...input,
      action: 'inspect',
      dryRun: true,
      only: 'mcp',
    });
    const readiness = await new McpReadinessBatch(this.deps).execute({
      workspace: input.workspace,
      resources,
      posture: input.posture,
    });
    return {
      items: resources.map((resource, index) => ({
        name: resource.name,
        description: resource.description ?? null,
        transport: resource.transport,
        command: resource.command ?? null,
        url: resource.url ?? null,
        env: resource.env ?? {},
        headers: resource.headers ?? {},
        variables: resource.variables ?? {},
        check: resource.check ?? null,
        readiness: readiness[index]!,
        projections: projections.items.filter(
          (row) => row.name === resource.name || row.name === `fx-${resource.name}`,
        ),
      })),
      orphaned: projections.items.filter(
        (row) =>
          !input.harness?.mcp.some(
            (resource) => row.name === resource.name || row.name === `fx-${resource.name}`,
          ),
      ),
    };
  }
}
