// Ports for personal configuration, workspace selections, command trust and caches.

import type { ConfigFile } from '../domain/config/file.js';
import type { LocalLayer } from '../domain/manifest/types.js';

export type { ConfigFile, WorkspaceEntry } from '../domain/config/file.js';

export interface ConfigStore {
  read(): Promise<ConfigFile>;
  write(next: ConfigFile): Promise<void>;
  update(change: (current: ConfigFile) => ConfigFile | Promise<ConfigFile>): Promise<ConfigFile>;
  path(): string;
}

export interface LocalLayerStore {
  read(workspace: string): Promise<LocalLayer>;
  write(workspace: string, next: LocalLayer): Promise<void>;
  update(
    workspace: string,
    change: (current: LocalLayer) => LocalLayer | Promise<LocalLayer>,
  ): Promise<LocalLayer>;
  path(workspace: string): string;
}

export interface Cache {
  get<T>(key: string, signal?: AbortSignal): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

export interface TrustedEntry {
  readonly fingerprint: string;
  readonly label: string;
  readonly trusted_at: string;
}

export interface TrustStore {
  isTrusted(workspace: string, fingerprint: string): Promise<boolean>;
  trust(workspace: string, fingerprint: string, label: string): Promise<void>;
  list(workspace: string): Promise<TrustedEntry[]>;
  path(): string;
}
