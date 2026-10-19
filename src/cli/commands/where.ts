import { Where } from '../../application/readiness/where.js';
import { recordProbe } from '../../composition/probe-record.js';
import { DevkitError } from '../../domain/errors.js';
import { FxCommand } from '../base.js';
import { requiredArgument, writeIntent } from '../flags.js';
import { selectWhereColumns, whereFlags } from '../where-flags.js';
import type { WriteScopeDeclaration } from '../workspace-write-policy.js';

export default class WhereCommand extends FxCommand {
  static override description =
    'Locate repository coordinates; optionally probe or record their existence\n\nQueries return a collection. --record writes verified evidence into source environments.yaml and returns a record with action (preview, recorded, unchanged or skipped) and written. --record --dry-run returns the write plan without probing or writing.';
  static override examples = [
    '<%= config.bin %> where fx-example-api --env test --format json',
    '<%= config.bin %> where fx-example-api --env test --platform jenkins --probe --record --dry-run',
  ];
  static override args = {
    repo: requiredArgument('repository name'),
  };
  static override flags = whereFlags;
  static override writeScope: WriteScopeDeclaration = (flags) =>
    flags['record'] ? 'workspace' : null;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WhereCommand);
    if (flags['dry-run']) this.skipUpdateChecks();
    const input = {
      repo: args.repo,
      env: flags.env,
      platform: flags.platform,
      check: flags.check,
      probe: flags.probe,
      jobs: flags.jobs,
    };
    if (flags.record) {
      const result = await recordProbe({
        container: this.container,
        workspace: await this.workspaceDeps(),
        login: this.loginDeps(),
        input: { ...input, ...writeIntent(flags, this.posture) },
      });
      this.renderer.record(result);
      return;
    }
    if (flags['dry-run'])
      throw new DevkitError(
        'usage',
        'PROBE_RECORD_INPUT_REQUIRED',
        '--dry-run on where requires --record; use --no-check for a query without live checks',
        {
          nextSteps: [
            `fx where ${args.repo} --env <env> --platform <platform> --probe --record --dry-run`,
            `fx where ${args.repo} --no-check`,
          ],
        },
      );
    const rows = await new Where(await this.workspaceDeps(), this.loginDeps()).execute(input);
    this.renderer.list(rows, { columns: selectWhereColumns(flags.probe) });
  }
}
