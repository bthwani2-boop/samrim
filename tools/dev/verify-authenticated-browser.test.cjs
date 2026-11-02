"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {authPath,parseArgs} = require("./verify-authenticated-browser.cjs");

test("Login endpoints are not accepted as protected-page proof", () => {
  for (const path of ["/admin/login","/sign-in","/en/authentication","/signin"]) {
    assert.equal(authPath(path),true);
  }
  assert.equal(authPath("/admin/dashboard"),false);
});

test("URL and signed-in-only selector are both mandatory", () => {
  assert.throws(()=>parseArgs([]),/TARGET_URL_REQUIRED/);
  assert.throws(()=>parseArgs(["--url","https://elleen.ye/admin/dashboard"]),/REQUIRE_SELECTOR/);
  assert.throws(()=>parseArgs(["--url","https://elleen.ye/admin/login","--require-selector","main"]),/PROTECTED_PAGE_REQUIRED/);
});

test("Rejects unsafe URLs, extra args and credentials in URLs", () => {
  assert.throws(()=>parseArgs(["--url","file:///tmp/a","--require-selector","main"]),/UNSUPPORTED_TARGET_URL/);
  assert.throws(()=>parseArgs(["--url","https://u:p@elleen.ye/admin/dashboard","--require-selector","main"]),/UNSUPPORTED_TARGET_URL/);
  assert.throws(()=>parseArgs(["--url","https://elleen.ye/admin/dashboard","--require-selector","main","--launch"]),/USAGE/);
});

test("Valid inspection uses only the provided target and selector", () => {
  const {target,selector}=parseArgs(["--url","https://elleen.ye/admin/dashboard","--require-selector","main"]);
  assert.equal(target.origin,"https://elleen.ye");
  assert.equal(target.pathname,"/admin/dashboard");
  assert.equal(selector,"main");
});