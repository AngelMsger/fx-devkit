import { DevkitError } from '../../src/domain/errors.js';
import type { ConfirmOptions, Prompter } from '../../src/ports/prompter.js';

export class FakePrompter implements Prompter {
  readonly questions: string[] = [];
  answers: string[] = [];
  confirmWith = true;
  // Behaves like a terminal without a person: every question is INPUT_REQUIRED.
  unavailable = false;

  async confirm(question: string, _options?: ConfirmOptions): Promise<boolean> {
    if (this.unavailable) throw new DevkitError('config', 'INPUT_REQUIRED', question);
    this.questions.push(question);
    return this.confirmWith;
  }

  async ask(question: string): Promise<string> {
    this.questions.push(question);
    return this.answers.shift() ?? '';
  }

  async pause(message: string): Promise<void> {
    this.questions.push(message);
  }
}
