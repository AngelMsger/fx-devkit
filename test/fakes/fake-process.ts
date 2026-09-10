import type { Process, ProcessResult, RunOptions } from '../../src/ports/process.js';

export interface RecordedCall {
  readonly vector: readonly string[];
  readonly options: RunOptions;
}

type Matcher = (vector: readonly string[]) => boolean;

// Scripted subprocess: rules are tried in order, the first match answers.
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
      return { code: 127, stdout: '', stderr: `fake: no rule for ${vector.join(' ')}` };
    }
    return rule.result;
  }

  async which(binary: string): Promise<string | undefined> {
    return this.binaries.has(binary) ? `/fake/bin/${binary}` : undefined;
  }
}
