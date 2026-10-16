import { createHash } from "node:crypto";
import type { JoiningCaseSummary, StoreAccessGrant } from "@bthwani/dsh";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listJoiningCases, listStoreAccessRoleAdmissionsForOperator } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { GET as readRegistry, POST as searchRegistry } from "../registry/route";

type Source = "joining" | "access" | "registry";
type Cursor = { v: 1; scope: string; from: Record<Source, string>; done: Record<Source, boolean> };
type Row = { kind: "joining"; case: JoiningCaseSummary } | { kind: "access"; grant: StoreAccessGrant } | { kind: "store"; store: unknown; partnerRole: unknown } | { kind: "partner"; actor: unknown };
const sources: Source[] = ["joining", "access", "registry"];
const states = ["", "submitted", "admission_requested", "needs_correction", "draft", "approved", "pending_role_admission", "published", "unpublished", "hidden"];
const rejected = (status: number, message: string) => NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
const encode = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decode(raw: string, scope: string): Cursor | null {
  if (!raw) return { v: 1, scope, from: { joining: "", access: "", registry: "" }, done: { joining: false, access: false, registry: false } };
  if (raw.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    return c?.v === 1 && c.scope === scope && c.from && c.done &&
      sources.every((key) => typeof c.from[key] === "string" && c.from[key].length <= (key === "access" ? 512 : 2500) && typeof c.done[key] === "boolean") ? c : null;
  } catch { return null; }
}
const joiningState = (s: string) => ["submitted", "admission_requested", "needs_correction", "draft", "approved"].includes(s);
const publication = (s: string) => ["published", "unpublished", "hidden"].includes(s);
const phoneQuery = (s: string) => /^\+?[\d\s-]{5,}$/.test(s) && s.replace(/\D/g, "").length >= 5;

export async function GET(request: Request) { return readWorkbench(request); }
export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return rejected(403, "مصدر البحث غير مصرح به.");
  const body = await request.json().catch(() => null) as { q?: unknown } | null;
  if (!body || Object.keys(body).some((key) => key !== "q") || typeof body.q !== "string") return rejected(400, "بحث غير صالح.");
  return readWorkbench(request, body.q);
}

async function readWorkbench(request: Request, privateQuery?: string): Promise<Response> {
  const identity = await readOperatorSession();
  if (!identity) return rejected(401, "جلسة المشغل مطلوبة.");
  if (identity.role !== "operator") return rejected(403, "هذه الوظيفة للمشغل فقط.");
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const p = new URL(request.url).searchParams;
  const kind = p.get("kind") || "all";
  const status = p.get("status") ?? "";
  const city = p.get("serviceCityId") ?? "";
  const sort = p.get("sort") === "oldest" ? "oldest" : "newest";
  const q = (privateQuery ?? p.get("q") ?? "").trim();
  if (!["all", "requests", "joining", "access", "store", "partner"].includes(kind) || !states.includes(status) ||
    q.length > 100 || city.length > 128 || (city && kind !== "all" && kind !== "store") ||
    (privateQuery === undefined && phoneQuery(q))) return rejected(400, "فلاتر غير صالحة.");
  const scope = createHash("sha256").update(JSON.stringify({ actor: identity.subject, kind, status, city, sort, q })).digest("hex").slice(0, 24);
  const cursor = decode(p.get("cursor") ?? "", scope);
  if (!cursor) return rejected(400, "انتهت صلاحية الصفحة أو تغيّرت مرشحاتها.");
  const allowed = {
    joining: (kind === "all" || kind === "requests" || kind === "joining") && !city && !publication(status) && status !== "pending_role_admission",
    access: (kind === "all" || kind === "requests" || kind === "access") && !city && (!status || status === "pending_role_admission"),
    registry: (kind === "all" || kind === "store" || kind === "partner") && !joiningState(status) && status !== "pending_role_admission" && (kind !== "partner" || !publication(status)),
  };
  const limits = kind === "all" ? { joining: 5, access: 4, registry: 11 } :
    kind === "requests" ? { joining: 10, access: 10, registry: 0 } :
    { joining: 20, access: 20, registry: 20 };
  const next: Cursor = { v: 1, scope, from: { ...cursor.from }, done: { ...cursor.done } };
  const rows: Row[] = [];
  const context = { operatorActorId: identity.subject };
  try {
    // Independent opaque cursors preserve all records; no source is truncated at its first page.
    if (allowed.joining && !next.done.joining) {
      const page = await listJoiningCases(joiningState(status) ? status : "", q, sort === "oldest" ? "created_asc" : "created_desc", limits.joining, next.from.joining, context);
      rows.push(...page.cases.map((item) => ({ kind: "joining" as const, case: item })));
      next.from.joining = page.nextCursor ?? "";
      next.done.joining = !page.nextCursor;
    } else next.done.joining = true;

    if (allowed.access && !next.done.access) {
      let from = next.from.access;
      let reachedEnd = false;
      // Access admissions have no search parameter. Scan bounded chunks and retain the continuation.
      for (let batch = 0; batch < 8; batch++) {
        const page = await listStoreAccessRoleAdmissionsForOperator(context, limits.access, from);
        from = page.nextCursor ?? "";
        const matches = q ? page.items.filter((item) =>
          item.storeName.toLocaleLowerCase("ar").includes(q.toLocaleLowerCase("ar")) ||
          (item.delegatePhoneMasked ?? "").includes(q)) : page.items;
        rows.push(...matches.map((item) => ({ kind: "access" as const, grant: item })));
        reachedEnd = !from;
        if (matches.length || reachedEnd || !q) break;
      }
      next.from.access = from;
      next.done.access = reachedEnd;
    } else next.done.access = true;

    if (allowed.registry && !next.done.registry) {
      const url = new URL("/api/partners/registry", request.url);
      url.searchParams.set("mode", kind === "store" ? "stores" : kind === "partner" ? "without_store" : "all");
      url.searchParams.set("sort", sort === "oldest" ? "updated_asc" : "updated_desc");
      if (publication(status)) url.searchParams.set("state", status);
      if (city) url.searchParams.set("serviceCityId", city);
      if (next.from.registry) url.searchParams.set("cursor", next.from.registry);
      if (q && !phoneQuery(q)) url.searchParams.set("q", q);
      const response = phoneQuery(q) ?
        await searchRegistry(new Request(url, { method: "POST", headers: {
          "Content-Type": "application/json",
          Origin: request.headers.get("origin") || new URL(request.url).origin,
          Host: request.headers.get("host") || new URL(request.url).host,
          "Sec-Fetch-Site": "same-origin",
        }, body: JSON.stringify({ q }) })) :
        await readRegistry(new Request(url));
      if (!response.ok) return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      const page = await response.json() as { rows: Row[]; nextCursor?: string };
      rows.push(...page.rows);
      next.from.registry = page.nextCursor ?? "";
      next.done.registry = !page.nextCursor;
    } else next.done.registry = true;

    return NextResponse.json({ rows, nextCursor: sources.every((key) => next.done[key]) ? "" : encode(next), ordering: "source_priority" },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return NextResponse.json({ error: payload }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    }
    return rejected(503, "تعذرت قراءة أحد مصادر سجل الشركاء، ولم تُعرض نتائج جزئية.");
  }
}
