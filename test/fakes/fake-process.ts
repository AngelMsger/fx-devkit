import type { Process, ProcessResult, RunOptions } from '../../src/ports/process.js';

export interface RecordedCall {
  readonly vector: readonly string[];
  readonly options: RunOptions;
}

type Matcher = (vector: readonly string[]) => boolean;

const startsWith = (vector: readonly string[], prefix: readonly string[]): boolean =>
  prefix.every((word, index) => vector[index] === word);

// Scripted subprocess: rules are tried in order, the first match answers.
// Assertions select recorded calls by vector; a call's position is an
// implementation detail unless a test states that the order is the contract.
export class FakeProcess implements Process {
  readonly calls: RecordedCall[] = [];
  readonly binaries = new Set<string>();
  private readonly rules: { matcher: Matcher; result: ProcessResult }[] = [];

  on(prefix: readonly string[], result: ProcessResult): this {
    this.rules.push({ matcher: (v) => prefix.every((p, i) => v[i] === p), result });
    return this;
  }

  when(matcher: Matcher, result: ProcessResult): this {
    this.rules.push({ matcher, result });
    return this;
  }

  always(result: ProcessResult): this {
    this.rules.push({ matcher: () => true, result });
    return this;
  }

  clear(): this {
    this.rules.length = 0;
    return this;
  }

  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    this.calls.push({ vector, options });
    const rule = this.rules.find((r) => r.matcher(vector));
    if (rule === undefined) {
      return {
        code: 127,
        stdout: '',
        stderr: `fake: no rule for ${vector.join(' ')}`,
        notStarted: true,
      };
    }
    return rule.result;
  }

  async which(binary: string): Promise<string | undefined> {
    return this.binaries.has(binary) ? `/fake/bin/${binary}` : undefined;
  }

  // Every recorded vector in call order, for the tests whose contract is the order.
  vectors(): readonly (readonly string[])[] {
    return this.calls.map((call) => call.vector);
  }

  calledWith(prefix: readonly string[]): boolean {
    return this.calls.some((call) => startsWith(call.vector, prefix));
  }

  callsTo(prefix: readonly string[]): readonly RecordedCall[] {
    return this.calls.filter((call) => startsWith(call.vector, prefix));
  }

  // The single call a prefix names: a repeat is a failure rather than a first hit.
  soleCallTo(prefix: readonly string[]): RecordedCall {
    const found = this.callsTo(prefix);
    if (found[0] === undefined || found.length !== 1)
      throw new Error(
        `expected one call to "${prefix.join(' ')}", recorded ${found.length} of ${this.calls.length}: ${this.vectors()
          .map((vector) => vector.join(' '))
          .join(' | ')}`,
      );
    return found[0];
  }
}
