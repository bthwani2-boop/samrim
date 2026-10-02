import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCanonicalDshMigrationHistory,
  canonicalDshMigrationHistoryQuery,
  readCanonicalDshMigrationNames,
} from "./canonical-dsh-migration-history.mjs";

function withMigrationDirectory(files, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-migrations-"));
  try {
    for (const file of files) {
      const target = path.join(directory, file);
      if (file.endsWith("/")) fs.mkdirSync(target);
      else fs.writeFileSync(target, "-- test migration\n");
    }
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("canonical DSH migration list is sorted and includes only numbered SQL files", () => {
  const names = withMigrationDirectory(["002_second.sql", "README.md", "001_first.sql", "003_directory.sql/"], (directory) => readCanonicalDshMigrationNames(directory));
  assert.deepEqual(names, ["001_first.sql", "002_second.sql"]);
});

test("canonical DSH migration list rejects an empty or gapped sequence", () => {
  withMigrationDirectory([], (directory) => assert.throws(() => readCanonicalDshMigrationNames(directory), /set is empty/));
  withMigrationDirectory(["001_first.sql", "003_third.sql"], (directory) => assert.throws(() => readCanonicalDshMigrationNames(directory), /not contiguous: 003_third.sql/));
});

test("canonical migration history query escapes SQL literals", () => {
  assert.equal(
    canonicalDshMigrationHistoryQuery(["001_first.sql", "002_dsh's.sql"]),
    "SELECT count(*) FROM (VALUES (1, '001_first.sql'),(2, '002_dsh''s.sql')) AS expected(version, name) LEFT JOIN dsh.schema_migrations actual USING (version) WHERE actual.name IS DISTINCT FROM expected.name",
  );
  assert.throws(() => canonicalDshMigrationHistoryQuery([]), /set is empty/);
});

test("canonical migration history requires the exact row count and every version/name match", () => {
  assert.doesNotThrow(() => assertCanonicalDshMigrationHistory(["001_first.sql", "002_second.sql"], "2", "0"));
  assert.throws(() => assertCanonicalDshMigrationHistory(["001_first.sql", "002_second.sql"], "1", "0"), /count=1 expected=2/);
  assert.throws(() => assertCanonicalDshMigrationHistory(["001_first.sql", "002_second.sql"], "2", "1"), /mismatches=1/);
});

test("location proof delegates schema migration history to the tested canonical helper", () => {
  const source = fs.readFileSync(new URL("../verify-dsh-location-runtime.mjs", import.meta.url), "utf8");
  assert.match(source, /readCanonicalDshMigrationNames\(dshMigrationDirectory\)/);
  assert.match(source, /assertCanonicalDshMigrationHistory\(dshMigrationNames, schema, sql\(canonicalDshMigrationHistoryQuery\(dshMigrationNames\)\)\)/);
});
