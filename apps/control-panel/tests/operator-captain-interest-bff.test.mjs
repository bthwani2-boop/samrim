import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = p => readFileSync(new URL(p, root), "utf8");

test("Captain contact list is a separate authenticated Operator page", () => {
  assert.match(source("app/(workspace)/captains/registrations/page.tsx"), /captain-interest-workspace/);
  assert.match(source("app/api/captains/interest/route.ts"), /readCaptainInterestForOperator/);
});
test("Operator BFF keeps private candidate contacts behind live Identity operations and same-origin rules", () => {
  const bff = source("src/features/captains/captain-interest-bff.ts");
  assert.match(bff, /readVerifiedOperatorAccess/);
  assert.match(bff, /access.grants.includes\("operations"\)/);
  assert.match(bff, /listOperatorCaptainInterest/);
  assert.match(bff, /markOperatorCaptainInterestContacted/);
  assert.match(bff, /same-origin/);
  assert.match(bff, /isTrustedOperatorLoopbackTarget\(request, config\.browserOrigin, true\)/);
  assert.doesNotMatch(bff, /localStorage|sessionStorage|CAPTAIN_NOT_APPROVED/);
});

test("Captain administration reuses trusted SSH target while retaining live operations permission", () => {
  for (const path of [
    "src/features/captains/captains-read-bff.ts",
    "src/features/captains/captain-interest-bff.ts",
  ]) {
    const bff = source(path);
    assert.match(bff, /isTrustedOperatorLoopbackTarget\(request, config\.browserOrigin, true\)/);
    assert.match(bff, /access\.grants\.includes\("operations"\)/);
    assert.match(bff, /origin !== null && origin !== config\.browserOrigin/);
  }
});

test("denied Captain owner reads never claim there are zero records", () => {
  const standings = source("src/features/captains/captains-workspace.tsx");
  const contacts = source("src/features/captains/captain-interest-workspace.tsx");
  assert.match(standings, /\(loading \|\| \(page !== null && !error\)\) && <Card/);
  assert.match(contacts, /\(loading \|\| \(page !== null && !error\)\) && <Card/);
});

function nodes(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props.children)];
}

test("Operator returns through the same cursor filters with fresh owner reads", async t => {
  const temporary = mkdtempSync(join(tmpdir(), "bthwani-captain-interest-pages-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const workspace = fileURLToPath(new URL("../../../", import.meta.url));
  const result = spawnSync(process.execPath, [
    join(workspace, "node_modules/typescript/bin/tsc"),
    fileURLToPath(new URL("src/features/captains/captain-interest-workspace.tsx", root)),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--jsx", "react-jsx", "--outDir", temporary,
  ], { cwd: workspace, timeout: 20_000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const hooks = [];
  const effects = [];
  const pending = [];
  const requests = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  const mocks = {
    "@bthwani/dsh": { isOperatorCaptainInterest: () => true },
    antd: { Alert: "Alert", Button: "Button", Card: "Card", Input: "Input", Select: "Select", Space: "Space", Table: "Table", Tag: "Tag",
      Typography: { Title: "Title", Paragraph: "Paragraph", Text: "Text" } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in hooks)) hooks[slot] = initial;
        return [hooks[slot], value => { hooks[slot] = typeof value === "function" ? value(hooks[slot]) : value; }];
      },
      useRef(initial) {
        const slot = index++;
        hooks[slot] ??= { current: initial };
        return hooks[slot];
      },
      useCallback(callback) { return callback; },
      useEffect(callback, deps) {
        const slot = index++;
        const previous = effects[slot];
        if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) pending.push(() => {
          previous?.cleanup?.();
          effects[slot] = { deps, cleanup: callback() };
        });
      },
    },
  };
  const browser = { addEventListener() {}, removeEventListener() {} };
  t.mock.method(globalThis, "fetch", async url => {
    const query = new URL(url, "http://localhost").searchParams;
    requests.push(query);
    if (query.get("city") === "عدن") return new Response("{}", { status: 403 });
    const before = query.get("before");
    const page = before === null ? { nextCursor: "40" } : before === "40" ? { nextCursor: "20" } : {};
    return Response.json({ ...page, items: [] }, { headers: { "X-BThwani-Operator": "operator-a" } });
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", "window", "document", readFileSync(join(temporary, "captain-interest-workspace.js"), "utf8"))(
    name => mocks[name], mod, mod.exports, browser, browser,
  );
  const render = () => {
    index = 0;
    const view = nodes(mod.exports.default());
    for (const effect of pending.splice(0)) effect();
    return view;
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const button = (view, label) => view.find(node => node.type === "Button" && node.props.children === label);
  render();
  await settle();
  render().find(node => node.type === "Select" && node.props["aria-label"] === "نوع الدراجة").props.onChange("BICYCLE");
  render();
  await settle();
  for (let page = 0; page < 2; page++) {
    button(render(), "الصفحة التالية").props.onClick();
    render();
    await settle();
  }
  const lastPage = render();
  assert.equal(button(lastPage, "الصفحة التالية"), undefined);
  assert.ok(button(lastPage, "الصفحة السابقة"), "the operator must be able to return from the final page");
  button(lastPage, "الصفحة السابقة").props.onClick();
  render();
  await settle();
  assert.equal(requests.at(-1).get("before"), "40");
  assert.equal(requests.at(-1).get("vehicle"), "BICYCLE");
  const input = render().find(node => node.type === "Input");
  input.props.onChange({ target: { value: "عدن" } });
  render().find(node => node.type === "Input").props.onPressEnter();
  render();
  await settle();
  assert.equal(requests.at(-1).get("before"), null);
  assert.equal(requests.at(-1).get("city"), "عدن");
  assert.ok(render().some(node => node.type === "Alert"));
  assert.ok(!render().some(node => node.type === "Table"));
});
