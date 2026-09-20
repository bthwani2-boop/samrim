import { expect, test } from "@playwright/test";

test("@live operator reads the real bounded COD cash-custody journey", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "المالية" })).toBeVisible();
  await expect(page.getByText("التزامات نقدية محصلة ضمن الإسقاط الحالي")).toBeVisible();
  await expect(page.getByText("لا توجد هنا تسوية للتجار أو عمولات أو استردادات أو وسائل دفع إلكترونية.")).toBeVisible();

  const cashCustodyRead = await page.evaluate(async () => {
    const response = await fetch("/api/finance/cash-custody", { cache: "no-store" });
    return { status: response.status, body: await response.json() as { items?: unknown; totalAmountMinor?: unknown } };
  });
  expect(cashCustodyRead.status).toBe(200);
  expect(Array.isArray(cashCustodyRead.body.items)).toBe(true);
  expect(typeof cashCustodyRead.body.totalAmountMinor).toBe("number");
  await expect(page.locator(".finance-table tbody tr")).toHaveCount((cashCustodyRead.body.items as unknown[]).length);
});
