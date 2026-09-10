import type { Registry } from '../../src/ports/registry.js';

export class FakeRegistry implements Registry {
  calls = 0;
  constructor(private answer: string | Error = '0.1.0') {}

  set(answer: string | Error): this {
    this.answer = answer;
    return this;
  }

  async latest(): Promise<string> {
    this.calls += 1;
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}
