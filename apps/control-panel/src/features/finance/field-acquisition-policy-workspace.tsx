"use client";
import { TextArea } from "@bthwani/design-system/web";
import type { CommercialStoreType, CommerceVertical, FieldAcquisitionRewardPolicy } from "@bthwani/dsh";
import { financialPolicyStateLabel, formatMoney } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PolicyRecordProvenance } from "../policies/policy-record-provenance";

type Policy = FieldAcquisitionRewardPolicy;
type ReadState = "unselected" | "loading" | "ready" | "missing" | "error";

function saveButtonLabel(busy: boolean, hasPolicy: boolean): string {
  if (busy) return "جارٍ الحفظ ومطابقة السجل…";
  return hasPolicy ? "حفظ التغيير" : "إنشاء السياسة";
}

function FieldAcquisitionPolicySelection({
  verticalId, verticals, verticalsError, onVerticalChange, onVerticalRetry,
  commercialTypes, selectedCommercialType, commercialTypeId, commercialTypesLoading,
  commercialTypesError, onCommercialTypeChange, onCommercialTypesRetry, busy, readState,
  policy, error,
}: Readonly<{
  verticalId: string;
  verticals: ReadonlyArray<CommerceVertical>;
  verticalsError: string;
  onVerticalChange: (id: string) => void;
  onVerticalRetry: () => void;
  commercialTypes: ReadonlyArray<CommercialStoreType>;
  selectedCommercialType: CommercialStoreType | undefined;
  commercialTypeId: string;
  commercialTypesLoading: boolean;
  commercialTypesError: string;
  onCommercialTypeChange: (id: string) => void;
  onCommercialTypesRetry: () => void;
  busy: boolean;
  readState: ReadState;
  policy: Policy | null;
  error: string;
}>) {
  return <>
    <div className="form-grid">
      <label className="field-label" htmlFor="field-reward-vertical">للعثور على نوع المتجر: اختر المجال الذي يتبعه<select id="field-reward-vertical" value={verticalId} onChange={(event) => onVerticalChange(event.target.value)} disabled={busy || verticals.length === 0}>
        <option value="">اختر مجال المتجر للتصفية فقط</option>
        {verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}
      </select></label>
      {verticalId && !commercialTypesLoading && !commercialTypesError ? <label className="field-label" htmlFor="field-reward-commercial-type">نوع المتجر الذي تُطبّق عليه المكافأة<select id="field-reward-commercial-type" value={commercialTypeId} onChange={(event) => onCommercialTypeChange(event.target.value)} disabled={busy || commercialTypes.length === 0}>
        <option value="">اختر نوع المتجر</option>
        {commercialTypes.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select><small>هذا النوع وحده نطاق سياسة المكافأة؛ لا تُطبّق على المجال التجاري بأكمله.</small></label> : null}
    </div>
    {verticalsError ? <p className="validation-error state-message" role="alert">{verticalsError} <button className="button button-quiet" type="button" onClick={onVerticalRetry} disabled={busy}>إعادة تحميل الفئات</button></p> : null}
    {verticals.length === 0 && !verticalsError ? <p className="muted state-message">لا توجد مجالات تحتوي أنواع متاجر نشطة حاليًا.</p> : null}
    {commercialTypesLoading ? <p className="state-message" role="status">جارٍ قراءة أنواع المتاجر…</p> : null}
    {commercialTypesError ? <p className="validation-error state-message" role="alert">{commercialTypesError} <button className="button button-quiet" type="button" onClick={onCommercialTypesRetry} disabled={busy}>إعادة القراءة</button></p> : null}
    {readState === "loading" ? <p className="state-message" role="status">جارٍ قراءة سياسة نوع المتجر من السجل المالي…</p> : null}
    {readState === "missing" ? <p className="managed-status managed-status-warning state-message" role="status">لا توجد سياسة لنوع «{selectedCommercialType?.nameAr}». أنشئها هنا لاحتساب الاستحقاق.</p> : null}
    {readState === "error" ? <p className="validation-error state-message" role="alert">{error || "تعذرت القراءة؛ الحفظ معطل حتى نجاحها."}</p> : null}
    {policy ? <><div className="facts-grid" role="status"><span>المبلغ الفعّال لنوع المتجر</span><strong>{formatMoney(policy.rewardMinor, "YER")}</strong><span>{financialPolicyStateLabel(policy.state)}</span></div><PolicyRecordProvenance record={policy} /></> : null}
  </>;
}

export function FieldAcquisitionPolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [verticals, setVerticals] = useState<CommerceVertical[]>([]);
  const [verticalsError, setVerticalsError] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [commercialTypes, setCommercialTypes] = useState<CommercialStoreType[]>([]);
  const [commercialTypesError, setCommercialTypesError] = useState("");
  const [commercialTypesLoading, setCommercialTypesLoading] = useState(false);
  const [commercialTypeId, setCommercialTypeId] = useState("");
  const [rewardMinor, setRewardMinor] = useState("");
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [readState, setReadState] = useState<ReadState>("unselected");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const readSequence = useRef(0);
  const optionsController = useRef<AbortController | null>(null);

  const loadVerticals = useCallback(async () => {
    optionsController.current?.abort();
    const controller = new AbortController();
    optionsController.current = controller;
    setVerticalsError("");
    try {
      const response = await fetch("/api/catalog/verticals", { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { verticals?: CommerceVertical[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذرت قراءة فئات المتاجر .");
      if (!controller.signal.aborted) setVerticals((body.verticals ?? []).filter((vertical) => vertical.active));
    } catch (error_) {
      if (!controller.signal.aborted) setVerticalsError(error_ instanceof Error ? error_.message : "تعذر تحميل فئات المتاجر.");
    }
  }, []);

  const loadCommercialTypes = useCallback(async (selectedVerticalId: string) => {
    setCommercialTypesLoading(true);
    setCommercialTypesError("");
    setCommercialTypeId("");
    setCommercialTypes([]);
    try {
      const query = new URLSearchParams({ verticalId: selectedVerticalId });
      const response = await fetch(`/api/catalog/commercial-store-types?${query}`, { cache: "no-store" });
      const body = await response.json() as { storeTypes?: CommercialStoreType[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذر قراءة أنواع المتاجر.");
      setCommercialTypes((body.storeTypes ?? []).filter((item) => item.active));
    } catch (error_) {
      setCommercialTypesError(error_ instanceof Error ? error_.message : "تعذر قراءة أنواع المتاجر.");
    } finally {
      setCommercialTypesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVerticals();
    return () => optionsController.current?.abort();
  }, [loadVerticals]);

  const read = useCallback(async (id: string): Promise<boolean> => {
    const sequence = ++readSequence.current;
    setReadState("loading");
    setPolicy(null);
    setRewardMinor("");
    setError("");
    setMessage("");
    try {
      const query = new URLSearchParams({ scopeType: "STORE_TYPE", scopeId: id });
      const response = await fetch(`/api/finance/field-acquisition-policy?${query}`, { cache: "no-store" });
      const body = await response.json() as { policy?: Policy; error?: { message?: string } };
      if (sequence !== readSequence.current) return false;
      if (response.status === 404) {
        setReadState("missing");
        return false;
      }
      if (!response.ok || !body.policy) throw new Error(body.error?.message || "تعذرت قراءة سياسة هذه الفئة من السجل المالي.");
      setPolicy(body.policy);
      setRewardMinor(String(body.policy.rewardMinor));
      setReadState("ready");
      return true;
    } catch (error_) {
      if (sequence === readSequence.current) {
        setReadState("error");
        setError(error_ instanceof Error ? error_.message : "تعذرت قراءة سياسة هذه الفئة.");
      }
      return false;
    }
  }, []);

  const chooseVertical = (id: string) => {
    readSequence.current += 1;
    setVerticalId(id);
    setCommercialTypeId("");
    setCommercialTypes([]);
    setPolicy(null);
    setRewardMinor("");
    setReason("");
    setError("");
    setMessage("");
    if (id) void loadCommercialTypes(id);
    else setReadState("unselected");
  };

  const chooseCommercialType = (id: string) => {
    setCommercialTypeId(id);
    if (id) void read(id);
    else setReadState("unselected");
  };

  const save = async () => {
    if (!commercialTypeId || (readState !== "ready" && readState !== "missing") || !canEdit || !Number.isInteger(Number(rewardMinor)) || Number(rewardMinor) < 50 || reason.trim().length < 5 || reason.trim().length > 500) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/field-acquisition-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ scopeType: "STORE_TYPE", scopeId: commercialTypeId, rewardMinor: Number(rewardMinor), roundingUnitMinor: 50, expectedVersion: policy?.version ?? 0, reason: reason.trim() }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "تعذر حفظ سياسة الفئة.");
      if (!await read(commercialTypeId)) throw new Error("تم الحفظ لكن تعذرت مطابقة القراءة المعتمدة من السجل المالي؛ أعد القراءة قبل أي تغيير آخر.");
      setMessage("تم حفظ السياسة ومطابقة مبلغها وإصدارها مع السجل المالي.");
      setReason("");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "تعذر حفظ سياسة الفئة.");
    } finally {
      setBusy(false);
    }
  };

  const selectedCommercialType = commercialTypes.find((item) => item.id === commercialTypeId);
  const canEditPolicy = Boolean(commercialTypeId) && (readState === "ready" || readState === "missing");

  return <section className="form-section" aria-label="إعداد مبلغ الاستحقاق">
    <FieldAcquisitionPolicySelection verticalId={verticalId} verticals={verticals} verticalsError={verticalsError} onVerticalChange={chooseVertical} onVerticalRetry={() => void loadVerticals()} commercialTypes={commercialTypes} selectedCommercialType={selectedCommercialType} commercialTypeId={commercialTypeId} commercialTypesLoading={commercialTypesLoading} commercialTypesError={commercialTypesError} onCommercialTypeChange={chooseCommercialType} onCommercialTypesRetry={() => void loadCommercialTypes(verticalId)} busy={busy} readState={readState} policy={policy} error={error} />
    {canEditPolicy ? <>
      <div className="form-grid">
        <label className="field-label" htmlFor="field-acquisition-reward">مبلغ الاستحقاق (ريال)<input id="field-acquisition-reward" type="number" min="50" step="50" value={rewardMinor} onChange={(event) => setRewardMinor(event.target.value)} aria-describedby="field-acquisition-rounding" disabled={busy || !canEdit} /><small id="field-acquisition-rounding">مضاعفات ٥٠؛ مرة واحدة عند ظهور أول متجر مؤهل.</small></label>
        <label className="field-label" htmlFor="field-reward-reason">سبب الإنشاء أو التغيير<TextArea className="resize-none" id="field-reward-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} rows={3} aria-describedby="field-reward-reason-hint" disabled={busy || !canEdit} /><small id="field-reward-reason-hint">٥–٥٠٠ حرف.</small></label>
      </div>
      {message ? <output className="success state-message">{message}</output> : null}
      {error ? <p className="validation-error state-message" role="alert">{error}</p> : null}
    </> : null}
    <div className="action-row">
      {canEditPolicy ? <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || !canEdit || !Number.isInteger(Number(rewardMinor)) || Number(rewardMinor) < 50 || reason.trim().length < 5 || reason.trim().length > 500}>{saveButtonLabel(busy, Boolean(policy))}</button> : null}

    </div>
  </section>;
}
