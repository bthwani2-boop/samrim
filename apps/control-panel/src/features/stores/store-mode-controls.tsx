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

  useEffect(() => { if (!editing) setSelected(store.fulfillmentModes); }, [editing, store.fulfillmentModes]);
  const changed = selected.length !== store.fulfillmentModes.length || selected.some((value) => !store.fulfillmentModes.includes(value));
  async function save() {
    if (busy || !changed || selected.length === 0) return;
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
      if (!response.ok || latest.store.id !== store.id || selected.length !== latest.store.fulfillmentModes.length
        || selected.some((item) => !latest.store.fulfillmentModes.includes(item))) {
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
    {!editing ? <div className="store-mode-chips">{modeChoices.map((choice) =>
      <span key={choice} data-enabled={store.fulfillmentModes.includes(choice)}>{fulfillmentModeLabel(choice)}</span>)}</div> :
    <fieldset className="store-mode-edit" disabled={busy}>
      <legend>تفعيل أو تعطيل طرق التنفيذ</legend>
      {modeChoices.map((choice) => <label key={choice} className="store-mode-option">
        <input type="checkbox" checked={selected.includes(choice)} onChange={() => {
          setSelected((old) => old.includes(choice) ? old.filter((value) => value !== choice) : [...old, choice]);
          setError(""); setNotice("");
        }} /><span>{fulfillmentModeLabel(choice)}</span>
      </label>)}
      {selected.length === 0 ? <p role="alert">يجب إبقاء طريقة تنفيذ واحدة على الأقل.</p> : null}
      <div className="store-control-actions"><button className="button button-primary" type="button" disabled={!changed || !selected.length || busy} onClick={() => void save()}>{busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setSelected(store.fulfillmentModes); setEditing(false); setError(""); }}>إلغاء</button></div>
    </fieldset>}
    {error ? <p className="store-control-error" role="alert">{error}</p> : null}
    {notice ? <p role="status" className="store-control-success">{notice}</p> : null}
  </div>;
}
