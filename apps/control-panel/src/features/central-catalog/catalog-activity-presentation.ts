import type { CatalogActivityItem } from "@bthwani/dsh";

type ActivitySummary = Pick<CatalogActivityItem, "action" | "kind" | "subject" | "storeName">;

export function activityTitle(item: ActivitySummary): string {
  const action = item.action === "created" ? "تمت إضافة" : item.action === "updated" ? "تم تعديل" : "تم نقل بيانات";
  const noun = item.kind === "product" ? "المنتج" : "عرض المنتج";
  return `${action} ${noun} «${item.subject || "اسم غير متاح"}»`;
}

export function activityContext(item: ActivitySummary): string {
  return item.kind === "offer" ? `المتجر: ${item.storeName || "اسم المتجر غير متاح"}` : "الكتالوج المشترك";
}

export function activityActor(actorId: string): string {
  if (actorId.startsWith("system:")) return "بواسطة النظام";
  return actorId ? "بواسطة حساب مسجل" : "المنفّذ غير متاح";
}
