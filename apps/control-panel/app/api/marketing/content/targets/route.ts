import { NextResponse } from "next/server";

import { listCatalogCategories, listCatalogProducts, listCatalogVerticals, listMarketingPromotions, listPublishedStoresForMarketing, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

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

  const params = new URL(request.url).searchParams;
  const targetType = params.get("targetType") as TargetType | null;
  const serviceCityId = params.get("serviceCityId")?.trim() ?? "";
  const query = params.get("query")?.trim() ?? "";
  if (!targetType || !["STORE", "PRODUCT", "CATEGORY", "PROMOTION", "INFO"].includes(targetType)) return errorResponse("INVALID_INPUT", "a valid targetType is required", 400);

  const context = { operatorActorId: identity.subject };
  try {
    let options: ReadonlyArray<TargetOption> = [];
    if (targetType === "STORE") {
      if (!serviceCityId) return errorResponse("INVALID_INPUT", "choose a service city to select a Store", 400);
      const result = await listPublishedStoresForMarketing(serviceCityId);
      options = result.stores.map((store) => targetOption(store.id, store.name, store.serviceCity.displayNameAr));
    } else if (targetType === "PRODUCT") {
      if (query.length < 2) return NextResponse.json({ options }, { headers: { "Cache-Control": "no-store" } });
      const result = await listCatalogProducts(query, "", "", context);
      options = result.products.filter((product) => product.active).map((product) => targetOption(product.id, product.canonicalName, product.brand));
    } else if (targetType === "CATEGORY") {
      const verticals = (await listCatalogVerticals(context)).verticals.filter((vertical) => vertical.active);
      const groups = await Promise.all(verticals.map((vertical) => listCatalogCategories(vertical.id)));
      options = groups.flatMap((group) => group.categories.filter((category) => category.active).map((category) => targetOption(category.id, category.nameAr, category.nameEn)));
    } else if (targetType === "PROMOTION") {
      const promotions = await listMarketingPromotions(context);
      const storeIDs = serviceCityId ? new Set((await listPublishedStoresForMarketing(serviceCityId)).stores.map((store) => store.id)) : null;
      options = promotions.promotions.filter((promotion) =>
        promotion.state === "PUBLISHED" &&
        (!serviceCityId || !promotion.serviceCityId || promotion.serviceCityId === serviceCityId) &&
        (!promotion.storeId || storeIDs?.has(promotion.storeId) === true)
      ).map((promotion) => targetOption(promotion.id, promotion.nameAr, promotion.code));
    }

    return NextResponse.json({ options }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery target lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
