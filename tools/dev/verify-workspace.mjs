#!/usr/bin/env node
// Stage-4 workspace smoke: original source toolchain and minimal working app hosts.
// Static verification only, not Android/iOS/live device or financial Product proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const runningNode = process.version.replace(/^v/, '');
if (runningNode !== nodePin) {
  fail('Active Node runtime mismatch: expected ' + nodePin +
    ', observed ' + runningNode + ' at ' + process.execPath);
}
const pnpmPin = '12.15.0';
const tsPin = '7.0.2';
const biomePin = '2.5.12';

assert.equal(nodePin, '24.22.1', 'Node pin changed from original branch 41');
assert.equal(nvmPin, nodePin, 'nvm and Node pins must agree');
assert.equal(goPin, '1.27.4', 'Go must use the approved 2026-11-16 security patch');
assert.equal(pkg.packageManager, 'pnpm@' + pnpmPin);
assert.equal(pkg.private, true);
assert.equal(pkg.engines.node, '>=24.17.0 <25');
assert.equal(pkg.engines.pnpm, pnpmPin);
assert.deepEqual(pkg.devDependencies, { '@biomejs/biome': biomePin, knip: '6.34.0', nx: '24.0.1', typescript: tsPin },
  'Workspace tooling must use exact donor-compatible package versions');
if (pkg.dependencies?.nx) fail('Nx is development tooling, not a production dependency');

const ws = read('pnpm-workspace.yaml');
for (const glob of ['"apps/*"', '"packages/*"', '"services/*"']) {
  if (!ws.includes(glob)) fail('Missing future workspace glob ' + glob);
}
for (const setting of ['autoInstallPeers: false','engineStrict: true',
  'nodeLinker: isolated','saveExact: true','strictPeerDependencies: true']) {
  if (!ws.includes(setting)) fail('Missing original pnpm behavior: ' + setting);
}
if (/nxCloudId:/.test(ws)) fail('Nx Cloud is not admitted');
if (!ws.includes("'@rc-component/util@1.14.0': patches/@rc-component__util@1.14.0.patch")) {
  fail('Pinned donor Ant Design CSP patch is missing');
}

const nx = JSON.parse(read('nx.json'));
if (nx.defaultBase !== 'main' || nx.targetDefaults?.typecheck?.cache !== true ||
    !Array.isArray(nx.namedInputs?.nodeToolchain)) {
  fail('Nx local project graph and typecheck cache configuration is incomplete');
}
if (!/^[a-f0-9]{24}$/.test(nx.nxCloudId ?? '') ||
    nx.nxCloudId === '6aa9eedc45c07f39423ffa9f' ||
    nx.nxCloudAccessToken || nx.nxCloudUrl) {
  fail('Nx Cloud requires a dedicated refoundation ID and no embedded credentials');
}
const lock = read('pnpm-lock.yaml');
for (const entry of ["lockfileVersion: '9.0'",
  "specifier: 12.15.0", "specifier: " + tsPin, "specifier: " + biomePin,
  "specifier: 6.34.0", "knip@6.34.0:",
  'typescript@' + tsPin + ':', "'@biomejs/biome@" + biomePin + "':"]) {
  if (!lock.includes(entry)) fail('Incomplete exact pnpm frozen lock: ' + entry);
}
for (const p of ['knip.jsonc','nx.json','tsconfig.base.json','biome.json','.editorconfig','.gitattributes','.gitignore']) {
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
for (const required of ['apps/customer','apps/merchant','apps/captain','apps/control-panel',
  'packages/design-system','packages/tamagui-config',
  'tools/mobile/define-bthwani-expo-app.cjs',
  'tools/mobile/verify-app-foundations.mjs','patches/@rc-component__util@1.14.0.patch']) {
  if (!existsSync(path.join(projectRoot, required))) fail('Stage-4 required source absent: ' + required);
}
for (const owner of ['identity','dsh','wlt']) {
  const placement = path.join(projectRoot, 'services', owner, 'README.md');
  if (!existsSync(placement)) fail('Missing service placement README for ' + owner);
  const doc = readFileSync(placement, 'utf8');
  // A service may progress from a placement-only scaffold to isolated owner code
  // without a global governance cutover or separate development admission vote.
  const state = /^STATUS: (SCAFFOLD_ONLY|IMPLEMENTATION_IN_PROGRESS)$/m.exec(doc)?.[1];
  const execution = /^EXECUTION: (NOT_STARTED|IN_PROGRESS)$/m.exec(doc)?.[1];
  if (!((state === 'SCAFFOLD_ONLY' && execution === 'NOT_STARTED') ||
        (state === 'IMPLEMENTATION_IN_PROGRESS' && execution === 'IN_PROGRESS'))) {
    fail('Service README must declare a consistent scaffold or progressive execution state: ' + owner);
  }
  const dir = path.join(projectRoot, 'services', owner);
  const service = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (service.name !== '@bthwani/' + owner || service.private !== true ||
      service.type !== 'module' || service.types !== './clients/index.ts' ||
      service.scripts?.typecheck !== 'tsc --noEmit -p tsconfig.json' ||
      service.devDependencies?.typescript !== tsPin) {
    fail('Service client workspace is not ready: ' + owner);
  }
  const config = JSON.parse(readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
  if (config.extends !== '../../tsconfig.base.json' ||
      !config.include?.includes('clients/**/*.ts') ||
      !config.include?.includes('clients/**/*.tsx') ||
      config.compilerOptions?.noEmit !== true) {
    fail('Service TypeScript configuration is not ready: ' + owner);
  }
  if (!existsSync(path.join(dir, 'clients', 'index.ts')) ||
      !existsSync(path.join(dir, 'clients', 'README.md')) ||
      !lock.includes('  services/' + owner + ':')) {
    fail('Missing client entrypoint, documentation or frozen lock importer: ' + owner);
  }
}
for (const forbidden of ['contracts','go.work',
  'apps/app-client','apps/app-partner','apps/app-captain',
  'tools/mobile/create-bthwani-metro-config.cjs']) {
  if (existsSync(path.join(projectRoot, forbidden))) fail('Duplicated/deferred legacy source: ' + forbidden);
}
for (const entry of ['node_modules/','.env','secrets.local.','apps/control-panel/next-env.d.ts']) {
  if (!read('.gitignore').includes(entry)) fail('Local dependencies or secret ignores missing: ' + entry);
}

console.log('STAGE4_WORKSPACE_STRUCTURE_PASS pnpm=' + pnpmPin +
  ' typescript=' + tsPin + ' biome=' + biomePin + ' node-pin=' + nodePin +
  ' go-pin=' + goPin + ' nx=LOCAL_ONLY');

if (strict) {
  // pnpm launches its own embedded Node runtime on some Windows machines.
  // Discover the real installed executables rather than trusting pnpm's PATH
  // first entry. All probes are version-only and do not modify the toolchain.
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  const args = process.platform === 'win32' ? ['node'] : ['-a', 'node'];
  const candidates = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  if (candidates.status !== 0) fail('Cannot discover installed Node executables');
  const nodeVersions = [...new Set(candidates.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean))]
    .map(file => {
      const probe = spawnSync(file, ['--version'], { encoding: 'utf8', windowsHide: true });
      return probe.status === 0 ? probe.stdout.trim().replace(/^v/, '') : 'unavailable';
    });
  if (!nodeVersions.includes(nodePin)) {
    fail('Exact .node-version binary not found on PATH: expected ' + nodePin +
      ', observed ' + nodeVersions.join(', '));
  }
  const installedNode = nodePin;
  // Verify the installed Go binary, not an automatically downloaded toolchain.
  // GOTOOLCHAIN=local prevents Go's user cache from masking a global mismatch.
  const go = spawnSync(process.platform === 'win32' ? 'go.exe' : 'go', ['version'], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPROXY: 'off' }
  });
  if (go.status !== 0) fail('Cannot execute locally installed Go binary: ' + (go.error?.message ?? go.stderr?.trim() ?? 'unknown'));
  const actual = /^go version go([0-9.]+) /m.exec(go.stdout)?.[1];
  if (actual !== goPin) fail('Global Go toolchain mismatch: expected ' + goPin +
    ', observed ' + (actual ?? 'unknown'));
  console.log('STAGE3_EXACT_LOCAL_TOOLCHAIN_PASS node=' + installedNode + ' go=' + actual + ' global_go=true');
}
