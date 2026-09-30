import fs from "node:fs";

export function readCanonicalDshMigrationNames(directory) {
  const names = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{3}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) throw new Error("canonical DSH migration set is empty");
  for (const [index, name] of names.entries()) {
    if (Number(name.slice(0, 3)) !== index + 1) throw new Error(`canonical DSH migration sequence is not contiguous: ${name}`);
  }
  return names;
}

export function canonicalDshMigrationHistoryQuery(names) {
  if (names.length === 0) throw new Error("canonical DSH migration set is empty");
  const rows = names.map((name) => `(${Number(name.slice(0, 3))}, '${name.replaceAll("'", "''")}')`).join(",");
  return `SELECT count(*) FROM (VALUES ${rows}) AS expected(version, name) LEFT JOIN dsh.schema_migrations actual USING (version) WHERE actual.name IS DISTINCT FROM expected.name`;
}

export function assertCanonicalDshMigrationHistory(names, actualCount, mismatchCount) {
  if (actualCount !== String(names.length) || mismatchCount !== "0") {
    throw new Error(`DSH schema history differs from canonical migrations: count=${actualCount} expected=${names.length} mismatches=${mismatchCount}`);
  }
}
