export type CaptainStatus = "PENDING" | "APPROVED" | "SUSPENDED" | "REVOKED";
export type CaptainStanding = { actorId: string; status: CaptainStatus; version: number };
export type CaptainPage = { items: CaptainStanding[]; nextCursor?: string };

export const captainStatuses: ReadonlyArray<{ value: CaptainStatus; label: string }> = [
  { value: "PENDING", label: "بانتظار المراجعة" },
  { value: "APPROVED", label: "معتمد" },
  { value: "SUSPENDED", label: "موقوف" },
  { value: "REVOKED", label: "ملغى" },
];
export const captainStatusLabels: Record<CaptainStatus, string> =
  Object.fromEntries(captainStatuses.map(({ value, label }) => [value, label])) as Record<CaptainStatus, string>;

export function isCaptainStanding(value: unknown): value is CaptainStanding {
  return typeof value === "object" && value !== null &&
    typeof (value as CaptainStanding).actorId === "string" &&
    (value as CaptainStanding).actorId.length > 0 &&
    captainStatuses.some(({ value: status }) => status === (value as CaptainStanding).status) &&
    Number.isSafeInteger((value as CaptainStanding).version) && (value as CaptainStanding).version > 0;
}

export async function readCaptainJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) {
    if (response.status === 401) throw new Error("انتهت جلسة المشغّل. سجّل الدخول مجددًا.");
    if (response.status === 403) throw new Error("لا تملك صلاحية العمليات المطلوبة.");
    if (response.status === 404) throw new Error("لا يوجد طلب كابتن بهذا المعرّف.");
    throw new Error("تعذّر قراءة بيانات الكباتن من DSH. حاول مجددًا.");
  }
  return response.json();
}
