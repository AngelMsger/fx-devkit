// An error raised before oclif has parsed anything must already read the way the caller
// asked, and must stay an envelope whenever that is not known.
import { describe, expect, it } from 'vitest';

import {
  invocationFormat,
  readInvocationFormat,
  UNDECIDED_FORMAT,
} from '../../../src/cli/invocation-format.js';
import type { Format } from '../../../src/domain/format.js';
import type { ConfigFile, ConfigStore } from '../../../src/ports/stores.js';

const file = (format?: Format): ConfigFile => (format ? { format } : {});

describe('the format an invocation asks for', () => {
  it('is human when nothing asks otherwise', () => {
    expect(invocationFormat(['status'], {}, file())).toBe('human');
  });

  it('takes the flag over the environment over the file', () => {
    expect(invocationFormat(['status'], {}, file('json'))).toBe('json');
    expect(invocationFormat(['status'], { FX_FORMAT: 'ndjson' }, file('json'))).toBe('ndjson');
    expect(
      invocationFormat(['status', '--format', 'human'], { FX_FORMAT: 'ndjson' }, file('json')),
    ).toBe('human');
    expect(invocationFormat(['status', '--format=json', '--bogus'], {}, file())).toBe('json');
  });

  it('is undecided, and so an envelope, for a value that names no format', () => {
    expect(invocationFormat(['status'], { FX_FORMAT: 'yaml' }, file())).toBe('json');
    expect(invocationFormat(['status', '--format', 'yaml'], {}, file())).toBe('json');
  });

  it('is undecided when the configuration cannot be read', async () => {
    const unreadable = {
      read: () => Promise.reject(new Error('config.yaml is not valid YAML')),
    } as unknown as ConfigStore;
    expect(await readInvocationFormat(['status'], {}, unreadable)).toBe(UNDECIDED_FORMAT);
    const readable = { read: () => Promise.resolve(file()) } as unknown as ConfigStore;
    expect(await readInvocationFormat(['status'], {}, readable)).toBe('human');
  });
});
