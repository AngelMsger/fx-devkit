// A restricted worker can read only its current smart-bot task. Readiness uses
// that same read without surfacing conversation content or obtaining new grants.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { referenceEntry } from '../../reference/entry.js';

const TOOL = 'wecom-chat-cli';
const TASK = [
  '--socket',
  '{socket}',
  '--bot-id',
  '{bot_id}',
  '--deployment',
  '{deployment}',
  'task',
  'get',
];

export const wecomChatProvider: ProviderDescriptor<Coordinate> = {
  id: TOOL,
  capability: 'im',
  reference: true,
  tools: [TOOL],
  vars: [
    { name: 'socket', desc: 'absolute path to the restricted worker socket', required: true },
    { name: 'bot_id', desc: 'bot ID supplied by the operator', required: true },
    { name: 'deployment', desc: 'deployment name supplied by the operator', required: true },
  ],
  recipes: [
    {
      id: 'task-access',
      tool: TOOL,
      perEnv: false,
      kind: 'manual',
      title: 'Provision a restricted WeCom conversation worker',
      instructions:
        'Run fx only inside the restricted worker for this binding. The trusted supervisor supplies its worker socket, bot/deployment scope and WECOM_CHAT_TASK_TOKEN environment for one live task. Keep the token out of manifests, argv and prompts. Install the matching packaged SKILL.md through the worker host. Broker setup, task issuance and independent reply approval remain with the operator; never supply its socket or bot Secret to the worker.',
      open: 'https://github.com/AngelMsger/wecom-chat-cli/blob/main/docs/host-integration.md',
      verify: {
        command: TASK,
        json: {
          path: 'trust.content_trust',
          equals: 'untrusted_external',
          unmet: 'the broker did not return an explicitly untrusted task',
        },
      },
    },
  ],
  create: (_deps, vars) =>
    referenceEntry({
      template: {
        label: 'Current authorized WeCom smart-bot task (untrusted content)',
        command: [TOOL, ...TASK],
      },
      vars,
    }),
};
