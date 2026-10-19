// The manifest types every later layer consumes, inferred from the schemas
// so a document's shape is defined exactly once.

import type * as z from 'zod';

import type {
  environmentsSchema,
  envPlatformSchema,
  platformSchema,
} from './environments.schema.js';
import type { harnessSchema, mcpSchema } from './harness.schema.js';
import type { localSchema } from './local.schema.js';
import type { membersSchema, personSchema } from './members.schema.js';
import type { INSTALLERS, setupStep, toolSchema, toolsSchema } from './tools.schema.js';
import type { providerBinding, repoSchema, workspaceSchema } from './workspace.schema.js';

export type Harness = z.infer<typeof harnessSchema>;
export type McpResource = z.infer<typeof mcpSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Repo = z.infer<typeof repoSchema>;
export type ProviderBinding = z.infer<typeof providerBinding>;
export type Environments = z.infer<typeof environmentsSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type EnvPlatform = z.infer<typeof envPlatformSchema>;
export type Toolchain = z.infer<typeof toolsSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type InstallVia = (typeof INSTALLERS)[number];
export type DeclaredSetupStep = z.infer<typeof setupStep>;
export type Members = z.infer<typeof membersSchema>;
export type Person = z.infer<typeof personSchema>;
export type LocalLayer = z.infer<typeof localSchema>;

export const KINDS = ['workspace', 'environments', 'tools', 'members', 'harness', 'local'] as const;
export type Kind = (typeof KINDS)[number];

export interface Problem {
  readonly path: string;
  readonly message: string;
  readonly line?: number;
}

export interface Dropped {
  readonly collection: 'repos' | 'tools' | 'mcp';
  readonly name: string;
  readonly reason: string;
}

export type NegotiationFailure = 'schema_too_old' | 'schema_too_new' | 'cli_too_old';

export interface Negotiation {
  readonly schema: number | undefined;
  readonly minCli: string | undefined;
  readonly failure: NegotiationFailure | undefined;
}

export interface LoadResult<T> {
  readonly valid: true;
  readonly doc: T;
  readonly problems: readonly Problem[];
  readonly dropped: readonly Dropped[];
  readonly unknown: readonly string[];
  readonly negotiation: Negotiation;
}

export interface InvalidLoadResult {
  readonly valid: false;
  readonly doc: null;
  readonly problems: readonly Problem[];
  readonly dropped: readonly Dropped[];
  readonly unknown: readonly string[];
  readonly negotiation: Negotiation;
}

export type InspectedLoadResult<T> = LoadResult<T> | InvalidLoadResult;
