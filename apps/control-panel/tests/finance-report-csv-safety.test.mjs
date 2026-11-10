import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const reportSource = readFileSync(new URL("../src/features/finance/finance-specialized-tabs.tsx", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../src/features/shared/registry-csv.ts", import.meta.url), "utf8");
const start = reportSource.indexOf(" const download=()=>downloadRegistryCsv(");
const end = reportSource.indexOf(" return <button", start);
assert.ok(start > 0 && end > start, "finance report uses the existing CSV writer");
const downloadAction = reportSource.slice(start, end);
const runnableHelper = stripTypeScriptTypes(helperSource.replace("export function downloadRegistryCsv", "function downloadRegistryCsv"))
  + "\nglobalThis.expose = downloadRegistryCsv;";

async function exportCsv(rows, filename = "bthwani-finance-report") {
  const action = { blob: null, href: null, filename: null, clicked: false, revoked: null };
  const context = {
    Blob,
    URL: {
      createObjectURL(blob) { action.blob = blob; return "blob:finance-report"; },
      revokeObjectURL(url) { action.revoked = url; },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, "a");
        return {
          set href(value) { action.href = value; },
          set download(value) { action.filename = value; },
          click() { action.clicked = true; },
        };
      },
    },
  };
  runInNewContext(runnableHelper, context);
  const trigger = runInNewContext(`${downloadAction}\ndownload;`, {
    downloadRegistryCsv: context.expose,
    rows,
    file: filename,
  });
  trigger();
  assert.equal(action.clicked, true);
  assert.equal(action.href, "blob:finance-report");
  assert.equal(action.revoked, "blob:finance-report");
  return { csv: await action.blob.text(), bytes: new Uint8Array(await action.blob.arrayBuffer()), filename: action.filename };
}

function row(subject, overrides = {}) {
  return {
    priority: 1, category: "تسوية", subject, reference: "WLT-1",
    state: "بانتظار المراجعة", amount: "100 ريال", nextStep: "مراجعة المستند",
    ...overrides,
  };
}

test("operator finance report uses the canonical exporter with the same seven Arabic columns and filename", async () => {
  const { csv, bytes, filename } = await exportCsv([row("بثواني")], "bthwani-all-report");
  assert.equal(filename, "bthwani-all-report.csv");
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "Arabic CSV keeps the UTF-8 BOM bytes");
  assert.match(csv, /^"الأولوية","النوع","المستفيد","المرجع","الحالة","المبلغ","السبب"\r\n/);
  assert.match(csv, /"1","تسوية","بثواني","WLT-1","بانتظار المراجعة","100 ريال","مراجعة المستند"/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("untrusted recipient and category spreadsheet formulae are neutralized on export", async () => {
  const { csv } = await exportCsv([
    row('=HYPERLINK("https://malicious.example","click")'),
    row("+SUM(1,1)", { category: "@NOW()" }),
    row("-CMD('x')", { reference: "\t=SUM(2,3)" }),
    row("\u200B=HYPERLINK('x')"),
  ]);
  assert.ok(csv.includes(`"'=HYPERLINK(""https://malicious.example"",""click"")"`));
  assert.ok(csv.includes(`"'+SUM(1,1)"`));
  assert.ok(csv.includes(`"'@NOW()"`));
  assert.ok(csv.includes(`"'-CMD('x')"`));
  assert.ok(csv.includes(`"' =SUM(2,3)"`), "tab becomes a space and formula marker is escaped");
  assert.ok(csv.includes(`"'\u200B=HYPERLINK('x')"`));
});

test("embedded CSV line breaks and quotes remain in one cell without injecting rows", async () => {
  const { csv } = await exportCsv([row('مدخل "اقتباس"\r\nحقل')]);
  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /"مدخل ""اقتباس"" حقل"/);
  assert.doesNotMatch(csv, /\r\nحقل/);
});

test("canonical exporter does not convert true numeric negative ledger values into text", () => {
  const action = { blob: null };
  const context = {
    Blob,
    URL: { createObjectURL(blob) { action.blob = blob; return "blob:csv"; }, revokeObjectURL() {} },
    document: { createElement() { return { click() {} }; } },
  };
  runInNewContext(runnableHelper, context);
  context.expose("ledger.csv", ["قيمة"], [[-500], ["-500"], ["=1+1"]]);
  return action.blob.text().then((text) => {
    assert.match(text, /"-500"\r\n"'-500"\r\n"'=1\+1"/);
  });
});

test("finance report no longer maintains a second CSV, Blob or object-URL implementation", () => {
  assert.equal((reportSource.match(/function Download\(/g) ?? []).length, 1);
  assert.equal((reportSource.match(/downloadRegistryCsv\(/g) ?? []).length, 1);
  assert.doesNotMatch(downloadAction, /new Blob|URL\.createObjectURL|createElement\("a"\)/);
  assert.match(reportSource, /rows\.map\(r=>\[String\(r\.priority\),r\.category,r\.subject,r\.reference,r\.state,r\.amount,r\.nextStep\]\)/);
});
