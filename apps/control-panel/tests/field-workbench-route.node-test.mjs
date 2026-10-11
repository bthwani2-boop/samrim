import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { ModuleKind, transpileModule } from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/fields/route.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;

function routeFixture({ candidates = [], candidatesNextCursor, accountPages = [[]], cityByActor = {} } = {}) {
  const accountRequests = [];
  const admissionRequests = [];
  const dsh = {
    listFieldAdmissions: async (_query, _state, _sort, limit) => ({ admissions: candidates.slice(0, limit), nextCursor: candidatesNextCursor }),
    readFieldAdmissionByActor: async (actorId) => {
      admissionRequests.push(actorId);
      return { admission: { id: `admission-${actorId}`, actorId, serviceCityIds: cityByActor[actorId] ?? [] } };
    },
    listOperatorFieldActivity: async () => ({ items: [] }),
    isDshClientError: () => false,
  };
  const identity = {
    readOperatorSession: async () => ({ subject: "operator", role: "operator", permissions: ["partners"] }),
    searchIdentityRoles: async (_role, _query, limit, cursor) => {
      accountRequests.push({ limit, cursor });
      const pageIndex = cursor ? Number(cursor) : 0;
      const page = accountPages[pageIndex] ?? [];
      assert.ok(page.length <= limit, "fixture page must honor the canonical Identity bound");
      return { items: page, limit, nextCursor: pageIndex + 1 < accountPages.length ? String(pageIndex + 1) : undefined };
    },
    identityErrorPayload: () => ({ code: "ERROR" }),
    identityHttpStatus: () => 502,
  };
  const exports = {};
  const ownerRequire = (specifier) => {
    if (specifier.endsWith("/dsh-bff")) return dsh;
    if (specifier.endsWith("/identity-bff")) return identity;
    if (specifier.endsWith("/operator-workspace-access")) return { operatorWorkspacePermissionDenied: () => null };
    if (specifier.endsWith("/csrf")) return { verifySameOrigin: () => true };
    if (specifier === "@bthwani/design-system") return { normalizeYemenPhoneE164: (value) => value };
    return require(specifier);
  };
  new Function("require", "exports", compiled)(ownerRequire, exports);
  return { GET: exports.GET, accountRequests, admissionRequests };
}

const role = (actorId) => ({ actorId, phoneE164: "+967770000001", role: "field", enabled: true });
const request = (query) => new Request(`http://localhost/api/fields?scope=workbench&${query}`);

test("combined candidate and city-filtered account page obeys the requested limit", async () => {
  const fixture = routeFixture({ candidates: [{ id: "one" }, { id: "two" }], accountPages: [[role("account")]], cityByActor: { account: ["city-a"] } });
  const response = await fixture.GET(request("limit=3&serviceCityId=city-a"));
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.items.length, 3);
  assert.deepEqual(fixture.accountRequests, [{ limit: 1, cursor: "" }]);
  assert.equal(fixture.admissionRequests.length, 1);
});

test("sparse city pages preserve a bounded source cursor and reach later matches", async () => {
  const fixture = routeFixture({ accountPages: [[role("outside-a"), role("outside-b")], [role("inside")]], cityByActor: { inside: ["city-a"] } });
  const first = await (await fixture.GET(request("limit=2&serviceCityId=city-a"))).json();
  assert.deepEqual(first.items, []);
  assert.ok(first.nextCursor);
  const second = await (await fixture.GET(request(`limit=2&serviceCityId=city-a&cursor=${first.nextCursor}`))).json();
  assert.deepEqual(second.items.map((item) => item.account.actorId), ["inside"]);
  assert.equal(second.nextCursor, undefined);
  assert.deepEqual(fixture.accountRequests, [{ limit: 2, cursor: "" }, { limit: 2, cursor: "1" }]);
  assert.deepEqual(fixture.admissionRequests, ["outside-a", "outside-b", "inside"]);
});

test("candidate source cursor does not query or append accounts prematurely", async () => {
  const fixture = routeFixture({ candidates: [{ id: "candidate" }], candidatesNextCursor: "candidate-next" });
  const page = await (await fixture.GET(request("limit=1"))).json();
  assert.equal(page.items.length, 1);
  assert.equal(JSON.parse(Buffer.from(page.nextCursor, "base64url").toString()).phase, "candidates");
  assert.deepEqual(fixture.accountRequests, []);
});
