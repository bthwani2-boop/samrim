import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./field-cases.tsx', import.meta.url), 'utf8');

test('identity change invalidates prior actor list reads and clears case-bearing state', () => {
  assert.match(source, /subscribeIdentitySession\(\(state\) =>/);
  assert.match(source, /actorScope\.current\.revision !== revision/);
  assert.match(source, /setCases\(\[\]\);[\s\S]*?setSelectedCase\(null\);[\s\S]*?setMediaCase\(null\);/);
  assert.match(source, /pagination\.current\.sequence \+= 1/);
});

test('selected-case read accepts the current authenticated actor and rejects a previous actor response', () => {
  assert.match(source, /actorScope\.current\.subject !== subject \|\| !subject/);
  assert.match(source, /if \(!active \|\| actorScope\.current\.revision !== revision \|\| actorScope\.current\.subject !== subject \|\| !subject\) return;[\s\S]*?setSelectedCase\(/);
});

test('continuation reads remain bound to query cursor sequence and actor revision', () => {
  assert.match(source, /pagination\.current\.cursor !== requestedCursor \|\| actorScope\.current\.revision !== revision/);
});
test('actor change restarts the focused queue read and selected-case read', () => {
  assert.match(source, /setActorRevision\(\(current\) => current \+ 1\)/);
  assert.match(source, /const load = useCallback\(async \(\) => \{\s*const revision = actorRevision;/);
  assert.match(source, /\}, \[appliedQuery, actorRevision\]\);/);
  assert.match(source, /\}, \[appliedQuery, load\]\)\);/);
  assert.match(source, /\}, \[routeCaseId, selectionRetry, actorRevision\]\);/);
});

test('late image-detail read cannot repopulate the previous actor media after switching accounts', () => {
  assert.match(source, /async function openStoreImage\(item: JoiningCaseSummary\) \{[\s\S]*?const revision = actorScope\.current\.revision;[\s\S]*?const subject = actorScope\.current\.subject;/);
  assert.match(source, /readOwnFieldJoiningCase\(token, item\.id\);\s*if \(actorScope\.current\.revision !== revision \|\| actorScope\.current\.subject !== subject\) return;\s*setMediaCase\(current\);/);
});