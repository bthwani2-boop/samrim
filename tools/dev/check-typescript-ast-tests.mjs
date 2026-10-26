import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.test.mjs", "*.test.js"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const tests = tracked.filter((file) =>
  readFileSync(resolve(repositoryRoot, file), "utf8").includes("typescript-ast"),
);

if (tests.length < 17) {
  console.error(`TS_AST_TEST_DISCOVERY=FAIL count=${tests.length} expected_at_least=17`);
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, ["--test", ...tests], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 2;
  console.log(`TS_AST_TESTS=${process.exitCode === 0 ? "PASS" : "FAIL"} files=${tests.length} exit=${process.exitCode}`);
}
