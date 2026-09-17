// bitbucket-cli is a family CLI; this names the binary and nothing else.

import type { Process } from '../../../ports/process.js';
import { FamilyCli } from '../../family/cli.js';

export const BINARY = 'bitbucket-cli';

export type { CliCall } from '../../family/cli.js';

export class BitbucketCli extends FamilyCli {
  constructor(
    process: Process,
    context: string | undefined,
    service?: Readonly<Record<string, string>>,
  ) {
    super(BINARY, process, context, service);
  }
}
