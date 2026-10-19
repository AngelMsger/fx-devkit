import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { TemplatePlatform } from '../../../../src/adapters/platform/template-platform.js';
import { ProbeRecord } from '../../../../src/application/probe-record/index.js';
import type { Process } from '../../../../src/ports/process.js';
import type {
  ProjectionPath,
  ProjectionStore,
  ProjectionWrite,
} from '../../../../src/ports/projection.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { MANIFEST_DIR, harness } from '../../../fakes/workspace.js';

const envFile = `${MANIFEST_DIR}/manifest/environments.yaml`;
const wsFile = `${MANIFEST_DIR}/manifest/workspace.yaml`;
const input = {
  repo: 'app',
  env: 'dev',
  platform: 'ci',
  probe: true,
  check: false,
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
};
async function fixture(
  options: { path?: string; otherOverride?: boolean; commandShell?: 'cmd' } = {},
) {
  const workspace = `schema_version: 2\ndefaults: {host: https://git.example.com, branch: main}\nrepos:\n  - name: app\n  - name: other\n${options.otherOverride ? '    obs: {overrides: {ci: {dev: {vars: {path: special}}}}}\n' : ''}`;
  const env = `# keep header\nschema_version: 2\nplatforms:\n  ci: {provider: tool, capability: ci, vars: {path: ${JSON.stringify(options.path ?? 'jobs/{repo}')}}}\nenvs:\n  dev:\n    platforms:\n      ci:\n        confidence: unverified\n        note: 'keep this explanation' # keep comment\n`;
  const platform = new TemplatePlatform({
    id: 'tool',
    capability: 'ci',
    label: 'item {path}',
    command: ['tool', 'show', '{path}'],
    probe: { label: 'item {path}', command: ['tool', 'get', '{path}'] },
  });
  const h = await harness({ workspace, files: { [envFile]: env }, platforms: { tool: platform } });
  const writes: ProjectionWrite[] = [];
  let acquire = 0;
  let releases = 0;
  let conflict = false;
  let onProbe: (() => Promise<void>) | undefined;
  const files: ProjectionStore = {
    read: async (at: ProjectionPath) => {
      const text = await h.fs.readText(path.join(at.root, at.relative));
      return text === undefined ? { kind: 'absent', text: null } : { kind: 'file', text };
    },
    write: async (request) => {
      if (
        conflict ||
        (await h.fs.readText(path.join(request.root, request.relative))) !== request.before.text
      )
        return 'conflict';
      writes.push(request);
      await h.fs.writeText(path.join(request.root, request.relative), request.text!);
      return 'written';
    },
  };
  const process: Process = {
    run: async (vector, runOptions) => {
      await onProbe?.();
      return h.process.run(vector, runOptions);
    },
    which: (binary) => h.process.which(binary),
  };
  const deps = {
    workspace: {
      ...h.deps,
      ...(options.commandShell === undefined ? {} : { commandShell: options.commandShell }),
      process,
    },
    login: fakeLoginDeps({}),
    files,
    clock: new FakeClock(new Date('2026-09-09T10:00:00Z')),
    lock: {
      acquire: async () => {
        acquire++;
        return {
          release: async () => {
            releases++;
          },
        };
      },
    },
  };
  h.process.always({ code: 0, stdout: '{}', stderr: '' });
  return {
    h,
    env,
    workspace,
    writes,
    usecase: new ProbeRecord(deps),
    acquired: () => acquire,
    released: () => releases,
    conflict: () => {
      conflict = true;
    },
    onProbe: (callback: () => Promise<void>) => {
      onProbe = callback;
    },
  };
}

describe('recording coordinate probes', () => {
  it('previews conditional recording without readiness checks, probes, locks or file writes', async () => {
    const f = await fixture();
    expect(
      await f.usecase.execute({
        ...input,
        check: true,
        dryRun: true,
        posture: { readOnly: true, source: 'env' },
      }),
    ).toMatchObject({ action: 'preview', scope: 'repository', written: false, after: null });
    expect(f.h.process.calls).toEqual([]);
    expect(f.writes).toEqual([]);
    expect(f.acquired()).toBe(0);
  });
  it('gates an actual write before asking the platform', async () => {
    const f = await fixture();
    await expect(
      f.usecase.execute({ ...input, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(f.h.process.calls).toEqual([]);
    expect(f.writes).toEqual([]);
  });
  it('records only repository-specific evidence and preserves unrelated bytes and notes', async () => {
    const f = await fixture();
    const result = await f.usecase.execute(input);
    expect(result).toMatchObject({ scope: 'repository', after: 'verified', written: true });
    const text = (await f.h.fs.readText(envFile))!;
    const platform = parse(text).envs.dev.platforms.ci;
    expect(platform.confidence).toBe('unverified');
    expect(platform.observations.app.confidence).toBe('verified');
    expect(platform.observations.other).toBeUndefined();
    expect(platform.observations.app.note).toContain('2026-09-09');
    expect(platform.observations.app.note).toContain('{path}');
    expect(platform.observations.app.note).not.toContain('jobs/app');
    expect(text).toContain("note: 'keep this explanation' # keep comment\n");
    expect(await f.h.fs.readText(wsFile)).toBe(f.workspace);
    expect(f.h.process.calls).toHaveLength(1);
    expect(f.released()).toBe(1);
  });
  it('updates environment confidence only when no repository-dependent scope would be promoted', async () => {
    const f = await fixture({ path: 'shared' });
    expect(await f.usecase.execute(input)).toMatchObject({ scope: 'environment', written: true });
    const doc = parse((await f.h.fs.readText(envFile))!);
    expect(doc.envs.dev.platforms.ci.confidence).toBe('verified');
    expect(doc.envs.dev.platforms.ci.note).toMatch(/^keep this explanation\n/);
    const scoped = await fixture({ path: 'shared', otherOverride: true });
    expect(await scoped.usecase.execute(input)).toMatchObject({ scope: 'repository' });
    expect(parse((await scoped.h.fs.readText(envFile))!).envs.dev.platforms.ci.confidence).toBe(
      'unverified',
    );
  });
  it.each([4, 8])(
    'does not write confidence for inconclusive exit %s and supplies a handoff',
    async (code) => {
      const f = await fixture();
      f.h.process.clear().always({ code, stdout: '', stderr: 'unavailable' });
      expect(await f.usecase.execute(input)).toMatchObject({
        action: 'skipped',
        written: false,
        after: null,
        handoff: expect.any(Object),
      });
      expect(await f.h.fs.readText(envFile)).toBe(f.env);
      expect(f.writes).toEqual([]);
    },
  );
  it('quotes the capability check it hands over for the configured shell', async () => {
    const f = await fixture({ commandShell: 'cmd' });
    f.h.process.clear().always({ code: 8, stdout: '', stderr: 'unavailable' });
    expect((await f.usecase.execute(input)).handoff?.command).toBe(
      'fx ^"can^" ^"ci^" ^"--env^" ^"dev^"',
    );
  });
  it('refuses to record fingerprints of inline credentials from coordinate variables', async () => {
    const f = await fixture();
    const text = f.env.replace('vars: {path:', 'vars: {token: inline-secret, path:');
    const h = await harness({
      workspace: f.workspace,
      files: { [envFile]: text },
      platforms: {
        tool: new TemplatePlatform({
          id: 'tool',
          capability: 'ci',
          label: 'item',
          command: ['tool', '{path}'],
          probe: { label: 'item', command: ['tool', '{path}'] },
        }),
      },
    });
    const files: ProjectionStore = {
      read: async (at) => ({
        kind: 'file',
        text: (await h.fs.readText(path.join(at.root, at.relative)))!,
      }),
      write: async () => {
        throw new Error('must not write');
      },
    };
    const record = new ProbeRecord({
      workspace: h.deps,
      login: fakeLoginDeps({}),
      files,
      clock: new FakeClock(),
      lock: { acquire: async () => null },
    });
    await expect(record.execute({ ...input, dryRun: true })).rejects.toMatchObject({
      code: 'PROBE_RECORD_SENSITIVE',
    });
    expect(h.process.calls).toEqual([]);
  });
  it('records confirmed absence as not_found rather than verified', async () => {
    const f = await fixture();
    f.h.process.clear().always({ code: 6, stdout: '', stderr: 'missing' });
    expect(await f.usecase.execute(input)).toMatchObject({ after: 'not_found', written: true });
  });
  it('refuses stale evidence when workspace bytes change during the probe', async () => {
    const f = await fixture();
    f.onProbe(async () => {
      await f.h.fs.writeText(wsFile, f.workspace + '# concurrent change\n');
    });
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ code: 'PROBE_RECORD_CHANGED' });
    expect(await f.h.fs.readText(envFile)).toBe(f.env);
    expect(f.writes).toEqual([]);
    expect(f.released()).toBe(1);
  });
  it('does not overwrite a conflicting file at the final atomic write', async () => {
    const f = await fixture();
    f.conflict();
    await expect(f.usecase.execute(input)).rejects.toMatchObject({ code: 'PROBE_RECORD_CHANGED' });
    expect(await f.h.fs.readText(envFile)).toBe(f.env);
  });
  it('requires a real probe and an explicit environment and platform', async () => {
    const f = await fixture();
    await expect(f.usecase.execute({ ...input, probe: false })).rejects.toMatchObject({
      code: 'PROBE_RECORD_INPUT_REQUIRED',
    });
    await expect(f.usecase.execute({ ...input, platform: undefined })).rejects.toMatchObject({
      code: 'PROBE_RECORD_INPUT_REQUIRED',
    });
    expect(f.h.process.calls).toEqual([]);
  });
});
