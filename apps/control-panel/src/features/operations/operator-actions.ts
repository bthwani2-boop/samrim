import type { OperatorAssignmentSummary, OrderState } from "@bthwani/dsh";

export type OperatorAction = "dispatch" | "reassign" | "recover";

export function operationActionLabel(action: OperatorAction): string {
  if (action === "dispatch") return "إرسال للتوزيع";
  if (action === "reassign") return "إعادة التوزيع";
  return "استعادة التسليم";
}

export function resolveOperatorAction(item: Readonly<{ state: OrderState; assignment: OperatorAssignmentSummary | null }>): OperatorAction | null {
	if (item.state === "READY_FOR_DISPATCH") return "dispatch";
	if (item.state === "CAPTAIN_ASSIGNED" && item.assignment?.state === "assigned") return "reassign";
	if (item.state === "DELIVERY_FAILED" && item.assignment?.state === "delivery_failed") return "recover";
  return null;
}
