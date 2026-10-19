import { DevkitError } from '../../src/domain/errors.js';
import type { ConfirmOptions, Prompter } from '../../src/ports/prompter.js';

export class FakePrompter implements Prompter {
  readonly questions: string[] = [];
  answers: string[] = [];
  confirmWith = true;
  // A terminal without a person: every method is INPUT_REQUIRED, as the port states.
  unavailable = false;

  async confirm(question: string, _options?: ConfirmOptions): Promise<boolean> {
    this.requirePerson(question);
    this.questions.push(question);
    return this.confirmWith;
  }

  async ask(question: string): Promise<string> {
    this.requirePerson(question);
    this.questions.push(question);
    return this.answers.shift() ?? '';
  }

  async pause(message: string): Promise<void> {
    this.requirePerson(message);
    this.questions.push(message);
  }

  private requirePerson(prompt: string): void {
    if (this.unavailable)
      throw new DevkitError('config', 'INPUT_REQUIRED', `A person has to answer: ${prompt}`);
  }
}
