// Personal configuration has one validated shape for local storage and exported
// profiles. Workspace selection remains data; resolution belongs to application.

import * as z from 'zod';

import { FORMATS, type Format } from '../format.js';
import { COMMAND_SHELLS, type CommandShell } from '../shell.js';

export interface WorkspaceEntry {
  readonly root: string;
  readonly source?: string;
}

export interface ConfigFile {
  readonly default_workspace?: string;
  readonly workspaces?: Readonly<Record<string, WorkspaceEntry>>;
  readonly user?: string;
  readonly format?: Format;
  readonly command_shell?: CommandShell;
  readonly agents?: readonly string[];
  readonly read_only?: boolean;
  readonly skill_notice?: boolean;
  readonly update_check?: boolean;
  readonly hooks?: boolean;
}

export const configFileSchema = z.strictObject({
  default_workspace: z.string().optional(),
  workspaces: z
    .record(z.string(), z.strictObject({ root: z.string(), source: z.string().optional() }))
    .optional(),
  user: z.string().optional(),
  format: z.enum(FORMATS).optional(),
  command_shell: z.enum(COMMAND_SHELLS).optional(),
  agents: z.array(z.string()).optional(),
  read_only: z.boolean().optional(),
  skill_notice: z.boolean().optional(),
  update_check: z.boolean().optional(),
  hooks: z.boolean().optional(),
});
