import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { TerminalPrompter } from '../../../src/adapters/prompter/terminal.js';
import { FakeActivity } from '../../fakes/fake-activity.js';

// What a person types into and reads from, or a pipe when nobody is there.
function streams(person: boolean) {
  return { input: Object.assign(new PassThrough(), { isTTY: person }), output: new PassThrough() };
}

describe('TerminalPrompter', () => {
  it('never waits when there is no person: --no-input or no TTY become INPUT_REQUIRED', async () => {
    const noTty = new TerminalPrompter(false, new FakeActivity(), streams(false));
    await expect(noTty.confirm('Proceed?')).rejects.toMatchObject({
      category: 'config',
      code: 'INPUT_REQUIRED',
    });
    const noInput = new TerminalPrompter(true, new FakeActivity(), streams(true));
    await expect(noInput.ask('Name?')).rejects.toMatchObject({ code: 'INPUT_REQUIRED' });
    await expect(noInput.pause('Do the thing')).rejects.toMatchObject({
      code: 'INPUT_REQUIRED',
      hint: expect.stringContaining('manual step'),
    });
  });

  it('has the terminal to itself from the question to the answer', async () => {
    const activity = new FakeActivity();
    const terminal = streams(true);
    const asked = new TerminalPrompter(false, activity, terminal).confirm('Proceed?');
    expect(activity.handed).toBe(1);
    terminal.input.write('y\n');
    expect(await asked).toBe(true);
    expect(activity.handed).toBe(0);
    // Nobody is handed a terminal that no question reaches.
    await expect(
      new TerminalPrompter(true, activity, streams(true)).ask('Name?'),
    ).rejects.toMatchObject({ code: 'INPUT_REQUIRED' });
    expect(activity.handovers).toBe(1);
  });
});
