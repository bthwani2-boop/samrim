"use client";

import type { StoreRelationCommercialModelDefault } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { stablePartnerMutationHeaders } from "../partners/partner-request";

type StoreRelationModel = StoreRelationCommercialModelDefault["relationModel"];
type StoreCommercialModel = StoreRelationCommercialModelDefault["commercialModel"];
type ModelState = Readonly<{ items: readonly StoreRelationCommercialModelDefault[]; ready: boolean }>;
type Choice = Readonly<{ model: StoreCommercialModel; reason: string }>;
const relations: readonly Readonly<{ id: StoreRelationModel; label: string }>[] = [
  { id: "INDEPENDENT_STORE", label: "متجر مستقل" },
  { id: "BTHWANI_PARTNER", label: "شريك بثواني" },
];
const endpoint = "/api/policies/store-commercial-model-defaults";
const defaultReason = "تحديد نموذج اتفاق افتراضي للمتاجر الجديدة";

function readResult(payload: unknown): readonly StoreRelationCommercialModelDefault[] {
  const defaults = (payload as { defaults?: unknown } | null)?.defaults;
  if (!Array.isArray(defaults) || defaults.length > 2 ||
    defaults.some(item => !item || !relations.some(relation => relation.id === item.relationModel) ||
      !["COMMISSION", "SUBSCRIPTION"].includes(item.commercialModel) ||
      !Number.isInteger(item.policyVersion) || item.policyVersion < 1 ||
      typeof item.changedByActorId !== "string" || typeof item.changeReason !== "string" ||
      typeof item.updatedAt !== "string") ||
    new Set(defaults.map(item => item.relationModel)).size !== defaults.length) {
    throw new Error("تعذرت مطابقة سياسة النموذج التجاري المحفوظة في WLT.");
  }
  return defaults as readonly StoreRelationCommercialModelDefault[];
}

export function StoreRelationCommercialModelDefaults({
  onRead, sessionScope,
}: Readonly<{ onRead: (defaults: readonly StoreRelationCommercialModelDefault[] | null) => void; sessionScope: string }>) {
  const [modelState, setModelState] = useState<ModelState>({ items: [], ready: false });
  const [choices, setChoices] = useState<Record<StoreRelationModel, Choice>>({
    BTHWANI_PARTNER: { model: "COMMISSION", reason: defaultReason },
    INDEPENDENT_STORE: { model: "COMMISSION", reason: defaultReason },
  });
  const [busy, setBusy] = useState<StoreRelationModel | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef(false);
  const reading = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const closed = useRef(false);

  const read = useCallback(async () => {
    if (closed.current) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setModelState({ items: [], ready: false });
    onRead(null);
    const response = await fetch(endpoint, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    });
    if (!response.ok) throw new Error("تعذرت قراءة النموذج المالي الافتراضي من WLT.");
    const items = readResult(await response.json() as unknown);
    if (controller.signal.aborted || closed.current) return;
    setModelState({ items, ready: true });
    setChoices(current => ({
      BTHWANI_PARTNER: {
        model: items.find(item => item.relationModel === "BTHWANI_PARTNER")?.commercialModel ?? "COMMISSION",
        reason: current.BTHWANI_PARTNER.reason,
      },
      INDEPENDENT_STORE: {
        model: items.find(item => item.relationModel === "INDEPENDENT_STORE")?.commercialModel ?? "COMMISSION",
        reason: current.INDEPENDENT_STORE.reason,
      },
    }));
    setUncertain(false);
    onRead(items);
    return items;
  }, [onRead]);

  useEffect(() => {
    closed.current = false;
    void read().catch(() => { if (!closed.current && !reading.current?.signal.aborted) setError("تعذرت قراءة السياسة المالية؛ التعديل معطّل حتى إعادة القراءة."); });
    return () => { closed.current = true; reading.current?.abort(); mutation.current?.abort(); };
  }, [read]);

  async function save(relationModel: StoreRelationModel) {
    if (closed.current || pending.current || !modelState.ready || uncertain) return;
    const draft = choices[relationModel];
    const previous = modelState.items.find(item => item.relationModel === relationModel);
    const reason = draft.reason.trim();
    if ((previous?.commercialModel ?? null) === draft.model ||
      Array.from(reason).length < 8 || Array.from(reason).length > 500) {
      setError("اختر نموذجًا مختلفًا وأدخل سببًا واضحًا من 8 إلى 500 حرف.");
      return;
    }
    pending.current = true;
    setBusy(relationModel);
    setError("");
    setNotice("");
    let submitted = false;
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const expectedVersion = previous?.policyVersion ?? 0;
      const body = { relationModel, commercialModel: draft.model, expectedVersion, reason };
      const headers = await stablePartnerMutationHeaders("relation-model-default:" + sessionScope + ":" + JSON.stringify(body));
      if (controller.signal.aborted || closed.current) return;
      submitted = true;
      const response = await fetch(endpoint, {
        method: "POST", headers, body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      if (!response.ok) throw new Error("تعذر التأكد من نتيجة الحفظ.");
      const payload = await response.json() as { default?: StoreRelationCommercialModelDefault };
      if (payload.default?.relationModel !== relationModel ||
        payload.default?.commercialModel !== draft.model ||
        payload.default.policyVersion !== expectedVersion + 1) {
        throw new Error("اختلفت نتيجة الحفظ عن السياسة المطلوبة.");
      }
      // WLT is the owner; a successful POST alone cannot establish current truth.
      const verified = await read();
      const current = verified?.find(item => item.relationModel === relationModel);
      if (current?.commercialModel !== draft.model || current.policyVersion < expectedVersion + 1) {
        throw new Error("لم تتطابق قراءة WLT الدائمة بعد الحفظ.");
      }
      setNotice("حُفظ اختيار النموذج الافتراضي في WLT. الاتفاقيات الحالية لا تتغير.");
    } catch {
      if (closed.current || controller.signal.aborted) return;
      // The POST may have committed: do not construct another new mutation key.
      if (submitted) {
        setUncertain(true);
        setError("نتيجة الحفظ غير مؤكدة. أعد قراءة الحالة من WLT قبل أي تعديل جديد.");
      } else {
        setError("تعذر تجهيز الطلب ولم يُرسل أي تعديل.");
      }
    } finally {
      if (mutation.current === controller) mutation.current = null;
      pending.current = false;
      if (!closed.current) setBusy(null);
    }
  }

  return <section className="access-card" aria-label="النماذج المالية الافتراضية بحسب طريقة عمل المتجر">
    <h4>النموذج الافتراضي لكل طريقة عمل</h4>
    <p className="muted">اختر عمولة أو اشتراكًا بصورة مستقلة لشريك بثواني وللمتجر المستقل. يُحفظ الاختيار بصفته اقتراحًا للاتفاقيات المستقبلية، ولا يغير رسوم أي متجر أو اتفاقية سارية.</p>
    <p className="muted">الاشتراكات وعمولات الطلبات المباشرة غير قابلة للتفعيل والتحصيل حتى اكتمال مسارات WLT ومراجعة المالية والأمان. سعر الاشتراك وشروطه التفصيلية تحدد في اتفاقية المتجر قبل القبول.</p>
    <div className="form-grid">
      {relations.map(relation => {
        const existing = modelState.items.find(item => item.relationModel === relation.id);
        const draft = choices[relation.id];
        return <div className="access-card" key={relation.id}>
          <h5>{relation.label}</h5>
          <p className="muted">السجل الحالي: {existing ? existing.commercialModel === "COMMISSION" ? "عمولة" : "اشتراك" : "لم يُحدد بعد"} · الإصدار {existing?.policyVersion ?? 0}</p>
          <label className="field-label" htmlFor={"relation-model-" + relation.id}>النموذج المالي
            <select id={"relation-model-" + relation.id} value={draft.model}
              onChange={event => setChoices(current => ({ ...current, [relation.id]: { ...current[relation.id], model: event.target.value as StoreCommercialModel } }))}
              disabled={!modelState.ready || busy !== null || uncertain}>
              <option value="COMMISSION">عمولة</option>
              <option value="SUBSCRIPTION">اشتراك</option>
            </select>
          </label>
          <label className="field-label" htmlFor={"relation-reason-" + relation.id}>سبب التغيير
            <textarea id={"relation-reason-" + relation.id} rows={2} minLength={8} maxLength={500}
              value={draft.reason} onChange={event => setChoices(current => ({ ...current, [relation.id]: { ...current[relation.id], reason: event.target.value } }))}
              disabled={!modelState.ready || busy !== null || uncertain} />
          </label>
          <button type="button" className="button button-secondary" disabled={!modelState.ready || busy !== null || uncertain ||
            existing?.commercialModel === draft.model || Array.from(draft.reason.trim()).length < 8}
            onClick={() => void save(relation.id)}>
            {busy === relation.id ? "جارٍ حفظ السياسة…" : "حفظ النموذج الافتراضي"}
          </button>
        </div>;
      })}
    </div>
    {error ? <p role="alert" className="validation-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <button className="button button-secondary" type="button" disabled={busy !== null}
      onClick={() => { setError(""); setNotice(""); void read().catch(() => { if (!closed.current) setError("تعذرت قراءة الحالة الحالية؛ لا يمكن المتابعة."); }); }}>
      إعادة قراءة الحالة من WLT
    </button>
  </section>;
}
