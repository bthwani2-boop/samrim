export type OperationalAge = Readonly<{ label: string; needsReview: boolean }>;
const terminal = new Set(["DELIVERED", "REJECTED", "CANCELLED"]);
export function operationalAge(state: string, lastChangedAt: string, now: number): OperationalAge {
  if (terminal.has(state)) return { label: "مغلق", needsReview: false };
  if (state === "DELIVERY_FAILED") return { label: "تعثر التوصيل", needsReview: true };
  const timestamp = Date.parse(lastChangedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp > now + 60_000) return { label: "وقت غير موثوق", needsReview: false };
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed >= 24 * 60 * 60_000) {
    const days = Math.floor(elapsed / (24 * 60 * 60_000));
    return { label: `منذ ${days.toLocaleString("ar-YE")} يوم دون تحديث`, needsReview: true };
  }
  if (elapsed >= 60 * 60_000) {
    const hours = Math.floor(elapsed / (60 * 60_000));
    return { label: hours === 1 ? "أكثر من ساعة دون تحديث" : `منذ ${hours.toLocaleString("ar-YE")} ساعة دون تحديث`, needsReview: true };
  }
  if (elapsed >= 30 * 60_000) return { label: "أكثر من 30 دقيقة دون تحديث", needsReview: true };
  return { label: "منذ " + Math.floor(elapsed / 60_000) + " دقيقة", needsReview: false };
}
