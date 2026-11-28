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
  const asset = documentAssets('<script src="' + script + '"></script>', origin)[0];
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
test("a fetched hint or inert data block never establishes an executable entry", () => {
  for (const html of [
    preload(script),
    '<link rel="modulepreload" href="' + script + '">',
    '<script type="application/json" src="' + script + '"></script>',
    '<script type="importmap" src="' + script + '"></script>',
    '<script nomodule src="' + script + '"></script>',
    '<script type="text/javascript; charset=utf-8" src="' + script + '"></script>',
    '<script type=" module " src="' + script + '"></script>',
    '<script language="vbscript" src="' + script + '"></script>',
    '<script for="other" event="onload" src="' + script + '"></script>',
  ]) assert.throws(() => documentAssets(html, origin), undefined, html);
  for (const attrs of ["", 'type="module"', 'type="text/javascript"', 'type=" APPLICATION/JAVASCRIPT "']) {
    const html = '<script ' + attrs + ' src="' + script + '"></script>';
    assert.deepEqual(documentAssets(html, origin), [{ url: script, file: script.slice(1), type: "script" }]);
  }
  assert.deepEqual(documentAssets('<script type="application/json">{}</script><script src="' + script + '"></script>', origin),
    [{ url: script, file: script.slice(1), type: "script" }]);
});

test("asset and redirect admission resolve the actual document URL, not an unrelated root", () => {
  const entry = '<script src="' + script + '"></script>';
  for (const html of [
    '<base href="https://example.invalid/">' + entry,
    '<script src="http://user@127.0.0.1:32123' + script + '"></script>',
    '<script src="' + script + '?"></script>',
    '<script src="' + script + '#"></script>',
    '<script src="_expo/static/js/web/index-abc.js"></script>',
  ]) assert.throws(() => documentAssets(html, origin, "/nested/route"), undefined, html);
  assert.deepEqual(documentAssets(entry, origin, "/nested/route"),
    [{ url: script, file: script.slice(1), type: "script" }]);
  assert.throws(() => assertPublicRedirect("./", origin, "/orders/example"));
  assert.doesNotThrow(() => assertPublicRedirect("../", origin, "/orders/example"));
});

test("a response MIME prefix is not an executable MIME essence", async () => {
  const asset = { url: script, file: script.slice(1), type: "script" };
  const bytes = Buffer.from("console.log('compiled');");
  for (const mime of ["application/javascript+json", "text/javascript-extra", "text/html"]) {
    await assert.rejects(() => assertAssetResponse(new Response(bytes, { headers: { "content-type": mime } }), bytes, asset), /MIME/);
  }
  await assert.doesNotReject(() => assertAssetResponse(new Response(bytes, { headers: { "content-type": "text/javascript; charset=utf-8" } }), bytes, asset));
});

test("non-executable links do not create assets and CSS preloads are checked", () => {
  const css = "/_expo/static/css/web/app.css";
  const html = '<link href="/favicon.ico"><link rel="icon" href="/favicon.ico">' +
    '<link rel="preload" as="font" href="/assets/example.woff2">' +
    '<link rel="preload" as="style" href="' + css + '">' +
    '<script type="" src="' + script + '"></script>';
  assert.deepEqual(documentAssets(html, origin), [
    { url: css, file: css.slice(1), type: "style" },
    { url: script, file: script.slice(1), type: "script" },
  ]);
  for (const markup of ['<link rel="stylesheet">', '<script src=""></script>', '<link rel="stylesheet" href="' + script + '">']) {
    assert.throws(() => documentAssets(html + markup, origin));
  }
});

test("stylesheet responses require CSS MIME and absent MIME never passes", async () => {
  const css = "/_expo/static/css/web/app.css";
  const asset = { url: css, file: css.slice(1), type: "style" };
  const bytes = Buffer.from("body { display: block }");
  await assert.doesNotReject(() => assertAssetResponse(new Response(bytes, { headers: { "content-type": "text/css; charset=utf-8" } }), bytes, asset));
  for (const headers of [{}, { "content-type": "text/css-extra" }, { "content-type": "application/javascript" }]) {
    await assert.rejects(() => assertAssetResponse(new Response(bytes, { headers }), bytes, asset), /MIME/);
  }
});

test("document admission rejects missing metadata and explicit rendered body", () => {
  assert.throws(() => assertHtmlDocument('<html lang="ar" dir="rtl"><head></head><body>' + page.body + '</body></html>', page), /wrong document title/);
  assert.throws(() => assertHtmlDocument('<html lang="ar" dir="rtl"><head><title>' + page.title + '</title></head>' + page.body + '</html>', page), /missing rendered body/);
  assert.throws(() => assertHtmlDocument(document(page.body, page.title, 'dir="rtl"'), page), /Arabic document/);
});
