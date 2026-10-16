"use client";

import type { OperatorStoreSummary } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";

export function StoreOperationalDecision({ store, role, onInspect }: Readonly<{ store: OperatorStoreSummary; role: ActorRoleView | null; onInspect: () => void }>) {
  const paused = role && (!role.enabled || !role.securityEnabled);
  const pending = role && !role.activatedAt && !paused;
  const attentionReason = !role ? "حالة الحساب غير متاحة" : paused ? "حساب الشريك موقوف" : pending ? "الحساب يحتاج تفعيلًا" : null;
  const next = paused ? "مراجعة حساب الشريك" : pending ? "متابعة تفعيل الشريك" :
    store.publicationState === "published" ? "إدارة المتجر" :
    store.publicationState === "hidden" ? "مراجعة الإخفاء" : "فحص جاهزية النشر";
  return <div className="partner-decision">
    {attentionReason ? <small>{attentionReason}</small> : null}
    <button type="button" className="partner-row-action partner-next-action" data-adaptive-record-trigger={`partner-store-${store.id}`} onClick={onInspect}>
      {next} <span aria-hidden="true">←</span>
    </button>
  </div>;
}

