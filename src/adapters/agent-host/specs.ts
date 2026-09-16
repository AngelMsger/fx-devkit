// Native agent capabilities, discovery signals and resource paths.

import type { HookSupport } from '../../domain/harness/hooks.js';
import type { McpSupport, RulesSupport } from '../../domain/harness/mcp.js';

export interface AgentHostSpec {
  readonly id: string;
  readonly label: string;
  readonly homeSub: string;
  readonly projectSkills: string;
  readonly markers: readonly string[];
  readonly projectMarkers: readonly string[];
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
    projectMarkers: ['.claude'],
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
    projectMarkers: ['.agents', 'AGENTS.md'],
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
    projectMarkers: ['.cursor'],
    binaries: ['cursor-agent', 'cursor'],
  },
  {
    id: 'agents',
    label: 'Agents (shared tree)',
    homeSub: '.agents',
    projectSkills: '.agents/skills',
    markers: ['.agents'],
    projectMarkers: ['.agents', 'AGENTS.md'],
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
    projectMarkers: ['.gemini'],
    binaries: ['gemini'],
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    homeSub: '.copilot',
    projectSkills: '.agents/skills',
    markers: ['.copilot'],
    projectMarkers: ['.github', '.agents'],
    binaries: ['copilot'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    homeSub: '.config/opencode',
    projectSkills: '.opencode/skills',
    markers: ['.config/opencode'],
    projectMarkers: ['.opencode'],
    binaries: ['opencode'],
  },
  {
    id: 'continue',
    label: 'Continue',
    homeSub: '.continue',
    projectSkills: '.continue/skills',
    markers: ['.continue'],
    projectMarkers: ['.continue'],
    binaries: ['cn'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    homeSub: '.codeium/windsurf',
    projectSkills: '.windsurf/skills',
    markers: ['.codeium/windsurf'],
    projectMarkers: ['.windsurf', '.codeium'],
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
    projectMarkers: ['.grok'],
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
    projectMarkers: ['.pi'],
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
    projectMarkers: ['.kilocode'],
    binaries: ['kilocode'],
  },
  {
    id: 'roo',
    label: 'Roo Code',
    homeSub: '.roo',
    projectSkills: '.roo/skills',
    markers: ['.roo'],
    projectMarkers: ['.roo'],
    binaries: ['roo'],
  },
];
