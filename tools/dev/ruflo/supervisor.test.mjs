import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Supervisor, validateJob, loadConfig } from './supervisor.mjs';
import { parseFixturePrompt } from './fixture.mjs';
import { createWorktreeForJob, validateWorktreeBase } from './worktrees.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GIB = 1024 ** 3;
function sandbox(t, extra = {}) {
  fs.mkdirSync(path.join(ROOT, 'tests'), { recursive: true });
  const root = fs.mkdtempSync(path.join(ROOT, 'tests', 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['control/claims', 'control/outcomes', 'queue', 'runs']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const config = { enabled: true, dispatchEnabled: true, maxParallel: 6, minFreeRamGb: 2.5, pollMs: 100, ...extra };
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  return { root, config };
}
function enqueue(root, id, prompt = 'fixture:success', kind = 'isolated-fixture', extra = {}) {
  fs.writeFileSync(path.join(root, 'queue', `${id}.json`), JSON.stringify({ approved: true, kind, prompt, ...extra }));
}
function make(root, config, opts = {}) { return new Supervisor({ root, config, freeMem: () => 5 * GIB, ...opts }); }
const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8', shell: false }).status === 0;
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false }).trim(); }
function gitFixture(t) {
  fs.mkdirSync(path.join(ROOT, 'tests'), { recursive: true });
  const root = fs.mkdtempSync(path.join(ROOT, 'tests', 'git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'), worktreeRoot = path.join(root, 'worktrees');
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(worktreeRoot, { recursive: true });
  git(repo, ['init', '--initial-branch=28']);
  git(repo, ['config', 'user.name', 'Ruflo Fixture']); git(repo, ['config', 'user.email', 'ruflo-fixture@example.invalid']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'base\n'); git(repo, ['add', '--', 'seed.txt']); git(repo, ['commit', '-m', 'isolated fixture baseline']);
  return { root, repo, worktreeRoot, sha: git(repo, ['rev-parse', 'HEAD']) };
}

test('unapproved specs, unsafe names, and arbitrary executable arguments are rejected', async (t) => {
  const { root, config } = sandbox(t);
  assert.throws(() => validateJob({ approved: false, kind: 'isolated-fixture', prompt: 'fixture:success' }, 'safe', root), /not approved/);
  assert.throws(() => validateJob({ approved: true, kind: 'isolated-fixture', prompt: 'x' }, '../escape', root), /invalid job id/);
  assert.throws(() => validateJob({ approved: true, kind: 'isolated-fixture', prompt: 'x', executable: 'cmd.exe' }, 'safe', root), /may not select/);
  assert.throws(() => validateJob({ approved: true, kind: 'codex-worktree', prompt: 'x', baseSha: 'deadbeef' }, 'safe', root), /exact 40-character/);
  fs.writeFileSync(path.join(root, 'queue', 'bad_name.json'), JSON.stringify({ approved: true, kind: 'isolated-fixture', prompt: 'fixture:success' }));
  assert.equal(make(root, config).snapshot().queue[0].state, 'invalid');
  fs.writeFileSync(path.join(root, 'queue', 'unapproved.json'), JSON.stringify({ approved: false, kind: 'isolated-fixture', prompt: 'fixture:success' }));
  await make(root, config).once();
  assert.equal(fs.existsSync(path.join(root, 'control', 'claims', 'unapproved.json')), false);
});

test('runtime root is explicit for constructor compatibility and configuration preserves safe defaults', (t) => {
  const { root } = sandbox(t); const config = loadConfig(root);
  assert.equal(config.enabled, true); assert.equal(config.dispatchEnabled, true); assert.equal(config.minFreeRamGb, 2.5);
  assert.throws(() => new Supervisor(), /absolute path/);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ ...config, minFreeRamGb: 2 }));
  assert.throws(() => loadConfig(root), /at least 2.5/);
});

test('disabled dispatch does not claim or launch work', async (t) => {
  const { root, config } = sandbox(t, { dispatchEnabled: false }); enqueue(root, 'safe');
  const result = await make(root, config).once();
  assert.equal(result.batch.skipped, 'dispatch disabled'); assert.equal(fs.existsSync(path.join(root, 'control', 'claims', 'safe.json')), false);
});

test('claim collision prevents a second launch', async (t) => {
  const { root, config } = sandbox(t); enqueue(root, 'claimed');
  fs.writeFileSync(path.join(root, 'control', 'claims', 'claimed.json'), JSON.stringify({ id: 'claimed', state: 'claimed' }));
  const supervisor = make(root, config); supervisor.acquire();
  try { assert.deepEqual((await supervisor.dispatchBatch()).launched, []); } finally { supervisor.release(); }
});

test('bounded batch never exceeds maxParallel', async (t) => {
  const { root, config } = sandbox(t, { maxParallel: 2 });
  for (const id of ['one', 'two', 'three']) enqueue(root, id, 'fixture:hold:120');
  const result = await make(root, config).once();
  assert.equal(result.batch.launched.length, 2); assert.equal(result.outcomes.length, 2);
  assert.equal(fs.readdirSync(path.join(root, 'control', 'claims')).length, 2);
});

test('crash-after effect is ambiguous and the claim prevents rerun', async (t) => {
  const { root, config } = sandbox(t); enqueue(root, 'effect', 'fixture:crash-after');
  const first = await make(root, config).once(); assert.equal(first.outcomes[0].status, 'ambiguous');
  const second = await make(root, config).once(); assert.equal(second.batch.launched.length, 0); assert.equal(second.after.claims[0].state, 'ambiguous');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'runs', 'effect', 'effect.json'))).id, 'effect');
});

test('restart reports an effect without an outcome as ambiguous', (t) => {
  const { root, config } = sandbox(t); enqueue(root, 'lost');
  fs.writeFileSync(path.join(root, 'control', 'claims', 'lost.json'), JSON.stringify({ id: 'lost', state: 'running' }));
  fs.mkdirSync(path.join(root, 'runs', 'lost')); fs.writeFileSync(path.join(root, 'runs', 'lost', 'effect.json'), JSON.stringify({ id: 'lost', source: 'fixture.mjs', effect: 'durable' }));
  assert.equal(make(root, config).snapshot().claims[0].state, 'ambiguous');
});

test('stale lock is archived only after owner and claimed workers are absent', (t) => {
  const { root, config } = sandbox(t); fs.writeFileSync(path.join(root, 'control', 'supervisor.lock'), JSON.stringify({ pid: 99999999, startedAt: 'old', nonce: 'old' }));
  const supervisor = make(root, config); supervisor.acquire();
  try {
    assert.equal(fs.existsSync(path.join(root, 'control', 'supervisor.lock')), true);
    assert.equal(fs.readdirSync(path.join(root, 'control', 'archives')).length, 1);
  } finally { supervisor.release(); }
});

test('live worker claim prevents stale lock recovery', (t) => {
  const { root, config } = sandbox(t); fs.writeFileSync(path.join(root, 'control', 'supervisor.lock'), JSON.stringify({ pid: 99999999, nonce: 'old' }));
  fs.writeFileSync(path.join(root, 'control', 'claims', 'active.json'), JSON.stringify({ id: 'active', workerPid: process.pid }));
  assert.throws(() => make(root, config).acquire(), /worker active is still alive/);
});

test('minimum 2.5 GB free RAM guard does not create a claim', async (t) => {
  const { root, config } = sandbox(t); enqueue(root, 'lowram');
  const result = await make(root, config, { freeMem: () => 2 * GIB }).once();
  assert.equal(result.batch.skipped, 'minimum 2.5 GB free RAM gate not met'); assert.equal(fs.existsSync(path.join(root, 'control', 'claims', 'lowram.json')), false);
});

test('fixture outcome records verified source; successful Codex exit requires review', async (t) => {
  const { root, config } = sandbox(t); enqueue(root, 'verified');
  const result = await make(root, config).once(); assert.equal(result.outcomes[0].status, 'completed');
  assert.equal(result.outcomes[0].verifiedSource.source, 'fixture-effect-receipt'); assert.match(result.outcomes[0].verifiedSource.sha256, /^[a-f0-9]{64}$/);
  enqueue(root, 'codex-job', 'ok', 'codex');
  const fake = path.join(root, 'fake-codex.js'); fs.writeFileSync(fake, 'process.exit(0)\n');
  const realSpawn = (await import('node:child_process')).spawn;
  const fakeSpawn = (exe, args, options) => {
    assert.equal(exe, process.execPath);
    assert.deepEqual(args.slice(1, 9), ['exec', '--enable', 'fast_mode', '--disable', 'multi_agent', '--sandbox', 'workspace-write', '--skip-git-repo-check']);
    return realSpawn(exe, [fake], options);
  };
  const supervisor = make(root, config, { codexPath: fake, spawn: fakeSpawn }); supervisor.acquire();
  try { const batch = await supervisor.dispatchBatch(); await Promise.all(batch.launched.map((item) => item.completion)); } finally { supervisor.release(); }
  const outcome = JSON.parse(fs.readFileSync(path.join(root, 'control', 'outcomes', 'codex-job.json')));
  assert.equal(outcome.status, 'needs_review'); assert.equal(outcome.reviewRequired, true);
});

test('doctor reports queue, claims, outcomes, RAM, and readiness without dispatch', (t) => {
  const { root, config } = sandbox(t, { dispatchEnabled: false }); enqueue(root, 'waiting');
  const state = make(root, config).snapshot(); assert.equal(state.queue[0].id, 'waiting'); assert.equal(state.freeRamGb, 5);
  assert.equal(state.readiness.dispatchEnabled, false); assert.equal(state.readiness.ready, false);
  assert.deepEqual(state.claims, []); assert.deepEqual(state.outcomes, []);
});

test('fixture command grammar accepts only documented semantics', () => {
  assert.equal(parseFixturePrompt('fixture:success').action, 'success');
  assert.throws(() => parseFixturePrompt('fixture:success; whoami')); assert.throws(() => parseFixturePrompt('fixture:hold:999999'));
});

test('codex-worktree derives independent branches from the pinned SHA and denies collisions or wrong SHA', { skip: !gitAvailable }, (t) => {
  const fixture = gitFixture(t);
  const first = createWorktreeForJob({ id: 'one', baseSha: fixture.sha, baseRepo: fixture.repo, worktreeRoot: fixture.worktreeRoot });
  const second = createWorktreeForJob({ id: 'two', baseSha: fixture.sha, baseRepo: fixture.repo, worktreeRoot: fixture.worktreeRoot });
  assert.equal(first.baseSha, fixture.sha); assert.equal(second.baseSha, fixture.sha);
  assert.equal(first.branch, 'agent/28-one'); assert.equal(second.branch, 'agent/28-two');
  fs.writeFileSync(path.join(first.worktree, 'one.txt'), 'first\n'); fs.writeFileSync(path.join(second.worktree, 'two.txt'), 'second\n');
  assert.equal(fs.existsSync(path.join(first.worktree, 'two.txt')), false); assert.equal(fs.existsSync(path.join(second.worktree, 'one.txt')), false);
  assert.equal(git(first.worktree, ['rev-parse', 'HEAD']), fixture.sha); assert.equal(git(second.worktree, ['rev-parse', 'HEAD']), fixture.sha);
  assert.throws(() => createWorktreeForJob({ id: 'one', baseSha: fixture.sha, baseRepo: fixture.repo, worktreeRoot: fixture.worktreeRoot }), /directory already exists|branch already exists/);
  assert.throws(() => validateWorktreeBase({ baseRepo: fixture.repo, baseSha: '0'.repeat(40) }), /does not match local refs\/heads\/28/);
});
