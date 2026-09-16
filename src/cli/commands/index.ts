// The command registry: the single runtime source of the command tree, which
// oclif loads explicitly and the docs generator reads. Keys use oclif's
// `topic:command` form.

import AgentList from './agent/list.js';
import AgentPick from './agent/pick.js';
import AgentUnpick from './agent/unpick.js';
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
import EnvShow from './env/show.js';
import EnvUnpick from './env/unpick.js';
import HookDispatch from './hook/dispatch.js';
import HookInject from './hook/inject.js';
import HookList from './hook/list.js';
import HookRemove from './hook/remove.js';
import InitCommand from './init.js';
import LoginCommand from './login.js';
import ManifestExplain from './manifest/explain.js';
import ManifestImport from './manifest/import.js';
import ManifestLint from './manifest/lint.js';
import ManifestProviders from './manifest/providers.js';
import ManifestRender from './manifest/render.js';
import ManifestSchema from './manifest/schema.js';
import ManifestSet from './manifest/set.js';
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
import RepoShow from './repo/show.js';
import RepoUnpick from './repo/unpick.js';
import SelfInfo from './self/info.js';
import SelfUpdate from './self/update.js';
import SkillInstall from './skill/install.js';
import SkillList from './skill/list.js';
import SkillPath from './skill/path.js';
import SkillShow from './skill/show.js';
import SkillStatus from './skill/status.js';
import SkillUninstall from './skill/uninstall.js';
import SourcePushCommand from './source/push.js';
import StatusCommand from './status.js';
import SyncCommand from './sync.js';
import ToolInstall from './tool/install.js';
import ToolList from './tool/list.js';
import ToolShow from './tool/show.js';
import ToolUpdate from './tool/update.js';
import WhereCommand from './where.js';

export const COMMANDS = {
  'mcp:list': McpList,
  'mcp:show': McpShow,
  'source:push': SourcePushCommand,
  'hook:dispatch': HookDispatch,
  'hook:list': HookList,
  'hook:inject': HookInject,
  'hook:remove': HookRemove,
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
  'repo:pick': RepoPick,
  'repo:unpick': RepoUnpick,
  'repo:add': RepoAdd,
  'repo:remove': RepoRemove,
  'repo:fork': RepoFork,
  'repo:open': RepoOpen,
  'env:list': EnvList,
  'env:show': EnvShow,
  'env:pick': EnvPick,
  'env:unpick': EnvUnpick,
  'agent:list': AgentList,
  'agent:pick': AgentPick,
  'agent:unpick': AgentUnpick,
  'skill:install': SkillInstall,
  'skill:list': SkillList,
  'skill:path': SkillPath,
  'skill:show': SkillShow,
  'skill:status': SkillStatus,
  'skill:uninstall': SkillUninstall,
  'tool:list': ToolList,
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
  'manifest:set': ManifestSet,
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
    .filter(([, command]) => includeHidden || !command.hidden)
    .map(([id]) => id.replaceAll(':', ' '));
}
