import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validateJob, readJsonAt } from './supervisor.mjs';
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); };
function assertNoLinks(root, target) {
  const base = path.resolve(root), file = path.resolve(target), rel = path.relative(base, file);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('path escapes runtime root');
  let current = base;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`symlink path is not allowed: ${current}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
function parseArgs(argv) {
  let root, install, stateRoot;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && !root && argv[i + 1]) root = argv[++i];
    else if (argv[i] === '--ruflo-install' && !install && argv[i + 1]) install = argv[++i];
    else if (argv[i] === '--ruflo-state' && !stateRoot && argv[i + 1]) stateRoot = argv[++i];
    else throw new Error('usage: node ruflo-sync.mjs --root <absolute-runtime-root> --ruflo-install <absolute-node_modules-dir> [--ruflo-state <original-trusted-state>]');
  }
  if (!root || !path.isAbsolute(root)) throw new Error('--root must be an absolute runtime root');
  if (!install || !path.isAbsolute(install)) throw new Error('--ruflo-install must be an absolute installed Ruflo node_modules directory');
  const runtimeRoot = path.resolve(root);
  const sourceRoot = path.resolve(SOURCE_DIR, '../../..');
  if (inside(sourceRoot, runtimeRoot)) throw new Error('--root must be outside the source repository');
  if (stateRoot && !path.isAbsolute(stateRoot)) throw new Error('--ruflo-state must be absolute');
  return { root: runtimeRoot, install: path.resolve(install), stateRoot: stateRoot ? path.resolve(stateRoot) : path.join(runtimeRoot, 'ruflo-state') };
}
function loadAuthorizedJobs(root) {
  const queue = path.join(root, 'queue'); assertNoLinks(root, queue);
  let names;
  try { names = fs.readdirSync(queue).filter((name) => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const jobs = [];
  for (const name of names) {
    const id = name.slice(0, -5);
    try { jobs.push(validateJob(readJsonAt(root, path.join(queue, name)), id, root)); }
    catch (error) { console.error('SKIP_INVALID_OR_UNAPPROVED_MANIFEST', id, error.message); }
  }
  return jobs;
}
function parseResponse(response) {
  if (response.isError) throw new Error(JSON.stringify(response.content));
  const text = response.content?.find((item) => item.type === 'text')?.text;
  return text ? JSON.parse(text) : (response.structuredContent || {});
}
async function main() {
  const { root, install, stateRoot } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(root, { recursive: true });
  const state = stateRoot, control = path.join(root, 'control'), lock = path.join(control, 'ruflo-sync.lock');
  fs.mkdirSync(control, { recursive: true });
  assertNoLinks(root, control);
  if (!fs.existsSync(state) || !fs.statSync(state).isDirectory()) throw new Error('trusted Ruflo state root is missing');
  assertNoLinks(path.parse(state).root, state);
  const requireFromInstall = createRequire(path.join(install, 'package.json'));
  const { Client } = requireFromInstall('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = requireFromInstall('@modelcontextprotocol/sdk/client/stdio.js');
  const bin = path.join(install, 'ruflo', 'bin', 'ruflo.js');
  if (!fs.existsSync(bin) || !fs.lstatSync(bin).isFile()) throw new Error('Ruflo executable was not found under --ruflo-install');
  const env = { ...process.env };
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) delete env[name];
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp', 'start'], cwd: state, env, stderr: 'pipe' });
  const client = new Client({ name: 'bthwani-continuous-synchronizer', version: '1' }, { capabilities: {} });
  async function call(name, args = {}) {
    const result = parseResponse(await client.callTool({ name, arguments: args }));
    if (result.success === false) throw new Error(`${name} failed ${JSON.stringify(result)}`);
    return result;
  }
  // RUFLO_SYNC_STALE_LOCK_ARCHIVE: safe at-logon restart, no duplicate sync owners.
  const lockToken = { pid: process.pid, nonce: crypto.randomUUID(), startedAt: new Date().toISOString() };
  const live = (pid) => { if (!Number.isSafeInteger(pid) || pid < 1) return true; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  const lockPayload = () => JSON.stringify(lockToken) + '\n';
  try { fs.writeFileSync(lock, lockPayload(), {flag:'wx'}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recovery = lock + '.recovery';
    fs.writeFileSync(recovery, lockPayload(), {flag:'wx'});
    try {
      const stale = readJsonAt(root, lock);
      if (live(stale.pid)) throw new Error('Ruflo sync owner still live or PID unverified; refuse lock takeover');
      const reread = readJsonAt(root, lock);
      if (reread.nonce !== stale.nonce) throw new Error('Ruflo sync lock changed during reconciliation');
      const archives = path.join(control,'archives'); assertNoLinks(root,archives);
      fs.mkdirSync(archives,{recursive:true});
      fs.renameSync(lock,path.join(archives,'ruflo-sync-stale-'+lockToken.nonce+'.json'));
      fs.writeFileSync(lock, lockPayload(), {flag:'wx'});
    } finally {
      try { if (readJsonAt(root,recovery).nonce === lockToken.nonce) fs.unlinkSync(recovery); } catch {}
    }
  }
  try {
    await client.connect(transport);
    const taskList = await call('task_list', { limit: 1000 }), existing = taskList.tasks || [], records = [];
    for (const job of loadAuthorizedJobs(root)) {
      const description = `BTHWANI-CONTINUOUS ${job.id}`;
      const matches = existing.filter((task) => task.description === description);
      if (matches.length > 1) throw new Error(`Duplicate Ruflo tasks for ${job.id}; fail closed`);
      let task = matches[0];
      if (!task) {
        const created = await call('task_create', { type: 'feature', description, priority: 'normal', tags: ['bthwani', 'continuous', 'codex-external'] });
        task = { taskId: created.taskId || created.id, status: 'pending', description };
        if (!task.taskId) throw new Error('Ruflo task ID missing');
        existing.push(task);
      }
      const outcomeFile = path.join(root, 'control', 'outcomes', `${job.id}.json`), claimFile = path.join(root, 'control', 'claims', `${job.id}.json`);
      let outcome = null;
      try { outcome = readJsonAt(root, outcomeFile); if (outcome.id !== job.id) throw new Error('Mismatched outcome'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      let claim = null;
      try { claim = readJsonAt(root, claimFile); if (claim.id !== job.id) throw new Error('Mismatched claim'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const completed = outcome?.status === 'completed';
      const desired = completed ? 'completed' : outcome || claim ? 'in_progress' : 'pending';
      const progress = completed ? 100 : outcome ? 90 : claim ? 25 : 0;
      const result = outcome ? { managerOutcome: outcome.status, independentReviewRequired: outcome.status !== 'completed', receipt: outcome.verifiedSource || null } : undefined;
      if (desired === 'completed') {
        if (task.status !== 'completed') await call('task_complete', { taskId: task.taskId, result: result || { managerOutcome: 'completed' } });
      } else if (task.status !== desired || (desired === 'in_progress' && task.progress !== progress)) {
        await call('task_update', { taskId: task.taskId, status: desired, progress, ...(result ? { result } : {}) });
      }
      records.push({ id: job.id, taskId: task.taskId, desired });
    }
    console.log(JSON.stringify({ sync: 'PASS', records }, null, 2));
  } finally {
    await client.close().catch(() => {});
    try { if (readJsonAt(root, lock).nonce === lockToken.nonce) fs.unlinkSync(lock); } catch {}
  }
}
main().catch((error) => { console.error('RUFLO_SYNC_FAILED', String(error)); process.exitCode = 1; });
