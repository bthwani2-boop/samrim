import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const operationsSource = readFileSync(new URL("../src/features/operations/operations-performance.tsx", import.meta.url), "utf8");
const sharedSource = readFileSync(new URL("../src/features/shared/registry-csv.ts", import.meta.url), "utf8");
const start = operationsSource.indexOf("  function exportReport() {");
const end = operationsSource.indexOf("  return <section", start);
assert.ok(start >= 0 && end > start, "actual OperationsPerformance export handler found");
const exportSource = operationsSource.slice(start, end);
const canonical = stripTypeScriptTypes(sharedSource.replace("export function downloadRegistryCsv", "function downloadRegistryCsv"))
  + "\nglobalThis.download = downloadRegistryCsv;";

function dailyReport(length = 30) {
  return {
    timeZone: "Asia/Aden",
    measuredAt: "2026-11-11T08:00:00.000Z",
    days: Array.from({ length }, (_, index) => ({
      day: `2026-10-${String(index + 1).padStart(2, "0")}`,
      orders: index + 1,
      delivered: index,
      awaitingDispatch: 1,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    })),
  };
}

async function actualCsv(report, range) {
  const result = { blob: null, filename: null, href: null, revoked: null, clicked: false };
  const exporter = { Blob, URL: {
    createObjectURL(blob) { result.blob = blob; return "blob:operations-report"; },
    revokeObjectURL(value) { result.revoked = value; },
  }, document: { createElement(tag) {
    assert.equal(tag, "a");
    return {
      set href(value) { result.href = value; },
      set download(value) { result.filename = value; },
      click() { result.clicked = true; },
    };
  } } };
  runInNewContext(canonical, exporter);
  const allDays = report?.days ?? [];
  const trigger = runInNewContext(`${exportSource}\nexportReport;`, {
    report, allDays, days: allDays.slice(-range), range, pending: false,
    downloadRegistryCsv: exporter.download,
  });
  trigger();
  if (!result.blob) return result;
  return {
    ...result,
    bytes: new Uint8Array(await result.blob.arrayBuffer()),
    csv: await result.blob.text(),
  };
}

test("operator daily operations CSV preserves DSH metadata, headers, filename and BOM", async () => {
  const exported = await actualCsv(dailyReport(7), 7);
  assert.equal(exported.filename, "bthwani-operations-daily-7.csv");
  assert.equal(exported.clicked, true);
  assert.equal(exported.href, "blob:operations-report");
  assert.equal(exported.revoked, "blob:operations-report");
  assert.deepEqual([...exported.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = exported.csv.replace(/^\uFEFF/u, "").split("\r\n");
  assert.deepEqual(lines.slice(0, 5), [
    "# source=DSH operator/home-analytics",
    "# timezone=Asia/Aden",
    "# measuredAt=2026-11-11T08:00:00.000Z",
    "# coverage=returned_daily_aggregate",
    '"day","orders","delivered","awaiting_dispatch","in_progress","failed","cancelled"',
  ]);
  assert.equal(lines.length, 12, "four provenance lines, header and seven daily rows");
  assert.equal(lines[5], '"2026-10-01","1","0","1","0","0","0"');
  assert.equal(lines[11], '"2026-10-07","7","6","1","0","0","0"');
});

test("30 day export keeps the full period and original filename", async () => {
  const exported = await actualCsv(dailyReport(), 30);
  assert.equal(exported.filename, "bthwani-operations-daily-30.csv");
  assert.equal(exported.csv.split("\r\n").length, 35, "four metadata lines + header + 30 records");
  assert.ok(exported.csv.includes('"2026-10-01","1","0","1","0","0","0"'));
});

test("untrusted metadata and daily text cannot inject extra CSV rows or spreadsheet formulas", async () => {
  const report = dailyReport(7);
  report.timeZone = "Asia/Aden\r\n=HYPERLINK(\"x\")";
  report.days[6].day = '=HYPERLINK("https://example.test","open")';
  const exported = await actualCsv(report, 7);
  const lines = exported.csv.split("\r\n");
  assert.equal(lines.length, 12);
  assert.equal(lines[1], '# timezone=Asia/Aden =HYPERLINK("x")');
  assert.ok(exported.csv.includes('"\'=HYPERLINK(""https://example.test"",""open"")"'));
});

test("OperationsPerformance retains canonical report pagination/availability without another CSV writer", () => {
  assert.match(exportSource, /downloadRegistryCsv\(/);
  assert.doesNotMatch(exportSource, /new Blob|createObjectURL|createElement\("a"\)|safeCsv/);
  assert.doesNotMatch(operationsSource, /const safeCsv/);
  assert.match(operationsSource, /disabled=\{pending \|\| !report \|\| days\.length !== range\}/);
  assert.match(operationsSource, /allDays\.slice\(-range\)/);
});

test("report selection binds the visible result, loading and errors to the selected DSH period", () => {
  const start = operationsSource.indexOf("  const activeResult = ");
  const end = operationsSource.indexOf("  useEffect(", start);
  assert.ok(start >= 0 && end > start, "Production report has one period-bound selected result");
  const snippet = operationsSource.slice(start, end);
  const select = runInNewContext(`(function(result, range) { ${snippet} return {report, pending, error}; })`);
  const thirty = dailyReport(30);
  assert.equal(select({range: 30, report: thirty, error: "", pending: false}, 7).report, null);
  assert.equal(select({range: 30, report: thirty, error: "previous failure", pending: false}, 7).pending, true);
  assert.equal(select({range: 30, report: thirty, error: "previous failure", pending: false}, 7).error, "");
  assert.equal(select({range: 30, report: thirty, error: "", pending: false}, 30).report, thirty);
  assert.equal(select({range: 7, report: dailyReport(7), error: "read failed", pending: false}, 7).error, "read failed");
});

test("CSV handler refuses a 30-day source on a 7-day screen", async () => {
  const exported = await actualCsv(dailyReport(30), 7);
  assert.equal(exported.clicked, false, "No stale cross-period CSV should be downloaded");
});

test("no download is produced when the report is absent or has no records", async () => {
  const missing = await actualCsv(null, 7);
  assert.equal(missing.clicked, false);
  const empty = await actualCsv(dailyReport(0), 7);
  assert.equal(empty.clicked, false);
});
