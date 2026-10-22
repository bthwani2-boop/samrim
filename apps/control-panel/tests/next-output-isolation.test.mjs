import assert from "node:assert/strict";
import test from "node:test";

test("Next dev and production builds own separate output directories", async () => {
  const before = process.env.NODE_ENV;
  try {
    for (const [mode, expected] of [["development", ".next-dev"], ["production", ".next"]]) {
      process.env.NODE_ENV = mode;
      const { default: config } = await import(`../next.config.mjs?mode=${mode}`);
      assert.equal(config.distDir, expected, `${mode} must not write into the other runtime`);
    }
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
