import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-more.tsx"), "utf8");
const actor = (subject, sessionId) => ({ kind: "authenticated", identity: { role: "partner", subject, sessionId } });
const scope = (state) => state.kind === "authenticated" && state.identity?.role === "partner" &&
  state.identity.subject && state.identity.sessionId ? JSON.stringify([state.identity.subject, state.identity.sessionId]) : "";

test("PartnerMore session guard invalidates same-account re-login, cross-actor and logout", () => {
  const guard = source.match(/const stillCurrentSession=useCallback\(\(\)=>Boolean\(sessionScope\)&&partnerSetupSessionKey\(currentIdentityState\(\)\)===sessionScope,\[sessionScope\]\);/)?.[0];
  assert.ok(guard, "session scope must include subject and sessionId");
  const started = actor("partner-a", "session-1");
  let observed = started;
  const evaluate = runInNewContext(guard + "\nstillCurrentSession", {
    sessionScope: scope(started), currentIdentityState: () => observed,
    partnerSetupSessionKey: scope, useCallback: callback => callback,
  });
  assert.equal(evaluate(), true);
  observed = actor("partner-a", "session-2");
  assert.equal(evaluate(), false);
  observed = actor("partner-b", "session-1");
  assert.equal(evaluate(), false);
  observed = { kind: "unauthenticated" };
  assert.equal(evaluate(), false);
  assert.match(source, /setSessionScope\(partnerSetupSessionKey\(currentIdentityState\(\)\)\)/);
});

test("late owner profile response cannot surface name, telephone or correction after same-actor session changes", async () => {
  const resolution = source.match(/const resolve=async\(\)=>\{[\s\S]*?\n    \};/)?.[0];
  assert.ok(resolution, "evaluate the production profile resolver");
  async function runCase(invalidate) {
    let deliver;
    const pending = new Promise(resolve => { deliver = resolve; });
    let current = actor("partner-a", "session-1");
    const started = scope(current);
    const identityWrites = [];
    const correctionWrites = [];
    const executable = resolution.replace("const grant:StoreAccessGrant|undefined=", "const grant=");
    const task = runInNewContext(executable + "\nresolve()", {
      selectedStore: { id: "store-1", owned: true },
      readOwnJoiningCase: () => pending,
      isCurrent: () => scope(current) === started,
      setIdentity: value => identityWrites.push(value),
      setNeedsJoiningCorrection: value => correctionWrites.push(value),
    });
    current = invalidate ? actor("partner-a", "session-2") : current;
    deliver({ case: { ownerFullName: "Private owner", contactPhoneE164: "+967700000000", state: "needs_correction" } });
    await task;
    return { identityWrites, correctionWrites };
  }
  const changed = await runCase(true);
  assert.equal(changed.identityWrites.length, 0);
  assert.equal(changed.correctionWrites.length, 0);
  const same = await runCase(false);
  assert.equal(same.identityWrites.length, 1);
  assert.equal(same.identityWrites[0].name, "Private owner");
  assert.equal(same.correctionWrites[0], true);
});

test("late private store-image reply is ignored after session changes but retained for same session", async () => {
  const imageRead = source.match(/if\(selectedID && sessionScope\)void readOwnStoreImages\(selectedID\)\.then\(value=>\{[^\n]*\}\)\.catch\(\(\)=>\{[^\n]*\}\);/)?.[0];
  assert.ok(imageRead, "verify existing production store-image read callback");
  async function runCase(invalidate) {
    let deliver;
    const pending = new Promise(resolve => { deliver = resolve; });
    const started = scope(actor("partner-a", "session-1"));
    let current = started;
    const writes = [];
    runInNewContext(imageRead, {
      selectedID: "store-1", sessionScope: started, active: true,
      readOwnStoreImages: () => pending, stillCurrentSession: () => current === started,
      setStoreImages: value => writes.push(value),
    });
    if (invalidate) current = scope(actor("partner-a", "session-2"));
    deliver({ storeId: "store-1", storeCoverImage: { uri: "private-cover" } });
    await pending;
    await Promise.resolve();
    return writes;
  }
  assert.equal((await runCase(true)).length, 0);
  assert.equal((await runCase(false))[0].storeId, "store-1");
});

test("operational and commercial snapshots are session guarded, independent Store hides marketplace finance action", () => {
  assert.match(source, /if\(active&&stillCurrentSession\(\)\)\{setAvailability\(value\);setAvailabilityError\(false\);\}/);
  assert.match(source, /if\(active&&stillCurrentSession\(\)\)setAvailabilityError\(true\)/);
  assert.match(source, /return active && stillCurrentSession\(\) && current\.kind==="authenticated" && current\.identity\.subject===actor/);
  assert.match(source, /agreementState\?\.actor===actor && agreementState\.sessionScope===sessionScope/);
  assert.match(source, /const visibleIdentity:IdentityDisplay=stillCurrentSession\(\)\?identity:/);
  assert.match(source, /const visibleStoreImages=stillCurrentSession\(\)\?storeImages:null/);
  assert.match(source, /const canWallet=Boolean\(marketplace && selectedStore/);
  assert.match(source, /selectedStore\?\.owned && independent && !desktopWeb \? <BthwaniButton label="إدارة موقع المتجر وسياساته"/);
  assert.match(source, /independent \? "المتجر المستقل قيد الإعداد" : "تعذر التحقق من طريقة عمل المتجر"/);
});

test("dashboard data widgets are hidden until a live session and remounted on session change", () => {
  const gate = source.indexOf('if(!stillCurrentSession())return <View style={styles.screen}>');
  const fullScreen = source.indexOf('return <View style={styles.screen}>', gate + 1);
  assert.ok(gate >= 0 && fullScreen > gate, "full Store view must fail closed while Identity is changing");
  assert.match(source, /PartnerDesktopHome key=\{"home:"\+sessionScope\+":"\+selectedStore\.id\}/);
  assert.match(source, /PartnerInsights key=\{"insights:"\+sessionScope\+":"\+selectedStore\.id\}/);
  assert.match(source, /PartnerPerformancePeek key=\{"performance:"\+sessionScope\+":"\+/);
  assert.match(source, /PartnerStorefrontLink key=\{sessionScope\+":"\+selectedStore\.id\}/);
  assert.match(source, /const visibleIdentity:IdentityDisplay=stillCurrentSession\(\)\?identity:/);
  assert.match(source, /const visibleStoreImages=stillCurrentSession\(\)\?storeImages:null/);
});
