import { NextResponse } from "next/server";

import { listCatalogCategories, listCatalogProducts, listCatalogVerticals, listMarketingPromotions, listOperatorStores, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";

type TargetType = "STORE" | "PRODUCT" | "CATEGORY" | "PROMOTION" | "INFO";
type TargetOption = Readonly<{ id: string; label: string; detail?: string }>;

function targetOption(id: string, label: string, detail?: string | null): TargetOption {
  const normalizedDetail = detail?.trim();
  return { id, label, ...(normalizedDetail ? { detail: normalizedDetail } : {}) };
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (permissionDenied) return permissionDenied;

  const params = new URL(request.url).searchParams;
  const targetType = params.get("targetType") as TargetType | null;
  const serviceCityId = params.get("serviceCityId")?.trim() ?? "";
  const query = params.get("query")?.trim() ?? "";
  const rawCursor = params.get("cursor") ?? "";
  const cursor = rawCursor.trim();
  if (rawCursor.length > 1024) return errorResponse("INVALID_INPUT", "target cursor is invalid", 400);
  if (!targetType || !["STORE", "PRODUCT", "CATEGORY", "PROMOTION", "INFO"].includes(targetType)) return errorResponse("INVALID_INPUT", "a valid targetType is required", 400);
  if (Array.from(query).length > 128 || serviceCityId.length > 128) return errorResponse("INVALID_INPUT", "target search or service city is too long", 400);

  const context = { operatorActorId: identity.subject };
  try {
    let options: ReadonlyArray<TargetOption> = [];
    let nextCursor = "";
    if (targetType === "STORE") {
      if (!serviceCityId) return errorResponse("INVALID_INPUT", "choose a service city to select a Store", 400);
      if (Array.from(query).length < 2) return NextResponse.json({ options, nextCursor }, { headers: { "Cache-Control": "no-store" } });
      const result = await listOperatorStores("published", query, serviceCityId, "name_prefix", "name_asc", 25, cursor, context);
      options = result.stores.map((store) => targetOption(store.id, store.name));
      nextCursor = result.nextCursor ?? "";
    } else if (targetType === "PRODUCT") {
      if (query.length < 2) return NextResponse.json({ options, nextCursor }, { headers: { "Cache-Control": "no-store" } });
      const result = await listCatalogProducts(query, "", cursor, context);
      options = result.products.filter((product) => product.active).map((product) => targetOption(product.id, product.canonicalName, product.brand));
      nextCursor = result.nextCursor ?? "";
    } else if (targetType === "CATEGORY") {
      const verticals = (await listCatalogVerticals(context)).verticals.filter((vertical) => vertical.active);
      const groups = await Promise.all(verticals.map((vertical) => listCatalogCategories(vertical.id)));
      options = groups.flatMap((group) => group.categories.filter((category) => category.active).map((category) => targetOption(category.id, category.nameAr, category.nameEn)));
    } else if (targetType === "PROMOTION") {
      if (query.length < 2) return NextResponse.json({ options, nextCursor }, { headers: { "Cache-Control": "no-store" } });
      const promotions = await listMarketingPromotions({ search: query, state: "PUBLISHED", sort: "starts_desc", cursor, limit: 25 }, context);
      options = promotions.promotions.filter((promotion) => !serviceCityId || !promotion.serviceCityId || promotion.serviceCityId === serviceCityId).map((promotion) => targetOption(promotion.id, promotion.nameAr, promotion.code));
      nextCursor = promotions.nextCursor ?? "";
    }

    return NextResponse.json({ options, nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery target lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
