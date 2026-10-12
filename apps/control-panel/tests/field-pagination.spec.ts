import { expect, test } from "./coverage-fixtures";

test("Field registry replaces cursor pages and restores query and city on browser navigation", async ({ page }) => {
  // Includes reload, repeated navigation and failure recovery; assertion timeouts stay at five seconds.
  test.setTimeout(60_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: { subject: "actor-operator", sessionId: "session-operator", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } }) }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "city-a", displayNameAr: "مدينة أ", active: true, version: 1 }, { id: "city-b", displayNameAr: "مدينة ب", active: true, version: 1 }] }) }));
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ walletProviders: [{ key: "wallet-a", displayNameAr: "محفظة أ", active: true, version: 1 }] }) }));
  const admission = (id: string, fullNameAr: string) => ({ kind: "candidate", admission: { id, fullNameAr, contactPhoneE164: "+967770020001", walletProviderKey: "wallet-a", allServiceCities: true, serviceCityIds: [], state: "pending_review", version: 1 } });
  const requests: URLSearchParams[] = [];
  const privatePhone = "770020001";
  const secondCursor = Buffer.from(`phone_asc|+967${privatePhone}|second`).toString("base64url");
  const thirdCursor = Buffer.from(`phone_asc|+967${privatePhone}|third`).toString("base64url");
  let failSecondPage = false;
  await page.route("**/api/fields?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const cursor = params.get("cursor");
    if (cursor === secondCursor && failSecondPage) return route.fulfill({ status: 503, json: { error: { message: "تعذرت قراءة الصفحة التالية." } } });
    const items = cursor === secondCursor ? [] : [admission(cursor === thirdCursor ? "third" : "first", cursor === thirdCursor ? "الميداني الثالث" : "الميداني الأول")];
    const nextCursor = !cursor ? secondCursor : cursor === secondCursor ? thirdCursor : undefined;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, nextCursor }) });
  });

  await page.goto("/fields?serviceCityId=city-a");
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();
  await page.getByLabel("بحث بالهاتف").fill(privatePhone);
  await expect.poll(() => requests.at(-1)?.get("q")).toBe(privatePhone);
  await expect(page.getByRole("button", { name: "تحديث السجل", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/fields\?serviceCityId=city-a$/);
  await page.getByRole("button", { name: "التالية", exact: true }).click();
  await expect(page).toHaveURL(/fieldPage=2/);
  expect(page.url()).not.toContain(privatePhone);
  expect(page.url()).not.toContain(secondCursor);
  await expect(page.getByText("لا توجد نتائج في هذه الصفحة")).toBeVisible();
  await expect(page.getByText("الميداني الأول", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "التالية", exact: true }).click();
  await expect(page.getByText("الميداني الثالث", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "التالية", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByText("الميداني الثالث", { exact: true })).toBeVisible();
  await expect(page.getByLabel("بحث بالهاتف")).toHaveValue(privatePhone);
  expect(requests.at(-1)?.get("cursor")).toBe(thirdCursor);
  await page.getByRole("button", { name: "السابقة", exact: true }).click();
  await expect(page).toHaveURL(/fieldPage=2/);
  await expect(page.getByText("لا توجد نتائج في هذه الصفحة")).toBeVisible();
  await page.getByRole("button", { name: "السابقة", exact: true }).click();
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "السابقة", exact: true })).toBeDisabled();

  await page.locator(".field-roster-filter-disclosure > summary").click();
  await page.getByRole("combobox", { name: "مدينة الخدمة", exact: true }).selectOption("city-b");
  await expect(page).toHaveURL(/serviceCityId=city-b/);
  await page.getByRole("button", { name: "التالية", exact: true }).click();
  await expect(page.getByText("لا توجد نتائج في هذه الصفحة")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "مدينة الخدمة", exact: true })).toHaveValue("city-b");
  expect(requests.every((params) => params.get("limit") === "25")).toBe(true);
  expect(requests.at(-1)?.get("q")).toBe(privatePhone);
  expect(requests.at(-1)?.get("serviceCityId")).toBe("city-b");

  failSecondPage = true;
  await page.getByRole("button", { name: "التالية", exact: true }).click();
  await expect(page.locator(".field-workbench-pane > p.identity-error[role=alert]")).toHaveText("تعذر إكمال طلب الميدانيين الآن. أعد المحاولة لاحقًا.");
  await expect(page.getByText("الميداني الأول", { exact: true })).toHaveCount(0);
  await expect(page.getByText("لا توجد نتائج في هذه الصفحة")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "التالية", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "السابقة", exact: true })).toBeEnabled();
  failSecondPage = false;
  await page.getByRole("button", { name: "تحديث السجل", exact: true }).click();
  await expect(page.getByText("لا توجد نتائج في هذه الصفحة")).toBeVisible();
  await page.getByRole("button", { name: "السابقة", exact: true }).click();
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();

  await page.getByLabel("بحث بالهاتف").fill("");
  await page.getByRole("combobox", { name: "مدينة الخدمة", exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "تحديث السجل", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "مزوّد المحفظة", exact: true }).selectOption("wallet-a");
  await page.getByRole("button", { name: "مسح البحث والمرشحات", exact: true }).click();
  await expect(page.getByRole("button", { name: "تحديث السجل", exact: true })).toBeEnabled();
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();

  // A copied URL has no private tab history: its public page marker safely returns to page one.
  await page.goto("/fields?serviceCityId=city-a&fieldPage=3");
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();
  await expect(page.getByLabel("بحث بالهاتف")).toHaveValue("");
  await expect(page).toHaveURL(/\/fields\?serviceCityId=city-a$/);
  expect(requests.at(-1)?.get("cursor")).toBeNull();
  expect(requests.at(-1)?.get("q")).toBe("");

  // Clearing search on page two creates a first-page entry identical to the original entry.
  await page.getByRole("button", { name: "التالية", exact: true }).click();
  await expect(page.getByText("لا توجد نتائج في هذه الصفحة")).toBeVisible();
  await page.getByLabel("بحث بالهاتف").fill(privatePhone);
  await expect.poll(() => requests.at(-1)?.get("q")).toBe(privatePhone);
  await expect(page.getByRole("button", { name: "تحديث السجل", exact: true })).toBeEnabled();
  await page.getByLabel("بحث بالهاتف").fill("");
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();
  const requestsBeforeBack = requests.length;
  await page.goBack();
  await expect.poll(() => requests.length).toBeGreaterThan(requestsBeforeBack);
  await expect(page.getByText("الميداني الأول", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "تحديث السجل", exact: true })).toBeEnabled();
  await expect(page.getByLabel("بحث بالهاتف")).toHaveValue("");
  expect(requests.at(-1)?.get("q")).toBe("");
  expect(requests.at(-1)?.get("cursor")).toBeNull();
});

test("Field access filter applies before paging and survives reload and browser navigation", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: { subject: "actor-operator", sessionId: "session-operator", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ status: 200, json: { cities: [{ id: "city-a", displayNameAr: "مدينة أ", active: true, version: 1 }] } }));
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ status: 200, json: { walletProviders: [{ key: "wallet-a", displayNameAr: "محفظة أ", active: true, version: 1 }] } }));
  const admission = (id: string, name: string) => ({ id, fullNameAr: name, contactPhoneE164: "+967770020001", walletProviderKey: "wallet-a", allServiceCities: true, serviceCityIds: [], state: "eligible", version: 1 });
  const candidate = { kind: "candidate", admission: { ...admission("candidate", "مرشح للمراجعة"), state: "pending_review" } };
  const account = (id: string, name: string) => ({ kind: "account", account: { actorId: id, role: "field", phoneE164: "+967770000001", enabled: false, securityEnabled: true, admission: admission(id, name), latestStore: null, joiningCaseCount: 0, latestJoiningCase: null } });
  const requests: URLSearchParams[] = [];
  const nextToken = "identity-disabled-next";
  await page.route("**/api/fields?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    if (params.get("enabled") === "false") {
      const isNext = params.get("cursor") === nextToken;
      return route.fulfill({ status: 200, json: { items: [isNext ? account("disabled-b", "ميداني موقوف ثانٍ") : account("disabled-a", "ميداني موقوف أول")], nextCursor: isNext ? undefined : nextToken } });
    }
    return route.fulfill({ status: 200, json: { items: [candidate] } });
  });
  await page.goto("/fields");
  await expect(page.getByText("مرشح للمراجعة", { exact: true })).toBeVisible();
  await page.locator(".field-roster-filter-disclosure > summary").click();
  const access = page.getByRole("combobox", { name: "دخول التطبيق", exact: true });
  await access.selectOption("disabled");
  await expect(page.getByText("ميداني موقوف أول", { exact: true })).toBeVisible();
  await expect(page.getByText("مرشح للمراجعة", { exact: true })).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.get("enabled")).toBe("false");
  await page.getByRole("button", { name: "التالية", exact: true }).click();
  await expect(page.getByText("ميداني موقوف ثانٍ", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/fieldPage=2/);
  await page.reload();
  await expect(page.getByText("ميداني موقوف ثانٍ", { exact: true })).toBeVisible();
  await page.locator(".field-roster-filter-disclosure > summary").click();
  await expect(page.getByRole("combobox", { name: "دخول التطبيق", exact: true })).toHaveValue("disabled");
  expect(requests.at(-1)?.get("enabled")).toBe("false");
  expect(requests.at(-1)?.get("cursor")).toBe(nextToken);
  await page.getByRole("button", { name: "السابقة", exact: true }).click();
  await expect(page.getByText("ميداني موقوف أول", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "مسح البحث والمرشحات", exact: true }).click();
  await expect(page.getByText("مرشح للمراجعة", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "دخول التطبيق", exact: true })).toHaveValue("");
  expect(requests.at(-1)?.get("enabled")).toBeNull();
});
