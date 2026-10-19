import { Writable } from 'node:stream';

// A stream a program would read, such as a pipe or a file: it keeps what was
// written to it and answers none of the questions a terminal answers.
export class CaptureStream extends Writable {
  private readonly chunks: string[] = [];

  override _write(chunk: unknown, _encoding: string, callback: () => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}
