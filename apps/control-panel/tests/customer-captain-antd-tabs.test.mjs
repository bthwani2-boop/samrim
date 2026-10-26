import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const captainPath = new URL("../src/features/captain/captain-detail-workspace.tsx", import.meta.url);
const customerPath = new URL("../src/features/customers/customer-profile.tsx", import.meta.url);

const [captain, customer] = await Promise.all([
  readFile(captainPath, "utf8"),
  readFile(customerPath, "utf8"),
]);

test("captain profile panels are Ant Design item children with URL-backed selection", () => {
  assert.match(captain, /import \{ Tabs \} from "antd"/);
  assert.doesNotMatch(captain, /RecordTabs|role="tabpanel"/);
  assert.match(captain, /<Tabs aria-label="أقسام ملف الكابتن" className="captain-profile-tabs" activeKey=\{activeTab\} onChange=\{\(key\) => switchTab\(validCaptainTab\(key\)\)\}/);
  assert.match(captain, /destroyOnHidden=\{false\} items=\{captainTabs\.map\(\(\{ id, label \}\) => \(\{ key: id, label, children: renderTabContent\(id\) \}\)\)\}/);
  assert.match(captain, /tabBarExtraContent=\{<div className="captain-profile-toolbarActions">/);
  assert.doesNotMatch(captain, /<div className="captain-profile-toolbar">/);
  for (const key of ["overview", "orders", "performance", "finance", "account", "history"]) {
    assert.ok(captain.includes(`id: "${key}"`), `${key} remains in the captain tab model`);
    assert.ok(captain.includes(`tab === "${key}"`), `${key} content remains selected within its item`);
  }
  assert.match(captain, /const renderTabContent = \(tab: CaptainTab\) => \{\s*if \(!detail \|\| !captain\) return null;/);
  assert.match(captain, /const switchTab = useCallback\(\(next: CaptainTab\) => \{\s*setActiveTab\(next\);[\s\S]*?window\.history\.pushState/);
  assert.match(captain, /window\.addEventListener\("popstate", readTab\)/);
});

test("customer profile panels belong to permission-filtered Ant Design items", () => {
  assert.match(customer, /import \{ Tabs \} from "antd"/);
  assert.doesNotMatch(customer, /RecordTabs|role="tabpanel"|hidden=\{shownTab !==/);
  assert.match(customer, /<Tabs aria-label="أقسام ملف العميل" className="customer-tab-strip" activeKey=\{shownTab\} onChange=\{\(key\) => selectTab\(key as Tab\)\}/);
  const tabs = customer.slice(customer.indexOf("<Tabs aria-label=\"أقسام ملف العميل\""), customer.indexOf("</Tabs>", customer.indexOf("<Tabs aria-label=\"أقسام ملف العميل\"")));
  for (const key of ["overview", "orders", "performance", "marketing", "account", "finance"]) {
    assert.match(tabs, new RegExp(`key: "${key}"`), `${key} remains a Tabs item`);
  }
  assert.equal((tabs.match(/children: \(/g) ?? []).length, 6, "every panel is owned by an item child");
  assert.match(tabs, /\.\.\.\(canReadOrders \? \[\s*\{ key: "orders"[\s\S]*?\{ key: "performance"/);
  assert.match(tabs, /\.\.\.\(canMarketing \? \[\{ key: "marketing"/);
  assert.match(tabs, /\.\.\.\(canFinance \? \[\{ key: "finance"/);
  assert.match(tabs, /id="customer-account-management"/);
  assert.match(tabs, /shownTab === "overview" \? <ActorWalletStatement/);
  assert.match(tabs, /shownTab === "finance" \? <ActorWalletStatement/);
  assert.match(customer, /destroyOnHidden=\{false\}/);
  assert.match(customer, /window\.addEventListener\("popstate", syncTab\)/);
  assert.match(customer, /window\.history\.pushState/);
});
