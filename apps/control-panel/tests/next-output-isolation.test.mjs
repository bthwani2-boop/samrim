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

test("local development never emits production-only HSTS", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAppEnv = process.env.BTHWANI_ENV;
  try {
    for (const [nodeEnv, appEnv, expectHsts] of [
      ["development", "development", false],
      ["production", "development", false],
      ["development", "production", false],
      ["production", "test", false],
      ["production", "production", true],
    ]) {
      process.env.NODE_ENV = nodeEnv;
      process.env.BTHWANI_ENV = appEnv;
      const { default: config } = await import(`../next.config.mjs?hsts=${nodeEnv}-${appEnv}`);
      const rules = await config.headers();
      const headers = rules.flatMap((rule) => rule.headers);
      assert.equal(
        headers.some((header) => header.key === "Strict-Transport-Security"),
        expectHsts,
        `HSTS environment isolation failed for NODE_ENV=${nodeEnv} BTHWANI_ENV=${appEnv}`,
      );
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAppEnv === undefined) delete process.env.BTHWANI_ENV;
    else process.env.BTHWANI_ENV = previousAppEnv;
  }
});
