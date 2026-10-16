import { NextResponse } from "next/server";
import { listCatalogProductRegistry, listOperatorOperations, listOperatorStores } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession, searchIdentityRoles } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

// A bounded read coordinator. Each service remains its record/query owner;
// private search text is carried in a POST body, never in browser history.
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (status: number, message: string) => NextResponse.json({ error: { message } }, { status, headers });
  if (!verifySameOrigin(request)) return fail(403, "مصدر البحث غير مسموح.");
  const identity = await readOperatorSession();
  if (!identity) return fail(401, "يلزم تسجيل الدخول.");
  if (identity.role !== "operator") return fail(403, "البحث للمشغّلين فقط.");
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "query") || !("query" in body) || typeof body.query !== "string") return fail(400, "أدخل نص البحث.");
  const query = body.query.trim();
  if (query.length < 2 || query.length > 100) return fail(400, "استخدم من حرفين إلى مئة حرف للبحث.");
  const permissions = identity.permissions ?? [];
  const context = { operatorActorId: identity.subject };
  const sources: { key: string; label: string; read: () => Promise<ReadonlyArray<{ label: string; href: string }>> }[] = [];
  if (permissions.includes("operations")) sources.push({ key: "orders", label: "الطلبات", read: async () => {
    const page = await listOperatorOperations("", query, "updated_desc", 5, "", false, context);
    return page.operations.map((item) => ({ label: item.storeName, href: `/operations/${encodeURIComponent(item.orderId)}` }));
  } });
  if (permissions.includes("partners")) {
    sources.push({ key: "stores", label: "المتاجر", read: async () => {
      const page = await listOperatorStores("", query, "", "contains", "updated_desc", 5, "", context);
      return page.stores.map((item) => ({ label: item.name, href: `/partners/stores/${encodeURIComponent(item.id)}` }));
    } });
    sources.push({ key: "partners", label: "حسابات الشركاء", read: async () => {
      const page = await searchIdentityRoles("partner", query, 5);
      return page.items.map((item) => ({ label: item.fullNameAr?.trim() || item.phoneE164, href: `/partners/actors/${encodeURIComponent(item.actorId)}` }));
    } });
  }
  if (permissions.includes("catalog")) sources.push({ key: "products", label: "المنتجات", read: async () => {
    const page = await listCatalogProductRegistry({ query, verticalId: "", categoryId: "", active: "all", sort: "name_asc", cursor: "" }, context);
    return page.products.slice(0, 5).map((item) => ({ label: item.canonicalName, href: `/catalog?mode=edit&productId=${encodeURIComponent(item.id)}` }));
  } });
  const results = await Promise.allSettled(sources.map((source) => source.read()));
  const groups = results.map((result, index) => ({ key: sources[index]!.key, label: sources[index]!.label,
    ...(result.status === "fulfilled" ? { status: "ready", items: result.value } : { status: "error", items: [] }),
  }));
  return NextResponse.json({ groups }, { headers });
}
