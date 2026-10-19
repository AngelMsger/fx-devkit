import { describe, expect, it } from 'vitest';

import { isPublicHttpUrl } from '../../../src/domain/public-url.js';

describe('isPublicHttpUrl', () => {
  it.each([
    'https://git.example.com/project/repo',
    'http://localhost:8080/',
    'HTTPS://Example.com/api/v1',
  ])('accepts %j', (value) => {
    expect(isPublicHttpUrl(value)).toBe(true);
  });

  it.each([
    '',
    'git.example.com/project/repo',
    'ssh://git@git.example.com/project/repo.git',
    'file:///etc/hosts',
    'https://alice@git.example.com/project/repo',
    'https://alice:secret@git.example.com/project/repo',
    'https://git.example.com/project/repo?token=secret',
    'https://git.example.com/project/repo#readme',
  ])('refuses %j', (value) => {
    expect(isPublicHttpUrl(value)).toBe(false);
  });
});
