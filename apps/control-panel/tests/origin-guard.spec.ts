import { expect, test } from "@playwright/test";

const forbiddenError = {
  error: {
    code: "FORBIDDEN_CROSS_ORIGIN",
    message: "Cross-origin requests are forbidden for control-panel mutations",
  },
};

test("control-panel mutations accept only the configured IPv4-loopback origin", async ({ page }) => {
  const navigation = await page.goto("/");
  expect(navigation).not.toBeNull();

  const canonical = new URL(page.url());
  expect(canonical.hostname).toBe("127.0.0.1");

  const sameOrigin = await page.request.post("/api/auth/logout", {
    headers: {
      Origin: canonical.origin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  expect(sameOrigin.status()).not.toBe(403);

  const localhostAlias = new URL(canonical.origin);
  localhostAlias.hostname = "localhost";

  const aliasResponse = await page.request.post("/api/auth/logout", {
    headers: {
      Origin: localhostAlias.origin,
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
