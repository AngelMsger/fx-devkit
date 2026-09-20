import { describe, expect, it } from 'vitest';

import { SystemUrlOpener } from '../../../src/adapters/process/url-opener.js';
import { FakeProcess } from '../../fakes/fake-process.js';

describe('Windows URL opening', () => {
  it('passes the URL as data without putting it into the PowerShell program', async () => {
    const proc = new FakeProcess().always({ code: 0, stdout: '', stderr: '' });
    const url = 'https://git.example.com/repo?filter=a&other=%PATH%';
    expect(await new SystemUrlOpener(proc, 'win32').open(url)).toBe(true);
    const call = proc.soleCallTo(['powershell.exe']);
    expect(call.options.env).toEqual({ FX_OPEN_URL: url });
    const script = Buffer.from(call.vector.at(-1)!, 'base64').toString('utf16le');
    expect(script).toContain('$env:FX_OPEN_URL');
    expect(script).not.toContain(url);
    proc.clear().always({ code: 1, stdout: '', stderr: 'no desktop' });
    expect(await new SystemUrlOpener(proc, 'win32').open(url)).toBe(false);
  });
});
