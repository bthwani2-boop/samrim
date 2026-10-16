import { expect, test } from "./coverage-fixtures";

// A large server collection is represented by bounded pages, never seeded into a database.
const cases = [
  { key: "products", path: "/catalog/products?active=inactive&sort=name_desc", api: "/api/catalog/product-registry", parameter: "productCursor", rows: ".catalog-registry-table tbody tr", label: "المنتجات", size: 50 },
  { key: "proposals", path: "/catalog/proposals", api: "/api/catalog/proposals", parameter: "proposalCursor", rows: ".proposal-list > li", label: "مقترحات المنتجات", size: 50 },
  { key: "captains", path: "/captains", api: "/api/captains", parameter: "captainCursor", rows: "section[aria-labelledby=captain-roster-title] tbody tr", label: "الكباتن", size: 25 },
  { key: "candidates", path: "/captains", api: "/api/captains", parameter: "captainCandidateCursor", rows: "section[aria-labelledby=captain-candidate-registry-title] tbody tr", label: "ملفات الكباتن", size: 25 },
  { key: "operators", path: "/access?view=permissions", api: "/api/access/operators", parameter: "operatorCursor", rows: ".access-center-table tbody tr", label: "حسابات المشغّلين", size: 25 },
  { key: "profiles", path: "/access?view=profiles", api: "/api/access/operator-profiles", parameter: "operatorProfileCursor", rows: ".access-center-table tbody tr", label: "ملفات المشغّلين", size: 25 },
];

for (const registry of cases) {
  test(`${registry.key} keeps a 5000-record collection bounded and restores cursor navigation`, async ({ page }) => {
    // Exercises reload, filter history and failed-page recovery in one bounded registry scenario.
    test.setTimeout(60_000);
    const requestedCursors: string[] = [];
    const requestedQueries: string[] = [];
    let failNextPage = false;
    const privateRegistry = registry.key !== "products" && registry.key !== "proposals";
    const nextToken = privateRegistry ? Buffer.from(JSON.stringify({ phone: "+96777002500", query: "+967770" })).toString("base64url") : "page-2500";
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET") return route.fulfill({ status: 405, json: { error: { message: "Read-only registry proof" } } });
      if (url.pathname === "/api/auth/session") return route.fulfill({ status: 200, json: { identity: { subject: "registry-operator", sessionId: "registry-session", role: "operator", surface: "control-panel", permissions: ["operations", "partners", "catalog", "marketing", "finance", "platform_policies"], canManageOperatorPermissions: true, expiresAt: "2099-01-01T00:00:00Z" } } });
      const requestedScope = url.searchParams.get("scope") === "candidates";
      const matching = url.pathname === registry.api && (registry.key !== "captains" || !requestedScope) && (registry.key !== "candidates" || requestedScope);
      if (matching) {
        expect(url.searchParams.get("limit")).toBe(String(registry.size));
        const cursor = url.searchParams.get("cursor") ?? "";
        requestedCursors.push(cursor);
        requestedQueries.push(url.searchParams.get("q") ?? "");
        if (cursor && failNextPage) {
          failNextPage = false;
          return route.fulfill({ status: 503, json: { error: { message: "تعذرت قراءة صفحة السجل." } } });
        }
        const start = cursor ? 2500 : 0;
        const records = Array.from({ length: registry.size }, (_, offset) => {
          const index = start + offset;
          const name = `سجل العرض ${index}`;
          const phone = `+96777${String(index).padStart(6, "0")}`;
          const shared = { id: `registry-${index}`, version: 1, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z" };
          if (registry.key === "products") return { ...shared, canonicalName: name, verticalId: "registry-vertical", categoryIds: [], variantCount: 1, storeCount: 2, active: true };
          if (registry.key === "proposals") return { ...shared, proposedName: name, proposedVariantTitle: "نسخة العرض", state: "submitted", verticalId: "registry-vertical" };
          if (registry.key === "candidates") return { ...shared, fullNameAr: name, contactPhoneE164: phone, walletProviderKey: "registry-wallet", state: "review_required" };
          if (registry.key === "profiles") return { ...shared, fullNameAr: name, phoneE164: phone, jobTitle: "عمليات", department: "التشغيل", state: "pending_review" };
          return { actorId: `registry-actor-${index}`, phoneE164: phone, role: registry.key === "captains" ? "captain" : "operator", securityEnabled: true, enabled: true, activatedAt: shared.createdAt, actorVersion: 1, roleVersion: 1, operatorEnabledPermissionCount: 6, admission: { ...shared, fullNameAr: name, actorId: `registry-actor-${index}`, state: "eligible", availabilityState: "unavailable" } };
        });
        const key = registry.key === "products" ? "products" : registry.key === "proposals" ? "proposals" : "items";
        return route.fulfill({ status: 200, json: { [key]: records, nextCursor: cursor ? "" : nextToken, limit: registry.size } });
      }
      const payloads: Record<string, unknown> = {
        "/api/catalog/verticals": { verticals: [{ id: "registry-vertical", nameAr: "البقالة", nameEn: "Grocery", active: true, version: 1 }] },
        "/api/catalog/categories": { categories: [], nextCursor: "" },
        "/api/wallet-providers": { walletProviders: [{ key: "registry-wallet", displayNameAr: "محفظة العرض", active: true, version: 1 }] },
        "/api/auth/operator-phone": { phoneE164: "+967770000000" },
        "/api/notifications": { notifications: [], unreadCount: 0 },
      };
      return route.fulfill({ status: 200, json: payloads[url.pathname] ?? { items: [], nextCursor: "" } });
    });
    await page.goto(registry.path);
    const rows = page.locator(registry.rows);
    if (registry.key === "operators" || registry.key === "profiles") {
      await expect(rows).toHaveCount(registry.size);
      await page.getByRole("button", { name: "تحميل المزيد" }).click();
      await expect(rows).toHaveCount(registry.size * 2);
      expect(requestedCursors).toContain(nextToken);
      expect(page.url()).not.toContain(nextToken);
      expect(page.url()).not.toContain("+96777002500");
      return;
    }
    const navigation = page.getByRole("navigation", { name: `صفحات ${registry.label}`, exact: true });
    await expect(rows).toHaveCount(registry.size);
    const recordMarker = (index: number) => registry.key === "operators" || registry.key === "captains" || registry.key === "candidates"
      ? `+96777${String(index).padStart(6, "0")}` : `سجل العرض ${index}`;
    await expect(rows.first()).toContainText(recordMarker(0));
    await navigation.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${registry.parameter}=${privateRegistry ? "page-2" : "page-2500"}`));
    if (privateRegistry) { expect(page.url()).not.toContain(nextToken); expect(page.url()).not.toContain("967770"); }
    await expect(rows).toHaveCount(registry.size);
    await expect(rows.first()).toContainText(recordMarker(2500));
    await page.reload();
    await expect(rows).toHaveCount(registry.size);
    await expect(rows.first()).toContainText(recordMarker(2500));
    await navigation.getByRole("button", { name: /السابق|الأولى/ }).click();
    await expect(rows.first()).toContainText(recordMarker(0));
    await expect(rows).toHaveCount(registry.size);
    await page.goBack();
    await expect(rows.first()).toContainText(recordMarker(2500));
    await expect(rows).toHaveCount(registry.size);
    expect(requestedCursors).toContain(nextToken);

    if (registry.key === "products" || registry.key === "operators" || registry.key === "profiles") {
      const filter = registry.key === "products" ? page.getByRole("combobox", { name: "الحالة", exact: true })
        : page.locator(registry.key === "operators" ? "#operator-enabled-filter" : "#operator-profile-state");
      const originalFilter = await filter.inputValue();
      await filter.selectOption(registry.key === "products" ? "active" : registry.key === "operators" ? "true" : "approved");
      await expect(rows.first()).toContainText(recordMarker(0));
      await page.goBack();
      await expect(rows.first()).toContainText(recordMarker(2500));
      await expect(filter).toHaveValue(originalFilter);
      expect(requestedCursors.at(-1)).toBe(nextToken);
    }

    if (privateRegistry) {
      const inputId = registry.key === "operators" ? "operator-search" : registry.key === "profiles" ? "operator-profile-search" : registry.key === "captains" ? "captain-search" : "captain-candidate-search";
      const input = page.locator(`#${inputId}`);
      async function searchPrivatePhone(phone: string) {
        await input.fill(phone);
        if (registry.key === "operators" || registry.key === "profiles") await input.locator("xpath=ancestor::form[1]").getByRole("button", { name: "بحث", exact: true }).click();
        await expect.poll(() => requestedQueries.at(-1)).toBe(phone);
        await expect(rows.first()).toContainText(recordMarker(0));
        await expect(navigation.getByRole("button", { name: "التالي", exact: true })).toBeEnabled();
        expect(page.url()).not.toContain(phone);
        expect(page.url()).not.toContain(nextToken);
      }
      await searchPrivatePhone("770123456");
      await navigation.getByRole("button", { name: "التالي", exact: true }).click();
      await expect(rows.first()).toContainText(recordMarker(2500));
      await page.reload();
      await expect(input).toHaveValue("770123456");
      await expect(rows.first()).toContainText(recordMarker(2500));
      expect(requestedQueries.at(-1)).toBe("770123456");
      expect(page.url()).not.toContain("770123456");
      expect(page.url()).not.toContain(nextToken);
      await searchPrivatePhone("770654321");
      await page.goBack();
      await expect(input).toHaveValue("770123456");
      await expect(rows.first()).toContainText(recordMarker(0));
      expect(requestedQueries.at(-1)).toBe("770123456");
      await page.goBack();
      await expect(input).toHaveValue("");
      await expect(rows.first()).toContainText(recordMarker(0));
      await expect.poll(() => requestedQueries.at(-1)).toBe("");
      if (registry.key === "operators" || registry.key === "profiles") {
        await navigation.getByRole("button", { name: "التالي", exact: true }).click();
        await expect(rows.first()).toContainText(recordMarker(2500));
        await searchPrivatePhone("770123456");
        const reads = requestedQueries.length;
        await searchPrivatePhone("770123456");
        await expect.poll(() => requestedQueries.length).toBeGreaterThan(reads);
        await input.locator("xpath=ancestor::form[1]").getByRole("button", { name: "مسح البحث", exact: true }).click();
        await expect.poll(() => requestedQueries.at(-1)).toBe("");
        await expect(rows.first()).toContainText(recordMarker(0));
        await page.goBack();
        await expect(input).toHaveValue("");
        await expect(rows).toHaveCount(registry.size);
        await expect(rows.first()).toContainText(recordMarker(0));
        await expect(navigation.getByRole("button", { name: "التالي", exact: true })).toBeEnabled();
      }
    } else {
      await navigation.getByRole("button", { name: /السابق|الأولى/ }).click();
      await expect(rows.first()).toContainText(recordMarker(0));
    }

    failNextPage = true;
    await navigation.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page.locator(".identity-error[role=alert], .managed-status[role=alert]").first()).toBeVisible();
    await expect(rows.filter({ hasText: recordMarker(0) })).toHaveCount(0);
    await expect(rows.filter({ hasText: recordMarker(2500) })).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: "التالي", exact: true })).toBeDisabled();
    await expect(navigation.getByRole("button", { name: /السابق|الأولى/ })).toBeEnabled();
    await navigation.getByRole("button", { name: /السابق|الأولى/ }).click();
    await expect(rows.first()).toContainText(recordMarker(0));
    await expect(rows).toHaveCount(registry.size);
    await expect(page.locator(".identity-error[role=alert], .managed-status[role=alert]")).toHaveCount(0);
    await navigation.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(rows.first()).toContainText(recordMarker(2500));
    await expect(rows).toHaveCount(registry.size);
  });
}
