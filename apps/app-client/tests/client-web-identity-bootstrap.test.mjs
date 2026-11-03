import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");

test("Client web restores identity at root on deep links, not only on the landing page", () => {
  assert.match(layout, /import\s*\{[^}]*restoreIdentitySession[^}]*\}\s*from\s*["']\.\.\/src\/bootstrap\/identity["']/s);
  const root = layout.split("export default function RootLayout() {")[1] ?? "";
  const startup = root.slice(0, 450);
  assert.match(startup, /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(Platform\.OS\s*===\s*["']web["']\)/);
  assert.match(startup, /void\s+restoreIdentitySession\(\)/);
});
