import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = fileURLToPath(new URL('./setup-env.mjs', import.meta.url));

function isolatedFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'bthwani-env-exclusive-'));
  const infra = path.join(root, 'infra');
  mkdirSync(infra);
  const script = path.join(infra, 'setup-env.mjs');
  copyFileSync(source, script);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, script, dest: path.join(infra, '.env') };
}

function run(script) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env },
  });
}

function runAsync(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('creates one local secret file with exclusive creation and no printed secrets', t => {
  const { script, dest } = isolatedFixture(t);
  const result = run(script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'REFOUNDATION_ENV_CREATED_LOCAL_ONLY');
  const file = readFileSync(dest, 'utf8');
  assert.match(file, /^REF_POSTGRES_PASSWORD=[0-9a-f]{64}$/m);
  assert.match(file, /^REF_MEDIA_ACCESS_KEY=[0-9a-f]{64}$/m);
  assert.match(file, /^REF_MEDIA_SECRET_KEY=[0-9a-f]{64}$/m);
  assert.ok(lstatSync(dest).isFile());
  for (const secret of [...file.matchAll(/=(?<secret>[0-9a-f]{64})$/gm)]) {
    assert.ok(!result.stdout.includes(secret.groups.secret));
    assert.ok(!result.stderr.includes(secret.groups.secret));
  }
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(dest).mode & 0o777, 0o600);
  }
});

test('second invocation preserves the exact existing file', t => {
  const { script, dest } = isolatedFixture(t);
  const original = 'REF_POSTGRES_PASSWORD=preserved\n';
  writeFileSync(dest, original, 'utf8');
  const result = run(script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'REFOUNDATION_ENV_EXISTS_UNTOUCHED');
  assert.equal(readFileSync(dest, 'utf8'), original);
});

test('existing directory is rejected without altering contents', t => {
  const { script, dest } = isolatedFixture(t);
  mkdirSync(dest);
  const result = run(script);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a regular file/);
  assert.ok(lstatSync(dest).isDirectory());
});

test('existing symlink never overwrites a different target', t => {
  const { root, script, dest } = isolatedFixture(t);
  const target = path.join(root, 'protected-target');
  const original = 'protected-original-data';
  writeFileSync(target, original, 'utf8');
  try {
    symlinkSync(target, dest, 'file');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.diagnostic('Symlink creation unavailable on this OS/user; test skipped');
      return;
    }
    throw error;
  }
  const result = run(script);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a regular file/);
  assert.ok(lstatSync(dest).isSymbolicLink());
  assert.equal(readFileSync(target, 'utf8'), original);
});

test('concurrent contenders never replace the winning secret file', async t => {
  const { script, dest } = isolatedFixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => runAsync(script)));
  assert.ok(results.every(r => r.code === 0), results.map(r => r.stderr).join('\n'));
  assert.equal(results.filter(r => r.stdout.trim() === 'REFOUNDATION_ENV_CREATED_LOCAL_ONLY').length, 1);
  assert.equal(results.filter(r => r.stdout.trim() === 'REFOUNDATION_ENV_EXISTS_UNTOUCHED').length, 7);
  const file = readFileSync(dest, 'utf8');
  assert.equal((file.match(/^REF_POSTGRES_PASSWORD=/gm) || []).length, 1);
  assert.equal((file.match(/^REF_MEDIA_SECRET_KEY=/gm) || []).length, 1);
  assert.match(file, /^REF_MEDIA_SECRET_KEY=[0-9a-f]{64}$/m);
  for (const result of results) {
    assert.ok(!result.stdout.includes(file.match(/^REF_MEDIA_SECRET_KEY=([0-9a-f]{64})$/m)[1]));
  }
});
