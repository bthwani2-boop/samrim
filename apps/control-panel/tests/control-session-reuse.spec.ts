import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const reusableControlSessionPath = path.join(
  process.env.BTHWANI_SECRETS_ROOT?.trim() || "C:\\BTHWANI-Secrets\\samrim",
  "control-playwright",
  "storage-state.json",
);

test.skip(process.env.PLAYWRIGHT_CONTROL_SESSION_PROOF !== "1", "targeted LOCAL_INTEGRATION reusable-session proof");

test("reuses the canonical Control session across independent proof invocations", async ({ browser, baseURL }) => {
  test.setTimeout(30_000);
  if (!baseURL || !existsSync(reusableControlSessionPath)) throw new Error("canonical reusable Control session state is required for this proof");

  const observedCeremonies: string[] = [];
  const sessionURL = new URL("/api/auth/session", baseURL).toString();
  const workspaceURL = new URL("/workspace", baseURL).toString();

  for (const invocation of ["A", "B"]) {
    const context = await browser.newContext({ storageState: reusableControlSessionPath, locale: "ar-YE" });
    const page = await context.newPage();
    page.on("request", (request) => {
      if (/\/api\/auth\/(?:activation|operator\/recovery|passkey|logout)/.test(new URL(request.url()).pathname)) observedCeremonies.push(`${invocation}:${request.method()}:${request.url()}`);
    });
    try {
      const session = await page.goto(sessionURL, { waitUntil: "domcontentloaded" });
      expect(session?.status(), `${invocation} session response`).toBe(200);
      const body = await page.evaluate(() => JSON.parse(document.body.textContent || "{}")) as { identity?: { role?: string; surface?: string } };
      expect(body.identity?.role).toBe("operator");
      expect(body.identity?.surface).toBe("control-panel");

      await page.goto(workspaceURL, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "الرئيسية", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "الرئيسية", exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  }

  expect(observedCeremonies, "normal reusable-session proof must not start an auth ceremony").toEqual([]);
});
