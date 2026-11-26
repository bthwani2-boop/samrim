import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAssetResponse, assertHtmlDocument, assertPublicRedirect, documentAssets } from "./verify-expo-web-http.mjs";

const page = { route: "merchant/", title: "بثواني — التاجر", body: "تسجيل الدخول أو الانضمام" };
const document = (body, title = page.title, attrs = 'lang="ar" dir="rtl"') =>
  '<html ' + attrs + '><head><title>' + title + '</title></head><body>' + body + '</body></html>';
const origin = "http://127.0.0.1:32123";
const script = "/_expo/static/js/web/index-abc.js";
const preload = ref => '<link rel="preload" href="' + ref + '" as="script"/>';

test("SSR requires actual product body independently of metadata", () => {
  assert.doesNotThrow(() => assertHtmlDocument(document("<main>" + page.body + "</main>"), page));
  for (const markup of [
    "<main></main>",
    "<script>" + page.body + "</script>",
    "<style>" + page.body + "</style>",
    "<template>" + page.body + "</template>",
    "<!--" + page.body + "-->",
  ]) assert.throws(() => assertHtmlDocument(document(markup), page), /required product body/);
  assert.throws(() => assertHtmlDocument(document(page.body, "wrong"), page), /wrong document title/);
  assert.throws(() => assertHtmlDocument(document(page.body, page.title, 'lang="ar" dir="ltr"'), page), /RTL/);
  assert.throws(() => assertHtmlDocument(document(page.body + " Requiring unknown module"), page), /Metro module error/);
});

test("protected routes redirect only to the exact same-origin public root", () => {
  for (const target of ["/", origin + "/"]) {
    assert.doesNotThrow(() => assertPublicRedirect(target, origin, "/orders"));
  }
  for (const target of [null, "//example.invalid/", "http://127.0.0.1:32124/", "/?next=/orders", "/orders", "/#private"]) {
    assert.throws(() => assertPublicRedirect(target, origin, "/orders"));
  }
});

test("SSR assets include actual Expo JS preloads and styles, deduplicated", () => {
  const style = "/_expo/static/css/web/app.css";
  const html = preload(script) + '<script src="' + script + '"></script>' +
    '<link rel="stylesheet" href="' + style + '"/>';
  assert.deepEqual(documentAssets(html, origin), [
    { url: script, file: script.slice(1), type: "script" },
    { url: style, file: style.slice(1), type: "style" },
  ]);
});

test("missing or non-client executable references fail closed", () => {
  assert.throws(() => documentAssets("<html><script>inline()</script></html>", origin), /No executable/);
  for (const ref of [
    "https://example.invalid/a.js", "//example.invalid/a.js", "/_expo/server/render.js",
    "/_expo/static/js/web/index.js?next=1", "/_expo/static/js/web/index.js#fragment",
    "/_expo/static/js/web/index.css", "/_expo/static/js/web/%5cindex.js",
  ]) assert.throws(() => documentAssets(preload(ref), origin));
});

test("real asset response requires HTTP success, correct MIME and exact exported bytes", async () => {
  const asset = documentAssets(preload(script), origin)[0];
  const bytes = Buffer.from("console.log('compiled');");
  const response = (body, status = 200, mime = "application/javascript") =>
    new Response(body, { status, headers: { "content-type": mime } });
  await assert.doesNotReject(() => assertAssetResponse(response(bytes), bytes, asset));
  await assert.rejects(() => assertAssetResponse(response(bytes, 404), bytes, asset), /HTTP status/);
  await assert.rejects(() => assertAssetResponse(response(bytes, 200, "text/html"), bytes, asset), /MIME/);
  await assert.rejects(() => assertAssetResponse(response("changed"), bytes, asset), /differ/);
  await assert.rejects(() => assertAssetResponse(response(""), Buffer.alloc(0), asset), /empty/);
});

test("HTML tree, not tag-like text, establishes document and body evidence", () => {
  const invalid = [
    document('<div hidden>' + page.body + '</div>'),
    document('<textarea>' + page.body + '</textarea>'),
    document('<svg><title>' + page.body + '</title></svg>'),
    document('<script>const x = "<body>' + page.body + '</body>";</script>'),
    '<!-- <html lang="ar" dir="rtl"> --><head><title>' + page.title + '</title></head><body>' + page.body + '</body>',
  ];
  for (const html of invalid) assert.throws(() => assertHtmlDocument(html, page));
  assert.doesNotThrow(() => assertHtmlDocument(document('<main data-note="a>b">' + page.body + '</main>'), page));
});
test("asset inventory follows parsed HTML and ignores inert markup", () => {
  const fake = "/_expo/static/js/web/fake.js";
  const html = document('<template><script src="' + fake + '"></script></template>' +
    '<textarea><script src="' + fake + '"></script></textarea>' +
    '<script>const x = "<script src=\'' + fake + '\'>";</script>' +
    '<!-- <script src="' + fake + '"></script> -->' +
    '<script data-note="a>b" src="' + script + '"></script>');
  assert.deepEqual(documentAssets(html, origin), [{ url: script, file: script.slice(1), type: "script" }]);
  assert.throws(() => documentAssets('<template>' + preload(script) + '</template>', origin), /No executable/);
});
