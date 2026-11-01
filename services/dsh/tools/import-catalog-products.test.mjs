import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const importer = fileURLToPath(new URL("./import-catalog-products.mjs", import.meta.url));
const header = "canonicalName,verticalId,scope,measurementKind,baseUnit,categoryIds";

async function runCsvImport(csv) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, body: JSON.parse(body) });
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ run: { state: "previewed" }, items: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(tmpdir(), "bthwani-catalog-csv-"));
  try {
    const file = path.join(directory, "catalog.csv");
    await writeFile(file, csv, "utf8");
    const args = [
      importer,
      "--file=" + file,
      "--base-url=http://127.0.0.1:" + server.address().port,
      "--actor-id=test-operator",
      "--service-token=isolated-test-token",
      "--report=" + path.join(directory, "report.json"),
    ];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { windowsHide: true, timeout: 10_000 });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    return { ...result, requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("CSV import preserves quoted commas, doubled quotes, newlines and physical row numbers", async () => {
  const csv = [
    header,
    '"Green ""special"", tea\nmint",grocery,SHARED,DISCRETE,COUNT,category-1',
    "Bread,grocery,SHARED,DISCRETE,COUNT,category-1",
    "",
  ].join("\n");
  const result = await runCsvImport(csv);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].path, "/dsh/catalog/imports/preview");
  assert.deepEqual(result.requests[0].body.rows.map((row) => row.rowNumber), [2, 4]);
  assert.deepEqual(result.requests[0].body.rows.map((row) => row.canonicalName), [
    'Green "special", tea\nmint', "Bread",
  ]);
});

test("CSV import rejects trailing content after a closing quote without sending a request", async () => {
  const result = await runCsvImport(header + '\n"Tea"junk,grocery,SHARED,DISCRETE,COUNT,category-1\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /CSV.*quote/i);
  assert.equal(result.requests.length, 0);
});

test("CSV import rejects quotes embedded in unquoted fields", async () => {
  const result = await runCsvImport(header + '\nTe"a,grocery,SHARED,DISCRETE,COUNT,category-1\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /CSV.*quote/i);
  assert.equal(result.requests.length, 0);
});
