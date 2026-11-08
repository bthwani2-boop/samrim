"use client";

import type { StorePublicationResponse } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { StoreCommercialAgreementProposal } from "../partner-onboarding/store-commercial-agreement-proposal";

type Store = StorePublicationResponse["store"];
const validModes = new Set(["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]);

/** The Store agreement remains the WLT-owned commercial fact. This policy surface
 * selects its model through the existing versioned proposal, not a second store setting. */
export function StoreCommercialModelPolicyWorkspace() {
  const { state } = useSession();
  const permissions = state.kind === "authenticated" ? state.identity.permissions : null;
  const allowed = state.kind === "authenticated" && state.identity.role === "operator"
    && permissions?.includes("platform_policies") === true
    && permissions.includes("finance") && permissions.includes("partners")
    && Boolean(state.identity.subject && state.identity.sessionId);
  if (!allowed || state.kind !== "authenticated") return <p className="validation-error" role="alert">
    اختيار نموذج الاتفاق يتطلب جلسة مشغّل فعّالة وصلاحيات سياسات المنصة والشركاء والمالية معًا.
  </p>;
  // Remount owner-dependent Store and WLT agreement state on every Identity session.
  const sessionKey = JSON.stringify([state.identity.subject, state.identity.sessionId]);
  return <StoreCommercialModelPolicyEditor key={sessionKey} />;
}

function StoreCommercialModelPolicyEditor() {
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const activeRead = useRef<AbortController | null>(null);

  const readStore = useCallback(async (storeId: string) => {
    activeRead.current?.abort();
    const requestID = ++sequence.current;
    setSelected(null);
    setError("");
    if (!storeId || storeId.length > 128) {
      setLoading(false);
      setError("اختر متجرًا من قسم الشركاء أو أدخل معرّف متجر صالحًا.");
      return;
    }
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/publication`, {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 403 ? "لا تملك صلاحية قراءة هذا المتجر." : "تعذرت قراءة المتجر من DSH.");
      const result = await response.json() as StorePublicationResponse;
      if (result.store?.id !== storeId || !Array.isArray(result.store.fulfillmentModes)
        || !result.store.fulfillmentModes.length
        || result.store.fulfillmentModes.some(mode => !validModes.has(mode))
        || new Set(result.store.fulfillmentModes).size !== result.store.fulfillmentModes.length) {
        throw new Error("تعذرت مطابقة المتجر وطرق التنفيذ مع سجل DSH.");
      }
      if (sequence.current === requestID && !controller.signal.aborted) setSelected(result.store);
    } catch (cause) {
      if (sequence.current === requestID && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "تعذرت قراءة المتجر.");
      }
    } finally {
      if (sequence.current === requestID && !controller.signal.aborted) setLoading(false);
      if (activeRead.current === controller) activeRead.current = null;
    }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("storeId")?.trim() ?? "";
    if (fromUrl) {
      setInput(fromUrl);
      void readStore(fromUrl);
    }
    return () => {
      activeRead.current?.abort();
      sequence.current += 1;
    };
  }, [readStore]);

  return <section className="form-section" aria-label="سياسة نموذج الاتفاق التجاري للمتجر">
    <h3>اختيار نموذج التعاقد للمتجر</h3>
    <p className="muted">اختر متجرًا لتحديد نموذج اتفاقيته: عمولة أو اشتراك. يُنشأ مقترح جديد للمتجر نفسه، وتبقى الاتفاقية السارية والطلبات السابقة دون تغيير حتى القبول والموافقة.</p>
    <p className="muted">الاشتراك غير قابل للتفعيل أو التحصيل حاليًا حتى تكتمل فوترة WLT والمراجعة المستقلة. لا تتحكم هذه السياسة في ميزات تطبيق الشريك أو صلاحياته.</p>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); void readStore(input.trim()); }}>
      <label className="field-label" htmlFor="commercial-model-policy-store">معرّف المتجر
        <input id="commercial-model-policy-store" value={input} autoComplete="off"
          placeholder="اختر المتجر من قسم الشركاء"
          onChange={event => { activeRead.current?.abort(); sequence.current += 1; setLoading(false); setInput(event.target.value); setSelected(null); setError(""); }}
          maxLength={128} disabled={loading} />
      </label>
      <button type="submit" className="button button-secondary" disabled={loading || !input.trim()}>
        {loading ? "جارٍ التحقق من المتجر…" : "قراءة اتفاقيات المتجر"}
      </button>
      <Link href="/partners" className="button button-secondary">اختيار متجر من قسم الشركاء</Link>
    </form>
    {error ? <p role="alert" className="validation-error">{error}</p> : null}
    {selected ? <StoreCommercialAgreementProposal key={selected.id} storeId={selected.id}
      modes={selected.fulfillmentModes} readOnly={false} /> : null}
  </section>;
}
