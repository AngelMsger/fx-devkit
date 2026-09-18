// oclif's help plus the AGENT USAGE block: the part of the contract an agent needs even
// when it has loaded no Skill. The root page puts the everyday commands before the
// topics.
//
// oclif constructs this class from the config alone, with no command and so no Renderer;
// help writes through its own `log`, and is the one stdout channel outside that contract.

import { Help, type Command, type Interfaces } from '@oclif/core';

import { COMMAND_ALIASES, compatibilityTarget, EVERYDAY } from './commands/index.js';

const AGENT_USAGE = `AGENT USAGE
  --format json     machine-readable output; collections are {items, has_more, next?}
  --format ndjson   one JSON object per line, for streaming
  --fields a,b.c    keep only these dot paths in the output
  --details         full JSON for init/sync/doctor/release (default: summary)
  --no-header       omit headings from human list output
  --no-input        never prompt; a needed answer becomes a structured error
  --dry-run         on write commands: print the plan, change nothing
  --allow-writes    override read-only posture (read_only / FX_READ_ONLY) once
  Errors are JSON on stderr as {error:{category,code,message,hint,next_steps,retryable}};
  the category maps to a fixed exit code (usage 2, config 3, auth 4, permission 5,
  not_found 6, conflict 11). A LOGIN_REQUIRED error carries a handoff for the user.
  doctor and release exit 0 even when findings fail; inspect report.ok, complete and findings.
  init and sync expose operation and preparation_complete; preview completion is null.
  Summaries retain exceptions and recovery; omitted counts normal rows/evidence.
  Start with self info, read the bundled Skill, then set FX_SKILL_VERSION to bundled_skill_version.
  Global agent selection and tool inventory/history cover FX_HOME; --workspace does not narrow them.
  Help, completion, skill show and manifest schema return their native text/artifact formats.
  Set FX_FORMAT=json to apply the format to a whole session.`;

export default class FxHelp extends Help {
  protected override get sortedCommands(): Command.Loadable[] {
    return super.sortedCommands.filter((command) => compatibilityTarget(command.id) === undefined);
  }

  override async showCommandHelp(command: Command.Loadable): Promise<void> {
    const target = compatibilityTarget(command.id);
    if (target)
      this.log(`COMPATIBILITY\n  Use fx ${target.replaceAll(':', ' ')} for this operation.\n`);
    await super.showCommandHelp(command);
    this.log(AGENT_USAGE);
  }

  protected override async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
    await super.showTopicHelp(topic);
    const aliases = Object.entries(COMMAND_ALIASES).filter(([alias]) =>
      alias.startsWith(`${topic.name}:`),
    );
    if (aliases.length) {
      this.log('COMPATIBILITY');
      for (const [alias, canonical] of aliases)
        this.log(`  ${alias.replaceAll(':', ' ')} -> ${canonical.replaceAll(':', ' ')}`);
      this.log('');
    }
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
