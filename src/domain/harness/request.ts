// A lifecycle entry is bound to one registration and one managed owner.
// Internal arguments are intentionally separate from the public CLI parser.

import { BUILTIN_HOOKS, type HookEvent } from './hooks.js';

export interface HookRequest {
  readonly event: HookEvent;
  readonly workspace: string;
  readonly root: string;
  readonly home: string;
  readonly agent: string;
  readonly owner: string;
}

export function parseHookRequest(args: readonly string[]): HookRequest | null {
  const definition = BUILTIN_HOOKS.find((hook) => hook.event === args[0]);
  if (definition === undefined) return null;
  const values = new Map<string, string>();
  const names = ['--workspace', '--root', '--fx-home', '--agent', '--owner'];
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key || !value || !names.includes(key) || values.has(key)) return null;
    values.set(key, value);
  }
  if (values.size !== names.length) return null;
  return {
    event: definition.event,
    workspace: values.get('--workspace')!,
    root: values.get('--root')!,
    home: values.get('--fx-home')!,
    agent: values.get('--agent')!,
    owner: values.get('--owner')!,
  };
}

export function hookRequestArgs(request: HookRequest): readonly string[] {
  return [
    request.event,
    '--workspace',
    request.workspace,
    '--root',
    request.root,
    '--fx-home',
    request.home,
    '--agent',
    request.agent,
    '--owner',
    request.owner,
  ];
}
