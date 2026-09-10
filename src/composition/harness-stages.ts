// Connects the harness application workflow to concrete ports.

import * as stages from '../application/harness/stages.js';

import { harnessSession, type HarnessCommandInput } from './harness.js';

export interface ManageHarness extends HarnessCommandInput {
  readonly action: stages.ManageHarness['action'];
  readonly dryRun: boolean;
  readonly only?: stages.ManageHarness['only'];
  readonly workspaceLease?: stages.ManageHarness['workspaceLease'];
}

export function manageHarness(command: ManageHarness): ReturnType<typeof stages.manageHarness> {
  return stages.manageHarness({
    ...harnessSession(command),
    action: command.action,
    dryRun: command.dryRun,
    only: command.only,
    workspaceLease: command.workspaceLease,
  });
}
export function harnessStage(command: ManageHarness): ReturnType<typeof stages.harnessStage> {
  return stages.harnessStage({
    ...harnessSession(command),
    action: command.action,
    dryRun: command.dryRun,
    only: command.only,
    workspaceLease: command.workspaceLease,
  });
}
export function harnessDoctor(
  command: HarnessCommandInput,
  kind: 'mcp' | 'rules',
): ReturnType<typeof stages.harnessDoctor> {
  return stages.harnessDoctor(harnessSession(command), kind);
}
