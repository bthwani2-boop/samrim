import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SHA_RE = /^[a-f0-9]{40}$/i;
const DEFAULT_REPOSITORY = 'D:\\samrim';
const DEFAULT_WORKTREE_ROOT = 'D:\\samrim-implementation\\worktrees\\ruflo-agents';
function git(repo, args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false }).trim(); }
function ensureAbsolute(value, name) { if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`); return path.resolve(value); }
function isInside(parent, target) { const rel = path.relative(parent, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); }
function rejectLinkedPath(parent, target) {
  if (!isInside(parent, target)) throw new Error('worktree path escapes configured root');
  let current = parent;
  for (const segment of path.relative(parent, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`symlink worktree path is not allowed: ${current}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
export function validateWorktreeBase({ baseRepo = DEFAULT_REPOSITORY, baseSha } = {}) {
  const repo = fs.realpathSync(ensureAbsolute(baseRepo, 'baseRepo'));
  if (!SHA_RE.test(baseSha ?? '')) throw new Error('baseSha must be an exact 40-character commit SHA');
  const branch = git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch !== '28') throw new Error(`base repository must be checked out on branch 28 (found ${branch})`);
  const head = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const pinnedRef = git(repo, ['rev-parse', '--verify', 'refs/heads/28^{commit}']);
  if (head !== pinnedRef) throw new Error('base repository HEAD does not match refs/heads/28');
  if (git(repo, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('base repository working tree is not clean');
  if (baseSha.toLowerCase() !== pinnedRef.toLowerCase()) throw new Error('baseSha does not match local refs/heads/28');
  return { repo, branch, head, pinnedRef };
}
export function createWorktreeForJob({ id, baseSha, baseRepo = DEFAULT_REPOSITORY, worktreeRoot = DEFAULT_WORKTREE_ROOT } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('invalid job id');
  const base = validateWorktreeBase({ baseRepo, baseSha });
  const configuredRoot = ensureAbsolute(worktreeRoot, 'worktreeRoot');
  fs.mkdirSync(configuredRoot, { recursive: true });
  const root = fs.realpathSync(configuredRoot);
  if (isInside(base.repo, root)) throw new Error('worktreeRoot must be outside the base repository');
  const branch = `agent/28-${id}`, directory = path.resolve(root, id);
  rejectLinkedPath(root, directory);
  if (fs.existsSync(directory)) throw new Error('worktree directory already exists');
  try { git(base.repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); throw new Error('worktree branch already exists'); }
  catch (error) { if (error.message === 'worktree branch already exists') throw error; if (error.status !== 1) throw error; }
  git(base.repo, ['worktree', 'add', '-b', branch, '--', directory, base.pinnedRef]);
  const created = fs.realpathSync(directory);
  if (!isInside(root, created) || fs.lstatSync(created).isSymbolicLink()) throw new Error('created worktree escaped configured root');
  if (git(created, ['rev-parse', '--verify', 'HEAD^{commit}']) !== base.pinnedRef) throw new Error('created worktree is not at the pinned base SHA');
  if (git(created, ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) throw new Error('created worktree branch mismatch');
  return { id, baseSha: base.pinnedRef, baseRepo: base.repo, worktreeRoot: root, worktree: created, branch };
}
export const worktreeDefaults = Object.freeze({ baseRepo: DEFAULT_REPOSITORY, worktreeRoot: DEFAULT_WORKTREE_ROOT });
