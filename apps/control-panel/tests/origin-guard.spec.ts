import { expect, test } from "@playwright/test";

const forbiddenError = {
  error: {
    code: "FORBIDDEN_CROSS_ORIGIN",
    message: "Cross-origin requests are forbidden for control-panel mutations",
  },
};

test("local browser navigation canonicalizes 127.0.0.1 to localhost", async ({ page, request }) => {
  const canonical = process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
  test.skip(process.env.BTHWANI_ENV !== "development" || canonical !== "http://localhost:13000", "Local development only");

  const alias = "http://127.0.0.1:13000";
  const redirect = await request.get(`${alias}/partners?view=joining`, {
    maxRedirects: 0,
    headers: { Accept: "text/html" },
  });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers().location).toBe(`${canonical}/partners?view=joining`);

  await page.goto(`${alias}/?from=loopback`);
  expect(new URL(page.url()).origin).toBe(canonical);
});

test("control-panel mutations accept only the configured loopback origin", async ({ page }) => {
  const navigation = await page.goto("/");
  expect(navigation).not.toBeNull();

  const canonical = new URL(page.url());
  expect(["localhost", "127.0.0.1"]).toContain(canonical.hostname);

  const sameOrigin = await page.request.post("/api/auth/logout", {
    headers: {
      Origin: canonical.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  expect(sameOrigin.status()).not.toBe(403);

  const loopbackAlias = new URL(canonical.origin);
  loopbackAlias.hostname = canonical.hostname === "localhost" ? "127.0.0.1" : "localhost";

  const aliasResponse = await page.request.post("/api/auth/logout", {
    headers: {
      Origin: loopbackAlias.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  expect(aliasResponse.status()).toBe(403);
  expect(await aliasResponse.json()).toEqual(forbiddenError);

  const foreignResponse = await page.request.post("/api/auth/logout", {
    headers: {
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  expect(foreignResponse.status()).toBe(403);
  expect(await foreignResponse.json()).toEqual(forbiddenError);
});
