import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
