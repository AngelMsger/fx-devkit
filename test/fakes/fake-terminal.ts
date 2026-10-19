import { CaptureStream } from './capture-stream.js';

// A stream that answers the way a terminal does and keeps what was written to it.
export class FakeTerminal extends CaptureStream {
  readonly isTTY = true;

  constructor(
    readonly columns = 120,
    private readonly colours = true,
  ) {
    super();
  }

  // The part of Node's own answer the renderer relies on.
  hasColors(env: NodeJS.ProcessEnv): boolean {
    return this.colours && !env['NO_COLOR'] && env['TERM'] !== 'dumb';
  }
}

// Each control sequence as a readable tag, so a test states which text carries which role.
export function tagged(text: string): string {
  const names: Record<string, string> = {
    '1': 'strong',
    '2': 'quiet',
    '31': 'fail',
    '32': 'ok',
    '33': 'warn',
    '36': 'accent',
    '22': '/',
    '39': '/',
  };
  return text.replace(/\u001b\[(\d+)m/g, (_, code: string) => `<${names[code] ?? code}>`);
}
