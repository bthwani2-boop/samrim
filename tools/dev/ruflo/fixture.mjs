import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); };
function assertNoLinks(root, target) {
  const base = path.resolve(root), file = path.resolve(target), rel = path.relative(base, file);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('fixture path escaped runtime root');
  let current = base;
  for (const segment of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`fixture refuses symlink paths: ${current}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
export function parseFixturePrompt(prompt) {
  const match = /^(?:fixture:)(success|fail|crash-after|crash-before|hold(?::([0-9]{1,5}))?)$/.exec(prompt);
  if (!match) throw new Error('invalid fixture prompt');
  const duration = match[2] === undefined ? 1000 : Number(match[2]);
  if (match[1] === 'hold' && duration > 30000) throw new Error('hold duration exceeds 30000ms');
  return { action: match[1], duration };
}
export async function runFixture({ id, prompt, root, wait = sleep } = {}) {
  const mode = parseFixturePrompt(prompt);
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('invalid id');
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('fixture runtime root must be absolute');
  const base = path.resolve(root), dir = path.resolve(base, 'runs', id);
  if (!inside(base, dir)) throw new Error('fixture path escaped root');
  assertNoLinks(base, dir);
  if (mode.action === 'crash-before') process.exit(31);
  if (mode.action === 'hold') { await wait(mode.duration); return { status: 'held' }; }
  if (mode.action === 'fail') { process.exitCode = 23; return { status: 'fail' }; }
  if (mode.action === 'success' || mode.action === 'crash-after') {
    fs.mkdirSync(dir, { recursive: true }); assertNoLinks(base, dir);
    const realDir = fs.realpathSync(dir);
    if (!inside(fs.realpathSync(base), realDir)) throw new Error('fixture run directory escaped runtime root');
    const receipt = { id, source: 'fixture.mjs', effect: 'fixture-effect', createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'effect.json'), `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
  }
  if (mode.action === 'crash-after') process.exit(32);
  return { status: mode.action };
}
function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runFixture({ id: arg('--id'), prompt: arg('--prompt'), root: arg('--root') }); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
