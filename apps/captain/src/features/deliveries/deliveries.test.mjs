import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const dir = import.meta.dirname;
test("delivery presentation stays read-only until authoritative owner operations exist", () => {
  for (const file of ["deliveries-screen.tsx","delivery-task-screen.tsx","handoff-proof.tsx","delivery-proof.tsx","order-conversation.tsx"]) {
    const content=readFileSync(resolve(dir,file),"utf8");
    assert.ok(content.includes("DSH"), file);
    assert.doesNotMatch(content,/fetch\s*\(|setSession\s*\(|setDelivered\s*\(/,file);
  }
});
