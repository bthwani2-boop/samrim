import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const appDirectory = new URL("../../app/(app)/", import.meta.url);

test("new partner is a stack destination above tabs, not a hidden tab", async () => {
  const appLayout = await readFile(new URL("_layout.tsx", appDirectory), "utf8");
  const tabsLayout = await readFile(new URL("(tabs)/_layout.tsx", appDirectory), "utf8");
  const rootEntries = await readdir(appDirectory);
  const casesRoute = await readFile(new URL("(tabs)/cases.tsx", appDirectory), "utf8");
  const walletRoute = await readFile(new URL("(tabs)/wallet.tsx", appDirectory), "utf8");
  const newPartnerRoute = await readFile(new URL("new-case.tsx", appDirectory), "utf8");

  assert.ok(rootEntries.includes("new-case.tsx"));
  assert.match(appLayout, /<Stack\.Screen name="\(tabs\)"/u);
  assert.match(appLayout, /<Stack\.Screen name="new-case"/u);
  assert.doesNotMatch(tabsLayout, /name="new-case"|tabBarButton/u);
  assert.match(tabsLayout, /name="cases"/u);
  assert.match(tabsLayout, /name="account"/u);
  assert.match(casesRoute, /<FieldAdmissionGate>/u);
  assert.match(walletRoute, /<FieldAdmissionGate>/u);
  assert.match(newPartnerRoute, /<FieldAdmissionGate>/u);
});
