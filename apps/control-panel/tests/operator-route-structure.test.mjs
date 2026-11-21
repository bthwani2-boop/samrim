import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const panel = resolve(import.meta.dirname, "..");
const file = (path) => resolve(panel, path);
const read = (path) => readFileSync(file(path), "utf8");

test("Operator workspace keeps control-panel identity and uses a real Next route group", () => {
  for (const path of ["app/page.tsx", "app/(workspace)/layout.tsx",
    "app/(workspace)/workspace/page.tsx", "proxy.ts"]) {
    assert.ok(existsSync(file(path)), path);
  }
  assert.match(read("app/page.tsx"), /OperatorEntryScreen/);
  assert.match(read("app/(workspace)/workspace/page.tsx"), /OperatorDashboardPage/);
  assert.equal(existsSync(file("src/app")), false);
});

test("Operator workspace only renders protected children after owner-verified active session and scope", () => {
  const layout = read("app/(workspace)/layout.tsx");
  assert.match(layout, /currentOperatorAccess/);
  assert.match(layout, /canEnterOperatorWorkspace/);
  assert.match(layout, /if \(!allowed\) return <OperatorWorkspaceGate hasWorkspace=/);
  assert.match(layout, /return <>{children}<\/>/);
  const proxy = read("proxy.ts");
  assert.match(proxy, /requestHeaders\.set\("x-bthwani-route", request\.nextUrl\.pathname\)/);
  const server = read("src/server/current-operator-access.ts");
  assert.match(server, /cache\(async/);
  assert.match(server, /readVerifiedOperatorAccess/);
  const gate = read("src/features/access/operator-workspace-gate.tsx");
  assert.match(gate, /غير متاح/);
  assert.doesNotMatch(gate, /fetch\(|getOrder\(|useSession\(/);
  const entry = read("src/features/access/operator-entry-screen.tsx");
  assert.match(entry, /لوحة تحكم بثواني/);
  assert.doesNotMatch(entry, /setSession\(|localStorage|mock/i);
});

test("Operator links perform a new document request, not a cached layout-only transition", () => {
  const shell = read("src/features/operator-shell/operator-shell.tsx");
  const login = read("src/features/access/operator-passkey-form.tsx");
  const home = read("src/features/workspace/home-dashboard.tsx");
  assert.match(shell, /<a href={href}/);
  assert.match(shell, /aria-label="معاينة الأقسام غير المتاحة قبل الدخول"/);
  assert.match(shell, /aria-disabled="true"/);
  assert.match(login, /window\.location\.replace\("\/"\)/);
  assert.match(home, /<a className={styles\.sectionCard} href={entry\.href}/);
  assert.doesNotMatch(shell, /next\/link/);
  assert.doesNotMatch(login, /next\/link/);
  assert.doesNotMatch(home, /next\/link/);
});


test("Operator SSR shell paints from the same semantic CSS theme as its text before hydration", () => {
  const provider = read("app/providers.tsx");
  // When the OS prefers dark and React has not hydrated yet, its initial
  // `systemDark=false` must not force a light inline background under dark CSS text.
  assert.match(provider, /background:\s*"var\(--surface-warm\)"/);
  assert.match(provider, /color:\s*"var\(--color-primary\)"/);
  assert.doesNotMatch(provider, /background:\s*colors\.background/);
  assert.doesNotMatch(provider, /color:\s*colors\.color/);

  const themeCss = read("../../packages/design-system/theme.css");
  const darkIndex = themeCss.indexOf("@media (prefers-color-scheme: dark)");
  assert.notEqual(darkIndex, -1, "canonical dark-system CSS roles are required before JS mounts");
  const darkMedia = themeCss.slice(darkIndex);
  for (const role of ["--surface-warm", "--color-primary"]) {
    assert.match(themeCss, new RegExp(`${role}:\\s*#[0-9A-Fa-f]{6}`));
    assert.match(darkMedia, new RegExp(`${role}:\\s*#[0-9A-Fa-f]{6}`));
  }
  assert.match(provider, /document\.documentElement\.dataset\.theme\s*=/,
    "hydration must still honor the user-selected light/dark theme");
});
