import { Flags } from '@oclif/core';

import { Login, LOGIN_STEP_COLUMNS } from '../../application/login/run.js';
import { SETUP_STEP_COLUMNS } from '../../domain/setup/types.js';
import { FxCommand } from '../base.js';
import { argument, dryRunFlag, listFlag, writeIntent } from '../flags.js';
import { loginNotices, nonZero } from '../notices.js';
import type { WriteScopeDeclaration } from '../workspace-write-policy.js';

export default class LoginCommand extends FxCommand {
  static override description =
    'Prepare tool access for the selected workspace: authentication, configuration and permission checks';
  static override examples = [
    '<%= config.bin %> login --list',
    '<%= config.bin %> login',
    '<%= config.bin %> login kubectl --env test',
    '<%= config.bin %> login <tool> --dry-run --no-input --format json',
    '<%= config.bin %> login --no-input --format json   # inspect pending setup; resume after verification',
  ];
  static override strict = false;
  static override args = {
    tool: argument('only these tools'),
  };
  static override flags = {
    env: listFlag('only these environments'),
    list: Flags.boolean({
      default: false,
      exclusive: ['dry-run', 'skip-manual'],
      description: 'print the static plan without checking current state',
    }),
    'skip-manual': Flags.boolean({
      default: false,
      exclusive: ['list'],
      description: 'only steps fx can run itself',
    }),
    'dry-run': {
      ...dryRunFlag,
      exclusive: ['list'],
      description: 'check current state and preview each unfinished action',
    },
  };
  static override writeScope: WriteScopeDeclaration = (flags) =>
    flags['list'] ? null : 'workspace';

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(LoginCommand);
    const tools = argv.length === 0 ? undefined : (argv as string[]);
    const login = new Login(await this.workspaceDeps(), this.loginDeps());
    this.renderer.status?.fold({ notices: ['LOGIN_SUMMARY'] });
    if (flags.list) {
      const plan = await login.plan({ tools, envs: flags.env });
      this.renderer.list(plan.steps, {
        columns: SETUP_STEP_COLUMNS,
        trailer: { problems: plan.problems },
      });
      for (const notice of loginNotices(plan.problems)) this.renderer.notice(notice);
      return;
    }
    const out = await login.execute({
      tools,
      envs: flags.env,
      skipManual: flags['skip-manual'],
      ...writeIntent(flags, this.posture),
      noInput: this.noInput,
    });
    // A person reads the counts once, below the table, and only those that are not zero.
    const human = this.format === 'human';
    const summary = human ? nonZero(out.summary) : out.summary;
    this.renderer.list(out.items, {
      columns: LOGIN_STEP_COLUMNS,
      trailer: {
        summary,
        ...(human && out.problems.length === 0 ? {} : { problems: out.problems }),
      },
    });
    for (const notice of loginNotices(out.problems, out.summary)) this.renderer.notice(notice);
  }
}
