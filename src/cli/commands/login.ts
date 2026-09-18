import { Flags } from '@oclif/core';

import { Login, LOGIN_STEP_COLUMNS } from '../../application/login/run.js';
import { SETUP_STEP_COLUMNS } from '../../domain/setup/types.js';
import { FxCommand } from '../base.js';
import { argument, dryRunFlag, listFlag, writeIntent } from '../flags.js';
import { loginNotices } from '../notices.js';

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

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(LoginCommand);
    const tools = argv.length === 0 ? undefined : (argv as string[]);
    const login = new Login(await this.workspaceDeps(), this.loginDeps());
    if (flags.list) {
      const plan = await login.plan({ tools, envs: flags.env });
      this.renderer.list(plan.steps, { columns: SETUP_STEP_COLUMNS });
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
    this.renderer.list(out.items, { columns: LOGIN_STEP_COLUMNS });
    for (const notice of loginNotices(out.problems, out.summary)) this.renderer.notice(notice);
  }
}
