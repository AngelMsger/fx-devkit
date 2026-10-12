// oclif's help plus the AGENT USAGE block: the part of the contract an agent needs even
// when it has loaded no Skill. oclif constructs this class from the config alone, with no
// command and so no Renderer, so help writes through its own `log` and is the one stdout
// channel outside that contract. Every block goes through oclif's `section`, so its
// heading is emphasised exactly where oclif emphasises its own.

import { Help, type Command, type Interfaces } from '@oclif/core';

import { COMMAND_ALIASES, compatibilityTarget, EVERYDAY } from './commands/index.js';

const AGENT_USAGE = `Agents add --format json (collections are {items, has_more, next?}) and --no-input.
Every flag is described under FLAGS and GLOBAL FLAGS in each command's help.
Errors are JSON on stderr as {error:{category,code,message,hint,next_steps,retryable}};
the category maps to a fixed exit code (usage 2, config 3, auth 4, permission 5,
not_found 6, conflict 11). A LOGIN_REQUIRED error carries a handoff for the user.
Human format on a terminal adds colour and prints errors as text; pipes and JSON never do.
init/sync/doctor return preparation.state for their scope: planned, ready or incomplete.
Incomplete preparation exits 12; preparation.next selects Agent actions or human handoff.
Use resume only after prerequisites change. Release keeps ok/complete.
Summaries retain exceptions and recovery; omitted counts normal rows/evidence.
self info returns initialization_guide for setup and bundled_skill for other workflows.
Global agent selection and tool inventory/history cover FX_HOME; --workspace does not narrow them.
Help, completion, skill show and manifest schema return their native text/artifact formats.
Set FX_FORMAT=json to apply the format to a whole session.`;

const INITIALIZATION = `fx init "<directory>" --from "<manifest>" --dry-run --format json
fx init "<directory>" --from "<manifest>" --format json
Init prepares local tools, selected repositories and Agent resources and verifies them.
Add --yes when the exact automatic effects are already authorized. Personal login stays manual.
Read preparation.next: complete finishes setup; handoff waits for the listed prerequisites.
Completed setup is already verified. Resume after human input with the returned resume action.`;

export default class FxHelp extends Help {
  protected override get sortedCommands(): Command.Loadable[] {
    return super.sortedCommands.filter((command) => compatibilityTarget(command.id) === undefined);
  }

  override async showCommandHelp(command: Command.Loadable): Promise<void> {
    const target = compatibilityTarget(command.id);
    if (target)
      this.log(
        `${this.section('COMPATIBILITY', `Use fx ${target.replaceAll(':', ' ')} for this operation.`)}\n`,
      );
    await super.showCommandHelp(command);
    this.log(this.section('AGENT USAGE', AGENT_USAGE));
  }

  protected override async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
    await super.showTopicHelp(topic);
    const aliases = Object.entries(COMMAND_ALIASES).filter(([alias]) =>
      alias.startsWith(`${topic.name}:`),
    );
    if (aliases.length) {
      const names = aliases.map(
        ([alias, canonical]) =>
          `${alias.replaceAll(':', ' ')} -> ${canonical.replaceAll(':', ' ')}`,
      );
      this.log(`${this.section('COMPATIBILITY', names.join('\n'))}\n`);
    }
    this.log(this.section('AGENT USAGE', AGENT_USAGE));
  }

  protected override async showRootHelp(): Promise<void> {
    const byId = new Map(this.sortedCommands.map((c) => [c.id, c]));
    const everyday = EVERYDAY.flatMap((id) => byId.get(id) ?? []);
    this.log(this.formatRoot());
    this.log('');
    this.log(this.section('FIRST WORKSPACE', INITIALIZATION));
    this.log('');
    // The heading may be emphasised, so it is not at the start of the text.
    this.log(this.formatCommands(everyday).replace('COMMANDS', 'EVERYDAY'));
    this.log('');
    this.log(this.formatTopics(this.sortedTopics.filter((t) => !t.name.includes(':'))));
    this.log('');
    this.log(this.section('AGENT USAGE', AGENT_USAGE));
  }
}
