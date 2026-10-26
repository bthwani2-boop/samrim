import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const tabsDir = resolve(import.meta.dirname, "../../app/(app)/(tabs)");

test("Partner Tabs.Screen declarations match actual sibling routes", () => {
  const layout = readFileSync(join(tabsDir, "_layout.tsx"), "utf8");
  const declaredRoutes = [...layout.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(declaredRoutes.length > 0, "partner tab routes should be declared");
  for (const name of declaredRoutes) {
    assert.ok(
      existsSync(join(tabsDir, `${name}.tsx`)) || existsSync(join(tabsDir, name, "index.tsx")),
      `Tab "${name}" does not belong to the tabs navigator`,
    );
  }
});
