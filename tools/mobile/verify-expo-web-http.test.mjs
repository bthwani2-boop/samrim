import assert from "node:assert/strict";
import { test } from "node:test";
import { assertHtmlDocument, assertPublicRedirect } from "./verify-expo-web-http.mjs";

const page = { route: "merchant/", title: "بثواني — التاجر", body: "تسجيل الدخول أو الانضمام" };
const document = (body, title = page.title, attrs = 'lang="ar" dir="rtl"') =>
  '<html ' + attrs + '><head><title>' + title + '</title></head><body>' + body + '</body></html>';

test("SSR requires actual product body independently of metadata", () => {
  assert.doesNotThrow(() => assertHtmlDocument(document("<main>" + page.body + "</main>"), page));
  for (const markup of [
    "<main></main>",
    "<script>" + page.body + "</script>",
    "<style>" + page.body + "</style>",
    "<template>" + page.body + "</template>",
    "<!--" + page.body + "-->",
  ]) {
    assert.throws(() => assertHtmlDocument(document(markup), page), /required product body/);
  }
  assert.throws(() => assertHtmlDocument(document("<main>" + page.body + "</main>", "wrong"), page), /wrong document title/);
  assert.throws(() => assertHtmlDocument(document(page.body, page.title, 'lang="ar" dir="ltr"'), page), /RTL/);
  assert.throws(() => assertHtmlDocument(document(page.body + " Requiring unknown module"), page), /Metro module error/);
});

test("protected route redirect permits only the exact public origin and root", () => {
  const origin = "http://127.0.0.1:32123";
  for (const target of ["/", origin + "/"]) {
    assert.doesNotThrow(() => assertPublicRedirect(target, origin, "/orders"));
  }
  for (const target of [null, "//example.invalid/", "http://127.0.0.1:32124/", "/?next=/orders", "/orders", "/#private"]) {
    assert.throws(() => assertPublicRedirect(target, origin, "/orders"));
  }
});
