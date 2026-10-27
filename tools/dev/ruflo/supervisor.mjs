import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorktreeForJob, worktreeDefaults } from './worktrees.mjs';

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SHA_RE = /^[a-f0-9]{40}$/i;
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO = path.resolve(SOURCE_DIR, '../../..');
const SYSTEM_CODEX = path.resolve(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
const DEFAULTS = { enabled: false, dispatchEnabled: false, maxParallel: 1, minFreeRamGb: 2.5, pollMs: 15000, baseRepo: worktreeDefaults.baseRepo, worktreeRoot: worktreeDefaults.worktreeRoot };
export const validId = (id) => typeof id === 'string' && id.length <= 64 && ID_RE.test(id);
const within = (root, target) => { const rel = path.relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); };
function assertNoLinks(root, target) {
  const base = path.resolve(root), file = path.resolve(target), rel = path.relative(base, file);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('path escapes runtime root');
  let current = base;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`symlink path is not allowed: ${path.relative(base, current)}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export function readJsonAt(root, file) { assertNoLinks(root, file); if (!fs.lstatSync(file).isFile()) throw new Error('expected regular file'); return readJson(file); }
function atomicJson(root, file, value) {
  assertNoLinks(root, path.dirname(file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertNoLinks(root, path.dirname(file));
  assertNoLinks(root, file);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    assertNoLinks(root, temp);
    fs.renameSync(temp, file);
  } catch (error) { try { fs.unlinkSync(temp); } catch {} throw error; }
}
function files(root, relative) {
  const dir = path.join(root, relative); assertNoLinks(root, dir);
  try { return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function alive(pid) { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
function absolute(value, label) { if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`); return path.resolve(value); }

export function validateJob(spec, id, root) {
  if (!validId(id)) throw new Error('invalid job id');
  if (!spec || spec.approved !== true) throw new Error('job is not approved');
  if (!['isolated-fixture', 'codex', 'codex-worktree'].includes(spec.kind)) throw new Error('unsupported job kind');
  if (typeof spec.prompt !== 'string' || !spec.prompt.trim()) throw new Error('prompt must be nonempty');
  const runtimeRoot = path.resolve(root), workdir = path.resolve(runtimeRoot, 'runs', id);
  if (!within(runtimeRoot, workdir)) throw new Error('workdir escapes runtime root');
  assertNoLinks(runtimeRoot, workdir);
  if (spec.workdir !== undefined && spec.workdir !== path.join('runs', id)) throw new Error('workdir must be runs/<id>');
  for (const key of ['executable', 'args', 'command', 'worktree', 'branch', 'baseRepo', 'worktreeRoot']) if (spec[key] !== undefined) throw new Error(`job may not select ${key}`);
  if (spec.kind === 'codex-worktree' && !SHA_RE.test(spec.baseSha ?? '')) throw new Error('codex-worktree requires an exact 40-character baseSha');
  if (spec.kind !== 'codex-worktree' && spec.baseSha !== undefined) throw new Error('baseSha is only valid for codex-worktree');
  return { id, kind: spec.kind, prompt: spec.prompt, workdir, ...(spec.kind === 'codex-worktree' ? { baseSha: spec.baseSha.toLowerCase() } : {}) };
}
function validateConfig(supplied = {}) {
  const config = { ...DEFAULTS, ...supplied };
  if (typeof config.enabled !== 'boolean' || typeof config.dispatchEnabled !== 'boolean') throw new Error('config enable flags must be boolean');
  if (!Number.isInteger(config.maxParallel) || config.maxParallel < 1 || config.maxParallel > 6) throw new Error('config maxParallel must be 1..6');
  if (!Number.isFinite(config.minFreeRamGb) || config.minFreeRamGb < 2.5) throw new Error('config minFreeRamGb must be at least 2.5');
  if (!Number.isInteger(config.pollMs) || config.pollMs < 100) throw new Error('config pollMs must be at least 100');
  config.baseRepo = absolute(config.baseRepo, 'baseRepo');
  config.worktreeRoot = absolute(config.worktreeRoot, 'worktreeRoot');
  if (within(SOURCE_REPO, config.worktreeRoot)) throw new Error('worktreeRoot must be outside the source repository');
  return config;
}
export function loadConfig(root) {
  const runtimeRoot = path.resolve(root), configFile = path.join(runtimeRoot, 'config.json');
  assertNoLinks(runtimeRoot, configFile);
  let supplied = {};
  try { supplied = readJsonAt(runtimeRoot, configFile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return validateConfig(supplied);
}
function verifyEffect(root, id) {
  const file = path.join(root, 'runs', id, 'effect.json');
  try {
    const effect = readJsonAt(root, file);
    if (effect.id !== id || effect.source !== 'fixture.mjs' || typeof effect.effect !== 'string' || !effect.effect) return null;
    return { source: 'fixture-effect-receipt', path: `runs/${id}/effect.json`, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  } catch { return null; }
}
function systemCodexPresent(root, file) {
  const target = path.resolve(file);
  if (within(root, target)) { assertNoLinks(root, target); try { return fs.lstatSync(target).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  if (target !== SYSTEM_CODEX) throw new Error('unapproved external Codex path');
  try { return fs.lstatSync(target).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export class Supervisor {
  constructor({ root, config, freeMem = () => os.freemem(), spawn = nodeSpawn, now = () => new Date().toISOString(), timeoutMs = 1800000, codexPath = SYSTEM_CODEX, sync = null, syncIntervalMs = 600000, syncTimeoutMs = 30000 } = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('runtime root must be an absolute path');
    this.root = path.resolve(root);
    this.config = config === undefined ? loadConfig(this.root) : validateConfig(config); this.freeMem = freeMem; this.spawn = spawn; this.now = now; this.timeoutMs = timeoutMs;
    this.codexPath = path.resolve(codexPath);
    if (!within(this.root, this.codexPath) && this.codexPath !== SYSTEM_CODEX) throw new Error('Only installed Codex or runtime-local test executable is allowed');
    this.lockPath = path.join(this.root, 'control', 'supervisor.lock'); this.lockToken = null; this.children = new Map(); this.stopping = false;
    if (sync !== null && typeof sync !== 'function') throw new Error('sync must be a callable');
    if (!Number.isSafeInteger(syncIntervalMs) || syncIntervalMs < 1000) throw new Error('syncIntervalMs must be at least 1000');
    this.sync = sync;
    this.syncDirty = true;
    if (!Number.isSafeInteger(syncTimeoutMs) || syncTimeoutMs < 100) throw new Error('syncTimeoutMs must be at least 100');
    this.nextSyncAt = 0; this.syncIntervalMs = syncIntervalMs; this.syncTimeoutMs = syncTimeoutMs; this.lastSync = null;
  }
  archiveStaleLock() {
    const recoveryPath = `${this.lockPath}.recovery`, token = { pid: process.pid, nonce: crypto.randomUUID() };
    assertNoLinks(this.root, path.dirname(recoveryPath));
    try { fs.writeFileSync(recoveryPath, JSON.stringify(token), { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('lock recovery is already in progress; fail closed'); throw error; }
    try {
      const stale = readJsonAt(this.root, this.lockPath);
      if (alive(stale.pid)) throw new Error('supervisor lock owner is still alive; fail closed');
      for (const name of files(this.root, 'control/claims')) {
        let claim;
        try { claim = readJsonAt(this.root, path.join(this.root, 'control', 'claims', name)); }
        catch { throw new Error('unreadable claim prevents stale lock recovery; fail closed'); }
        if (alive(claim.workerPid)) throw new Error(`worker ${claim.id ?? name.slice(0, -5)} is still alive; fail closed`);
      }
      const archiveDir = path.join(this.root, 'control', 'archives');
      fs.mkdirSync(archiveDir, { recursive: true }); assertNoLinks(this.root, archiveDir);
      const archived = path.join(archiveDir, `supervisor-lock-${Date.now()}-${token.nonce}.json`);
      fs.renameSync(this.lockPath, archived);
    } finally {
      try { if (readJsonAt(this.root, recoveryPath).nonce === token.nonce) fs.unlinkSync(recoveryPath); } catch {}
    }
  }
  acquire() {
    fs.mkdirSync(this.root, { recursive: true });
    for (const dir of ['control/claims', 'control/outcomes']) { const target = path.join(this.root, dir); assertNoLinks(this.root, target); fs.mkdirSync(target, { recursive: true }); assertNoLinks(this.root, target); }
    const token = { pid: process.pid, startedAt: this.now(), nonce: crypto.randomUUID() };
    try { fs.writeFileSync(this.lockPath, `${JSON.stringify(token, null, 2)}\n`, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      this.archiveStaleLock();
      try { fs.writeFileSync(this.lockPath, `${JSON.stringify(token, null, 2)}\n`, { flag: 'wx' }); }
      catch (retryError) { if (retryError.code === 'EEXIST') throw new Error('supervisor lock race; fail closed'); throw retryError; }
    }
    this.lockToken = token; return token;
  }
  release() {
    if (!this.lockToken) return;
    try { if (readJsonAt(this.root, this.lockPath).nonce === this.lockToken.nonce) fs.unlinkSync(this.lockPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.lockToken = null;
  }
  get freeRamGb() { return this.freeMem() / (1024 ** 3); }
  snapshot() {
    const queue = [], claims = [], outcomes = [];
    for (const name of files(this.root, 'queue')) {
      const id = name.slice(0, -5);
      try { const job = validateJob(readJsonAt(this.root, path.join(this.root, 'queue', name)), id, this.root); queue.push({ id, kind: job.kind, approved: true, state: 'queued' }); }
      catch (error) { queue.push({ id, state: 'invalid', error: error.message }); }
    }
    const outcomeById = new Map();
    for (const name of files(this.root, 'control/outcomes')) {
      try { const outcome = readJsonAt(this.root, path.join(this.root, 'control', 'outcomes', name)); outcomes.push(outcome); outcomeById.set(outcome.id, outcome); }
      catch { outcomes.push({ id: name.slice(0, -5), status: 'invalid-outcome' }); }
    }
    for (const name of files(this.root, 'control/claims')) {
      const id = name.slice(0, -5); let claim;
      try { claim = readJsonAt(this.root, path.join(this.root, 'control', 'claims', name)); }
      catch { claims.push({ id, state: 'blocked', reason: 'unreadable claim' }); continue; }
      if (outcomeById.has(id)) { claims.push({ id, state: outcomeById.get(id).status }); continue; }
      if (alive(claim.workerPid)) { claims.push({ id, state: 'running', workerPid: claim.workerPid }); continue; }
      const evidence = verifyEffect(this.root, id);
      claims.push({ id, state: evidence ? 'ambiguous' : 'blocked', reason: evidence ? 'effect exists without verified outcome; review required' : 'claimed job has no outcome; never redispatch', ...(evidence ? { evidence } : {}) });
    }
    let codexAvailable = false; try { codexAvailable = systemCodexPresent(this.root, this.codexPath); } catch {}
    const needsCodex = queue.some((job) => ['codex', 'codex-worktree'].includes(job.kind) && job.state === 'queued');
    const codexUnavailable = needsCodex && !codexAvailable, memoryReady = this.freeRamGb >= this.config.minFreeRamGb;
    const lockAvailable = !fs.existsSync(this.lockPath);
    return { queue, claims, outcomes, freeRamGb: Number(this.freeRamGb.toFixed(2)), readiness: {
      enabled: this.config.enabled, dispatchEnabled: this.config.dispatchEnabled, lockAvailable, codexAvailable, memoryReady,
      availableSlots: Math.max(0, this.config.maxParallel - this.children.size),
      unclaimedJobs: queue.filter((job) => job.state === 'queued' && !claims.some((claim) => claim.id === job.id)).length,
      ready: this.config.enabled && this.config.dispatchEnabled && lockAvailable && memoryReady && !codexUnavailable,
      blockedCodex: codexUnavailable
    } };
  }
  writeOutcome(job, status, details = {}) {
    const file = path.join(this.root, 'control', 'outcomes', `${job.id}.json`);
    try { return readJsonAt(this.root, file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const outcome = { id: job.id, kind: job.kind, status, recordedAt: this.now(), verifiedSource: details.verifiedSource ?? null,
      exitCode: details.exitCode ?? null, signal: details.signal ?? null, log: `runs/${job.id}/worker.log`,
      reviewRequired: ['ambiguous', 'needs_review', 'failed', 'blocked'].includes(status), ...details };
    atomicJson(this.root, file, outcome); this.syncDirty = true; return outcome;
  }
  async launch(job) {
    const codex = job.kind !== 'isolated-fixture';
    if (codex && !systemCodexPresent(this.root, this.codexPath)) return { id: job.id, status: 'blocked' };
    const claimPath = path.join(this.root, 'control', 'claims', `${job.id}.json`);
    const claim = { id: job.id, kind: job.kind, ownerPid: process.pid, claimedAt: this.now(), state: 'claimed', nonce: crypto.randomUUID(), ...(job.baseSha ? { baseSha: job.baseSha } : {}) };
    try { fs.writeFileSync(claimPath, `${JSON.stringify(claim, null, 2)}\n`, { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') return { id: job.id, status: 'claim-collision' }; throw error; }
    let workdir = job.workdir, worktree = null;
    try {
      assertNoLinks(this.root, workdir); fs.mkdirSync(workdir, { recursive: true }); assertNoLinks(this.root, workdir);
      if (job.kind === 'codex-worktree') {
        worktree = createWorktreeForJob({ id: job.id, baseSha: job.baseSha, baseRepo: this.config.baseRepo, worktreeRoot: this.config.worktreeRoot });
        workdir = worktree.worktree;
      }
    } catch (error) {
      this.writeOutcome(job, 'blocked', { reason: `worktree or run directory creation failed: ${error.message}`, ...(worktree ? { worktree: worktree.worktree, branch: worktree.branch } : {}) });
      return { id: job.id, status: 'blocked' };
    }
    assertNoLinks(this.root, path.join(this.root, 'tmp')); fs.mkdirSync(path.join(this.root, 'tmp'), { recursive: true });
    const log = fs.openSync(path.join(this.root, 'runs', job.id, 'worker.log'), 'a');
    const args = codex
      ? [this.codexPath, 'exec', '--enable', 'fast_mode', '--disable', 'multi_agent', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '-C', workdir, '-o', 'final.txt', job.prompt]
      : [path.join(SOURCE_DIR, 'fixture.mjs'), '--root', this.root, '--id', job.id, '--prompt', job.prompt];
    const env = Object.fromEntries(Object.entries({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE, HOMEDRIVE: process.env.HOMEDRIVE, HOMEPATH: process.env.HOMEPATH, HOME: process.env.HOME, TEMP: path.join(this.root, 'tmp'), TMP: path.join(this.root, 'tmp') }).filter(([, value]) => typeof value === 'string'));
    let child;
    try { child = this.spawn(process.execPath, args, { cwd: workdir, shell: false, windowsHide: true, stdio: ['ignore', log, log], env }); }
    catch (error) {
      fs.closeSync(log); this.writeOutcome(job, 'failed', { reason: `worker spawn failed: ${error.message}`, ...(worktree ? { worktree: worktree.worktree, branch: worktree.branch } : {}) });
      return { id: job.id, status: 'failed' };
    }
    claim.workerPid = child.pid ?? null; claim.state = 'running'; claim.startedAt = this.now();
    if (worktree) Object.assign(claim, { worktree: worktree.worktree, branch: worktree.branch, baseSha: worktree.baseSha });
    atomicJson(this.root, claimPath, claim);
    this.syncDirty = true;
    const completion = new Promise((resolve) => {
      let settled = false, timedOut = false, forceTimer;
      const finish = (code, signal, error = null) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forceTimer); fs.closeSync(log);
        const verified = job.kind === 'isolated-fixture' ? verifyEffect(this.root, job.id) : null;
        const status = job.kind !== 'isolated-fixture' && code === 0 ? 'needs_review' : verified && (error || code !== 0) ? 'ambiguous' : code === 0 && verified ? 'completed' : 'failed';
        const details = { exitCode: code, signal, ...(error ? { reason: error.message } : {}), verifiedSource: verified, ...(worktree ? { worktree: worktree.worktree, branch: worktree.branch, baseSha: worktree.baseSha } : {}), ...(job.kind !== 'isolated-fixture' && code === 0 ? { reason: 'Codex process exited successfully; independent review is required, integration is not inferred' } : {}), ...(timedOut ? { timedOut: true } : {}) };
        const outcome = this.writeOutcome(job, status, details); this.children.delete(job.id); resolve(outcome);
      };
      const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); forceTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000); } catch {} }, this.timeoutMs);
      let spawnError = null; child.once('error', (error) => { spawnError = error; });
      child.once('close', (code, signal) => finish(code, signal, spawnError ?? (timedOut ? new Error('worker timed out') : null)));
    });
    this.children.set(job.id, { child, completion }); return { id: job.id, status: 'launched', completion };
  }
  async dispatchBatch() {
    if (!this.config.enabled || !this.config.dispatchEnabled) return { launched: [], skipped: 'dispatch disabled' };
    if (!this.lockToken) throw new Error('exclusive supervisor lock is required before dispatch');
    const launched = [], slots = Math.max(0, this.config.maxParallel - this.children.size);
    if (this.freeRamGb < Math.max(2.5, this.config.minFreeRamGb)) return { launched, skipped: 'minimum 2.5 GB free RAM gate not met' };
    for (const name of files(this.root, 'queue')) {
      if (launched.length >= slots || this.freeRamGb < Math.max(2.5, this.config.minFreeRamGb)) break;
      const id = name.slice(0, -5); let job;
      try { job = validateJob(readJsonAt(this.root, path.join(this.root, 'queue', name)), id, this.root); } catch { continue; }
      if (fs.existsSync(path.join(this.root, 'control', 'claims', `${id}.json`)) || fs.existsSync(path.join(this.root, 'control', 'outcomes', `${id}.json`))) continue;
      const result = await this.launch(job); if (result.status === 'launched') launched.push(result);
    }
    return { launched, skipped: null };
  }
  async once() {
    this.acquire();
    try { const before = this.snapshot(), batch = await this.dispatchBatch(), outcomes = await Promise.all(batch.launched.map((item) => item.completion));
      return { before, batch: { launched: batch.launched.map(({ completion, ...item }) => item), skipped: batch.skipped }, outcomes, after: this.snapshot() };
    } finally { this.release(); }
  }
  async reconcileRuflo() {
    if (!this.sync || (Date.now() < this.nextSyncAt && (!this.syncDirty || this.lastSync?.status === 'failed'))) return;
    this.syncDirty = false;
    try {
      // Keep a live event-loop handle while MCP connects; fail in bounded time instead of Node exit 13.
      let deadline;
      const result = await Promise.race([
        Promise.resolve().then(() => this.sync()),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Ruflo sync timed out')), this.syncTimeoutMs); })
      ]).finally(() => clearTimeout(deadline));
      this.lastSync = { status: 'pass', at: this.now(), records: result?.records?.length ?? null };
      atomicJson(this.root, path.join(this.root, 'control', 'ruflo-sync-status.json'), this.lastSync);
      this.nextSyncAt = Date.now() + this.syncIntervalMs;
    } catch (error) {
      this.syncDirty = true;
      this.nextSyncAt = Date.now() + 60000;
      this.lastSync = { status: 'failed', at: this.now(), error: String(error?.message ?? error) };
      try { atomicJson(this.root, path.join(this.root, 'control', 'ruflo-sync-status.json'), this.lastSync); } catch {}
      try { fs.appendFileSync(path.join(this.root, 'control', 'ruflo-sync-errors.log'), JSON.stringify(this.lastSync) + '\n'); } catch {}
    }
  }
  async serve({ signal } = {}) {
    this.acquire(); this.stopping = false; const stop = () => { this.stopping = true; }; signal?.addEventListener('abort', stop, { once: true });
    try {
      while (!this.stopping) {
        this.config = loadConfig(this.root);
        if (this.config.enabled && this.config.dispatchEnabled) await this.dispatchBatch();
        await this.reconcileRuflo();
        const pending = [...this.children.values()];
        if (pending.length) await Promise.race([Promise.all(pending.map((item) => item.completion)), new Promise((resolve) => setTimeout(resolve, this.config.pollMs))]);
        else await new Promise((resolve) => setTimeout(resolve, this.config.pollMs));
      }
      await Promise.all([...this.children.values()].map((item) => item.completion));
      await this.reconcileRuflo();
    } finally { signal?.removeEventListener('abort', stop); this.release(); }
  }
}
function cliArgs(argv) {
  let root, command = 'doctor';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') { if (root !== undefined || !argv[i + 1]) throw new Error('--root requires one absolute path'); root = argv[++i]; }
    else if (['doctor', 'status', 'once', 'serve'].includes(argv[i]) && command === 'doctor') command = argv[i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!root || !path.isAbsolute(root)) throw new Error('usage: node supervisor.mjs <doctor|status|once|serve> --root <absolute-runtime-root>');
  const resolved = path.resolve(root);
  if (within(SOURCE_REPO, resolved)) throw new Error('--root must be outside the source repository');
  return { command, root: resolved };
}
async function cli() {
  try {
    const { command, root } = cliArgs(process.argv.slice(2)), config = loadConfig(root), supervisor = new Supervisor({ root, config });
    if (command === 'doctor' || command === 'status') console.log(JSON.stringify({ command, ...supervisor.snapshot() }, null, 2));
    else if (command === 'once') console.log(JSON.stringify(await supervisor.once(), null, 2));
    else {
      if (typeof config.rufloInstall !== 'string' || !path.isAbsolute(config.rufloInstall) ||
          typeof config.rufloState !== 'string' || !path.isAbsolute(config.rufloState)) {
        throw new Error('serve requires trusted absolute rufloInstall and rufloState settings in runtime config');
      }
      const { syncRufloOnce } = await import('./ruflo-sync.mjs');
      supervisor.sync = () => syncRufloOnce({ root, install: config.rufloInstall, stateRoot: config.rufloState });
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
      await supervisor.serve({ signal: controller.signal });
    }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
// Do not top-level-await cli(): cli dynamically imports ruflo-sync, which imports this module.
// A top-level await creates a circular evaluation deadlock and Node exits with code 13.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void cli();
