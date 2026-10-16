"use client";

import { type JoiningCaseView, publicationReadinessBlockedReasonLabel, publicationStateLabel, type StorePublicationResponse } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { AdaptiveRecordPanel, useAdaptiveRecordView } from "../../shell/adaptive-record-workspace";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { partnerMutationHeaders } from "../partners/partner-request";
import { StoreProfileDashboard } from "./store-profile-dashboard";

const StoreManagement = lazy(async () => ({ default: (await import("./store-workspace")).StoreWorkspace }));

type PartnerContext = Readonly<{ partner: ActorRoleView; joiningCase: JoiningCaseView | null }>;

export function StoreInspector({ storeId, onClose, onPrevious, onNext, onUpdated }: Readonly<{
  storeId: string; onClose: () => void;
  onPrevious?: (() => void) | undefined; onNext?: (() => void) | undefined; onUpdated?: (() => void) | undefined;
}>) {
  const { state: session } = useSession();
  const recordView = useAdaptiveRecordView();
  const canViewFinance = session.kind === "authenticated" && session.identity.permissions?.includes("finance") === true;
  const canViewOperations = session.kind === "authenticated" && session.identity.permissions?.includes("operations") === true;
  const [store, setStore] = useState<StorePublicationResponse["store"] | null>(null);
  const [partner, setPartner] = useState<PartnerContext | null>(null);
  const [partnerError, setPartnerError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const openManagement = () => { setManageOpen(true); recordView?.expandForEditing(); };
  const sequence = useRef(0);

  const load = useCallback(async (signal: AbortSignal = AbortSignal.timeout(12000)) => {
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/publication`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(response.status === 403 ? "لا تملك صلاحية قراءة جاهزية المتجر." : await partnerErrorMessage(response));
      const result = await response.json() as StorePublicationResponse;
      if (request !== sequence.current) return;
      if (result.store?.id !== storeId || !Array.isArray(result.store.fulfillmentModes) || typeof result.store.publicationReadiness?.ready !== "boolean") {
        throw new Error("استجابة ملف المتجر غير صالحة.");
      }
      setStore(result.store);
      setPartner(null);
      setPartnerError("");
      try {
        const partnerResponse = await identityFetch(`/api/partners/roster/${encodeURIComponent(result.store.partnerActorId)}`, { cache: "no-store", signal });
        if (!partnerResponse.ok) throw new Error(await partnerErrorMessage(partnerResponse));
        const detail = await partnerResponse.json() as PartnerContext;
        if (request === sequence.current) setPartner(detail);
      } catch {
        if (request === sequence.current && !signal.aborted) setPartnerError("تعذرت قراءة بيانات حساب الشريك المرتبطة. معلومات المتجر ما زالت متاحة.");
      }
    } catch (cause) {
      if (request === sequence.current && !signal.aborted) {
        setError(cause instanceof Error ? cause.message : "تعذرت قراءة تفاصيل المتجر.");
        setStore(null);
      }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
    return () => { sequence.current += 1; controller.abort(); };
  }, [load]);

  async function changePublication() {
    if (!store || busy) return;
    const nextState = store.publicationState === "published" ? "hidden" : "published";
    if (nextState === "published" && !store.publicationReadiness.ready) {
      setError("النشر غير مسموح: " + publicationReadinessBlockedReasonLabel(store.publicationReadiness.blockedReason));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(store.id)}/publication`, {
        method: "POST", headers: partnerMutationHeaders(),
        body: JSON.stringify({ state: nextState, expectedVersion: store.version }),
      });
      if (!response.ok) {
        const failure = await partnerErrorMessage(response);
        await load();
        setError(failure);
        return;
      }
      const result = await response.json() as StorePublicationResponse;
      if (result.store?.id !== store.id) throw new Error("تعذرت مطابقة نتيجة العملية.");
      setStore(result.store);
      setConfirmHide(false);
      setNotice("تم تنفيذ العملية، وتحديث حالة المتجر من الخدمة المالكة.");
      onUpdated?.();
    } catch {
      await load();
      setError("لا يمكن تأكيد نتيجة العملية. تحقق من الحالة المقروءة قبل إعادة المحاولة.");
    } finally { setBusy(false); }
  }

  const publicationAction = store?.publicationState === "published" ? "إخفاء المتجر" : "نشر المتجر";
  const canPublish = Boolean(store && (store.publicationState === "published" || store.publicationReadiness.ready));

  return <AdaptiveRecordPanel title="تفاصيل المتجر" subtitle="الهوية والجاهزية والإجراءات المعتمدة" onClose={onClose} onPrevious={onPrevious} onNext={onNext}
    actions={canPublish || confirmHide ? <>
      {canPublish ? <button className={store?.publicationState === "published" ? "button button-secondary" : "button button-primary"} type="button"
        disabled={busy || loading} onClick={() => store?.publicationState === "published" && !confirmHide ? setConfirmHide(true) : void changePublication()}>
        {busy ? "جارٍ التنفيذ…" : confirmHide ? "تأكيد إخفاء المتجر" : publicationAction}
      </button> : null}
      {confirmHide ? <button type="button" className="button button-secondary" onClick={() => setConfirmHide(false)} disabled={busy}>إلغاء</button> : null}
    </> : null}>
    {loading && !store ? <p role="status" className="workspace-side-state">جارٍ قراءة بيانات المتجر…</p> : null}
    {error ? <div role="alert" className="managed-status managed-status-warning"><p>{error}</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>إعادة قراءة المعاينة</button></div> : null}
    {notice ? <p role="status" className="success-inline">{notice}</p> : null}
    {store ? <StoreProfileDashboard store={store} partner={partner} partnerError={partnerError} canViewFinance={canViewFinance} canViewOperations={canViewOperations} manageOpen={manageOpen} openManagement={openManagement} onUpdated={() => { void load(); onUpdated?.(); }} management={<Suspense fallback={<p role="status">جارٍ تحميل أدوات إدارة المتجر…</p>}><StoreManagement storeId={store.id} embedded onUpdated={() => { void load(); onUpdated?.(); }} /></Suspense>} /> : null}
  </AdaptiveRecordPanel>;
}
