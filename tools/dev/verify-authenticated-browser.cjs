#!/usr/bin/env node
"use strict";

// Read-only session gate. Reuse the existing BThwani Chrome CDP context;
// never launch another browser, profile or authentication flow.
const { chromium } = require("@playwright/test");

function authPath(pathname) {
  return /(?:^|\/)(?:login|log-in|signin|sign-in|sign_in|authenticate|authentication)(?:\/|$)/i.test(pathname);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) result.url = argv[++i];
    else if (argv[i] === "--require-selector" && argv[i + 1]) result.selector = argv[++i];
    else throw new Error("USAGE: --url https://example.com/protected --require-selector main");
  }
  if (!result.url) throw new Error("TARGET_URL_REQUIRED");
  if (!result.selector) throw new Error("REQUIRE_SELECTOR_FOR_AUTHENTICATED_PAGE");
  const target = new URL(result.url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("UNSUPPORTED_TARGET_URL");
  }
  if (authPath(target.pathname)) throw new Error("PROTECTED_PAGE_REQUIRED_NOT_LOGIN_ROUTE");
  result.target = target;
  return result;
}

async function verify({target, selector}) {
  const endpoint = "http://127.0.0.1:9222";
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, {timeout: 10000});
  } catch {
    throw new Error("CHROME_CDP_NOT_READY_USE_B_FIRST");
  }

  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("EXISTING_CHROME_CONTEXT_REQUIRED");
    // New tab within the *same authenticated profile*, not a new browser or context.
    const page = await context.newPage();
    try {
      const response = await page.goto(target.href, {
        waitUntil: "domcontentloaded", timeout: 20000
      });
      await page.waitForLoadState("networkidle", {timeout: 4500}).catch(() => {});
      await page.waitForTimeout(450); // allow client-side auth redirects to settle
      // Expo and other client-rendered protected views can hydrate after the
      // document loads; verify the signed-in selector after a bounded wait.
      const hasSelector = selector
        ? await page.locator(selector).first().waitFor({state: "visible", timeout: 10000}).then(() => true, () => false)
        : true;
      // Validate the destination and login form after client-side hydration.
      const finalUrl = new URL(page.url());
      const passwordForm = await page.locator('input[type="password"]').count();
      if (
        finalUrl.origin !== target.origin ||
        finalUrl.pathname.replace(/\/+$/, "") !== target.pathname.replace(/\/+$/, "") ||
        authPath(finalUrl.pathname) ||
        passwordForm > 0 ||
        !response || response.status() >= 400 ||
        !hasSelector
      ) {
        throw new Error("SITE_SESSION_NOT_VERIFIED");
      }
      return {
        status: "PASS", browser: "EXISTING_CHROME_CDP",
        origin: target.origin, path: finalUrl.pathname,
        httpStatus: response.status(),
        selectorVerified: selector || null
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {}); // detach CDP, do not close actual Chrome
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(await verify(args)));
  } catch (error) {
    const reason = String(error?.message || error);
    // Never echo arbitrary navigation errors that may contain URL query secrets.
    const code = /^(USAGE:|TARGET_URL_REQUIRED$|REQUIRE_SELECTOR_FOR_AUTHENTICATED_PAGE$|UNSUPPORTED_TARGET_URL$|PROTECTED_PAGE_REQUIRED_NOT_LOGIN_ROUTE$|CHROME_CDP_NOT_READY_USE_B_FIRST$|EXISTING_CHROME_CONTEXT_REQUIRED$|SITE_SESSION_NOT_VERIFIED$)/.test(reason)
      ? reason : "BROWSER_INSPECTION_FAILED";
    console.error(JSON.stringify({status: "BLOCKED", reason: code}));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = {authPath, parseArgs, verify};
