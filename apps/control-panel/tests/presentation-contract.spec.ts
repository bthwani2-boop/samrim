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
  fulfillmentModes: ["BTHWANI_CAPTAIN"], updatedAt: "2026-10-01T12:00:00Z",
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
      "/api/partners/registry": { rows: stores.map((store) => ({ kind: "store", store, partnerRole: null })), nextCursor: "presentation-next-page" },
      "/api/partners": { partners: [], nextCursor: "" },
      "/api/partners/roster": { items: [], nextCursor: "" },
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
      await page.goto("/partners");
      // Linux runner and local Docker use different system-ui font aliases.
      // Pin a packaged Arabic-capable font for comparable Linux rendering.
      if (process.platform === "linux") await page.addStyleTag({ content: 'body { font-family: "FreeSerif", serif !important; }' });
      await expect(page.locator(".store-registry tbody tr")).toHaveCount(10);
      await expect(page.getByRole("heading", { name: "الشركاء والمتاجر", level: 1, exact: true })).toBeVisible();
      // Reviewed compact indicators and mobile cards use platform-specific baselines.
      await expect(page).toHaveScreenshot(`store-registry-${device}-${theme}.png`, { animations: "disabled", maxDiffPixels: 256 });
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
  await page.goto("/partners");
  await expect(registry.locator("tbody tr")).toHaveCount(10);
  const direct = await readGeometry();
  expect(direct.buttonWidth).toBeLessThan(160);
  expect(direct.buttonWidth).toBeLessThan(direct.toolbarWidth / 3);
  expect(direct.buttonHeight).toBeLessThanOrEqual(44);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  await navigation.getByRole("link", { name: "العمليات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "العمليات", exact: true, level: 1 })).toBeVisible();
  await navigation.getByRole("link", { name: "الشركاء", exact: true }).click();
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
  await navigation.getByRole("link", { name: "المستحقات والتسويات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "المستحقات والتسويات", exact: true, level: 1 })).toBeVisible();
  await assertHidden();
});

test("partners have one store-first directory and one approvals workspace", async ({ page }) => {
  await page.goto("/partners");
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  const children = navigation.locator(".workspace-nav-children");
  const registry = children.getByRole("link", { name: "الشركاء والمتاجر", exact: true });
  const approvals = children.getByRole("link", { name: "الطلبات والاعتمادات", exact: true });
  await expect(children.getByRole("link")).toHaveCount(3);
  await expect(children.getByRole("link", { name: "الميداني", exact: true })).toHaveAttribute("href", "/fields");
  await expect(registry).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "الشركاء والمتاجر", level: 1 })).toBeVisible();
  await expect(page.locator(".store-registry tbody tr")).toHaveCount(10);
  await expect(page.locator(".store-registry tbody tr").first().getByRole("link", { name: "شريك العرض" })).toHaveAttribute("href", "/partners/actors/presentation-partner-0");

  await expect(page.getByRole("link", { name: "حسابات الشركاء", exact: true })).toHaveCount(0);
  await page.locator("#partner-registry-mode").selectOption("without_store");
  await expect(page).toHaveURL(/mode=without_store/);
  await page.goto("/partners");
  await expect(registry).toHaveAttribute("aria-current", "page");

  await approvals.click();
  await expect(page).toHaveURL(/\/partners\/joining$/);
  await expect(approvals).toHaveAttribute("aria-current", "page");
  const requestViews = page.getByRole("navigation", { name: "نوع الطلب أو الاعتماد" });
  await expect(requestViews.getByRole("link", { name: "طلبات الانضمام" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "طلب انضمام جديد" })).toHaveAttribute("href", "/partners/new");
  await requestViews.getByRole("link", { name: "اعتمادات الوصول" }).click();
  await expect(page).toHaveURL(/\/partners\/store-access$/);
  await expect(approvals).toHaveAttribute("aria-current", "page");
  await expect(requestViews.getByRole("link", { name: "اعتمادات الوصول" })).toHaveAttribute("aria-current", "page");
});
test("partner with two stores has two rows; identical business name is not repeated", async ({ page }) => {
  await page.route("**/api/partners/registry?**", (route) => route.fulfill({
    json: {
      rows: [
        { kind: "store", store: { ...stores[0], id: "same-name", name: "متجر واحد", partnerName: "متجر واحد", partnerActorId: "shared-partner" }, partnerRole: null },
        { kind: "store", store: { ...stores[1], id: "second-store", name: "متجر ثان", partnerName: "متجر واحد", partnerActorId: "shared-partner" }, partnerRole: null },
      ],
      nextCursor: "",
    },
  }));
  await page.goto("/partners");
  const rows = page.locator(".store-registry tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole("link", { name: "متجر واحد" })).toHaveCount(1);
  await expect(rows.nth(0).getByRole("link", { name: "ملف الشريك" })).toHaveAttribute("href", "/partners/actors/shared-partner");
  await expect(rows.nth(1).getByRole("link", { name: "متجر واحد" })).toHaveAttribute("href", "/partners/actors/shared-partner");
});

test("legacy store registry link preserves public filters on canonical partner registry", async ({ page }) => {
  await page.goto("/partners/stores?state=published&sort=updated_asc");
  await expect(page).toHaveURL(/\/partners\?state=published&sort=updated_asc$/);
  await expect(page.getByRole("heading", { name: "الشركاء والمتاجر", level: 1 })).toBeVisible();
  await expect(page.locator("#partner-store-publication-filter")).toHaveValue("published");
});
test("finance settlement groups three existing scopes without merging their routes", async ({ page }) => {
  await page.goto("/finance/beneficiary-settlement/partners");
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  const financeChildren = navigation.locator(".workspace-nav-children");
  await expect(financeChildren.getByRole("link", { name: "المستحقات والتسويات" })).toHaveAttribute("aria-current", "page");
  await expect(financeChildren.getByRole("link", { name: "مستحقات الكباتن" })).toHaveCount(0);
  const scopes = page.getByRole("navigation", { name: "نوع المستفيد" });
  await expect(scopes.getByRole("link", { name: "الشركاء" })).toHaveAttribute("aria-current", "page");
  await scopes.getByRole("link", { name: "الكباتن" }).click();
  await expect(page).toHaveURL(/\/finance\/beneficiary-settlement\/captains$/);
  await expect(scopes.getByRole("link", { name: "الكباتن" })).toHaveAttribute("aria-current", "page");
  await scopes.getByRole("link", { name: "الميدان" }).click();
  await expect(page).toHaveURL(/\/finance\/beneficiary-settlement\/field$/);
  await expect(scopes.getByRole("link", { name: "الميدان" })).toHaveAttribute("aria-current", "page");
  await page.goto("/finance/partner-earnings");
  await expect(page).toHaveURL(/\/finance\/beneficiary-settlement\/partners$/);
});

test("only the current center owns one visible child navigation", async ({ page }) => {
  for (const [path, center, child] of [
    ["/partners", "الشركاء", "الشركاء والمتاجر"],
    ["/fields", "الشركاء", "الميداني"],
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

test("compact phone header keeps the page title and keyboard navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners");
  await expect(page.locator(".workspace-actor-context")).toBeHidden();
  await expect(page.getByRole("heading", { name: "الشركاء والمتاجر", exact: true, level: 1 })).toBeVisible();

  const toggle = page.getByRole("button", { name: "فتح مسارات العمل" });
  const navigation = page.locator("#workspace-navigation");
  await expect(navigation).toBeHidden();
  await toggle.click();
  await expect(navigation).toHaveAttribute("data-open", "true");
  await expect(navigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveAttribute("data-open", "false");
  await expect(navigation).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("mobile store cards and catalog overflow keep their records inside the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners/stores");
  await expect(page.locator(".store-registry-mobile > li")).toHaveCount(10);
  await expect(page.locator(".store-registry-mobile")).toBeVisible();
  await expect(page.locator(".store-registry-table-wrap")).toBeHidden();
  await expectNoOuterOverflow(page);
  for (const [path, wrapper] of [["/catalog/products", ".catalog-registry-table-wrap"]]) {
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

test("operator can collapse desktop navigation to icons without losing field or partner routes", async ({ page }) => {
  await stubPresentationReads(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/partners");
  const layout = page.locator(".workspace-layout");
  const compact = page.getByRole("button", { name: "تصغير الشريط الجانبي" });
  await expect(compact).toBeVisible();
  await compact.click();
  await expect(layout).toHaveAttribute("data-nav-compact", "true");
  const nav = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  await expect(nav.getByRole("link", { name: "الشركاء" , exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "الميداني", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "الشركاء والمتاجر", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "توسيع الشريط الجانبي" })).toBeVisible();
  await page.reload();
  await expect(layout).toHaveAttribute("data-nav-compact", "true");
  await page.getByRole("button", { name: "توسيع الشريط الجانبي" }).click();
  await expect(layout).toHaveAttribute("data-nav-compact", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "تصغير الشريط الجانبي" })).toBeHidden();
  await page.getByRole("button", { name: "فتح مسارات العمل" }).click();
  await expect(nav.getByRole("link", { name: "الشركاء والمتاجر", exact: true })).toBeVisible();
  await expectNoOuterOverflow(page);
});

test("operator may choose compact table density without changing mobile touch spacing", async ({ page }) => {
  await stubPresentationReads(page);
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/partners");
  const layout = page.locator(".workspace-layout");
  await expect(layout).toHaveAttribute("data-table-density", "comfortable");
  const button = page.getByRole("button", { name: "تكثيف صفوف الجداول" });
  await button.click();
  await expect(layout).toHaveAttribute("data-table-density", "compact");
  await expect(page.getByRole("button", { name: "عرض الصفوف المريح" })).toBeVisible();
  const compactPadding = await page.locator(".operations-table tbody td").first().evaluate((cell) => getComputedStyle(cell).paddingTop);
  await page.reload();
  await expect(layout).toHaveAttribute("data-table-density", "compact");
  await page.getByRole("button", { name: "عرض الصفوف المريح" }).click();
  const comfortablePadding = await page.locator(".operations-table tbody td").first().evaluate((cell) => getComputedStyle(cell).paddingTop);
  expect(parseFloat(compactPadding)).toBeLessThan(parseFloat(comfortablePadding));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "تكثيف صفوف الجداول" })).toBeHidden();
  await expectNoOuterOverflow(page);
});
