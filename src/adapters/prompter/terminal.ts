// Questions on the terminal, through stderr so stdout stays data. With
// --no-input or without a TTY nothing waits: the question becomes an
// INPUT_REQUIRED error that names the flag that would have answered it.

import readline from 'node:readline';

import { DevkitError } from '../../domain/errors.js';
import type { ConfirmOptions, Prompter } from '../../ports/prompter.js';

export class TerminalPrompter implements Prompter {
  constructor(
    private readonly noInput: boolean,
    private readonly streams: {
      readonly input: NodeJS.ReadableStream & { isTTY?: boolean };
      readonly output: NodeJS.WritableStream;
    } = {
      input: process.stdin,
      output: process.stderr,
    },
  ) {}

  async confirm(question: string, options: ConfirmOptions = {}): Promise<boolean> {
    const answer = await this.line(
      `${question} ${options.defaultYes === true ? '[Y/n]' : '[y/N]'} `,
      {
        hint: 'Pass --yes to confirm without a prompt.',
        commands: options.commands,
      },
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === '') return options.defaultYes === true;
    return normalized === 'y' || normalized === 'yes';
  }

  async ask(question: string): Promise<string> {
    return this.line(`${question} `, { hint: 'This value has to come from a person.' });
  }

  async pause(message: string): Promise<void> {
    await this.line(`${message} (press Enter to continue) `, {
      hint: 'A manual step is waiting for a person.',
    });
  }

  private line(
    prompt: string,
    why: { hint: string; commands?: readonly string[] | undefined },
  ): Promise<string> {
    if (this.noInput || this.streams.input.isTTY !== true) {
      return Promise.reject(
        new DevkitError('config', 'INPUT_REQUIRED', `a person has to answer: ${prompt.trim()}`, {
          hint: why.hint,
          nextSteps:
            why.commands === undefined
              ? ['Run the command again in a terminal.']
              : [...why.commands],
        }),
      );
    }
    const rl = readline.createInterface({ input: this.streams.input, output: this.streams.output });
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
