// Doctor combines built-in and extension findings with preparation and repair results.

import type { ErrorEnvelope } from '../../domain/errors.js';
import type { Preparation } from '../../domain/preparation.js';
import type { Finding as ReportFinding, Report } from '../../domain/report.js';
import { finding as anyFinding, type FindingExtra } from '../../domain/report.js';
import type { WritePosture } from '../safety/posture.js';

export const GROUPS = ['repos', 'root', 'tools', 'login', 'agents', 'manifest', 'self'] as const;
export type Group = string;

export type { Level } from '../../domain/report.js';
export type Finding = ReportFinding<Group>;
export interface RepairAttempt {
  readonly group: string;
  readonly status: 'planned' | 'completed' | 'failed';
  readonly failure?: ErrorEnvelope['error'];
}
export interface DoctorReport extends Omit<Report<Group>, 'ok' | 'complete'> {
  readonly preparation: Preparation;
  readonly coverage: 'complete' | 'incomplete';
  readonly repairs: readonly RepairAttempt[];
}

export function finding(
  group: Group,
  id: string,
  level: Finding['level'],
  message: string,
  extra: FindingExtra = {},
): Finding {
  return anyFinding(group, id, level, message, extra);
}

export interface DoctorInput {
  readonly envs?: readonly string[] | undefined;
  readonly tools?: readonly string[] | undefined;
  readonly fix: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly posture: WritePosture;
}
