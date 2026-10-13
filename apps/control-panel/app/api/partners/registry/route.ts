import { createHash } from "node:crypto";
import type { ActorRoleView } from "@bthwani/identity";
import type { OperatorStoreSummary } from "@bthwani/dsh";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStores, readOperatorPartnerStorePresence } from "../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRolesBatch, readOperatorSession, searchIdentityRoles } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

type Cursor = { v: 1; phase: "stores" | "partners"; from: string; scope: string };
export type RegistryRow = { kind: "store"; store: OperatorStoreSummary; partnerRole: ActorRoleView | null } | { kind: "partner"; actor: ActorRoleView };
const PAGE_SIZE = 10;
const errorResponse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
const encode = (cursor: Cursor) => (cursor.phase === "partners" ? "p1." : "") + Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decode(raw: string, scope: string): Cursor | null {
  if (!raw) return { v: 1, phase: "stores", from: "", scope };
  const token = raw.startsWith("p1.") ? raw.slice(3) : raw;
  if (token.length > 2400 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<Cursor>;
    return value.v === 1 && value.scope === scope && (value.phase === "stores" || value.phase === "partners") && raw.startsWith("p1.") === (value.phase === "partners") && typeof value.from === "string" && value.from.length <= 1024 ? value as Cursor : null;
  } catch { return null; }
}

export async function GET(request: Request) { return registry(request); }

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse(403, "FORBIDDEN", "cross-origin searches are forbidden");
  const body = await request.json().catch(() => null) as { q?: unknown } | null;
  if (!body || Object.keys(body).some((key) => key !== "q") || typeof body.q !== "string") return errorResponse(400, "INVALID_INPUT", "search query is required");
  return registry(request, body.q);
}

async function registry(request: Request, privateQuery?: string) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse(401, "UNAUTHENTICATED", "operator session is required");
  if (identity.role !== "operator") return errorResponse(403, "FORBIDDEN", "operator access is required");
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const p = new URL(request.url).searchParams;
  const q = (privateQuery ?? p.get("q") ?? "").trim();
  const state = p.get("state") ?? "";
  const serviceCityId = p.get("serviceCityId") ?? "";
  const sort = p.get("sort") ?? "updated_desc";
  const mode = p.get("mode") ?? "all";
  if (q.length > 100 || serviceCityId.length > 128 || !["", "unpublished", "published", "hidden"].includes(state) || !["updated_desc", "updated_asc"].includes(sort) || !["all", "stores", "without_store"].includes(mode)) {
    return errorResponse(400, "INVALID_INPUT", "invalid registry filters");
  }
  const allowPartnerOnly = !state && !serviceCityId && mode !== "stores";
  const scope = createHash("sha256").update(JSON.stringify({ q, state, serviceCityId, sort, mode })).digest("hex").slice(0, 20);
  const requested = decode(p.get("cursor") ?? "", scope);
  if (!requested) return errorResponse(400, "INVALID_CURSOR", "cursor does not match the selected filters");
  const cursor: Cursor = mode === "without_store" && requested.phase === "stores" ? { ...requested, phase: "partners", from: "" } : requested;
  const context = { operatorActorId: identity.subject };
  try {
    if (cursor.phase === "stores" && mode !== "without_store") {
      const page = await listOperatorStores(state, q, serviceCityId, "contains", sort, PAGE_SIZE, cursor.from, context);
      const ids = [...new Set(page.stores.map((store) => store.partnerActorId))];
      const roles = await readManagedIdentityRolesBatch(ids);
      const byActor = new Map(roles.map((role) => [role.actorId, role]));
      const rows: RegistryRow[] = page.stores.map((store) => ({ kind: "store", store, partnerRole: byActor.get(store.partnerActorId) ?? null }));
      const next: Cursor | null = page.nextCursor
        ? { v: 1, phase: "stores", from: page.nextCursor, scope }
        : allowPartnerOnly ? { v: 1, phase: "partners", from: "", scope } : null;
      if (rows.length || !next || next.phase === "stores") {
        return NextResponse.json({ rows, nextCursor: next ? encode(next) : "" }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    if (!allowPartnerOnly) return NextResponse.json({ rows: [], nextCursor: "" }, { headers: { "Cache-Control": "no-store" } });
    const rows: RegistryRow[] = [];
    let from = cursor.phase === "partners" ? cursor.from : "";
    let more = true;
    // Bounded scan: no full-table download and no per-partner HTTP requests.
    for (let batch = 0; batch < 5 && rows.length < PAGE_SIZE && more; batch++) {
      const page = await searchIdentityRoles("partner", q, PAGE_SIZE - rows.length, from, undefined, "phone_asc");
      if (!page.items.length) { more = false; break; }
      const owning = new Set(await readOperatorPartnerStorePresence(page.items.map((actor) => actor.actorId), context));
      for (const actor of page.items) if (!owning.has(actor.actorId)) rows.push({ kind: "partner", actor });
      from = page.nextCursor ?? "";
      more = Boolean(from);
    }
    return NextResponse.json({ rows, nextCursor: more && from ? encode({ v: 1, phase: "partners", from, scope }) : "" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(dshHttpStatus(error), payload.code, payload.message);
    }
    const payload = identityErrorPayload(error);
    return errorResponse(identityHttpStatus(error), payload.code, payload.message);
  }
}
