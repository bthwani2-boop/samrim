"use client";

import type { StoreAccessGrant, StoreAccessGrantListResponse } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { useReadOnReturn } from "../shared/use-read-on-return";

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
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [nextCursor, setNextCursor] = useState("");
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [busyGrantId, setBusyGrantId] = useState("");
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, { idempotencyKey: string; correlationId: string }>());

  useEffect(() => {
    const saved = window.history.state as { storeAccessPageCursor?: unknown; storeAccessPageHistory?: unknown } | null;
    const stack = saved?.storeAccessPageHistory;
    if (typeof saved?.storeAccessPageCursor === "string" && saved.storeAccessPageCursor.length <= 512 &&
      Array.isArray(stack) && stack.length <= 100 && stack.every((item) => typeof item === "string" && item.length <= 512)) {
      setCursor(saved.storeAccessPageCursor);
      setCursorStack(stack);
    }
    setHistoryReady(true);
  }, []);
  useEffect(() => {
    if (!historyReady) return;
    window.history.replaceState({ ...window.history.state, storeAccessPageCursor: cursor, storeAccessPageHistory: cursorStack }, "");
  }, [cursor, cursorStack, historyReady]);

  const reload = useCallback(async (showLoading = true) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    if (showLoading) setState("loading");
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/partners/store-access-admissions?${params}`, { cache: "no-store", signal: controller.signal });
      if (sequence !== requestSequence.current) return;
      if (response.status === 400 && cursor) {
        setCursor("");
        setCursorStack([]);
        return;
      }
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as StoreAccessGrantListResponse;
      if (sequence !== requestSequence.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
      if (page.items.length === 0 && cursor) {
        setCursor(cursorStack.at(-1) ?? "");
        setCursorStack(cursorStack.slice(0, -1));
        return;
      }
      setState("ready");
    } catch (cause) {
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      setItems([]);
      setNextCursor("");
      setError(cause instanceof Error ? cause.message : "تعذر قراءة اعتمادات دور الشريك.");
      setState("error");
    }
  }, [cursor, cursorStack]);

  useEffect(() => {
    if (historyReady) void reload();
    return () => { activeRequest.current?.abort(); };
  }, [reload, historyReady]);
  useReadOnReturn(() => reload(false), historyReady && !busyGrantId);

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
    <div className="partner-registry-summary"><span>الدعوات التي قبلها أصحابها وتحتاج اعتماد دور الشريك</span>{state === "ready" ? <span role="status">الصفحة {cursorStack.length + 1} · {items.length} اعتماد معروض</span> : null}</div>
    {state === "loading" ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تحميل الاعتمادات </strong></div> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال العملية</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={Boolean(busyGrantId)} onClick={() => void reload()}>إعادة المحاولة</button></div> : null}
    {state === "ready" && items.length === 0 ? <div className="collection-state"><strong>لا توجد دعوات مقبولة بانتظار اعتماد الدور</strong><p>تظهر الدعوة هنا بعد أن يقبلها المدعو، ويجب أن يظل صاحبها حساب الحسابات قائمًا ومؤمّنًا.</p></div> : null}
    {items.length ? <div className="joining-case-table-wrap"><table className="operations-table partner-registry-table">
      <caption className="visually-hidden">دعوات Store Access المنتظرة لاعتماد دور Partner</caption>
      <thead><tr><th scope="col">المتجر</th><th scope="col">هاتف المدعو</th><th scope="col">الصلاحيات المطلوبة</th><th scope="col">الحالة</th><th scope="col">انتهاء الدعوة / آخر تحديث</th><th scope="col">الإجراء</th></tr></thead>
      <tbody>{items.map((grant) => <tr key={grant.id}><th scope="row"><Link href={`/partners/stores/${encodeURIComponent(grant.storeId)}`}>{grant.storeName}</Link></th><td><bdi dir="ltr">{grant.delegatePhoneMasked ?? "غير متاح"}</bdi></td><td><div className="joining-case-row-main"><span>{grant.permissions.map((permission) => permissionLabels[permission] ?? "صلاحية إضافية").join("، ") || "لم تُحدد صلاحيات"}</span><small>الصلاحيات المطلوبة لهذا المتجر فقط</small></div></td><td>{stateLabel(grant.state)}</td><td><div className="joining-case-row-main"><time dateTime={grant.expiresAt}>تنتهي: {new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(grant.expiresAt))}</time><small>تحديث: <time dateTime={grant.updatedAt}>{new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium" }).format(new Date(grant.updatedAt))}</time></small></div></td><td><button type="button" className="button button-primary" disabled={Boolean(busyGrantId)} onClick={() => void admit(grant)}>{busyGrantId === grant.id ? "جارٍ التحقق والاعتماد…" : "اعتماد الدور"}</button></td></tr>)}</tbody>
    </table></div> : null}
    {cursorStack.length > 0 || nextCursor ? <nav className="partner-registry-pagination" aria-label="صفحات اعتمادات الوصول">
      <button type="button" className="button button-secondary" disabled={state === "loading" || Boolean(busyGrantId) || cursorStack.length === 0} onClick={() => { setCursor(cursorStack.at(-1) ?? ""); setCursorStack(cursorStack.slice(0, -1)); }}>السابق</button>
      <span aria-current="page">الصفحة {cursorStack.length + 1}</span>
      <button type="button" className="button button-secondary" disabled={state === "loading" || Boolean(busyGrantId) || !nextCursor} onClick={() => { setCursorStack((current) => [...current, cursor]); setCursor(nextCursor); }}>التالي</button>
    </nav> : null}
  </section>;
}
