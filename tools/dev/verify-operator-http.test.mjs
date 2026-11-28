import assert from "node:assert/strict";
import { test } from "node:test";
import { assertOperatorDocument, assertOperatorPolicy, operatorInvocation, withOperatorHost } from "./verify-operator-http.mjs";

const nonce = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const route = "/";
const body = "دخول المشغّل";
const policy = development => [
  "default-src 'self'",
  "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'" + (development ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self'" + (development ? " ws:" : ""), "object-src 'none'", "base-uri 'self'",
  "form-action 'self'", "frame-ancestors 'none'", "frame-src 'none'",
  ...(!development ? ["upgrade-insecure-requests"] : []),
].join("; ");
const response = (value, cache = "private, no-store", extra = {}) => new Response(null, {
  headers: { "content-security-policy": value, "cache-control": cache, ...extra },
});

test("exact independent production and development policy admits one canonical nonce", () => {
  for (const development of [false, true]) {
    assert.equal(assertOperatorPolicy(response(policy(development)), route, development), nonce);
  }
  assert.equal(assertOperatorPolicy(response(policy(false).split("; ").reverse().join("; ")), route, false), nonce);
});

test("rejects weakened, duplicate, overriding and multiple CSP policies", () => {
  const good = policy(false);
  for (const value of [
    good.replace("connect-src 'self'", "connect-src 'self' *"),
    "frame-ancestors *; " + good,
    good + "; script-src-elem *",
    good + "; script-src-attr 'unsafe-inline'",
    good.replace("frame-src 'none'", "frame-src *"),
    good.replace("img-src 'self' data: blob:", "img-src *"),
    good.replace("object-src 'none'", "object-src 'none' *"),
    good.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-inline'"),
    good.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'"),
    good.replace("'strict-dynamic'", "'strict-dynamic' 'nonce-" + nonce + "'"),
    good.replace(nonce, "YQ=="),
    good.replace(nonce, "not_base64"),
    good.replace("upgrade-insecure-requests", "unknown-directive"),
    good.replace("frame-src 'none'; ", ""),
    good + ", " + good,
    "",
  ]) assert.throws(() => assertOperatorPolicy(response(value), route, false), undefined, value);
  assert.equal(assertOperatorPolicy(response(good, "private, no-cache, no-store, max-age=0, must-revalidate"), route, false), nonce);
  for (const cache of ["public, no-store", "private", "private, no-store, max-age=3600",
    "private, no-store, no-store", "private, no-store, s-maxage=0", "private, no-store=1"]) {
    assert.throws(() => assertOperatorPolicy(response(good, cache), route, false));
  }
  assert.throws(() => assertOperatorPolicy(response(good, "private, no-store", {
    "content-security-policy-report-only": good,
  }), route, false));
  assert.throws(() => assertOperatorPolicy(response(policy(true)), route, false));
  assert.throws(() => assertOperatorPolicy(response(good), route, true));
  assert.equal(assertOperatorPolicy(response(policy(true), "no-store"), route, true), nonce);
  assert.equal(assertOperatorPolicy(response(good + ";"), route, false), nonce);
  assert.throws(() => assertOperatorPolicy(response(good.replace(/script-src [^;]+; /, "")), route, false));
  assert.throws(() => assertOperatorPolicy(new Response(null, { headers: { "content-security-policy": good } }), route, false));
});

test("rejects non-ASCII whitespace that changes the actual browser policy", () => {
  const good = policy(false);
  for (const space of ["\u00a0", "\u0085"]) {
    assert.throws(() => assertOperatorPolicy(response(good.replace("; frame-ancestors", ";" + space + "frame-ancestors")), route, false));
    assert.throws(() => assertOperatorPolicy(response(good.replace("frame-ancestors 'none'", "frame-ancestors 'none'" + space)), route, false));
    assert.throws(() => assertOperatorPolicy(response(good, "private, " + space + "no-store"), route, false));
  }
});

test("accepts ASCII HTTP whitespace and reordered sources without weakening the policy", () => {
  const good = policy(false);
  const reordered = good.replace("img-src 'self' data: blob:", "IMG-SRC blob:\tdata:  'self'").replaceAll("; ", ";\t");
  assert.equal(assertOperatorPolicy(response(reordered, "NO-STORE,\tPRIVATE"), route, false), nonce);
  assert.throws(() => assertOperatorPolicy(response(good.replace("data: blob:", "data: data:")), route, false));
});

const script = '<script nonce="' + nonce + '" src="/_next/static/chunk.js"></script>';
const robots = '<meta name="robots" content="noindex,nofollow">';
const html = (content, head = robots, attrs = 'lang="ar" dir="rtl"') =>
  '<html ' + attrs + '><head>' + head + '</head><body>' + content + '</body></html>';
const expected = { route, body, expectedStatus: 200, nonce };

test("actual executable elements and rendered product text establish SSR proof", () => {
  assert.doesNotThrow(() => assertOperatorDocument(html("<main>" + body + "</main>" + script), expected));
  assert.doesNotThrow(() => assertOperatorDocument(html(body + script, robots + '<meta name="robots" content="noindex">'), expected));
  for (const markup of [
    html('<div nonce="' + nonce + '">' + body + '</div>'),
    html(body + '<!--' + script + '-->'),
    html(body + '<template>' + script + '</template>'),
    html(body + '<script type="application/json" nonce="' + nonce + '">{}</script>'),
    html(body + script + '<script src="/other.js"></script>'),
    html(body + script.replace(nonce, "wrong")),
    html("<script>" + body + "</script>" + script),
    html("<div hidden>" + body + "</div>" + script),
    html(body + script, '<meta name="robots" content="noindexfake">'),
    html(body + script, '<meta name="robots">'),
    html(body + script, '<!--' + robots + '-->'),
    html(body + script, robots + '<meta name="robots" content="index">'),
    html(body + script, '<meta name="robots" content="noindex,all">'),
    html(body + script, robots, 'lang="ar" dir="ltr"'),
  ]) assert.throws(() => assertOperatorDocument(markup, expected), undefined, markup);
});

test("404 recovery must be a real Arabic link to the public root", () => {
  const notFound = { ...expected, expectedStatus: 404 };
  const link = '<a href="/">العودة إلى لوحة المشغّل</a>';
  assert.doesNotThrow(() => assertOperatorDocument(html(body + link + script), notFound));
  for (const invalid of [
    '<a href="/private">العودة إلى لوحة المشغّل</a>',
    '<template>' + link + '</template>',
    '<!--' + link + '-->',
  ]) assert.throws(() => assertOperatorDocument(html(body + invalid + script), notFound));
});
test("native invocation rejects unknown arguments and pins development mode", () => {
  assert.throws(() => operatorInvocation(["--unknown"]));
  const invocation = operatorInvocation(["--dev"]);
  assert.equal(invocation.mode, "dev");
  assert.equal(invocation.env.NODE_ENV, "development");
  assert.equal(invocation.development, true);
});

test("real child startup failure is rejected and closed", async () => {
  const base = "http://127.0.0.1:1";
  const options = { cwd: process.cwd(), env: process.env };
  const verify = () => assert.fail("failed child must never enter verification");
  await assert.rejects(() => withOperatorHost(process.execPath, ["-e", "console.error('fixture startup rejected');process.exit(7)"],
    options, base, verify), /fixture startup rejected/);
  await assert.rejects(() => withOperatorHost(process.execPath + ".nonexistent", [],
    options, base, verify), /ENOENT/);
});
