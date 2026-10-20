type Orderability = Readonly<{ fulfillmentMode: string; state: string; reason?: string | null }>;

function pausedReason(item: Orderability): string {
  const reason = item.reason?.trim() ?? "";
  return /[\u0600-\u06FF]/u.test(reason) ? reason : "أوقف المتجر استقبال الطلبات مؤقتًا.";
}

export function summarizeStoreAvailability(
  modes: ReadonlyArray<Orderability>,
  selectedMode: string | null,
): Readonly<{ label: string; reason: string }> {
  if (selectedMode) {
    const selected = modes.find((mode) => mode.fulfillmentMode === selectedMode);
    if (!selected) return { label: "غير متاح", reason: "تعذر التحقق من طريقة الطلب المحددة." };
    if (selected.state === "OPEN_FOR_ORDERS") return { label: "مفتوح", reason: "" };
    if (selected.state === "CLOSED_BY_SCHEDULE") return { label: "مغلق", reason: "خارج ساعات العمل الآن." };
    if (selected.state === "PAUSED") return { label: "متوقف", reason: pausedReason(selected) };
    return { label: "غير متاح", reason: "طريقة الطلب غير متاحة حاليًا." };
  }
  if (!modes.length) return { label: "غير متاح", reason: "تعذر التحقق من استقبال الطلبات. أعد فتح المتجر للمحاولة." };
  if (modes.some((mode) => mode.state === "OPEN_FOR_ORDERS")) return { label: "اختر طريقة الطلب", reason: "" };
  if (modes.every((mode) => mode.state === "CLOSED_BY_SCHEDULE")) return { label: "مغلق", reason: "خارج ساعات العمل الآن." };
  if (modes.every((mode) => mode.state === "PAUSED")) return { label: "متوقف", reason: pausedReason(modes[0]!) };
  return { label: "غير متاح", reason: "لا توجد طريقة طلب متاحة حاليًا." };
}
