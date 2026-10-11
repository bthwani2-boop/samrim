"use client";
import { TextArea } from "@bthwani/design-system/web";
import styles from "./field-acquisition-policy-workspace.module.css";

import type { CommercialStoreType, CommerceVertical } from "@bthwani/dsh";
import { financialPolicyStateLabel, formatMoney } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

type Policy = Readonly<{ id: string; scopeType: "STORE_TYPE"; scopeId: string; rewardMinor: number; roundingUnitMinor: 50; state: "ACTIVE" | "RETIRED"; version: number }>;
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
    <div className={`${styles.scopeFields}${verticalId && !commercialTypesLoading && !commercialTypesError ? ` ${styles.scopeFieldsWithType}` : ""}`}>
      <label className={`field-label ${styles.field}`} htmlFor="field-reward-vertical">المجال التجاري<select id="field-reward-vertical" value={verticalId} onChange={(event) => onVerticalChange(event.target.value)} disabled={busy || verticals.length === 0}>
        <option value="">اختر المجال التجاري</option>
        {verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}
      </select></label>
      {verticalId && !commercialTypesLoading && !commercialTypesError ? <label className={`field-label ${styles.field}`} htmlFor="field-reward-commercial-type">نوع المتجر التجاري<select id="field-reward-commercial-type" value={commercialTypeId} onChange={(event) => onCommercialTypeChange(event.target.value)} disabled={busy || commercialTypes.length === 0}>
        <option value="">اختر نوع المتجر</option>
        {commercialTypes.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
      </select></label> : null}
    </div>
    {verticalsError ? <p className={`validation-error ${styles.feedback}`} role="alert">{verticalsError} <button className="button button-quiet" type="button" onClick={onVerticalRetry} disabled={busy}>إعادة تحميل الفئات</button></p> : null}
    {verticals.length === 0 && !verticalsError ? <p className={`muted ${styles.feedback}`}>لا توجد فئات متاجر نشطة حاليًا.</p> : null}
    {commercialTypesLoading ? <p className={styles.feedback} role="status">جارٍ قراءة أنواع المتاجر…</p> : null}
    {commercialTypesError ? <p className={`validation-error ${styles.feedback}`} role="alert">{commercialTypesError} <button className="button button-quiet" type="button" onClick={onCommercialTypesRetry} disabled={busy}>إعادة القراءة</button></p> : null}
    {readState === "loading" ? <p className={styles.feedback} role="status">جارٍ قراءة سياسة نوع المتجر من السجل المالي…</p> : null}
    {readState === "unselected" && verticalId && !commercialTypeId ? <p className={`muted ${styles.feedback}`}>اختر نوع متجر نشطًا لقراءة سياسته.</p> : null}
    {readState === "missing" ? <p className={`managed-status managed-status-warning ${styles.feedback}`} role="status">لا توجد سياسة لنوع «{selectedCommercialType?.nameAr}». أنشئها هنا لاحتساب الاستحقاق.</p> : null}
    {readState === "error" ? <p className={`validation-error ${styles.feedback}`} role="alert">{error || "تعذرت القراءة؛ الحفظ معطل حتى نجاحها."}</p> : null}
    {policy ? <div className={styles.policyReadout} role="status"><span>المبلغ الفعّال</span><strong>{formatMoney(policy.rewardMinor, "YER")}</strong><span>{financialPolicyStateLabel(policy.state)}</span></div> : null}
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

  return <section className={`access-card ${styles.panel}`} aria-labelledby="field-acquisition-policy-title">
    <header className={styles.header}>
      <div className={styles.heading}>
        <p className="eyebrow">سياسة مالية · لكل نوع متجر</p>
        <h2 id="field-acquisition-policy-title">إعداد مبلغ الاستحقاق</h2>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.source}>مصدرها السجل المالي</span>
        <button className="button button-secondary" type="button" onClick={() => { if (commercialTypeId) void read(commercialTypeId); }} disabled={!commercialTypeId || busy || readState === "loading"}>إعادة القراءة</button>
      </div>
    </header>
    <p className={styles.description}>لكل نوع متجر مبلغ مستقل يُحتسب مرة واحدة عند ظهور أول متجر مؤهل في تطبيق العميل؛ بلا مبلغ افتراضي أو تخصيص لمتجر.</p>
    <section className={styles.scope} aria-labelledby="field-acquisition-scope-title">
      <div className={styles.sectionHeading}><span className={styles.step} aria-hidden="true">١</span><div><h3 id="field-acquisition-scope-title">حدد نوع المتجر</h3><p>اختر المجال ثم النوع لقراءة السياسة الحالية.</p></div></div>
      <FieldAcquisitionPolicySelection verticalId={verticalId} verticals={verticals} verticalsError={verticalsError} onVerticalChange={chooseVertical} onVerticalRetry={() => void loadVerticals()} commercialTypes={commercialTypes} selectedCommercialType={selectedCommercialType} commercialTypeId={commercialTypeId} commercialTypesLoading={commercialTypesLoading} commercialTypesError={commercialTypesError} onCommercialTypeChange={chooseCommercialType} onCommercialTypesRetry={() => void loadCommercialTypes(verticalId)} busy={busy} readState={readState} policy={policy} error={error} />
    </section>
    {canEditPolicy ? <section className={styles.settings} aria-labelledby="field-acquisition-settings-title">
      <div className={styles.sectionHeading}><span className={styles.step} aria-hidden="true">٢</span><div><h3 id="field-acquisition-settings-title">قيمة السياسة</h3><p>تُحفظ كتغيير جديد في السجل المالي.</p></div></div>
      <div className={styles.settingsGrid}>
        <label className={`field-label ${styles.field}`} htmlFor="field-acquisition-reward">مبلغ الاستحقاق<input id="field-acquisition-reward" type="number" min="50" step="50" value={rewardMinor} onChange={(event) => setRewardMinor(event.target.value)} aria-describedby="field-acquisition-rounding" disabled={busy || !canEdit} /></label>
        <label className={`field-label ${styles.field} ${styles.reasonField}`} htmlFor="field-reward-reason">سبب الإنشاء أو التغيير<TextArea id="field-reward-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} aria-describedby="field-reward-reason-hint" disabled={busy || !canEdit} /></label>
        <p id="field-acquisition-rounding" className={`muted ${styles.helper}`}>بالريال اليمني، وبمضاعفات ٥٠. يخص نوع المتجر ولا يُعدّل من ملف الميداني أو المتجر.</p>
        <p id="field-reward-reason-hint" className={`muted ${styles.helper}`}>من ٥ إلى ٥٠٠ حرف.</p>
      </div>
      {message ? <output className={`success ${styles.notice}`}>{message}</output> : null}
      {error ? <p className={`validation-error ${styles.notice}`} role="alert">{error}</p> : null}
      <button className={`button button-primary ${styles.saveButton}`} type="button" onClick={() => void save()} disabled={busy || !canEdit || !Number.isInteger(Number(rewardMinor)) || Number(rewardMinor) < 50 || reason.trim().length < 5 || reason.trim().length > 500}>{saveButtonLabel(busy, Boolean(policy))}</button>
    </section> : null}
  </section>;
}
