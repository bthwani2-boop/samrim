import { strict as assert } from "node:assert";

const rawUrl = process.argv[2];
assert(rawUrl, "Usage: node tools/dev/check-control-panel-csp.mjs http://localhost:<port>");
const origin = new URL(rawUrl);
assert(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname), "Only local HTTP proof targets are permitted");
assert(origin.pathname === "/" && !origin.search && !origin.hash && !origin.username && !origin.password, "Pass a local origin without a path or credentials");

const requests = await Promise.all(
  ["/access", "/access", "/workspace"].map(async (path) => {
    const response = await fetch(new URL(path, origin), { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(12000) });
    assert.equal(response.status, 200, `Expected HTTP 200 on ${path}`);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /style-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    const nonce = csp.match(/style-src 'self' 'nonce-([^']+)'/)?.[1];
    assert(nonce, "Missing server style nonce");
    const html = await response.text();
    const styleTag = html.match(/<style\b[^>]*\bid="antd-cssinjs"[^>]*>/i)?.[0];
    assert(styleTag, `Missing first-screen Ant Design SSR styles on ${path}`);
    assert(styleTag.includes(`nonce="${nonce}"`), `SSR styles do not match response CSP nonce on ${path}`);
    assert.equal(html.includes("<html lang=\"ar\" dir=\"rtl\""), true, "Missing Arabic RTL root");
    return nonce;
  }),
);
assert.notEqual(requests[0], requests[1], "Nonces must rotate on independent document requests");
console.log("CP_CSP_SSR=PASS responses=3 nonce_rotation=PASS strict_style_csp=PASS rtl=PASS");
