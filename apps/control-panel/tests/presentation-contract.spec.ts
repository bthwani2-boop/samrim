import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, type Page, test } from "./coverage-fixtures";

// Rendering fixtures isolate presentation proof from durable business data.
const identity = {
  subject: "presentation-operator", sessionId: "presentation-session", role: "operator",
  permissions: ["operations", "partners", "catalog", "marketing", "finance", "platform_policies"],
  surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};
const stores = Array.from({ length: 10 }, (_, index) => ({
  id: `presentation-store-${index}`, name: `متجر العرض ${index + 1}`,
  partnerActorId: `presentation-partner-${index}`, partnerName: "شريك العرض",
  serviceCityName: "صنعاء", primaryVerticalName: "البقالة", publicationState: "published",
  fulfillmentModes: ["delivery"], updatedAt: "2026-10-01T12:00:00Z",
}));
const products = Array.from({ length: 10 }, (_, index) => ({
  id: `presentation-product-${index}`, canonicalName: `منتج العرض ${index + 1}`,
  verticalId: "presentation-vertical", categoryIds: [], variantCount: 2, storeCount: 25,
  active: true, updatedAt: "2026-10-01T12:00:00Z",
}));

async function stubPresentationReads(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, json: { error: { message: "Presentation proof does not mutate records" } } });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": { identity },
      "/api/notifications": { notifications: [], unreadCount: 0, nextCursor: "" },
      "/api/partners/stores": { stores, nextCursor: "presentation-next-page" },
      "/api/partners": { partners: [], nextCursor: "" },
      "/api/partners/joining-cases": { cases: [], nextCursor: "" },
      "/api/operations": { operations: [], nextCursor: "" },
      "/api/finance/beneficiaries": { beneficiaries: [], nextCursor: "" },
      "/api/finance/settlement-batches": { batches: [], nextCursor: "" },
      "/api/finance/cash-custody": { items: [], totalItems: 0, totalAmountMinor: 0, nextCursor: "" },
      "/api/catalog/product-registry": { products, nextCursor: "presentation-next-page" },
      "/api/catalog/products": { products: [] },
      "/api/catalog/categories": { categories: [], nextCursor: "" },
      "/api/catalog/verticals": { verticals: [{ id: "presentation-vertical", nameAr: "البقالة", nameEn: "Grocery", active: true, version: 1 }] },
      "/api/catalog/commercial-store-types": { storeTypes: [] },
      "/api/catalog/proposals": { proposals: [] },
      "/api/service-cities": { cities: [] },
      "/api/wallet-providers": { walletProviders: [{ key: "presentation-wallet", displayNameAr: "محفظة العرض", active: true, version: 1 }] },
      "/api/captains": { items: [], candidates: [], nextCursor: "" },
    };
    await route.fulfill(Object.hasOwn(responses, path)
      ? { status: 200, json: responses[path] }
      : { status: 404, json: { error: { message: `Unconfigured presentation fixture: ${path}` } } });
  });
}

async function expectNoOuterOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, "document width stays within the mobile viewport").toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, "body width stays within the mobile viewport").toBeLessThanOrEqual(dimensions.viewport + 1);
}

function presentationViolations(source: string, path: string): string[] {
  const violations: string[] = [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === "style") violations.push("style element");
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(styled-components|styled-jsx|@emotion)(\/|$)/.test(node.moduleSpecifier.text)) violations.push("competing style engine");
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "style") {
      let expression = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
      while (expression && ts.isAsExpression(expression)) expression = expression.expression;
      const properties = expression && ts.isObjectLiteralExpression(expression) ? expression.properties : [];
      const depth = properties.length === 1 && ts.isPropertyAssignment(properties[0]!) && properties[0]!.name.getText(file) === '"--tree-depth"';
      if (path !== "src/features/central-catalog/central-catalog.tsx" || !depth) violations.push("inline presentation");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

test("presentation guard rejects competing styles and restricts the tree-depth exception", () => {
  for (const source of ['<input style={{width:"100%"}} />', '<div style={customStyle} />', '<style>{"input {width:100%}"}</style>', 'import styled from "styled-components";']) {
    expect(presentationViolations(source, "src/new-page.tsx").length).toBeGreaterThan(0);
  }
  const depth = '<li style={{"--tree-depth": depth} as CSSProperties} />';
  expect(presentationViolations(depth, "src/features/central-catalog/central-catalog.tsx")).toEqual([]);
  expect(presentationViolations(depth, "src/new-page.tsx")).toEqual(["inline presentation"]);
  expect(presentationViolations('<li style={{"--tree-depth": depth, color: "red"}} />', "src/features/central-catalog/central-catalog.tsx")).toEqual(["inline presentation"]);
});

test("application presentation has one stylesheet and one import owner", () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  const files = [...walk(join(appRoot, "app")), ...walk(join(appRoot, "src"))];
  const relativePath = (path: string) => relative(appRoot, path).replaceAll("\\", "/");
  expect(files.filter((path) => /\.(css|scss|sass|less)$/.test(path)).map(relativePath)).toEqual(["app/globals.css"]);
  expect(files.filter((path) => /\.[cm]?[jt]sx?$/.test(path)).flatMap((path) => presentationViolations(readFileSync(path, "utf8"), relativePath(path)).map((violation) => `${relativePath(path)}: ${violation}`))).toEqual([]);
  const styleImportOwners = files.filter((path) => /\.[cm]?[jt]sx?$/.test(path) && /^\s*import\s+(?:[^;\n]+\s+from\s+)?["'][^"']+\.css["']/m.test(readFileSync(path, "utf8"))).map(relativePath);
  expect(styleImportOwners).toEqual(["app/layout.tsx"]);
  const css = [join(appRoot, "app/globals.css"), join(appRoot, "../../packages/design-system/theme.css"), join(appRoot, "../../packages/design-system/web.css")].map((path) => readFileSync(path, "utf8")).join("\n");
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const references = [...readFileSync(join(appRoot, "app/globals.css"), "utf8").matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
  // The tree's numeric depth is supplied by the owning data, never a visual override.
  expect([...new Set(references)].filter((name) => name !== "--tree-depth" && !definitions.has(name))).toEqual([]);
});

test("a period report uses the shared print output without exposing workspace controls", async ({ page }, testInfo) => {
  const totals = { openingBalanceMinor: 1000, creditsMinor: 500, debitsMinor: 200, closingBalanceMinor: 1300, currentBalanceMinor: 1300, heldMinor: 100, availableMinor: 1200 };
  await page.route("**/api/finance/financial-statements?**", (route) => route.fulfill({ status: 200, json: { summaries: [{ ...totals, actorType: "partner", actorId: "presentation-partner", displayName: "شريك كشف العرض", beneficiaryName: "شريك كشف العرض", phoneMasked: "***123", walletIdentifierMasked: "***456", currency: "YER" }], totals, nextCursor: "" } }));
  await page.goto("/finance/beneficiary-settlement/partners?view=reconciliation");
  await page.getByLabel("كشف الحساب من", { exact: true }).fill("2026-10-01");
  await page.getByLabel("إلى", { exact: true }).fill("2026-10-10");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "تنزيل تقرير الشركاء بصيغة CSV (يفتح في Excel)", exact: true }).click();
  await download;
  const report = page.locator("#partner-period-register-print");
  await expect(report).toBeHidden();
  // A long underlying work surface must not produce blank printed pages.
  await page.locator(".beneficiary-settlement-workspace").evaluate((element) => {
    const table = document.createElement("table");
    for (let index = 0; index < 200; index++) table.insertRow().insertCell().textContent = `سجل خارج التقرير ${index}`;
    element.append(table);
  });
  await page.evaluate(() => { window.print = () => {}; });
  await page.getByRole("button", { name: "طباعة التقرير الدوري", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("شريك كشف العرض");
  await expect(page.locator(".workspace-header")).toHaveCSS("visibility", "hidden");
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await testInfo.attach("period-report.pdf", { body: pdf, contentType: "application/pdf" });
  expect([...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)]).toHaveLength(1);
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubPresentationReads(page);
});

for (const [device, viewport] of [["desktop", { width: 1368, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`visual baseline: store registry ${device} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto("/partners/stores");
      await expect(page.locator(".store-registry tbody tr")).toHaveCount(10);
      await expect(page.getByRole("heading", { name: "المتاجر", level: 1, exact: true })).toBeVisible();
      await expect(page).toHaveScreenshot(`store-registry-${device}-${theme}.png`, { animations: "disabled" });
    });
  }
}

test("store registry geometry is stable on direct load, client navigation and reload", async ({ page }) => {
  const registry = page.locator(".store-registry");
  const readGeometry = () => registry.evaluate((element) => {
    const toolbar = element.querySelector<HTMLElement>(".store-registry-toolbar")!;
    const form = element.querySelector<HTMLFormElement>(".store-registry-search-form")!;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    return { toolbarDisplay: getComputedStyle(toolbar).display, formDisplay: getComputedStyle(form).display,
      buttonWidth: button.getBoundingClientRect().width, buttonHeight: button.getBoundingClientRect().height,
      toolbarWidth: toolbar.getBoundingClientRect().width };
  });
  await page.goto("/partners/stores");
  await expect(registry.locator("tbody tr")).toHaveCount(10);
  const direct = await readGeometry();
  expect(direct.buttonWidth).toBeLessThan(160);
  expect(direct.buttonWidth).toBeLessThan(direct.toolbarWidth / 3);
  expect(direct.buttonHeight).toBeLessThanOrEqual(44);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  await navigation.getByRole("link", { name: "العمليات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "العمليات", exact: true, level: 1 })).toBeVisible();
  await navigation.getByRole("link", { name: "الشركاء", exact: true }).click();
  await navigation.getByRole("link", { name: "المتاجر", exact: true }).click();
  await expect(registry.locator("tbody tr")).toHaveCount(10);
  expect(await readGeometry()).toEqual(direct);
  await page.reload();
  await expect(registry.locator("tbody tr")).toHaveCount(10);
  expect(await readGeometry()).toEqual(direct);
});

test("settlement controls marked hidden stay hidden after visiting other finance pages", async ({ page }) => {
  const assertHidden = async () => {
    const hidden = page.locator("#workspace-main [hidden]");
    expect(await hidden.count()).toBeGreaterThan(0);
    for (const element of await hidden.all()) await expect(element).toBeHidden();
    expect(await hidden.evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).display !== "none").length)).toBe(0);
  };
  await page.goto("/finance/beneficiary-settlement/partners?view=reconciliation");
  await expect(page.locator("#statement-file")).toBeVisible();
  await assertHidden();
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  await navigation.getByRole("link", { name: "حفظ النقد", exact: true }).click();
  await expect(page.getByRole("heading", { name: "حفظ النقد", exact: true, level: 1 })).toBeVisible();
  await navigation.getByRole("link", { name: "مستحقات الشركاء", exact: true }).click();
  await expect(page.getByRole("heading", { name: "مستحقات الشركاء", exact: true, level: 1 })).toBeVisible();
  await assertHidden();
});

test("only the current center owns one visible child navigation", async ({ page }) => {
  for (const [path, center, child] of [
    ["/partners/stores", "الشركاء", "المتاجر"],
    ["/finance/cash-custody", "المالية", "حفظ النقد"],
    ["/catalog/products", "الكتالوج", "المنتجات"],
  ] as const) {
    await page.goto(path!);
    const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
    const children = navigation.locator(".workspace-nav-children");
    await expect(children).toHaveCount(1);
    await expect(children).toHaveAttribute("aria-label", `مسارات ${center}`);
    await expect(children.getByRole("link", { name: child, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(navigation.getByRole("link", { name: center, exact: true })).toHaveAttribute("aria-current", "location");
    await expect(page.locator("#workspace-main .workspace-route-tabs")).toHaveCount(0);
    await expect(page.locator("#workspace-main .page-header")).toHaveCount(1);
  }
});

test("populated mobile tables scroll inside their wrapper without widening the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, wrapper] of [["/partners/stores", ".store-registry-table-wrap"], ["/catalog/products", ".catalog-registry-table-wrap"]]) {
    await page.goto(path!);
    const tableWrapper = page.locator(wrapper!);
    await expect(tableWrapper.locator("tbody tr")).toHaveCount(10);
    await expectNoOuterOverflow(page);
    const dimensions = await tableWrapper.evaluate((element) => ({
      width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth, overflow: getComputedStyle(element).overflowX,
    }));
    expect(dimensions.width).toBeLessThanOrEqual(390);
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    expect(["auto", "scroll"]).toContain(dimensions.overflow);
  }
});

test("a full product page stays bounded with readable headings and keyboard-reachable last rows", async ({ page }) => {
  const fullPage = Array.from({ length: 50 }, (_, index) => ({ ...products[index % products.length], id: `bounded-product-${index}`, canonicalName: `منتج مقيد ${index + 1}` }));
  await page.route("**/api/catalog/product-registry?**", (route) => route.fulfill({ status: 200, json: { products: fullPage, nextCursor: "bounded-next-page" } }));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/catalog/products");
    const wrapper = page.locator(".catalog-registry-table-wrap");
    await expect(wrapper.locator("tbody tr")).toHaveCount(50);
    const dimensions = await wrapper.evaluate((element) => ({ height: element.getBoundingClientRect().height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(dimensions.height).toBeLessThanOrEqual(viewport.height * 0.7 + 1);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    const lastCheckbox = wrapper.getByRole("checkbox", { name: "تحديد منتج مقيد 50", exact: true });
    await lastCheckbox.focus();
    await lastCheckbox.press("Space");
    await expect(lastCheckbox).toBeChecked();
    const bounds = await wrapper.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const heading = element.querySelector("thead")!.getBoundingClientRect();
      const target = element.querySelector("tbody tr:last-child input")!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, headingTop: heading.top, headingBottom: heading.bottom, targetTop: target.top, targetBottom: target.bottom, scrollTop: element.scrollTop };
    });
    expect(bounds.scrollTop).toBeGreaterThan(0);
    expect(bounds.headingTop).toBeGreaterThanOrEqual(bounds.top);
    expect(bounds.headingTop).toBeLessThanOrEqual(bounds.top + 2);
    expect(bounds.targetTop).toBeGreaterThanOrEqual(bounds.headingBottom);
    expect(bounds.targetBottom).toBeLessThanOrEqual(bounds.bottom);
    await expect(page.getByRole("navigation", { name: "صفحات المنتجات", exact: true }).getByRole("button", { name: "التالي", exact: true })).toBeEnabled();
    await expectNoOuterOverflow(page);
  }
});

test("mobile partner and captain forms fit the page and open only on demand", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners/new");
  await expect(page.getByLabel("اسم المالك الكامل")).toBeVisible();
  await expectNoOuterOverflow(page);
  await page.goto("/captains");
  const create = page.locator("details.create-disclosure");
  await expect(create.locator("#captain-candidate-name")).toBeHidden();
  await create.locator("summary").click();
  await expect(create.locator("#captain-candidate-name")).toBeVisible();
  await expectNoOuterOverflow(page);
});
