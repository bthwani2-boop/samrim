import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
