#!/usr/bin/env node
// Stage-3 workspace smoke: local toolchain pins and a source-sparse pnpm workspace.
// This does not verify any Expo/Go service, contracts, SQL, deployment or Product readiness.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const strict = process.argv.includes('--require-exact-toolchain');
if (process.argv.length > 2 && (process.argv.length !== 3 || !strict)) {
  throw new Error('Usage: node tools/dev/verify-workspace.mjs [--require-exact-toolchain]');
}
const read = (file) => readFileSync(path.join(projectRoot, file), 'utf8');
const fail = (reason) => { throw new Error('STAGE3_WORKSPACE_FAIL: ' + reason); };

const pkg = JSON.parse(read('package.json'));
const nodePin = read('.node-version').trim();
const goPin = read('.go-version').trim();
const nvmPin = read('.nvmrc').trim();
const pnpmPin = '12.15.0';
const tsPin = '7.0.2';
const biomePin = '2.5.12';

assert.equal(nodePin, '24.22.1', 'Node pin changed from original branch 41');
assert.equal(nvmPin, nodePin, 'nvm and Node pins must agree');
assert.equal(goPin, '1.27.3', 'Go pin changed from original branch 41');
assert.equal(pkg.packageManager, 'pnpm@' + pnpmPin);
assert.equal(pkg.private, true);
assert.equal(pkg.engines.node, '>=24.17.0 <25');
assert.equal(pkg.engines.pnpm, pnpmPin);
assert.deepEqual(pkg.devDependencies, { '@biomejs/biome': biomePin, typescript: tsPin },
  'No new packages or version drift before application implementation is authorized');

const ws = read('pnpm-workspace.yaml');
for (const glob of ['"apps/*"', '"packages/*"', '"services/*"']) {
  if (!ws.includes(glob)) fail('Missing future workspace glob ' + glob);
}
for (const setting of ['autoInstallPeers: false','engineStrict: true',
  'nodeLinker: isolated','saveExact: true','strictPeerDependencies: true']) {
  if (!ws.includes(setting)) fail('Missing original pnpm behavior: ' + setting);
}
if (/patchedDependencies:|nxCloudId:/.test(ws)) fail('Inherited old patches or Nx Cloud are not admitted in stage 3');

const lock = read('pnpm-lock.yaml');
for (const entry of ["lockfileVersion: '9.0'",
  "specifier: 12.15.0", "specifier: " + tsPin, "specifier: " + biomePin,
  'typescript@' + tsPin + ':', "'@biomejs/biome@" + biomePin + "':"]) {
  if (!lock.includes(entry)) fail('Incomplete exact pnpm frozen lock: ' + entry);
}
for (const p of ['tsconfig.base.json','biome.json','.editorconfig','.gitattributes','.gitignore']) {
  if (!existsSync(path.join(projectRoot, p))) fail('Missing tooling configuration: ' + p);
}
const tsconfig = JSON.parse(read('tsconfig.base.json'));
if (tsconfig.compilerOptions.strict !== true || tsconfig.compilerOptions.noEmit !== true) {
  fail('Base TypeScript contract must remain strict and non-emitting');
}
const biome = JSON.parse(read('biome.json'));
if (biome.linter.enabled !== true || biome.formatter.enabled !== false) {
  fail('Use original Biome lint policy without introducing redundant ESLint toolchain');
}
for (const forbidden of ['apps','services','packages','contracts','infra','nx.json','go.work']) {
  if (existsSync(path.join(projectRoot, forbidden))) {
    fail('Stage 4+ business/app/service/infra scaffolding is premature: ' + forbidden);
  }
}
for (const entry of ['node_modules/','.env','secrets.local.']) {
  if (!read('.gitignore').includes(entry)) fail('Local dependencies or secret ignores missing: ' + entry);
}

console.log('STAGE3_WORKSPACE_STRUCTURE_PASS pnpm=' + pnpmPin +
  ' typescript=' + tsPin + ' biome=' + biomePin + ' node-pin=' + nodePin +
  ' go-pin=' + goPin + ' nx=DEFERRED(no projects yet)');

if (strict) {
  const installedNode = process.versions.node;
  if (installedNode !== nodePin) fail('Node executable differs from exact .node-version: ' + installedNode);
  const go = spawnSync('go', ['version'], {
    encoding: 'utf8', shell: process.platform === 'win32',
    env: { ...process.env, GOTOOLCHAIN: 'local' }
  });
  if (go.status !== 0) fail('Go executable unavailable without downloading/upgrading toolchain');
  const actual = /go version go([0-9.]+)/.exec(go.stdout)?.[1];
  if (actual !== goPin) fail('Go toolchain mismatch: expected ' + goPin + ', installed ' + (actual ?? 'unknown') +
    '; no upgrade permitted by current instruction');
  console.log('STAGE3_EXACT_LOCAL_TOOLCHAIN_PASS node=' + installedNode + ' go=' + actual);
}
