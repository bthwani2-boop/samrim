import { expect, type Page, test } from "./coverage-fixtures";

const identity = { subject: "reference-proof", sessionId: "reference-session", role: "operator", permissions: ["operations", "partners", "catalog", "marketing", "finance", "platform_policies"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" };
const wallets = Array.from({ length: 50 }, (_, index) => ({ key: `wallet-${index}`, displayNameAr: `محفظة ${index + 1}`, active: true, version: 7 }));
async function shell(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const data: Record<string, unknown> = {
      "/api/auth/session": { identity }, "/api/notifications": { notifications: [], unreadCount: 0, nextCursor: "" },
      "/api/wallet-providers": { walletProviders: wallets }, "/api/service-cities": { cities: [] },
      "/api/finance/cash-custody": { items: [], totalItems: 0, totalAmountMinor: 0, nextCursor: "" },
      "/api/marketing/promotions": { promotions: [] },
    };
    return route.fulfill({ status: Object.hasOwn(data, path) ? 200 : 404, json: data[path] ?? { error: { message: "Unconfigured fixture" } } });
  });
}
test.beforeEach(async ({ page }) => { await shell(page); });

test("automatic return reads retain reference drafts and pause while renaming", async ({ page }) => {
  await page.clock.install();
  let reads = 0;
  await page.route("**/api/wallet-providers**", (route) => {
    reads++;
    return route.fulfill({ json: { walletProviders: [wallets[0]!] } });
  });
  await page.goto("/policies?policy=wallet-providers&action=manage");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  const initialReads = reads;
  await page.locator("details.create-disclosure > summary").click();
  await page.getByLabel("اسم المحفظة بالعربية").fill("محفظة مسودة");
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(initialReads + 1);
  await expect(page.getByLabel("اسم المحفظة بالعربية")).toHaveValue("محفظة مسودة");
  await page.locator("tbody tr").getByRole("button", { name: "تعديل", exact: true }).click();
  const rename = page.getByLabel("اسم المزوّد", { exact: true });
  await rename.fill("اسم غير محفوظ");
  const beforeRenameReturn = reads;
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rename).toHaveValue("اسم غير محفوظ");
  expect(reads).toBe(beforeRenameReturn);
});

test("resource centers open their canonical work surface without repeated navigation cards", async ({ page }) => {
  for (const [center, heading] of [["finance", "المالية"], ["marketing", "التسويق والمحتوى"], ["policies", "سياسات المنصة"]] as const) {
    await page.goto(`/${center}`);
    await expect(page).toHaveURL(new RegExp(`/${center}$`));
    await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
    await expect(page.locator("#workspace-main .resource-index, #workspace-main .resource-link")).toHaveCount(0);
    await expect(page.locator("#workspace-main h1")).toHaveCount(1);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/${center}$`));
  }
});

test("reference rows stay bounded at desktop and mobile sizes and editing restores keyboard focus", async ({ page }) => {
  for (const width of [1368, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/policies?policy=wallet-providers&action=manage");
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await expect(page.getByLabel("اسم المحفظة بالعربية")).toBeHidden();
    await expect(page.locator("tbody input")).toHaveCount(0);
    const first = page.locator("tbody tr").first();
    const columns = await page.locator("thead th").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    const edit = first.getByRole("button", { name: "تعديل", exact: true });
    await edit.click();
    const input = first.getByLabel("اسم المزوّد");
    await expect(input).toBeFocused();
    await expect(page.locator("tbody input")).toHaveCount(1);
    expect(await page.locator("thead th").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width))).toEqual(columns);
    expect((await input.boundingBox())!.width).toBeLessThanOrEqual(320);
    await input.press("Escape");
    await expect(edit).toBeFocused();
    const bounds = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, table: document.querySelector(".table-wrap")!.getBoundingClientRect().height }));
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.table).toBeLessThanOrEqual(631);
    await page.locator("details.create-disclosure > summary").click();
    expect((await page.locator(".compact-form").boundingBox())!.width).toBeLessThanOrEqual(480);
  }
});

test("reference search and status filters show a precise subset and reset without mutations", async ({ page }) => {
  let mutations = 0;
  const records = [{ key: "sanaa", id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1 }, { key: "aden", id: "aden", displayNameAr: "عدن", active: false, version: 1 }];
  for (const [resource, property] of [["wallet-providers", "walletProviders"], ["service-cities", "cities"]] as const) {
    await page.route(`**/api/${resource}**`, (route) => {
      if (route.request().method() !== "GET") mutations++;
      return route.fulfill({ status: 200, json: { [property]: records } });
    });
    await page.goto(`/policies?policy=${resource}&action=manage`);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    const search = page.getByRole("searchbox");
    await search.fill("عدن");
    await expect(page.locator("tbody th")).toHaveText("عدن");
    await page.locator("search select").selectOption("active");
    await expect(page.locator("tbody")).toContainText(resource === "wallet-providers" ? "لا توجد محافظ مطابقة." : "لا توجد مدن مطابقة.");
    await expect(page.locator("search ~ .muted")).toContainText("0 من 2");
    await page.getByRole("button", { name: "مسح المرشحات", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.locator("search select").selectOption("inactive");
    await expect(page.locator("tbody th")).toHaveText("عدن");
  }
  expect(mutations).toBe(0);
});

test("a filtered edit stays visible across conflict refresh and returns focus when its saved name leaves the filter", async ({ page }) => {
  let current = { ...wallets[0]! };
  let attempts = 0;
  await page.route("**/api/wallet-providers**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { walletProviders: [current] } });
    attempts++;
    current = { ...current, displayNameAr: attempts === 1 ? "اسم متزامن" : "الاسم الجديد", version: current.version + 1 };
    return route.fulfill(attempts === 1 ? { status: 409, json: { error: { code: "VERSION_CONFLICT" } } } : { status: 200, json: { walletProvider: current } });
  });
  await page.goto("/policies?policy=wallet-providers&action=manage");
  const search = page.getByRole("searchbox");
  await search.fill("محفظة 1");
  await page.getByRole("button", { name: "تعديل", exact: true }).click();
  await expect(search).toBeDisabled();
  const editor = page.getByLabel("اسم المزوّد");
  await editor.fill("الاسم الجديد");
  await editor.press("Enter");
  await expect(page.locator("#workspace-main").getByRole("alert")).toContainText("تعذر تحديث الاسم");
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(editor).toHaveValue("الاسم الجديد");
  await expect(page.getByRole("button", { name: "حفظ الاسم", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "حفظ الاسم", exact: true }).click();
  await expect(page.locator("tbody")).toContainText("لا توجد محافظ مطابقة.");
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "مسح المرشحات", exact: true }).click();
  await expect(page.locator("tbody th")).toHaveText("الاسم الجديد");
});

test("a conflicting wallet edit keeps its draft and a successful retry reads the canonical version", async ({ page }) => {
  let current = { ...wallets[0]! };
  const attempts: { version: string | undefined; body: unknown }[] = [];
  await page.route("**/api/wallet-providers**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { walletProviders: [current] } });
    attempts.push({ version: route.request().headers()["x-expected-version"], body: route.request().postDataJSON() });
    if (attempts.length === 1) {
      current = { ...current, displayNameAr: "اسم من موظف آخر", version: 8 };
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    }
    current = { ...current, displayNameAr: "محفظة معتمدة", version: 9 };
    return route.fulfill({ status: 200, json: { walletProvider: current } });
  });
  await page.goto("/policies?policy=wallet-providers&action=manage");
  await page.getByRole("button", { name: "تعديل", exact: true }).click();
  const input = page.getByLabel("اسم المزوّد");
  await input.fill("محفظة معتمدة"); await input.press("Enter");
  await expect(page.locator("#workspace-main").getByRole("alert")).toContainText("تعذر تحديث الاسم");
  await expect(input).toHaveValue("محفظة معتمدة");
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(page.getByRole("button", { name: "حفظ الاسم", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("محفظة معتمدة");
  await page.getByRole("button", { name: "حفظ الاسم", exact: true }).click();
  await expect(page.locator("tbody th")).toHaveText("محفظة معتمدة");
  await expect(page.getByRole("button", { name: "تعديل", exact: true })).toBeFocused();
  expect(current.key).toBe("wallet-0");
  expect(attempts).toEqual(["7", "8"].map((version) => ({ version, body: { displayNameAr: "محفظة معتمدة", active: true } })));
});

test("city read failure never presents a false empty registry and uncertain creation reuses its attempt", async ({ page }) => {
  let readFailed = true;
  let created = false;
  const keys: string[] = [];
  await page.route("**/api/service-cities**", (route) => {
    if (route.request().method() === "GET") return route.fulfill(readFailed ? { status: 503, json: {} } : { status: 200, json: { cities: created ? [{ id: "city-proof", displayNameAr: "صنعاء", active: true, version: 1 }] : [] } });
    keys.push(route.request().headers()["idempotency-key"]!);
    if (keys.length === 1) return route.fulfill({ status: 503, json: {} });
    created = true;
    return route.fulfill({ status: 201, json: { city: { id: "city-proof", displayNameAr: "صنعاء", active: true, version: 1 } } });
  });
  await page.goto("/policies?policy=service-cities&action=manage");
  await expect(page.locator("#workspace-main").getByRole("alert")).toContainText("تعذر قراءة المدن");
  await expect(page.getByText("لا توجد مدن بعد.", { exact: true })).toHaveCount(0);
  readFailed = false;
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(page.getByText("لا توجد مدن بعد.", { exact: true })).toBeVisible();
  await page.locator("details.create-disclosure > summary").click();
  await page.getByLabel("الاسم العربي", { exact: true }).fill("صنعاء");
  await page.getByRole("button", { name: "إضافة مدينة", exact: true }).click();
  await expect(page.locator("#workspace-main").getByRole("alert")).toContainText("تعذر حفظ المدينة");
  await page.getByRole("button", { name: "إضافة مدينة", exact: true }).click();
  await expect(page.locator("tbody th")).toHaveText("صنعاء");
  expect(keys).toHaveLength(2); expect(keys[0]).toBeTruthy(); expect(keys[1]).toBe(keys[0]);
});

test("uncertain wallet creation reuses its key and status changes carry the current version", async ({ page }) => {
  let provider: typeof wallets[number] | null = null;
  const creationKeys: string[] = [];
  let update: { version: string | undefined; body: unknown } | undefined;
  await page.route("**/api/wallet-providers**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { walletProviders: provider ? [provider] : [] } });
    if (route.request().method() === "POST") {
      creationKeys.push(route.request().headers()["idempotency-key"]!);
      if (creationKeys.length === 1) return route.fulfill({ status: 503, json: {} });
      provider = { key: "created-wallet", displayNameAr: "محفظة اختبار", active: true, version: 4 };
      return route.fulfill({ status: 201, json: { walletProvider: provider } });
    }
    update = { version: route.request().headers()["x-expected-version"], body: route.request().postDataJSON() };
    provider = { ...provider!, active: false, version: 5 };
    return route.fulfill({ status: 200, json: { walletProvider: provider } });
  });
  await page.goto("/policies?policy=wallet-providers&action=manage");
  await page.locator("details.create-disclosure > summary").click();
  await page.getByLabel("اسم المحفظة بالعربية").fill("محفظة اختبار");
  await page.getByRole("button", { name: "إضافة محفظة", exact: true }).click();
  await expect(page.locator("#workspace-main").getByRole("alert")).toContainText("تعذرت إضافة");
  await page.getByRole("button", { name: "إضافة محفظة", exact: true }).click();
  await expect(page.locator("tbody th")).toHaveText("محفظة اختبار");
  expect(creationKeys).toHaveLength(2); expect(creationKeys[0]).toBeTruthy(); expect(creationKeys[1]).toBe(creationKeys[0]);
  await page.getByRole("button", { name: "تعطيل", exact: true }).click();
  await expect(page.locator("tbody").getByRole("img", { name: /متوقف/ })).toBeVisible();
  expect(update).toEqual({ version: "4", body: { displayNameAr: "محفظة اختبار", active: false } });
});

test("an operator without policy authority cannot expose reference records or mutation controls", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 200, json: { identity: { ...identity, permissions: ["partners"] } } }));
  await page.goto("/policies?policy=wallet-providers&action=manage");
  await expect(page.locator("#workspace-main")).toContainText("الوصول إلى هذه المساحة غير مفعّل");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.locator("tbody button, .create-disclosure")).toHaveCount(0);
});
