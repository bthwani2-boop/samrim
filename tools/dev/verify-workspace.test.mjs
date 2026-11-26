import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = new URL('./verify-workspace.mjs', import.meta.url);

test('workspace verifier accepts the active pinned Node runtime', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(verifier)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WORKSPACE_SOURCE_PASS/);
  assert.match(result.stdout, /nx_cloud_configured=true nx_cache_execution=NOT_RUN lock=STATIC_ONLY/);
  assert.doesNotMatch(result.stdout, /STAGE[0-9]|nx=LOCAL_ONLY/);
});

test('workspace verifier rejects a different active Node even if the pinned binary exists', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-node-version-'));
  try {
    const preload = path.join(directory, 'simulate-node-version.cjs');
    writeFileSync(preload, "Object.defineProperty(process, 'version', { value: 'v24.19.0' });\n");
    const result = spawnSync(process.execPath, ['--require', preload, fileURLToPath(verifier)], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Active Node runtime mismatch: expected 24\.22\.1, observed 24\.19\.0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('existing owner Go and SQL source paths remain legal, including WLT when implemented', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-service-placement-'));
  try {
    for (const file of [
      'services/identity/backend/cmd/identity/main.go',
      'services/dsh/backend/internal/storeavailability/service.go',
      'services/dsh/backend/internal/storeavailability/tests/replay_test.go',
      'services/wlt/backend/internal/ledger/entry.go',
      'services/identity/database/schema/00_identity.sql',
      'services/dsh/database/schema/10_catalog.sql',
      'services/wlt/database/schema/00_ledger.sql',
      'services/wlt/database/sandbox/10_test_funding.sql',
    ]) {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '// synthetic fixture');
    }
    assert.deepEqual(serviceSourcePlacementIssues(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh owner SQL rejects misplaced sandbox and noncanonical baseline names', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-sql-baseline-placement-'));
  try {
    for (const file of [
      'services/dsh/database/sandbox/20_test_reversal.sql',
      'services/identity/database/schema/001_wrong_width.sql',
      'services/wlt/database/schema/legacy.sql',
    ]) {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '-- deliberately invalid SQL placement fixture');
    }
    const problems = serviceSourcePlacementIssues(directory);
    assert.equal(problems.length, 3, problems.join('\n'));
    for (const name of ['20_test_reversal.sql', '001_wrong_width.sql', 'legacy.sql']) {
      assert.ok(problems.some(issue => issue.includes(name)), name);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('owner OpenAPI YAML permits only its one entrypoint and flat paths modules', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-owner-openapi-placement-'));
  try {
    for (const file of [
      'services/identity/contracts/openapi/identity.openapi.yaml',
      'services/dsh/contracts/openapi/paths/store-access.yaml',
      'services/wlt/contracts/openapi/paths/ledger.yaml',
    ]) {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'paths: {}\\n');
    }
    assert.deepEqual(serviceSourcePlacementIssues(directory), [],
      'canonical owner entrypoints and reserved flat fragments remain allowed');

    for (const file of [
      'services/identity/contracts/openapi/shadow.yaml',
      'services/dsh/contracts/openapi/wlt.openapi.yaml',
      'services/wlt/contracts/openapi/paths/nested/ledger.yaml',
      'services/identity/contracts/alternate-sessions.yaml',
    ]) {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'paths: {}\\n');
    }
    const issues = serviceSourcePlacementIssues(directory);
    for (const name of ['shadow.yaml', 'wlt.openapi.yaml', 'nested/ledger.yaml', 'alternate-sessions.yaml']) {
      assert.ok(issues.some(issue => issue.includes(name)),
        `Non-canonical owner OpenAPI file escaped placement guard: ${name}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('service placement guard rejects wrong owners, unnamed SQL and duplicate contract path trees', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-illegal-placement-'));
  try {
    for (const file of [
      'services/identity/backend/session.go',
      'services/dsh/backend/cmd/identity/main.go',
      'services/dsh/backend/internal/misc/store.go',
      'services/wlt/database/migrations/001.sql',
      'services/wlt/backend/seed.sql',
      'services/identity/contracts/openapi/path/sessions.yaml',
    ]) {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '// forbidden fixture');
    }
    const problems = serviceSourcePlacementIssues(directory);
    assert.ok(problems.some(problem => problem.includes('backend/session.go')));
    assert.ok(problems.some(problem => problem.includes('cmd/identity/main.go')));
    assert.ok(problems.some(problem => problem.includes('internal/misc')));
    assert.ok(problems.some(problem => problem.includes('001.sql')));
    assert.ok(problems.some(problem => problem.includes('backend/seed.sql')));
    assert.ok(problems.some(problem => problem.includes('openapi/path')));
    assert.equal(problems.length, 7, problems.join('\\n'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an untracked fourth business service cannot bypass the owner-placement guard', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-rogue-owner-'));
  try {
    const allowed = path.join(directory, 'services', 'wlt', 'backend', 'internal', 'ledger', 'entry.go');
    mkdirSync(path.dirname(allowed), { recursive: true });
    writeFileSync(allowed, 'package ledger\\n');
    assert.deepEqual(serviceSourcePlacementIssues(directory), []);

    const rogue = path.join(directory, 'services', 'payments', 'backend', 'internal', 'ledger', 'entry.go');
    mkdirSync(path.dirname(rogue), { recursive: true });
    writeFileSync(rogue, 'package ledger\\n');
    const issues = serviceSourcePlacementIssues(directory);
    assert.ok(issues.some(issue => issue.includes('services/payments: unapproved service owner')), issues.join('\\n'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('service placement rejects unowned source files directly under services/', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-orphan-service-file-'));
  try {
    const legal = path.join(directory, 'services', 'dsh', 'backend', 'internal', 'discovery', 'http.go');
    mkdirSync(path.dirname(legal), { recursive: true });
    writeFileSync(legal, 'package discovery\n');
    assert.deepEqual(serviceSourcePlacementIssues(directory), []);

    const orphan = path.join(directory, 'services', 'orphan-client.ts');
    writeFileSync(orphan, 'export const duplicateOwner = true;\n');
    const issues = serviceSourcePlacementIssues(directory);
    assert.ok(issues.some(issue => issue.includes('services/orphan-client.ts: unowned service root file')),
      issues.join('\n'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('service placement refuses a linked services root before traversing it', async (t) => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'bthwani-linked-service-root-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, 'checkout');
  const target = path.join(dir, 'outside');
  mkdirSync(base);
  mkdirSync(path.join(target, 'dsh'), { recursive: true });
  symlinkSync(target, path.join(base, 'services'), 'junction');
  assert.deepEqual(serviceSourcePlacementIssues(base),
    ['services: service source root must be an actual directory']);
});

test('service placement reports an owner link without evaluating files outside the checkout', async (t) => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'bthwani-linked-owner-root-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, 'checkout');
  const target = path.join(dir, 'outside');
  mkdirSync(path.join(base, 'services'), { recursive: true });
  mkdirSync(target);
  writeFileSync(path.join(target, 'misplaced.sql'), 'SELECT 1;');
  symlinkSync(target, path.join(base, 'services', 'dsh'), 'junction');
  assert.deepEqual(serviceSourcePlacementIssues(base),
    ['services/dsh: unapproved service owner or source link']);
});

test('deep owner paths reject misplaced Go, SQL and OpenAPI while preserving legal modules', async () => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-deep-owner-placement-'));
  try {
    const put = file => {
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '// isolated fixture\n');
    };
    for (const valid of [
      'services/identity/backend/internal/session/recovery/replay.go',
      'services/dsh/backend/internal/storeavailability/policy/current.go',
      'services/wlt/backend/internal/ledger/reversal.go',
      'services/dsh/contracts/openapi/paths/captain-interest.yaml',
    ]) put(valid);
    assert.deepEqual(serviceSourcePlacementIssues(directory), [],
      'meaningful nested domains and legal owner artifacts remain valid');

    for (const invalid of [
      'services/dsh/backend/internal/storeavailability/misc/legacy.go',
      'services/dsh/backend/internal/store-availability/snapshot.go',
      'services/identity/backend/cmd/dsh/other-owner.go',
      'services/wlt/database/migrations/012.sql',
      'services/dsh/contracts/openapi/paths/checkout/shadow.yaml',
    ]) put(invalid);
    const issues = serviceSourcePlacementIssues(directory);
    assert.equal(issues.length, 6, issues.join('\n'),
      'the illegal Go directory and its source file are separate placement violations');
    for (const fragment of [
      'storeavailability/misc/legacy.go',
      'store-availability/snapshot.go',
      'backend/cmd/dsh/other-owner.go',
      'migrations/012.sql',
      'paths/checkout/shadow.yaml',
    ]) {
      assert.ok(issues.some(issue => issue.includes(fragment)),
        `Untracked deeply nested owner violation escaped guard: ${fragment}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('baseline-first local development refuses new migration histories for every owner', async (t) => {
  const { serviceSourcePlacementIssues } = await import('./check-service-placement.mjs');
  const directory = mkdtempSync(path.join(tmpdir(), 'bthwani-baseline-first-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const owner of ['identity', 'dsh', 'wlt']) {
    const schema = path.join(directory, 'services', owner, 'database', 'schema', '00_domain.sql');
    mkdirSync(path.dirname(schema), { recursive: true });
    writeFileSync(schema, 'SELECT 1;');
  }
  assert.deepEqual(serviceSourcePlacementIssues(directory), []);
  for (const owner of ['identity', 'dsh', 'wlt']) {
    const migration = path.join(directory, 'services', owner, 'database', 'migrations', '001_new_column.sql');
    mkdirSync(path.dirname(migration), { recursive: true });
    writeFileSync(migration, 'SELECT 1;');
  }
  const issues = serviceSourcePlacementIssues(directory);
  for (const owner of ['identity', 'dsh', 'wlt']) {
    assert.ok(issues.some(issue => issue.includes('services/'+owner+'/database/migrations/001_new_column.sql') &&
      issue.includes('BASELINE_FIRST')), issues.join('\n'));
  }
});

function sourceFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bthwani-workspace-source-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const files = [
    '.node-version', '.nvmrc', '.go-version', 'package.json', 'pnpm-workspace.yaml',
    'pnpm-lock.yaml', 'nx.json', 'knip.jsonc', '.editorconfig', '.gitattributes',
    '.gitignore', 'tsconfig.base.json', 'biome.json',
    'tools/mobile/define-bthwani-expo-app.cjs', 'tools/mobile/verify-app-identity.mjs',
    'patches/@rc-component__util@1.14.0.patch',
    ...['apps/customer','apps/merchant','apps/captain','apps/control-panel',
      'packages/design-system','packages/tamagui-config'].map(project => project + '/package.json'),
    ...['identity','dsh','wlt'].flatMap(owner => [
      'README.md','package.json','tsconfig.json','clients/index.ts','clients/README.md',
      'backend/go.mod','contracts/openapi/' + owner + '.openapi.yaml',
    ].map(rel => 'services/' + owner + '/' + rel)),
  ];
  for (const rel of files) {
    const target = path.join(dir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(source, rel), target);
  }
  return dir;
}

test('source admission follows actual owners, not README status or imaginary Nx cache execution', async t => {
  const { verifyWorkspace } = await import('./verify-workspace.mjs');
  const dir = sourceFixture(t);
  writeFileSync(path.join(dir, 'services/wlt/README.md'), '# WLT owner documentation\n');
  const result = verifyWorkspace(dir);
  assert.equal(result.node, process.version.slice(1));
  assert.equal(result.nxCloudConfigured, true);
  assert.equal(result.localGoVerified, false);
});

test('source admission rejects root lock drift even when the old version still appears in other lock records', async t => {
  const { verifyWorkspace } = await import('./verify-workspace.mjs');
  const dir = sourceFixture(t);
  const lock = path.join(dir, 'pnpm-lock.yaml');
  const original = readFileSync(lock, 'utf8');
  const altered = original.replace(/(      nx:\r?\n        specifier: )\d+\.\d+\.\d+/, (match, prefix) => prefix + '99.99.99');
  assert.notEqual(altered, original);
  writeFileSync(lock, altered);
  assert.throws(() => verifyWorkspace(dir), /Frozen lock pin differs: nx/);
});

test('source admission rejects an owner Go pin mismatch and a restored losing source path', async t => {
  const { verifyWorkspace } = await import('./verify-workspace.mjs');
  const dir = sourceFixture(t);
  const module = path.join(dir, 'services/dsh/backend/go.mod');
  const original = readFileSync(module, 'utf8');
  writeFileSync(module, original.replace(/^go \d+\.\d+\.\d+$/m, 'go 1.0.0'));
  assert.throws(() => verifyWorkspace(dir), /Owner Go pin differs: dsh/);
  writeFileSync(module, original);
  mkdirSync(path.join(dir, 'apps/app-client'), { recursive: true });
  assert.throws(() => verifyWorkspace(dir), /Retired source path returned: apps\/app-client/);
});

test('source admission protects the configured separate Nx workspace and rejects embedded credentials', async t => {
  const { verifyWorkspace } = await import('./verify-workspace.mjs');
  const dir = sourceFixture(t);
  const config = path.join(dir, 'nx.json');
  const original = JSON.parse(readFileSync(config, 'utf8'));
  writeFileSync(config, JSON.stringify({ ...original, nxCloudAccessToken: 'synthetic-test-only' }));
  assert.throws(() => verifyWorkspace(dir), /Do not embed Nx Cloud credentials/);
  writeFileSync(config, JSON.stringify({ ...original, nxCloudId: '6aa9eedc45c07f39423ffa9f' }));
  assert.throws(() => verifyWorkspace(dir), /Do not reuse donor Nx Cloud workspace/);
});

test("service placement cannot hide an unowned service or illegal owner paths behind generic output names", async (t) => {
  const { serviceSourcePlacementIssues } = await import("./check-service-placement.mjs");
  const root = mkdtempSync(path.join(tmpdir(), "bthwani-placement-output-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = file => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "fixture");
  };
  put("services/dsh/node_modules/dependency/ignored.go");
  put("services/identity/backend/internal/build/valid.go");
  assert.deepEqual(serviceSourcePlacementIssues(root), []);
  const forbidden = [
    "services/build",
    "services/dsh/database/migrations/build/01_bad.sql",
    "services/wlt/contracts/openapi/paths/dist/shadow.yaml",
    "services/identity/backend/internal/build/misc/escape.go",
  ];
  put("services/build/rogue.go");
  for (const file of forbidden.slice(1)) put(file);
  const issues = serviceSourcePlacementIssues(root);
  for (const file of forbidden) assert.ok(issues.some(issue => issue.startsWith(file + ":")), file);
});

test("service placement does not silently ignore a nested dependency or repository root", async (t) => {
  const { serviceSourcePlacementIssues } = await import("./check-service-placement.mjs");
  const root = mkdtempSync(path.join(tmpdir(), "bthwani-placement-nested-root-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ["services/dsh/backend/node_modules", "services/wlt/backend/.git"]) {
    mkdirSync(path.join(root, file), { recursive: true });
  }
  const issues = serviceSourcePlacementIssues(root);
  assert.ok(issues.some(issue => issue.startsWith("services/dsh/backend/node_modules:")));
  assert.ok(issues.some(issue => issue.startsWith("services/wlt/backend/.git:")));
});
