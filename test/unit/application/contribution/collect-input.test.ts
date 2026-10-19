import { describe, expect, it } from 'vitest';

import { CollectContributionInput } from '../../../../src/application/contribution/collect-input.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';

const input = {
  paths: [],
  issue: undefined,
  title: undefined,
  dryRun: true,
  yes: false,
  forceNew: false,
  posture: { readOnly: false, source: 'default' as const },
  cliVersion: '1.0.0',
};

describe('contribution input collection', () => {
  it('collects explicit paths and metadata while preserving spaces in JSON paths', async () => {
    const prompter = new FakePrompter();
    prompter.answers = ['["notes.md", "note one.md"]', 'g-1', 'Reviewed change'];
    expect(await new CollectContributionInput(prompter).execute(input)).toMatchObject({
      paths: ['notes.md', 'note one.md'],
      issue: 'g-1',
      title: 'Reviewed change',
    });
    expect(prompter.questions).toHaveLength(3);
  });
  it('does not interpret malformed selection or --yes as selecting every file', async () => {
    const prompter = new FakePrompter();
    prompter.answers = ['[broken'];
    await expect(
      new CollectContributionInput(prompter).execute({ ...input, yes: true }),
    ).rejects.toMatchObject({ code: 'SOURCE_SELECTION_INVALID' });
  });

  it('reports a missing input as INPUT_REQUIRED when there is no person to ask', async () => {
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    await expect(
      new CollectContributionInput(prompter).execute({ ...input, paths: ['notes.md'] }),
    ).rejects.toMatchObject({ category: 'config', code: 'INPUT_REQUIRED' });
  });

  it('needs nobody when every input was supplied', async () => {
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const supplied = { ...input, paths: ['notes.md'], issue: 'g-1', title: 'Change' };
    expect(await new CollectContributionInput(prompter).execute(supplied)).toMatchObject(supplied);
  });
});
