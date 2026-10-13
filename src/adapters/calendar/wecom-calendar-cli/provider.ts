// WeCom calendars through the family's wecom-calendar-cli, which mirrors a member's own
// calendars into a local store over CalDAV and reads them from there, history included;
// the official wecom-cli lists only the month around today that its bot can see. Each
// member signs in with their WeCom email and an app-specific CalDAV password, so
// readiness is a stored credential; filling the store with `sync` is the member's call.

import type { Coordinate } from '../../../domain/obs/types.js';
import type { ProviderDescriptor } from '../../../ports/provider.js';
import { familyService } from '../../family/service.js';

const TOOL = 'wecom-calendar-cli';
const MIN_VERSION = '0.5.0';
const EVENTS = ['event', 'list', '--format', 'json'];

export const wecomCalendarCliProvider: ProviderDescriptor<Coordinate> = {
  id: TOOL,
  capability: 'calendar',
  settings: {
    fields: ['base_url', 'context', 'auth_scheme', 'credential_url'],
    authSchemes: ['basic'],
  },
  reference: true,
  tools: [TOOL],
  vars: [],
  service: (settings) => familyService(TOOL, settings, MIN_VERSION),
  recipes: [
    {
      id: 'calendar-access',
      tool: TOOL,
      perEnv: false,
      kind: 'run',
      phase: 'authenticate',
      title: 'Sign in to your WeCom calendars',
      instructions: `Each member signs in with their own WeCom email and an app-specific CalDAV password from the WeCom mobile app; ${TOOL} auth guide explains where it comes from. Run ${TOOL} sync afterwards to fill the local store.`,
      run: ['auth', 'login'],
      verify: {
        command: ['auth', 'status', '--format', 'json'],
        json: { path: 'configured', equals: true, reason: 'detail' },
      },
    },
  ],
  create: (_deps, vars) => ({
    label: 'WeCom calendar events from the local mirror',
    command: [TOOL, ...(vars['context'] ? ['--use-context', vars['context']] : []), ...EVENTS],
  }),
};
