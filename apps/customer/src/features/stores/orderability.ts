import type { PublicStore } from "@bthwani/dsh";

// Presentation only. The DSH owner computes orderability and the client
// cannot turn a public discovery response into checkout permission.
export function describeStoreOrderability(
  store: Pick<PublicStore, "orderabilityStatus" | "orderingAvailable">,
): { headline: string; detail: string } {
  if (store.orderingAvailable !== false) {
    return {
      headline: "الطلب غير متاح تشغيليًا",
      detail: "لا يمكن إتمام طلب حتى تؤكد خدمة المتجر الجاهزية.",
    };
  }

  switch (store.orderabilityStatus) {
    case "PAUSED":
      return {
        headline: "المتجر متوقف مؤقتًا",
        detail: "يمكن تصفح عروض المتجر، لكن لا يمكن إتمام طلب أثناء التوقف.",
      };
    case "CLOSED_BY_SCHEDULE":
      return {
        headline: "المتجر مغلق بحسب الدوام",
        detail: "يمكن تصفح عروض المتجر، لكن لا يمكن إتمام طلب خارج مواعيد العمل.",
      };
    case "OPEN_FOR_ORDERS":
      return {
        headline: "المتجر ضمن ساعات العمل",
        detail: "لا يمكن إتمام طلب حتى تُفعّل خدمة الطلبات التجارية.",
      };
    default:
      return {
        headline: "الطلب غير متاح تشغيليًا",
        detail: "يمكن تصفح المتجر وعروضه، لكن لا يمكن إتمام طلب حاليًا.",
      };
  }
}
