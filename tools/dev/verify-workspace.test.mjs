import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.match(result.stdout, /STAGE4_WORKSPACE_STRUCTURE_PASS/);
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
      'services/wlt/database/migrations/001_ledger_entries.sql',
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

test('the merged PR 193 coverage waiver cannot silently return to Sonar CI', async () => {
  const { readFileSync } = await import('node:fs');
  const sonar = readFileSync(new URL('../../.github/workflows/sonar-quality.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(sonar, /Temporary PR 193 coverage exception|sonar[.]coverage[.]exclusions/);
  assert.ok(sonar.includes('-Dsonar.qualitygate.wait=true'));
  assert.ok(sonar.includes('SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}'));
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
