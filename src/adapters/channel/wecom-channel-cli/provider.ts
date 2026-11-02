import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const TOOL = 'wecom-channel-cli';

export const wecomChannelProvider: ProviderDescriptor<Coordinate> = {
  id: TOOL,
  capability: 'channel',
  reference: true,
  tools: [TOOL],
  vars: [],
  recipes: [
    {
      id: 'channel-access',
      tool: TOOL,
      perEnv: false,
      kind: 'manual',
      title: 'Connect to the WeCom channel broker',
      instructions:
        'Ask the operator for the agent socket and set WECOM_CHANNEL_SOCKET or select a configured channel context.',
      verify: {
        command: ['auth', 'status'],
        json: { path: 'data.ready', equals: true },
      },
    },
  ],
  create: () => ({
    label: 'Recent WeCom channel events',
    command: [TOOL, 'event', 'list', '--limit', '10'],
  }),
};
