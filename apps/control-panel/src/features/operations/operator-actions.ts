import type { OperatorAssignmentSummary, OrderState } from "@bthwani/dsh";
import { responseMessage } from "../access/identity-error-message";

export async function operationResponseMessage(response: Response): Promise<string> {
  if (response.status === 401) return responseMessage(response);
  if (response.status === 403) return "لا تملك صلاحية تنفيذ هذا الإجراء على الطلبات.";
  if (response.status === 404) return "لم يعد الطلب متاحًا. أعد قراءة قائمة الطلبات.";
  if (response.status === 409) return "تغيرت حالة الطلب. أعد قراءتها قبل المحاولة مرة أخرى.";
  if (response.status === 400) return "بيانات طلب العملية غير صالحة. راجع عوامل البحث أو بيانات الإجراء.";
  if (response.status === 408 || response.status === 504) return "استغرقت العملية وقتًا طويلًا. أعد القراءة قبل المحاولة مرة أخرى.";
  return "تعذر الاتصال بخدمة العمليات. أعد المحاولة.";
}

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
