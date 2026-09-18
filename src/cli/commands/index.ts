// The command registry: the single runtime source of the command tree, which
// oclif loads explicitly and the docs generator reads. Keys use oclif's
// `topic:command` form.

import AgentList from './agent/list.js';
import AgentPick from './agent/pick.js';
import AgentSkills from './agent/skills.js';
import AgentUnpick from './agent/unpick.js';
import { COMMAND_ALIASES, compatibilityTarget } from './aliases.js';
import CanCommand from './can.js';
import CompletionCommand from './completion.js';
import ConfigExport from './config/export.js';
import ConfigGet from './config/get.js';
import ConfigImport from './config/import.js';
import ConfigList from './config/list.js';
import ConfigSet from './config/set.js';
import ConfigUnset from './config/unset.js';
import DoctorCommand from './doctor.js';
import EnvList from './env/list.js';
import EnvPick from './env/pick.js';
import EnvSelect from './env/select.js';
import EnvShow from './env/show.js';
import EnvUnpick from './env/unpick.js';
import HookDisable from './hook/disable.js';
import HookDispatch from './hook/dispatch.js';
import HookEnable from './hook/enable.js';
import HookList from './hook/list.js';
import InitCommand from './init.js';
import LoginCommand from './login.js';
import ManifestExplain from './manifest/explain.js';
import ManifestImport from './manifest/import.js';
import ManifestLint from './manifest/lint.js';
import ManifestProviders from './manifest/providers.js';
import ManifestRecordProbe from './manifest/record-probe.js';
import ManifestRender from './manifest/render.js';
import ManifestRepoSet from './manifest/repo-set.js';
import ManifestSchema from './manifest/schema.js';
import ManifestValidate from './manifest/validate.js';
import McpList from './mcp/list.js';
import McpShow from './mcp/show.js';
import MemberList from './member/list.js';
import MemberShow from './member/show.js';
import ReleaseCommand from './release.js';
import RepoAdd from './repo/add.js';
import RepoFork from './repo/fork.js';
import RepoList from './repo/list.js';
import RepoOpen from './repo/open.js';
import RepoPick from './repo/pick.js';
import RepoRemove from './repo/remove.js';
import RepoSelect from './repo/select.js';
import RepoShow from './repo/show.js';
import RepoUnpick from './repo/unpick.js';
import SelfInfo from './self/info.js';
import SelfUpdate from './self/update.js';
import SkillInstall from './skill/install.js';
import SkillPath from './skill/path.js';
import SkillShow from './skill/show.js';
import SkillStatus from './skill/status.js';
import SkillUninstall from './skill/uninstall.js';
import SourcePushCommand from './source/push.js';
import StatusCommand from './status.js';
import SyncCommand from './sync.js';
import ToolHistory from './tool/history.js';
import ToolInstall from './tool/install.js';
import ToolInventory from './tool/inventory.js';
import ToolList from './tool/list.js';
import ToolShow from './tool/show.js';
import ToolUpdate from './tool/update.js';
import WhereCommand from './where.js';
import WorkspaceList from './workspace/list.js';
import WorkspaceRebind from './workspace/rebind.js';
import WorkspaceRelocate from './workspace/relocate.js';
import WorkspaceShow from './workspace/show.js';
import WorkspaceUnregister from './workspace/unregister.js';

export { COMMAND_ALIASES, compatibilityTarget };

const CANONICAL_COMMANDS = {
  'workspace:list': WorkspaceList,
  'workspace:show': WorkspaceShow,
  'workspace:unregister': WorkspaceUnregister,
  'workspace:relocate': WorkspaceRelocate,
  'workspace:rebind': WorkspaceRebind,
  'mcp:list': McpList,
  'mcp:show': McpShow,
  'source:push': SourcePushCommand,
  'hook:dispatch': HookDispatch,
  'hook:list': HookList,
  'hook:enable': HookEnable,
  'hook:disable': HookDisable,
  init: InitCommand,
  sync: SyncCommand,
  login: LoginCommand,
  doctor: DoctorCommand,
  status: StatusCommand,
  can: CanCommand,
  where: WhereCommand,
  release: ReleaseCommand,
  completion: CompletionCommand,
  'repo:list': RepoList,
  'repo:show': RepoShow,
  'repo:select': RepoSelect,
  'repo:pick': RepoPick,
  'repo:unpick': RepoUnpick,
  'repo:add': RepoAdd,
  'repo:remove': RepoRemove,
  'repo:fork': RepoFork,
  'repo:open': RepoOpen,
  'env:list': EnvList,
  'env:show': EnvShow,
  'env:select': EnvSelect,
  'env:pick': EnvPick,
  'env:unpick': EnvUnpick,
  'agent:list': AgentList,
  'agent:skills': AgentSkills,
  'agent:pick': AgentPick,
  'agent:unpick': AgentUnpick,
  'skill:install': SkillInstall,
  'skill:path': SkillPath,
  'skill:show': SkillShow,
  'skill:status': SkillStatus,
  'skill:uninstall': SkillUninstall,
  'tool:list': ToolList,
  'tool:history': ToolHistory,
  'tool:inventory': ToolInventory,
  'tool:show': ToolShow,
  'tool:install': ToolInstall,
  'tool:update': ToolUpdate,
  'member:list': MemberList,
  'member:show': MemberShow,
  'manifest:validate': ManifestValidate,
  'manifest:lint': ManifestLint,
  'manifest:explain': ManifestExplain,
  'manifest:schema': ManifestSchema,
  'manifest:providers': ManifestProviders,
  'manifest:repo-set': ManifestRepoSet,
  'manifest:record-probe': ManifestRecordProbe,
  'manifest:render': ManifestRender,
  'manifest:import': ManifestImport,
  'config:list': ConfigList,
  'config:get': ConfigGet,
  'config:set': ConfigSet,
  'config:unset': ConfigUnset,
  'config:export': ConfigExport,
  'config:import': ConfigImport,
  'self:info': SelfInfo,
  'self:update': SelfUpdate,
};

// Compatibility names execute the canonical class but stay out of primary discovery.
const aliases = Object.fromEntries(
  Object.entries(COMMAND_ALIASES).map(([alias, canonical]) => [
    alias,
    CANONICAL_COMMANDS[canonical],
  ]),
) as {
  [
    Name in keyof typeof COMMAND_ALIASES
  ]: (typeof CANONICAL_COMMANDS)[(typeof COMMAND_ALIASES)[Name]];
};

export const COMMANDS = { ...CANONICAL_COMMANDS, ...aliases };

// The nine commands a person or an agent reaches for first; help and the
// reference show them before the topics.
export const EVERYDAY = [
  'init',
  'sync',
  'login',
  'doctor',
  'status',
  'can',
  'where',
  'release',
  'completion',
] as const;

export function commandIds(includeHidden = true): string[] {
  return Object.entries(COMMANDS)
    .filter(
      ([id, command]) =>
        includeHidden || (!command.hidden && compatibilityTarget(id) === undefined),
    )
    .map(([id]) => id.replaceAll(':', ' '));
}
