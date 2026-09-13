// The family's thirteen first-class agents, as data: where each keeps its Skills, what
// marks it as present. Detection also accepts a binary on PATH, one more signal than the
// family uses, because a directory like .github says less about Copilot than the
// `copilot` command does.

import type { HookSupport } from '../../domain/harness/hooks.js';
import type { McpSupport, RulesSupport } from '../../domain/harness/mcp.js';

export interface AgentHostSpec {
  readonly id: string;
  readonly label: string;
  readonly homeSub: string;
  readonly projectSkills: string;
  readonly markers: readonly string[];
  readonly binaries: readonly string[];
  readonly hooks?: HookSupport;
  readonly mcp?: McpSupport;
  readonly rules?: RulesSupport;
}

export const AGENT_SPECS: readonly AgentHostSpec[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    mcp: {
      status: 'supported',
      projectPath: '.mcp.json',
      protocol: 'json',
      rootKey: 'mcpServers',
      references: 'interpolate',
    },
    homeSub: '.claude',
    projectSkills: '.claude/skills',
    markers: ['.claude'],
    binaries: ['claude'],
    hooks: {
      projectPath: '.claude/settings.local.json',
      windowsCommand: 'powershell',
      protocol: 'command-json',
      events: { 'session-start': 'SessionStart' },
      context: 'native',
      identityEnvironment: [],
    },
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    mcp: {
      status: 'supported',
      projectPath: '.codex/config.toml',
      protocol: 'toml',
      rootKey: 'mcp_servers',
      references: 'forward',
    },
    homeSub: '.codex',
    projectSkills: '.agents/skills',
    markers: ['.codex'],
    binaries: ['codex'],
    hooks: {
      projectPath: '.codex/hooks.json',
      windowsCommand: 'override',
      protocol: 'command-json',
      events: { 'session-start': 'SessionStart' },
      context: 'native',
      identityEnvironment: [],
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    homeSub: '.cursor',
    projectSkills: '.cursor/skills',
    markers: ['.cursor'],
    binaries: ['cursor-agent', 'cursor'],
  },
  {
    id: 'agents',
    label: 'Agents (shared tree)',
    homeSub: '.agents',
    projectSkills: '.agents/skills',
    markers: ['.agents'],
    binaries: [],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    mcp: {
      status: 'supported',
      projectPath: '.gemini/settings.json',
      protocol: 'jsonc',
      rootKey: 'mcpServers',
      references: 'interpolate',
    },
    rules: { projectPath: 'GEMINI.md', protocol: 'markdown' },
    homeSub: '.gemini',
    projectSkills: '.gemini/skills',
    markers: ['.gemini'],
    binaries: ['gemini'],
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    homeSub: '.copilot',
    projectSkills: '.agents/skills',
    markers: ['.copilot'],
    binaries: ['copilot'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    homeSub: '.config/opencode',
    projectSkills: '.opencode/skills',
    markers: ['.config/opencode'],
    binaries: ['opencode'],
  },
  {
    id: 'continue',
    label: 'Continue',
    homeSub: '.continue',
    projectSkills: '.continue/skills',
    markers: ['.continue'],
    binaries: ['cn'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    homeSub: '.codeium/windsurf',
    projectSkills: '.windsurf/skills',
    markers: ['.codeium/windsurf'],
    binaries: ['windsurf'],
  },
  {
    id: 'grok',
    label: 'Grok Build',
    mcp: {
      status: 'unverified',
      reason:
        'Project MCP configuration exists, but native environment-reference semantics have not been verified.',
    },
    homeSub: '.grok',
    projectSkills: '.grok/skills',
    markers: ['.grok'],
    binaries: ['grok'],
    hooks: {
      projectPath: '.grok/hooks/fx.json',
      activationLimit:
        'Grok 1.0.25 discovers project hooks only at a Git root. Plain workspace roots require explicit fx sync --only docs,skills; do not initialize Git at the workspace root.',
      windowsCommand: 'cmd',
      protocol: 'command-json',
      events: { 'session-start': 'SessionStart' },
      context: 'none',
      identityEnvironment: ['GROK_HOOK_EVENT'],
      sessionKey: 'sessionId',
    },
  },
  {
    id: 'pi',
    label: 'Pi',
    mcp: {
      status: 'unsupported',
      reason:
        'This host has no built-in MCP configuration; use its extension ecosystem or companion CLI Skills.',
    },
    homeSub: '.pi/agent',
    projectSkills: '.pi/skills',
    markers: ['.pi'],
    binaries: ['pi'],
    hooks: {
      projectPath: '.pi/extensions/fx.ts',
      protocol: 'extension',
      events: { 'session-start': 'session_start' },
      context: 'bridge',
      identityEnvironment: [],
    },
  },
  {
    id: 'kilo',
    label: 'Kilo Code',
    homeSub: '.kilocode',
    projectSkills: '.kilocode/skills',
    markers: ['.kilocode'],
    binaries: ['kilocode'],
  },
  {
    id: 'roo',
    label: 'Roo Code',
    homeSub: '.roo',
    projectSkills: '.roo/skills',
    markers: ['.roo'],
    binaries: ['roo'],
  },
];
