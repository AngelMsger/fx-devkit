import { expect, it } from 'vitest';

import {
  noAnswerAction,
  toolRecovery,
  verifyAction,
} from '../../../src/application/preparation.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';
import {
  preparation,
  preparationCheck,
  preparationScope,
  type PreparationAction,
} from '../../../src/domain/preparation.js';
import { harness } from '../../fakes/workspace.js';

const step = { id: 'sample.login', tool: 'sample' };

function nextActions(...raised: readonly (readonly PreparationAction[])[]): PreparationAction[] {
  const checks = raised.map((actions, index) =>
    preparationCheck(`check:${index}`, 'unknown', 'gave no answer', { actions }),
  );
  return [...preparation({ scope: preparationScope('fx'), checks }).next_actions];
}

it('offers one approval when a tool check and a setup step both wait on it', async () => {
  const { deps } = await harness();
  const withheld = toEnvelope(new DevkitError('config', 'VECTOR_UNTRUSTED', 'not trusted')).error;
  const fromTool = toolRecovery(deps, {
    name: 'sample',
    state: 'unknown',
    failure: withheld,
    preparation_required: true,
  });
  const fromStep = [verifyAction(deps, 'sample')];
  expect(fromTool.map((action) => action.id)).toEqual(['tool:sample']);
  expect(fromStep.map((action) => action.id)).toEqual(['approve-check:sample']);
  expect(nextActions(fromTool, fromStep)).toMatchObject([
    {
      argv: ['fx', 'doctor', '--tool', 'sample', '--workspace', 'fx', '--yes'],
      requires_approval: true,
    },
  ]);
});

it('offers one inspection when a missing tool also left a setup check unanswered', async () => {
  const { deps } = await harness();
  const fromTool = toolRecovery(deps, {
    name: 'sample',
    state: 'missing',
    preparation_required: true,
  });
  const fromStep = [noAnswerAction(deps, step, 'TOOL_MISSING')];
  expect(nextActions(fromTool, fromStep)).toMatchObject([
    {
      id: 'tool:sample',
      argv: ['fx', 'tool', 'install', 'sample', '--workspace', 'fx', '--dry-run'],
      requires_approval: false,
    },
  ]);
});

it('asks nothing of an agent for a tool that is usable or switched off and not required', async () => {
  const { deps } = await harness();
  const tool = { name: 'sample', preparation_required: false };
  expect(toolRecovery(deps, { ...tool, state: 'ok' })).toEqual([]);
  expect(toolRecovery(deps, { ...tool, state: 'disabled' })).toEqual([]);
  expect(
    toolRecovery(deps, { ...tool, state: 'disabled', preparation_required: true }),
  ).toMatchObject([{ argv: ['fx', 'tool', 'show', 'sample', '--workspace', 'fx'] }]);
});
