// Shared structural HTTP/SSR admission; this does not establish browser hydration.
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { parse } from "parse5";

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const excludedText = new Set(["script", "style", "template", "noscript", "textarea"]);
export const parseDocument = html => parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true });
export const htmlElement = (node, tag) => node.namespaceURI === htmlNamespace && node.tagName === tag;
export const child = (node, tag) => node.childNodes?.find(item => htmlElement(item, tag));
export const attr = (node, name) => node.attrs?.find(item => item.name === name && !item.namespace)?.value;

export function* elements(node) {
  if (node.tagName && node.namespaceURI !== htmlNamespace) return;
  if (htmlElement(node, "template") || htmlElement(node, "noscript")) return;
  if (node.tagName) yield node;
  for (const item of node.childNodes ?? []) yield* elements(item);
}

export function bodyText(node) {
  if (node.nodeName === "#text") return node.value;
  if (node.tagName && (node.namespaceURI !== htmlNamespace ||
    excludedText.has(node.tagName) || attr(node, "hidden") !== undefined)) return "";
  return (node.childNodes ?? []).map(bodyText).join(" ");
}

export function assertHtmlDocument(html, { body, title, route }) {
  const doc = child(parseDocument(html), "html");
  assert.ok(doc?.sourceCodeLocation?.startTag && attr(doc, "lang")?.toLowerCase() === "ar",
    route + ": missing Arabic document");
  assert.equal(attr(doc, "dir")?.toLowerCase(), "rtl", route + ": missing RTL document");
  const head = child(doc, "head");
  const rendered = child(doc, "body");
  assert.ok(rendered?.sourceCodeLocation?.startTag, route + ": missing rendered body");
  assert.ok(bodyText(rendered).includes(body), route + ": required product body text missing");
  if (title) {
    const titleNode = head && child(head, "title");
    assert.equal(titleNode?.childNodes?.map(item => item.value ?? "").join(""), title,
      route + ": wrong document title");
  }
  assert.doesNotMatch(html, /Requiring unknown module|EXPO_UNKNOWN_MODULE/i,
    route + ": Metro module error in document");
  return doc;
}

// The HTTP/SSR contract admits actual classic/module entry points, not fetch
// hints or inert data blocks. This is structural proof, not browser hydration.
export const javascriptMimes = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1",
  "text/javascript1.2", "text/javascript1.3", "text/javascript1.4", "text/javascript1.5",
  "text/jscript", "text/livescript", "text/x-ecmascript", "text/x-javascript",
]);
const asciiTrim = value => value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");

export function scriptKind(element) {
  const type = attr(element, "type");
  const language = attr(element, "language");
  if (type === "" || (type === undefined && !language)) return "classic";
  const value = type ?? "text/" + language;
  if (javascriptMimes.has(value.toLowerCase()) ||
      (type !== undefined && javascriptMimes.has(asciiTrim(type).toLowerCase()))) return "classic";
  return value.toLowerCase() === "module" ? "module" : null;
}

// RFC 9110 sections 5.6.2-5.6.6 and 8.3.1. A monotonic cursor keeps parsing linear.
const tokenSpecials = "!#$%&'*+-.^_`|~";
const mediaTypeEssence = value => {
  let index = 0;
  const skipOws = () => {
    while (index < value.length && (value.charCodeAt(index) === 0x09 || value.charCodeAt(index) === 0x20)) index++;
  };
  const token = () => {
    const start = index;
    while (index < value.length) {
      const code = value.charCodeAt(index);
      if (!((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) || tokenSpecials.includes(value[index]))) break;
      index++;
    }
    return index > start;
  };
  const quotedString = () => {
    index++;
    while (index < value.length) {
      const code = value.charCodeAt(index++);
      if (code === 0x22) return true;
      if (code === 0x5c) {
        const escaped = value.charCodeAt(index++);
        if (!(escaped === 0x09 || escaped === 0x20 ||
          (escaped >= 0x21 && escaped <= 0x7e) || (escaped >= 0x80 && escaped <= 0xff))) return false;
      } else if (!(code === 0x09 || code === 0x20 || code === 0x21 ||
        (code >= 0x23 && code <= 0x5b) || (code >= 0x5d && code <= 0x7e) ||
        (code >= 0x80 && code <= 0xff))) return false;
    }
    return false;
  };

  skipOws();
  const typeStart = index;
  if (!token() || value[index++] !== "/") return null;
  const type = value.slice(typeStart, index - 1).toLowerCase();
  const subtypeStart = index;
  if (!token()) return null;
  const subtype = value.slice(subtypeStart, index).toLowerCase();

  while (index < value.length) {
    skipOws();
    if (index === value.length) break;
    if (value[index++] !== ";") return null;
    skipOws();
    if (index === value.length || value[index] === ";") continue; // Empty parameter slots are valid.
    if (!token() || value[index++] !== "=") return null;
    if (value[index] === '"') {
      if (!quotedString()) return null;
    } else if (!token()) return null;
  }
  return `${type}/${subtype}`;
};

export function mimeEssence(response) {
  const header = response.headers.get("content-type");
  if (header === null) return "";
  const essence = mediaTypeEssence(header);
  assert.ok(essence, "Invalid or combined Content-Type (MIME)");
  return essence;
}

// Native HTTP keeps field occurrences before Fetch/Headers can combine them.
// This transport is only for the disposable loopback SSR verification hosts.
export async function requestSsr(reference, { method = "GET", headers, signal = AbortSignal.timeout(15000) } = {}) {
  const url = new URL(reference);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port &&
    !url.username && !url.password && !url.hash, "SSR proof requires an explicit loopback HTTP endpoint");
  const message = await new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers, signal, agent: false }, resolve);
    request.once("error", reject);
    request.end();
  });
  try {
    const distinct = message.headersDistinct;
    const normalized = new Headers();
    for (const [name, values] of Object.entries(distinct)) {
      assert.ok(!["content-type", "location"].includes(name) || values.length === 1,
        "Multiple occurrences of HTTP singleton field: " + name);
      for (const value of values) normalized.append(name, value);
    }
    const chunks = [];
    for await (const chunk of message) chunks.push(chunk);
    assert.ok(message.complete, "Incomplete SSR HTTP response");
    const status = message.statusCode;
    const body = method === "HEAD" || [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
    const response = new Response(body, { status, headers: normalized });
    mimeEssence(response);
    return response;
  } finally {
    message.destroy();
  }
}
