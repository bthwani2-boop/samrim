import { type OperatorMarketingSummary, type PromotionSettlementSummary, type CreatePromotionRequest, type DiscoveryContentAnalyticsListResponse, type DiscoveryContentResponse, dshOperationPaths, type MarketingPublicationRequest, type OperatorDiscoveryContentRegistryResponse, type OperatorPromotionRegistryResponse, type PromotionResponse, type OperatorPartnerDecisionPage, type CreateMarketingCampaignRequest, type MarketingCampaignPage, type MarketingCampaignResponse } from "@bthwani/dsh";
import { requestDshJson, requestDshMultipart, validateAttributedMutationContext, validateVersionedMutationContext, type DshOperatorReadContext, type JoiningCaseMutationContext, type StorePublicationMutationContext } from "./dsh-transport";
import type { StoreContentPerformanceSummary } from "@bthwani/dsh";

export type OperatorPromotionRegistryQuery = Readonly<{ search: string; state: string; discountKind?: string; fundingSource?: string; serviceCityId?: string; sort: "starts_desc" | "starts_asc"; cursor: string; limit: number }>;
export type OperatorDiscoveryContentRegistryQuery = Readonly<{ search: string; state: string; kind: string; sort: "priority" | "created_desc"; cursor: string; limit: number }>;

export async function listMarketingPromotions(query: OperatorPromotionRegistryQuery, context: DshOperatorReadContext): Promise<OperatorPromotionRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_MARKETING_READ_INPUT_INVALID");
  const serviceCityId = query.serviceCityId?.trim() ?? "";
  const discountKind = query.discountKind ?? "";
  const fundingSource = query.fundingSource ?? "";
  if ((discountKind && !["PERCENTAGE", "FIXED"].includes(discountKind)) || (fundingSource && !["BTHWANI", "PARTNER", "SHARED"].includes(fundingSource))) throw new Error("DSH_MARKETING_PROMOTION_FILTER_INVALID");
  if (query.search.trim().length > 128 || serviceCityId.length > 128 || query.cursor.length > 2048 || !["starts_desc", "starts_asc"].includes(query.sort) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error("DSH_MARKETING_PROMOTION_REGISTRY_INPUT_INVALID");
  const params = new URLSearchParams({ search: query.search.trim(), sort: query.sort, limit: String(query.limit) });
  if (query.state) params.set("state", query.state);
  if (discountKind) params.set("discountKind", discountKind);
  if (fundingSource) params.set("fundingSource", fundingSource);
  if (serviceCityId) params.set("serviceCityId", serviceCityId);
  if (query.cursor) params.set("cursor", query.cursor);
  const path = `${dshOperationPaths.listOperatorPromotions.path}?${params.toString()}`;
  return (await requestDshJson<OperatorPromotionRegistryResponse>(dshOperationPaths.listOperatorPromotions.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createMarketingPromotion(input: CreatePromotionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PromotionResponse }>> {
  if (!input.id.trim() || !input.code.trim() || !input.nameAr.trim() || !input.startsAt.trim()) throw new Error("DSH_MARKETING_PROMOTION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_PROMOTION_IDEMPOTENCY_INVALID");
  return requestDshJson<PromotionResponse>(dshOperationPaths.createOperatorPromotion.method, dshOperationPaths.createOperatorPromotion.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function setMarketingPromotionPublication(promotionId: string, input: MarketingPublicationRequest, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: PromotionResponse }>> {
  if (!promotionId.trim() || !input.state) throw new Error("DSH_MARKETING_PROMOTION_PUBLICATION_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_PROMOTION_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.setOperatorPromotionPublication.path.replace("{promotionId}", encodeURIComponent(promotionId.trim()));
  return requestDshJson<PromotionResponse>(dshOperationPaths.setOperatorPromotionPublication.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listMarketingContent(query: OperatorDiscoveryContentRegistryQuery, context: DshOperatorReadContext): Promise<OperatorDiscoveryContentRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_MARKETING_READ_INPUT_INVALID");
  if (query.search.trim().length > 128 || query.cursor.length > 2048 || !["priority", "created_desc"].includes(query.sort) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error("DSH_MARKETING_CONTENT_REGISTRY_INPUT_INVALID");
  const params = new URLSearchParams({ search: query.search.trim(), sort: query.sort, limit: String(query.limit) });
  if (query.state) params.set("state", query.state);
  if (query.kind) params.set("kind", query.kind);
  if (query.cursor) params.set("cursor", query.cursor);
  const path = `${dshOperationPaths.listOperatorDiscoveryContent.path}?${params.toString()}`;
  return (await requestDshJson<OperatorDiscoveryContentRegistryResponse>(dshOperationPaths.listOperatorDiscoveryContent.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createMarketingContentWithMedia(formData: FormData, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: DiscoveryContentResponse }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_CONTENT_IDEMPOTENCY_INVALID");
  return requestDshMultipart<DiscoveryContentResponse>(dshOperationPaths.createOperatorDiscoveryContent.method, dshOperationPaths.createOperatorDiscoveryContent.path, formData, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readOperatorStoreContentPerformanceSummary(storeId: string, context: DshOperatorReadContext): Promise<StoreContentPerformanceSummary> {
  const scope = storeId.trim();
  if (!context.operatorActorId.trim() || !scope || scope.length > 150) throw new Error("DSH_STORE_MARKETING_SUMMARY_SCOPE_INVALID");
  const route = dshOperationPaths.readOperatorStoreContentPerformanceSummary;
  const path = route.path.replace("{storeId}", encodeURIComponent(scope));
  return (await requestDshJson<StoreContentPerformanceSummary>(route.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listMarketingAnalytics(contentId: string, context: DshOperatorReadContext): Promise<DiscoveryContentAnalyticsListResponse> {
  if (!context.operatorActorId.trim() || !contentId.trim() || contentId.trim().length > 128) throw new Error("DSH_MARKETING_ANALYTICS_READ_INPUT_INVALID");
  const query = `?contentId=${encodeURIComponent(contentId.trim())}`;
  return (await requestDshJson<DiscoveryContentAnalyticsListResponse>(dshOperationPaths.listOperatorDiscoveryContentAnalytics.method, `${dshOperationPaths.listOperatorDiscoveryContentAnalytics.path}${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function setMarketingContentPublication(contentId: string, input: MarketingPublicationRequest, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: DiscoveryContentResponse }>> {
  if (!contentId.trim() || !input.state) throw new Error("DSH_MARKETING_CONTENT_PUBLICATION_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_CONTENT_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.setOperatorDiscoveryContentPublication.path.replace("{contentId}", encodeURIComponent(contentId.trim()));
  return requestDshJson<DiscoveryContentResponse>(dshOperationPaths.setOperatorDiscoveryContentPublication.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}



export async function readMarketingPromotionSettlementSummary(promotionId: string, context: DshOperatorReadContext): Promise<PromotionSettlementSummary> {
  if (!context.operatorActorId.trim() || !promotionId.trim() || promotionId.length > 128) throw new Error("DSH_MARKETING_SETTLEMENT_READ_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPromotionSettlementSummary.path.replace("{promotionId}", encodeURIComponent(promotionId.trim()));
  return (await requestDshJson<PromotionSettlementSummary>(dshOperationPaths.readOperatorPromotionSettlementSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readMarketingSummary(context: DshOperatorReadContext): Promise<OperatorMarketingSummary> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_MARKETING_SUMMARY_READ_INPUT_INVALID");
  return (await requestDshJson<OperatorMarketingSummary>(
    dshOperationPaths.readOperatorMarketingSummary.method,
    dshOperationPaths.readOperatorMarketingSummary.path,
    undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  )).payload;
}



export async function listMarketingPartnerDecisions(
  promotionId: string,
  cursor: string,
  decision: "" | "PENDING" | "OPTED_IN" | "DECLINED",
  context: DshOperatorReadContext,
): Promise<OperatorPartnerDecisionPage> {
  if (!context.operatorActorId.trim() || !promotionId.trim() || promotionId.length > 128 || cursor.length > 128)
    throw new Error("DSH_PARTNER_DECISIONS_READ_INPUT_INVALID");
  const route = dshOperationPaths.listOperatorPartnerDecisions;
  const path = route.path.replace("{promotionId}", encodeURIComponent(promotionId.trim()));
  const search = new URLSearchParams({ limit: "25" });
  if (cursor) search.set("cursor", cursor);
  if (decision) search.set("decision", decision);
  return (await requestDshJson<OperatorPartnerDecisionPage>(
    route.method,
    path + "?" + search.toString(),
    undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  )).payload;
}


// Canonical campaign registry: no client-side first-page filtering.



export function listOperatorMarketingCampaigns(
  state: string, cursor: string, context: DshOperatorReadContext,
): Promise<MarketingCampaignPage> {
  if (cursor.length > 128 || !["", "DRAFT", "PUBLISHED", "PAUSED", "ENDED", "ARCHIVED"].includes(state)) {
    throw new Error("MARKETING_CAMPAIGN_FILTER_INVALID");
  }
  const query = new URLSearchParams({ limit: "25" });
  if (state) query.set("state", state);
  if (cursor) query.set("cursor", cursor);
  return requestDshJson<MarketingCampaignPage>(
    dshOperationPaths.listOperatorMarketingCampaigns.method,
    dshOperationPaths.listOperatorMarketingCampaigns.path + "?" + query,
    undefined, { "X-Acting-Actor-ID": context.operatorActorId },
  ).then(({ payload }) => payload);
}

export function createOperatorMarketingCampaign(
  input: CreateMarketingCampaignRequest, context: JoiningCaseMutationContext,
): Promise<Readonly<{ status: number; payload: MarketingCampaignResponse }>> {
  validateAttributedMutationContext(context);
  return requestDshJson<MarketingCampaignResponse>(
    dshOperationPaths.createOperatorMarketingCampaign.method,
    dshOperationPaths.createOperatorMarketingCampaign.path, input,
    { "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey },
  );
}

export function setOperatorMarketingCampaignState(
  id: string, state: "PUBLISHED" | "PAUSED" | "ENDED" | "ARCHIVED", context: StorePublicationMutationContext,
): Promise<Readonly<{ status: number; payload: MarketingCampaignResponse }>> {
  validateVersionedMutationContext(context);
  return requestDshJson<MarketingCampaignResponse>(
    dshOperationPaths.setOperatorMarketingCampaignState.method,
    dshOperationPaths.setOperatorMarketingCampaignState.path.replace("{campaignId}", encodeURIComponent(id)),
    { state },
    { "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey, "X-Expected-Version": String(context.expectedVersion) },
  );
}

export function linkOperatorMarketingCampaignElement(
  id: string, kind: "PROMOTION" | "CONTENT", resourceId: string, context: StorePublicationMutationContext,
): Promise<Readonly<{ status: number; payload: MarketingCampaignResponse }>> {
  validateVersionedMutationContext(context);
  if (!id.trim() || id.length > 128 || !resourceId.trim() || resourceId.length > 128) throw new Error("INVALID_CAMPAIGN_LINK");
  return requestDshJson<MarketingCampaignResponse>(
    "POST",
    `/dsh/operator/marketing/campaigns/${encodeURIComponent(id)}/elements`,
    { kind, resourceId },
    { "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId,
      "Idempotency-Key": context.idempotencyKey, "X-Expected-Version": String(context.expectedVersion) },
  );
}
