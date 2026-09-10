// oclif's help plus the AGENT USAGE block: the part of the contract an agent needs even
// when it has loaded no Skill. The root page puts the everyday commands before the
// topics.

import { Help, type Command, type Interfaces } from '@oclif/core';

import { EVERYDAY } from './commands/index.js';

const AGENT_USAGE = `AGENT USAGE
  --format json     machine-readable output; collections are {items, has_more, next?}
  --format ndjson   one JSON object per line, for streaming
  --fields a,b.c    keep only these dot paths in the output
  --no-header       omit headings from human list output
  --no-input        never prompt; a needed answer becomes a structured error
  --dry-run         on write commands: print the plan, change nothing
  --allow-writes    override read-only posture (read_only / FX_READ_ONLY) once
  Errors are JSON on stderr as {error:{category,code,message,hint,next_steps,retryable}};
  the category maps to a fixed exit code (usage 2, config 3, auth 4, permission 5,
  not_found 6, conflict 11). A LOGIN_REQUIRED error carries a handoff for the user.
  doctor and release exit 0 even when findings fail; inspect report.ok, complete and findings.
  init and sync may return partial results; inspect sync.summary (init), summary (sync),
  stages and each failed item's failure before treating preparation as complete.
  Set FX_FORMAT=json to apply the format to a whole session.`;

export default class FxHelp extends Help {
  override async showCommandHelp(command: Command.Loadable): Promise<void> {
    await super.showCommandHelp(command);
    this.log(AGENT_USAGE);
  }

  protected override async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
    await super.showTopicHelp(topic);
    this.log(AGENT_USAGE);
  }

  protected override async showRootHelp(): Promise<void> {
    const byId = new Map(this.sortedCommands.map((c) => [c.id, c]));
    const everyday = EVERYDAY.flatMap((id) => byId.get(id) ?? []);
    this.log(this.formatRoot());
    this.log('');
    this.log(this.formatCommands(everyday).replace(/^COMMANDS/, 'EVERYDAY'));
    this.log('');
    this.log(this.formatTopics(this.sortedTopics.filter((t) => !t.name.includes(':'))));
    this.log('');
    this.log(AGENT_USAGE);
  }
}
