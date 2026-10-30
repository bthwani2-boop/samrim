import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("./", import.meta.url);
const source = readFileSync(new URL("./conversation-unread.ts", root), "utf8");

test("conversation badges never project a previous actor or list into the current view", () => {
  assert.match(source, /snapshot\.actorScope === actorScope/);
  assert.match(source, /snapshot\.idsKey === idsKey/);
  assert.match(source, /snapshot\.refreshKey === refreshKey/);
  assert.match(source, /current\.actorScope !== actorScope/);
  assert.match(source, /current\.idsKey !== idsKey/);
  assert.match(source, /current\.refreshKey !== refreshKey/);
  assert.match(source, /!enabled \|\| !actorScope \|\| !idsKey/);
});

test("failed or overlapping unread reads cannot erase known counts or publish stale results", () => {
  assert.match(source, /counts: \{ \.\.\.current\.counts, \.\.\.updates \}/);
  assert.match(source, /run !== generation/);
  assert.match(source, /if \(!active \|\| run !== generation\) return;/);
  assert.match(source, /Number\.isSafeInteger\(count\) && count >= 0/);
  assert.match(source, /catch \{\s*return null;/);
  assert.doesNotMatch(source, /setCounts\(updates\)|setCounts\(\{\}\)/);
  assert.doesNotMatch(source, /createDshMobileClient|fetch\(|getUsableIdentityAccessToken/);
});

for (const [app, feature, file] of [
  ["app-client", "orders", "orders.tsx"],
  ["app-partner", "order-management", "order-management.tsx"],
  ["app-captain", "captain-operations", "captain-deliveries.tsx"],
]) {
  test(app + " passes its actor scope and visible order IDs to the shared unread presentation hook", () => {
    const host = readFileSync(new URL(`../../../../apps/${app}/src/features/${feature}/${file}`, root), "utf8");
    assert.match(host, /useConversationUnreadCounts\(/);
    assert.doesNotMatch(host, /useOrderChatUnreadCounts/);
    assert.match(host, /getChatUnread/);
  });
}
