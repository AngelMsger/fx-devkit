// Native command-hook documents are edited at syntax offsets. Only marked
// handlers and their separators change; unrelated values are never serialized.

import { findNodeAtLocation, parseTree, type Node, type ParseError } from 'jsonc-parser';

import type { HookEvent, HookInvocation, HookSupport } from '../../domain/harness/hooks.js';
import type {
  HookProjection,
  HookProjectionInput,
  HookProtocol,
} from '../../ports/hook-protocol.js';
import { ownsWindowsHook, windowsHookCommand } from '../process/powershell.js';

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export class JsonHookProtocol implements HookProtocol {
  constructor(private readonly windowsCommand?: HookSupport['windowsCommand']) {}
  decode(text: string, support: HookSupport): HookInvocation | null {
    try {
      const input: unknown = JSON.parse(text);
      if (
        typeof input !== 'object' ||
        input === null ||
        !('cwd' in input) ||
        typeof input.cwd !== 'string'
      )
        return null;
      const session = (input as Record<string, unknown>)[support.sessionKey ?? 'session_id'];
      return { cwd: input.cwd, sessionId: typeof session === 'string' ? session : null };
    } catch {
      return null;
    }
  }

  context(text: string, support: HookSupport, event: HookEvent = 'session-start'): string {
    if (!text || support.context === 'none') return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: support.events[event],
        additionalContext: text,
      },
    });
  }

  project(input: HookProjectionInput): HookProjection {
    if (input.remove && input.current === null) return { text: null, status: 'managed' };
    const current = input.current ?? '{}';
    const errors: ParseError[] = [];
    const tree = parseTree(current, errors, { disallowComments: true, allowTrailingComma: false });
    if (!tree || tree.type !== 'object' || errors.length || hasDuplicates(tree))
      return { text: input.current, status: 'invalid' };
    const hooks = findNodeAtLocation(tree, ['hooks']);
    const event = findNodeAtLocation(tree, ['hooks', input.event]);
    if ((hooks && hooks.type !== 'object') || (event && event.type !== 'array'))
      return { text: input.current, status: 'invalid' };
    const handler = commandHandler(input, this.windowsCommand);
    const edits: Edit[] = [];
    const removals = new Map<Node, Node[]>();
    let retained = false;
    for (const group of event?.children ?? []) {
      const handlers = findNodeAtLocation(group, ['hooks']);
      if (!handlers || handlers.type !== 'array') return { text: input.current, status: 'invalid' };
      const owned = (handlers.children ?? []).filter((node) => isOwned(node, input.owner));
      if (!owned.length) continue;
      if (
        input.remove &&
        owned.length === handlers.children?.length &&
        group.children?.length === 1
      ) {
        removals.set(event!, [...(removals.get(event!) ?? []), group]);
        continue;
      }
      for (const node of owned) {
        if (input.remove || retained)
          removals.set(handlers, [...(removals.get(handlers) ?? []), node]);
        else {
          retained = true;
          const next = JSON.stringify(handler);
          if (current.slice(node.offset, node.offset + node.length) !== next)
            edits.push({ start: node.offset, end: node.offset + node.length, text: next });
        }
      }
    }
    if (!input.remove && !retained)
      edits.push(insertHandler(tree, hooks, event, input.event, handler));
    for (const [parent, nodes] of removals) edits.push(...removeNodes(parent, nodes));
    const text = applyEdits(current, edits);
    return { text, status: 'managed', empty: input.remove && isEmptyDocument(text) };
  }
}

function renderCommand(vector: readonly string[]): string {
  return vector.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}

function isOwned(node: Node, owner: string): boolean {
  const command = findNodeAtLocation(node, ['command'])?.value as unknown;
  return (
    findNodeAtLocation(node, ['type'])?.value === 'command' &&
    typeof command === 'string' &&
    (ownsWindowsHook(command, owner) ||
      command.endsWith(renderCommand(['--owner', owner])) ||
      command.endsWith(`${renderCommand(['--owner', owner])} 2>/dev/null || :`))
  );
}

function commandHandler(
  input: HookProjectionInput,
  windows?: HookSupport['windowsCommand'],
): object {
  const vector = [...input.vector, '--owner', input.owner];
  if (!windows)
    return { type: 'command', command: `${renderCommand(vector)} 2>/dev/null || :`, timeout: 3 };
  const command = windowsHookCommand(vector, input.owner);
  return {
    type: 'command',
    command,
    timeout: 3,
    ...(windows === 'powershell' ? { shell: 'powershell' } : {}),
    ...(windows === 'override' ? { commandWindows: command } : {}),
  };
}

function insertHandler(
  root: Node,
  hooks: Node | undefined,
  event: Node | undefined,
  name: string,
  handler: object,
): Edit {
  const group = { hooks: [handler] };
  if (event) return append(event, JSON.stringify(group));
  if (hooks) return append(hooks, `${JSON.stringify(name)}:${JSON.stringify([group])}`);
  return append(root, `"hooks":${JSON.stringify({ [name]: [group] })}`);
}

function append(node: Node, text: string): Edit {
  const last = node.children?.at(-1);
  const at = last ? last.offset + last.length : node.offset + 1;
  return { start: at, end: at, text: `${last ? ',' : ''}${text}` };
}

function removeNodes(parent: Node, nodes: readonly Node[]): Edit[] {
  const siblings = parent.children ?? [];
  const removed = new Set(nodes);
  const edits: Edit[] = [];
  for (let i = 0; i < siblings.length; i++) {
    const first = siblings[i]!;
    if (!removed.has(first)) continue;
    const previous = siblings[i - 1];
    while (i + 1 < siblings.length && removed.has(siblings[i + 1]!)) i++;
    const last = siblings[i]!;
    const next = siblings[i + 1];
    if (previous)
      edits.push({
        start: previous.offset + previous.length,
        end: last.offset + last.length,
        text: '',
      });
    else
      edits.push({ start: first.offset, end: next?.offset ?? last.offset + last.length, text: '' });
  }
  return edits;
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

function hasDuplicates(node: Node): boolean {
  if (node.type === 'object') {
    const names = (node.children ?? []).map((property) => property.children?.[0]?.value as unknown);
    if (new Set(names).size !== names.length) return true;
  }
  return (node.children ?? []).some(hasDuplicates);
}

function isEmptyDocument(text: string): boolean {
  const doc = JSON.parse(text) as Record<string, unknown>;
  if (Object.keys(doc).some((key) => key !== 'hooks')) return false;
  return Object.values((doc['hooks'] ?? {}) as Record<string, unknown>).every(
    (value) => Array.isArray(value) && value.length === 0,
  );
}
