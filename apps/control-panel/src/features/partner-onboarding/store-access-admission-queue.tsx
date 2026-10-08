"use client";

import type { StoreAccessGrant, StoreAccessGrantListResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";

type AdmissionQueueState = "loading" | "ready" | "error";

const permissionLabels: Readonly<Record<string, string>> = {
  orders: "إدارة الطلبات",
  catalog: "إدارة كتالوج المتجر",
  store_operations: "إدارة إتاحة المتجر",
};

function stateLabel(state: StoreAccessGrant["state"]): string {
  switch (state) {
    case "pending_role_admission": return "بانتظار اعتماد دور الشريك";
    case "pending_acceptance": return "بانتظار قبول المدعو";
    case "pending_partner_activation": return "بانتظار تفعيل وصول الشريك";
    case "active": return "وصول نشط";
    case "suspended": return "وصول موقوف";
    case "revoked": return "وصول ملغى";
    case "declined": return "دعوة مرفوضة";
    case "expired": return "انتهت الدعوة";
  }
}

export function StoreAccessAdmissionQueue() {
  const [state, setState] = useState<AdmissionQueueState>("loading");
  const [items, setItems] = useState<StoreAccessGrantListResponse["items"]>([]);
  const [busyGrantId, setBusyGrantId] = useState("");
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, { idempotencyKey: string; correlationId: string }>());

  const reload = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/partners/store-access-admissions", { cache: "no-store" });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as StoreAccessGrantListResponse;
      setItems(page.items);
      setState("ready");
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "تعذر قراءة اعتمادات دور الشريك.");
      setState("error");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function admit(grant: StoreAccessGrant) {
    if (busyGrantId) return;
    setBusyGrantId(grant.id);
    setError("");
    const attemptKey = `${grant.id}:${grant.version}`;
    const attempt = attempts.current.get(attemptKey) ?? { idempotencyKey: `store_access_admission_${crypto.randomUUID()}`, correlationId: `store_access_admission_corr_${crypto.randomUUID()}` };
    attempts.current.set(attemptKey, attempt);
    try {
      const response = await fetch(`/api/partners/store-access-admissions/${encodeURIComponent(grant.id)}/provision`, {
        method: "POST",
        headers: { "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
      });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      attempts.current.delete(attemptKey);
      await reload();
    } catch (cause) {
      await reload();
      setError(cause instanceof Error ? cause.message : "تعذر اعتماد الدور.");
    } finally {
      setBusyGrantId("");
    }
  }

  return <section className="joining-case-queue" aria-label="اعتمادات دور الشريك لدعوات الوصول">
    <div className="partner-registry-summary"><span>الدعوات التي قبلها أصحابها وتحتاج اعتماد دور الشريك</span><button type="button" className="button button-secondary" disabled={state === "loading" || Boolean(busyGrantId)} onClick={() => void reload()}>إعادة القراءة</button></div>
    {state === "loading" ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تحميل الاعتمادات </strong></div> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال العملية</strong><p>{error}</p></div> : null}
    {state === "ready" && items.length === 0 ? <div className="collection-state"><strong>لا توجد دعوات مقبولة بانتظار اعتماد الدور</strong><p>تظهر الدعوة هنا بعد أن يقبلها المدعو، ويجب أن يظل صاحبها حساب الحسابات قائمًا ومؤمّنًا.</p></div> : null}
    {items.length ? <div className="joining-case-table-wrap"><table className="operations-table partner-registry-table">
      <caption className="visually-hidden">دعوات Store Access المنتظرة لاعتماد دور Partner</caption>
      <thead><tr><th scope="col">المتجر</th><th scope="col">هاتف المدعو</th><th scope="col">الصلاحيات المطلوبة</th><th scope="col">الحالة</th><th scope="col">انتهاء الدعوة</th><th scope="col">الإجراء</th></tr></thead>
      <tbody>{items.map((grant) => <tr key={grant.id}><th scope="row">{grant.storeName}</th><td><bdi dir="ltr">{grant.delegatePhoneMasked ?? "غير متاح"}</bdi></td><td>{grant.permissions.map((permission) => permissionLabels[permission] ?? "صلاحية إضافية").join("، ")}</td><td>{stateLabel(grant.state)}</td><td><time dateTime={grant.expiresAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(grant.expiresAt))}</time></td><td><button type="button" className="button button-primary" disabled={Boolean(busyGrantId)} onClick={() => void admit(grant)}>{busyGrantId === grant.id ? "جارٍ التحقق والاعتماد…" : "اعتماد الدور"}</button></td></tr>)}</tbody>
    </table></div> : null}
  </section>;
}
