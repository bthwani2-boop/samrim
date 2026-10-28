import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/features/finance/", import.meta.url);
const [registry, financeStyles, specializedStyles] = await Promise.all([
  readFile(new URL("finance-wallet-registry.tsx", root), "utf8"),
  readFile(new URL("finance-command-center.css", root), "utf8"),
  readFile(new URL("finance-specialized-tabs.css", root), "utf8"),
]);

test("wallet registry uses Ant Design controls and removes its duplicate generic controls", () => {
  assert.match(registry, /import \{ Alert, Button, Flex, Input, Segmented, Table, Tag, Typography, type TableColumnsType \} from "antd"/);
  for (const component of ["Segmented<ActorType>", "Input.Search", "<Table<WalletRow>", "<Tag", "<Button", "<Alert"]) {
    assert.ok(registry.includes(component), component + " owns the matching generic control");
  }
  assert.doesNotMatch(registry, /<fieldset|<table|<input|<select|<button/);
  for (const selector of [".fc-search", ".fc-table", ".fc-table-scroll", ".fc-person", ".fc-actor-types button", ".fc-btn"]) {
    assert.ok(!financeStyles.includes(selector), selector + " duplicate styles are removed");
    assert.ok(!specializedStyles.includes(selector), selector + " theme override is removed");
  }
});

test("wallet browsing preserves read-only owner endpoints, cursor paging, and stale-request guards", () => {
  assert.match(registry, /fetch\(url, \{ cache: "no-store", signal: AbortSignal\.timeout\(15000\) \}\)/);
  assert.match(registry, /"\/api\/finance\/financial-statements\?" \+ params/);
  assert.match(registry, /"\/api\/finance\/beneficiaries\/" \+ encodeURIComponent\(row\.actorType\) \+ "\/" \+ encodeURIComponent\(row\.actorId\) \+ "\/financial-statement\?" \+ params/);
  assert.match(registry, /params\.set\("cursor", after\)/);
  assert.match(registry, /setItems\(\(old\) => after \? \[\.\.\.old, \.\.\.result\.summaries\] : result\.summaries\)/);
  assert.match(registry, /if \(request !== requestID\.current\) return/);
  assert.match(registry, /if \(request !== detailID\.current\) return/);
  assert.doesNotMatch(registry, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
});

test("wallet loading, errors, RTL values, and inspector focus recovery remain explicit", () => {
  assert.match(registry, /role="status"/);
  assert.match(registry, /<Alert type="error" showIcon message=\{error\} action=/);
  assert.match(registry, /<Alert type="error" showIcon message=\{statementError\} action=/);
  assert.match(registry, /aria-label="البحث في المحافظ المحمّلة"/);
  assert.match(registry, /<section aria-label="قائمة المحافظ">/);
  assert.match(registry, /dir="ltr"/);
  assert.match(registry, /requestAnimationFrame\(\(\) => selectionTrigger\.current\?\.focus\(\)\)/);
  assert.match(registry, /لا تُنفذ أي تسوية من هذه المعاينة/);
});
