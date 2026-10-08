// Tencent Meeting through tmeet. Readiness is one read-only query for the signed-in
// member's upcoming meetings: `tmeet auth status` exits zero when signed out, so it proves
// nothing. fx never creates, changes or joins a meeting.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';

const UPCOMING = ['meeting', 'list'];

export const tencentMeetingProvider: ProviderDescriptor<Coordinate> = {
  id: 'tencent-meeting',
  capability: 'meeting',
  reference: true,
  tools: ['tmeet'],
  vars: [],
  recipes: [
    {
      id: 'meeting-access',
      tool: 'tmeet',
      perEnv: false,
      kind: 'run',
      phase: 'authenticate',
      title: 'Sign in to Tencent Meeting with your own account',
      instructions:
        'Run the sign-in in your own terminal and complete the browser authorization it prints; it waits for that page. If it reports the user is already initialized, run tmeet auth logout first.',
      run: ['auth', 'login'],
      verify: { command: [...UPCOMING, '--page-size', '1'] },
    },
  ],
  create: () => ({
    label: "Tencent Meeting meetings of the signed-in member's account",
    command: ['tmeet', ...UPCOMING],
  }),
};
