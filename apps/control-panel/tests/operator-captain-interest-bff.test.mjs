import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const root = new URL("../", import.meta.url);
const source = p => readFileSync(new URL(p, root), "utf8");

test("Captain contact list is a separate authenticated Operator page", () => {
  assert.match(source("app/(workspace)/captains/registrations/page.tsx"), /captain-interest-workspace/);
  assert.match(source("app/api/captains/interest/route.ts"), /readCaptainInterestForOperator/);
});
test("Operator BFF keeps private candidate contacts behind live Identity operations and same-origin rules", () => {
  const bff = source("src/features/captains/captain-interest-bff.ts");
  assert.match(bff, /readVerifiedOperatorAccess/);
  assert.match(bff, /access.grants.includes\("operations"\)/);
  assert.match(bff, /listOperatorCaptainInterest/);
  assert.match(bff, /markOperatorCaptainInterestContacted/);
  assert.match(bff, /same-origin/);
  assert.match(bff, /isTrustedOperatorLoopbackTarget\(request, config\.browserOrigin, true\)/);
  assert.doesNotMatch(bff, /localStorage|sessionStorage|CAPTAIN_NOT_APPROVED/);
});

test("Captain administration reuses trusted SSH target while retaining live operations permission", () => {
  for (const path of [
    "src/features/captains/captains-read-bff.ts",
    "src/features/captains/captain-interest-bff.ts",
  ]) {
    const bff = source(path);
    assert.match(bff, /isTrustedOperatorLoopbackTarget\(request, config\.browserOrigin, true\)/);
    assert.match(bff, /access\.grants\.includes\("operations"\)/);
    assert.match(bff, /origin !== null && origin !== config\.browserOrigin/);
  }
});

test("denied Captain owner reads never claim there are zero records", () => {
  const standings = source("src/features/captains/captains-workspace.tsx");
  const contacts = source("src/features/captains/captain-interest-workspace.tsx");
  assert.match(standings, /\(loading \|\| \(page !== null && !error\)\) && <Card/);
  assert.match(contacts, /\(loading \|\| \(page !== null && !error\)\) && <Card/);
});
