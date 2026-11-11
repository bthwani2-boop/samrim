import { type CaptainOpportunityHeatmap, dshOperationPaths, type NotificationListResponse, type NotificationReadResponse, type OperatorOperationResponse, type OperatorOperationsResponse } from "@bthwani/dsh";
import { type DshOperatorReadContext, requestDshJson } from "./dsh-transport";



export async function readOperatorHomeAnalytics(context: DshOperatorReadContext, period: "7d" | "30d" = "7d"): Promise<import("@bthwani/dsh").OperatorHomeAnalytics> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_ANALYTICS_ACTOR_REQUIRED");
  return (await requestDshJson<import("@bthwani/dsh").OperatorHomeAnalytics>(
    dshOperationPaths.readOperatorHomeAnalytics.method,
    `${dshOperationPaths.readOperatorHomeAnalytics.path}?period=${period}`,
    undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  )).payload;
}

export type OperatorOperationsFilters = Readonly<{
  storeName?: string;
  fromDate?: string;
  toDate?: string;
  paymentSource?: string;
  fulfillmentMode?: string;
}>;

export async function listOperatorOperations(state: string, search: string, sort: string, limit: number, cursor: string, actionableOnly: boolean, context: DshOperatorReadContext, storeId = "", filters: OperatorOperationsFilters = {}): Promise<OperatorOperationsResponse> {
	if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.trim().length > 2048 || search.trim().length > 128 || (sort !== "updated_desc" && sort !== "updated_asc") || storeId.length > 128) {
		throw new Error("DSH_OPERATOR_OPERATIONS_INPUT_INVALID");
	}
	const params = new URLSearchParams({ limit: String(limit) });
	if (state.trim()) params.set("state", state.trim());
	if (search.trim()) params.set("q", search.trim());
	if (sort !== "updated_desc") params.set("sort", sort);
	if (cursor.trim()) params.set("cursor", cursor.trim());
	if (actionableOnly) params.set("actionableOnly", "true");
	if (storeId.trim()) params.set("storeId", storeId.trim());
	for (const key of ["storeName", "fromDate", "toDate", "paymentSource", "fulfillmentMode"] as const) {
		const value = filters[key]?.trim();
		if (value) params.set(key, value);
	}
	const path = `${dshOperationPaths.listOperatorOperations.path}?${params.toString()}`;
	const payload = (await requestDshJson<OperatorOperationsResponse>(dshOperationPaths.listOperatorOperations.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
	if (Object.values(filters).some(value => Boolean(value?.trim())) && payload.filterEngineVersion !== 1) {
		throw new Error("DSH_OPERATOR_FILTER_ENGINE_UPGRADE_REQUIRED");
	}
	return payload;
}

export async function listOperatorNotifications(limit: number, context: DshOperatorReadContext, cursor = ""): Promise<NotificationListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.length > 1024) {
    throw new Error("DSH_OPERATOR_NOTIFICATIONS_INPUT_INVALID");
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const path = `${dshOperationPaths.listNotifications.path}?${params.toString()}`;
  return (await requestDshJson<NotificationListResponse>(dshOperationPaths.listNotifications.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function markOperatorNotificationRead(notificationId: string, context: DshOperatorReadContext): Promise<NotificationReadResponse> {
  if (!notificationId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_NOTIFICATION_READ_INPUT_INVALID");
  const path = dshOperationPaths.markNotificationRead.path.replace("{notificationId}", encodeURIComponent(notificationId.trim()));
  return (await requestDshJson<NotificationReadResponse>(dshOperationPaths.markNotificationRead.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorOperation(orderId: string, context: DshOperatorReadContext): Promise<OperatorOperationResponse> {
	if (!orderId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_OPERATION_READ_INPUT_INVALID");
	const path = dshOperationPaths.readOperatorOperation.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
	return (await requestDshJson<OperatorOperationResponse>(dshOperationPaths.readOperatorOperation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorOpportunities(context: DshOperatorReadContext): Promise<CaptainOpportunityHeatmap> {
  const response = await requestDshJson<CaptainOpportunityHeatmap>("GET", "/dsh/operator/opportunities", undefined, {
    "X-Acting-Actor-ID": context.operatorActorId,
  });
  return response.payload;
}
