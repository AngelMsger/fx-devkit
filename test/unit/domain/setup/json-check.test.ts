import { expect, it } from 'vitest';

import { matchesJson } from '../../../../src/domain/setup/json-check.js';

it.each([
  ['{"authenticated":true}', 'authenticated', true, true],
  ['{"authenticated":"true"}', 'authenticated', true, false],
  ['{"profile":{"ready":true}}', 'profile.ready', true, true],
  ['{"profile":null}', 'profile.ready', true, false],
  ['{"value":null}', 'value', null, true],
  ['{}', 'value', null, false],
  ['not json', 'authenticated', true, false],
  ['{}', 'toString', true, false],
] as const)('checks only the declared JSON scalar: %s / %s', (text, path, equals, wanted) => {
  expect(matchesJson(text, { path, equals })).toBe(wanted);
});
