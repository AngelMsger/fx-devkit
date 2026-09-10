import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { NodeProcess } from '../../src/adapters/process/node-process.js';
import { writeNodeShim } from '../platform.js';

import { freshHome, git, manifestDirOf, repository } from './harness.js';

export function sourceFixture() {
  const root = freshHome();
  const home = path.join(root, 'fx');
  const workspace = path.join(root, 'workspace');
  const hosts = path.join(root, 'hosts');
  const binaries = path.join(root, 'bin');
  for (const dir of [
    home,
    workspace,
    binaries,
    path.join(hosts, 'TEAM'),
    path.join(hosts, '~alice'),
  ])
    mkdirSync(dir, { recursive: true });
  const document = `schema_version: 2\nproviders:\n  code-host: { provider: bitbucket-cli, vars: { host: ${JSON.stringify(hosts)}, web: https://git.example.com } }\ndefaults: { branch: main }\nrepos: [{ name: example, desc: Example }]\n`;
  const upstream = repository(path.join(hosts, 'TEAM'), 'manifest', {
    'manifest/workspace.yaml': document,
    'notes.md': 'base',
    'note one.md': 'base',
  });
  const origin = path.join(hosts, '~alice/manifest.git');
  git(['clone', '--bare', '-q', upstream.bare, origin], root);
  const source = manifestDirOf(home, 'test');
  mkdirSync(path.dirname(source), { recursive: true });
  git(['clone', '--origin', 'upstream', '-q', upstream.bare, source], root);
  git(['remote', 'add', 'origin', origin], source);
  git(['config', 'user.name', 'Fixture'], source);
  git(['config', 'user.email', 'fixture@example.com'], source);
  writeFileSync(path.join(source, 'notes.md'), 'new notes');
  writeFileSync(path.join(source, 'note one.md'), 'new spaced notes');
  writeFileSync(
    path.join(home, 'config.yaml'),
    JSON.stringify({
      default_workspace: 'test',
      workspaces: { test: { root: workspace, source: upstream.bare } },
      skill_notice: false,
    }),
  );
  const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name)+1];
const repoAt = args.indexOf('repo');
const prAt = args.indexOf('pr');
const stateFile = process.env.FX_TEST_STATE;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8')) : {nextId:1,prs:[]};
const fail = (code, category) => { console.error(JSON.stringify({error:{category,code:'FIXTURE_FAILURE',message:'fixture failure'}})); process.exitCode=code; };
if(args.includes('whoami')) console.log(JSON.stringify(process.env.FX_TEST_UNKNOWN_ACTOR==='1'?{type:'dc'}:{name:'alice'}));
else if(repoAt >= 0 && args[repoAt+1] === 'get') {
 const [workspace, slug] = args[repoAt+2].split('/');
 console.log(JSON.stringify({workspace,slug,default_branch:'main',clone_ssh:path.join(process.env.FX_TEST_HOST,workspace,slug+'.git'),url:'https://git.example.com/projects/'+workspace+'/repos/'+slug+'/browse',parent:workspace==='~alice'?{workspace:process.env.FX_TEST_WRONG_PARENT==='1'?'OTHER':'TEAM',slug}:null}));
} else if(prAt >= 0 && args[prAt+1] === 'get') {
 if(process.env.FX_TEST_QUERY_FAIL === '1') fail(8,'network');
 else {
  const id = Number(args[prAt+2].split('/').at(-1));
  const pr = state.prs.find(item=>item.id===id);
  if(pr) console.log(JSON.stringify(pr)); else fail(6,'not_found');
 }
} else if(prAt >= 0 && args[prAt+1] === 'create') {
 const [workspace,slug] = argument('--repo').split('/');
 const pr = {id:state.nextId++,state:'OPEN',title:argument('--title'),description:fs.readFileSync(argument('--description-file'),'utf8'),source:{branch:argument('--source'),repository:argument('--source-repo')},destination:{branch:argument('--target'),repository:argument('--repo')},repository:{workspace,slug}};
 pr.url='https://git.example.com/projects/'+workspace+'/repos/'+slug+'/pull-requests/'+pr.id;
 state.prs.push(pr); fs.writeFileSync(stateFile,JSON.stringify(state));
 if(process.env.FX_TEST_LOSE_PR_RESPONSE === '1') fail(8,'network'); else console.log(JSON.stringify(pr));
} else fail(2,'usage');
`;
  writeNodeShim(binaries, 'bitbucket-cli', script);
  return {
    home,
    workspace,
    source,
    origin,
    upstream: upstream.bare,
    binaries,
    state: path.join(binaries, 'state.json'),
    env: {
      FX_HOME: home,
      FX_TEST_HOST: hosts,
      FX_TEST_STATE: path.join(binaries, 'state.json'),
      PATH: `${binaries}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  };
}
export function sourceFingerprint(root: string): string {
  const hash = createHash('sha256');
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      hash.update(path.relative(root, file));
      if (statSync(file).isDirectory()) walk(file);
      else hash.update(readFileSync(file));
    }
  }
  walk(root);
  return hash.digest('hex');
}
export const sourceMetadata = [
  '--issue',
  'g-1',
  '--title',
  'Reviewed contribution',
  '--format',
  'json',
];

export async function installPushFault(fixture: ReturnType<typeof sourceFixture>): Promise<string> {
  const real = await new NodeProcess().which('git');
  if (!real) throw new Error('Git is required for this fixture.');
  const log = path.join(fixture.binaries, 'pushes.json');
  const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const result = require('node:child_process').spawnSync(${JSON.stringify(real)}, args, {stdio:'inherit'});
if(args.includes('push')) {
 const file = ${JSON.stringify(log)};
 const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
 calls.push(args); fs.writeFileSync(file,JSON.stringify(calls));
 if(result.status===0 && process.env.FX_TEST_DROP_PUSH_RESPONSE==='1') { console.error('fixture lost the successful push response'); process.exit(8); }
}
process.exit(result.status===null?1:result.status);
`;
  writeNodeShim(fixture.binaries, 'git', script);
  return log;
}
