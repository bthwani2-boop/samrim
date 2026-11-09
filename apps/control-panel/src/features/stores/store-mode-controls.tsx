"use client";

import { fulfillmentModeLabel, type StoreFulfillmentMode, type StorePublicationResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { partnerMutationHeaders } from "../partners/partner-request";

type Store = StorePublicationResponse["store"];
const modeChoices: ReadonlyArray<StoreFulfillmentMode> = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];

export function StoreModeControls({ store, onUpdated }: Readonly<{ store: Store; onUpdated: () => void }>) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ReadonlyArray<StoreFulfillmentMode>>(store.fulfillmentModes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const visibleChoices = store.relationModel === "INDEPENDENT_STORE"
    ? modeChoices.filter(mode => mode !== "BTHWANI_CAPTAIN")
    : store.relationModel === "BTHWANI_PARTNER" ? modeChoices : [];
  useEffect(() => { if (!editing) setSelected(store.fulfillmentModes); }, [editing, store.fulfillmentModes]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Store identity/relation/version resets editing; array identity alone must not discard an in-progress draft.
  useEffect(() => { setEditing(false); setSelected(store.fulfillmentModes); setError(""); setNotice(""); },
    [store.id, store.relationModel, store.version]);
  const changed = selected.length !== store.fulfillmentModes.length || selected.some((value) => !store.fulfillmentModes.includes(value));
  const illegalSelection = selected.some(mode => !visibleChoices.includes(mode));
  async function save() {
    if (busy || !changed || selected.length === 0) return;
    if ((store.relationModel !== "BTHWANI_PARTNER" && store.relationModel !== "INDEPENDENT_STORE") ||
        selected.some(mode => !modeChoices.includes(mode)) ||
        (store.relationModel === "INDEPENDENT_STORE" && selected.includes("BTHWANI_CAPTAIN"))) {
      setNotice("");
      setError("أوضاع التنفيذ لا تناسب طريقة عمل المتجر الحالية. حدّث الملف وأعد الاختيار قبل الحفظ.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(store.id)}/fulfillment-modes`, {
        method: "POST", headers: partnerMutationHeaders(),
        body: JSON.stringify({ fulfillmentModes: selected, expectedVersion: store.version }),
      });
      const failure = response.ok ? "" : await partnerErrorMessage(response);
      const readback = await fetch(`/api/stores/${encodeURIComponent(store.id)}/publication`, { cache: "no-store" });
      if (!readback.ok) throw new Error("تعذر تأكيد حالة التوصيل بعد الحفظ.");
      const latest = await readback.json() as StorePublicationResponse;
      if (!response.ok || latest.store?.id !== store.id || latest.store.relationModel !== store.relationModel ||
        selected.length !== latest.store.fulfillmentModes.length ||
        selected.some((item) => !latest.store.fulfillmentModes.includes(item))) {
        onUpdated();
        throw new Error(failure || "لم تتطابق أوضاع التنفيذ مع قراءة النظام؛ أعد المحاولة بعد التحديث.");
      }
      setEditing(false);
      setNotice("حُفظت أوضاع التنفيذ وتأكدت القراءة.");
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تعديل أوضاع التنفيذ.");
    } finally { setBusy(false); }
  }
  return <div className="store-mode-controls">
    <div className="store-mode-heading"><strong>طرق تنفيذ الطلب</strong>
      {!editing ? <button type="button" className="store-control-link" onClick={() => { setEditing(true); setError(""); setNotice(""); }}>تعديل</button> : null}
    </div>
    {!editing ? <div className="store-mode-chips">{visibleChoices.map((choice) =>
      <span key={choice} data-enabled={store.fulfillmentModes.includes(choice)}>{fulfillmentModeLabel(choice)}</span>)}</div> :
    <fieldset className="store-mode-edit" disabled={busy}>
      <legend>تفعيل أو تعطيل طرق التنفيذ</legend>
      {visibleChoices.map((choice) => <label key={choice} className="store-mode-option">
        <input type="checkbox" checked={selected.includes(choice)} onChange={() => {
          setSelected((old) => old.includes(choice) ? old.filter((value) => value !== choice) : [...old, choice]);
          setError(""); setNotice("");
        }} /><span>{fulfillmentModeLabel(choice)}</span>
      </label>)}
      {selected.length === 0 ? <p role="alert">يجب إبقاء طريقة تنفيذ واحدة على الأقل.</p> : null}
      {illegalSelection ? <p role="alert">توجد طريقة تنفيذ غير مسموحة لهذا النموذج. أعد قراءة ملف المتجر قبل حفظ أي تغيير.</p> : null}
      <div className="store-control-actions"><button className="button button-primary" type="button" disabled={!changed || !selected.length || illegalSelection || busy} onClick={() => void save()}>{busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setSelected(store.fulfillmentModes); setEditing(false); setError(""); }}>إلغاء</button></div>
    </fieldset>}
    {error ? <p className="store-control-error" role="alert">{error}</p> : null}
    {notice ? <p role="status" className="store-control-success">{notice}</p> : null}
  </div>;
}
