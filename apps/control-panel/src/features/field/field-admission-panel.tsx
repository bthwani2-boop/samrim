"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import { type FieldAdmission, type JoiningCaseListResponse, type ServiceCity, type ServiceCityListResponse, fieldAdmissionStateLabel, joiningCaseStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./field-workbench.module.css";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldAccount = ActorRoleView & Readonly<{ admission: FieldAdmission | null }>;
type FieldWorkbenchItem = Readonly<{ kind: "candidate"; admission: FieldAdmission }> | Readonly<{ kind: "account"; account: FieldAccount }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldWorkbenchItem>; nextCursor?: string }>;
type FieldAcquisitionCase = JoiningCaseListResponse["cases"][number];
type FieldCandidateAction = "update-profile" | "approve" | "provision";
type FieldAccountAction = "update-profile" | "review-profile" | "activate" | "disable" | "reenroll";
type AdmissionMutationResponse = Readonly<{ admission?: FieldAdmission }>;

function fieldRequestError(cause: unknown, fallback: string): string {
  if (isRequestFailure(cause)) return cause.message;
  if (cause instanceof Error) return cause.message;
  return fallback;
}

function fieldPhoneE164(value: string): string {
  return toAsciiDigits(value).replace(/\s+/g, "");
}

function isFieldPhoneE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function identityStatusLabel(field: FieldAccount): string {
  if (!field.securityEnabled) return "الهوية موقوفة أمنيًا";
  if (field.activatedAt && field.enabled) return "الدور مُفعّل";
  if (field.activatedAt) return "الدور موقوف بعد التفعيل";
  if (field.enabled) return "الدور جاهز؛ بانتظار تفعيل الجهاز";
  return "الدور موقوف قبل تفعيل الجهاز";
}

function admissionStatusLabel(admission: FieldAdmission | null): string {
  if (!admission) return "لا توجد أهلية تشغيل في DSH";
  if (admission.requiresProfileReview) return "الملف يحتاج استكمالًا ومراجعة";
  return fieldAdmissionStateLabel(admission.state);
}

function readbackQuery(query: string, limit = 25): string {
  const params = new URLSearchParams({ scope: "workbench", limit: String(limit), q: query });
  return `/api/fields?${params.toString()}`;
}

async function readWorkbench(currentQuery: string): Promise<FieldPage> {
  const response = await identityFetch(readbackQuery(currentQuery, 50), { cache: "no-store" });
  if (!response.ok) throw new Error(await responseMessage(response));
  return await response.json() as FieldPage;
}

function expectedCandidateState(action: FieldCandidateAction, currentState: FieldAdmission["state"]): FieldAdmission["state"] {
  if (action === "approve") return "pending_identity";
  if (action === "provision") return "eligible";
  return currentState;
}

function candidateMutationNotice(action: FieldCandidateAction): string {
  if (action === "approve") return "اعتُمد الملف وأُعيدت قراءته؛ أصبح منح الدور خطوته التالية.";
  if (action === "provision") return "مُنح دور الدخول وربط بأهلية DSH. الخطوة التالية للميداني: يفتح التطبيق، ويدخل رقم الهاتف المسجل، ثم يختار تفعيل الجهاز لإثبات الهاتف وإنشاء كلمة المرور.";
  return "حُفظ الاسم وأُعيدت قراءة الملف من DSH.";
}

function accountMutationNotice(action: FieldAccountAction): string {
  if (action === "reenroll") return "أُجيزت إعادة تسجيل دور سبق تفعيله بعد التحقق من أهلية DSH. الخطوة التالية للميداني: تفعيل الجهاز من التطبيق برمز الهاتف.";
  if (action === "activate") return "أُعيد تفعيل دور الدخول وأُعيدت قراءة حساب الميداني وأهليته.";
  if (action === "disable") return "أُوقف دور الدخول وأُعيدت قراءة حالة الحساب وأهلية DSH.";
  if (action === "review-profile") return "اعتُمدت مراجعة الملف وأُعيدت قراءة حالته.";
  if (action === "update-profile") return "حُفظ الاسم وأُعيدت قراءة الملف من DSH.";
  return "تم الإجراء وأُعيدت قراءة حالة الحساب وأهلية DSH.";
}

function accessActionButtonLabel(busy: boolean, shouldDisable: boolean): string {
  if (busy) return "جارٍ التحديث…";
  if (shouldDisable) return "إيقاف الوصول";
  return "إعادة التفعيل";
}

function accountMutationValidation(field: FieldAccount, action: FieldAccountAction, reason: string, fullNameAr: string): string | undefined {
  const admission = field.admission;
  const needsReason = action === "activate" || action === "disable" || action === "reenroll";
  if (needsReason && (Array.from(reason).length < 5 || Array.from(reason).length > 500)) return "اكتب سببًا من 5 إلى 500 حرف قبل تنفيذ الإجراء.";
  if ((action === "update-profile" || action === "review-profile") && (admission?.state !== "suspended" || !admission.requiresProfileReview)) return "هذا الملف لا يحتاج مراجعة حاليًا.";
  if (action === "update-profile" && (Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120)) return "أدخل اسم العرض الكامل قبل الحفظ.";
  if (action === "reenroll" && (admission?.state !== "eligible" || !field.enabled || !field.securityEnabled || !field.activatedAt)) return "إعادة التسجيل تتطلب دورًا مفعّلًا سبق تفعيله وأهلية DSH سارية.";
  return undefined;
}

function accountMutationBody(field: FieldAccount, action: FieldAccountAction, reason: string, fullNameAr: string): Record<string, unknown> {
  const admission = field.admission;
  const body: Record<string, unknown> = { action, actorId: field.actorId, admissionId: admission?.id, reason };
  if (action === "update-profile" || action === "review-profile") { body.fullNameAr = fullNameAr; body.expectedVersion = admission?.version; }
  if (action === "activate" || action === "disable") body.expectedVersion = field.roleVersion;
  if (action === "reenroll") { body.expectedActorVersion = field.actorVersion; body.expectedRoleVersion = field.roleVersion; body.expectedAdmissionVersion = admission?.version; }
  return body;
}

function accountReadbackMatches(action: FieldAccountAction, fullNameAr: string, canonical: FieldAccount): boolean {
  return !(
    (action === "update-profile" && canonical.admission?.fullNameAr !== fullNameAr) ||
    (action === "review-profile" && canonical.admission?.requiresProfileReview) ||
    (action === "disable" && canonical.enabled) ||
    (action === "activate" && !canonical.enabled) ||
    (action === "reenroll" && canonical.activatedAt)
  );
}

type FieldCandidateRowProps = Readonly<{
  profile: FieldAdmission;
  name: string;
  changed: boolean;
  busy: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  onNameChange: (value: string) => void;
  onMutate: (admission: FieldAdmission, action: FieldCandidateAction) => void;
}>;

function FieldCandidateRow({ profile, name, changed, busy, serviceCities, onNameChange, onMutate }: FieldCandidateRowProps) {
  const pendingReview = profile.state === "pending_review";
  const pendingIdentity = profile.state === "pending_identity";
  return <tr>
    <th scope="row"><strong>{profile.fullNameAr || "ملف بلا اسم مكتمل"}</strong><br /><bdi dir="ltr">{profile.contactPhoneE164 || "—"}</bdi><br /><span className="muted">مدينة الخدمة: {serviceCities.find((city) => city.id === profile.serviceCityId)?.displayNameAr ?? "غير محددة في الملف التاريخي"}</span></th>
    <td>{fieldAdmissionStateLabel(profile.state)}<br /><span className="muted">الإصدار {profile.version}</span></td>
    <td><span className="muted">لم يُنشأ الدور بعد</span></td>
    <td><details className="field-row-disclosure"><summary className="button button-secondary">الخطوة التالية</summary><div className="field-row-actions">
      {pendingReview ? <><label className="field-label" htmlFor={`candidate-name-${profile.id}`}>اسم العرض<input id={`candidate-name-${profile.id}`} value={name} maxLength={120} disabled={Boolean(busy)} onChange={(event) => onNameChange(event.target.value)} /></label><button type="button" className="button button-secondary" disabled={Boolean(busy) || !changed} onClick={() => onMutate(profile, "update-profile")}>حفظ الاسم</button><button type="button" className="button button-primary" disabled={Boolean(busy) || changed} onClick={() => onMutate(profile, "approve")}>{busy === profile.id ? "جارٍ الاعتماد…" : "اعتماد الملف"}</button></> : null}
      {pendingIdentity ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => onMutate(profile, "provision")}>{busy === profile.id ? "جارٍ منح الدور…" : "منح دور الميداني"}</button> : null}
      {!pendingReview && !pendingIdentity ? <span className="muted">لا توجد خطوة متاحة لهذه المرحلة.</span> : null}
    </div></details></td>
  </tr>;
}

type FieldAccountMutationActionsProps = Readonly<{
  field: FieldAccount;
  name: string;
  reason: string;
  busy: string;
  onNameChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onMutate: (field: FieldAccount, action: FieldAccountAction) => void;
}>;

type FieldLegacyReviewActionsProps = Readonly<Pick<FieldAccountMutationActionsProps, "field" | "name" | "busy" | "onNameChange" | "onMutate">>;

function FieldLegacyReviewActions({ field, name, busy, onNameChange, onMutate }: FieldLegacyReviewActionsProps) {
  const admission = field.admission;
  if (!admission) return null;
  const matchesSavedProfile = name.trim() === (admission.fullNameAr ?? "");
  const nameIsValid = Array.from(name.trim()).length >= 2;
  return <>
    <label className="field-label" htmlFor={`field-profile-name-${field.actorId}`}>استكمال اسم العرض<input id={`field-profile-name-${field.actorId}`} value={name} maxLength={120} disabled={Boolean(busy)} onChange={(event) => onNameChange(event.target.value)} /></label>
    <button type="button" className="button button-secondary" disabled={Boolean(busy) || !nameIsValid || matchesSavedProfile} onClick={() => onMutate(field, "update-profile")}>حفظ الاسم</button>
    <button type="button" className="button button-primary" disabled={Boolean(busy) || !name.trim() || !matchesSavedProfile} onClick={() => onMutate(field, "review-profile")}>اعتماد مراجعة الملف</button>
  </>;
}

type FieldAccountAccessActionsProps = Readonly<Pick<FieldAccountMutationActionsProps, "field" | "busy" | "reason" | "onMutate"> & Readonly<{
  waitingForFirstActivation: boolean;
  waitingForReenrollment: boolean;
  shouldDisable: boolean;
  requiresProfileReview: boolean;
  mustDisable: boolean;
  reasonIsValid: boolean;
}>>;

function FieldAccountAccessActions({ field, busy, reason, onMutate, waitingForFirstActivation, waitingForReenrollment, shouldDisable, requiresProfileReview, mustDisable, reasonIsValid }: FieldAccountAccessActionsProps) {
  const accessAction: FieldAccountAction = shouldDisable ? "disable" : "activate";
  const canDisable = shouldDisable;
  const canReactivate = !field.enabled && !requiresProfileReview && field.securityEnabled && field.admission?.state === "eligible";
  return <>
    {waitingForFirstActivation ? <p className="muted" role="status">الدور جاهز. الخطوة التالية للميداني: يفتح تطبيق الميدان، يدخل رقم الهاتف المسجل، ثم يختار «تفعيل الجهاز» لإثبات الهاتف وإنشاء كلمة المرور.</p> : null}
    {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || !reasonIsValid} onClick={() => onMutate(field, "reenroll")}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
    {canDisable || canReactivate ? <button type="button" className={shouldDisable ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || !reasonIsValid} onClick={() => onMutate(field, accessAction)}>{accessActionButtonLabel(busy === field.actorId, shouldDisable)}</button> : null}
    {requiresProfileReview && !mustDisable && !field.enabled ? <span className="muted">أكمل مراجعة الملف قبل إعادة التفعيل.</span> : null}
  </>;
}

function FieldAccountMutationActions({ field, name, reason, busy, onNameChange, onReasonChange, onMutate }: FieldAccountMutationActionsProps) {
  const admission = field.admission;
  const requiresProfileReview = admission?.requiresProfileReview === true;
  const mustDisable = requiresProfileReview && admission?.state === "eligible";
  const shouldDisable = field.enabled || mustDisable;
  const waitingForFirstActivation = !requiresProfileReview && field.securityEnabled && field.enabled && !field.activatedAt && admission?.state === "eligible";
  const waitingForReenrollment = !requiresProfileReview && field.securityEnabled && field.enabled && Boolean(field.activatedAt) && admission?.state === "eligible";
  const legacyReview = requiresProfileReview && admission?.state === "suspended";
  const reasonIsValid = Array.from(reason.trim()).length >= 5;

  return admission ? <details className="field-row-disclosure"><summary className="button button-secondary">الخطوة التالية</summary><div className="field-row-actions">
    {legacyReview ? <FieldLegacyReviewActions field={field} name={name} busy={busy} onNameChange={onNameChange} onMutate={onMutate} /> : null}
    <label className="field-label" htmlFor={`field-reason-${field.actorId}`}>سبب الإجراء<input id={`field-reason-${field.actorId}`} maxLength={500} value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={Boolean(busy)} /></label>
    <FieldAccountAccessActions field={field} busy={busy} reason={reason} onMutate={onMutate} waitingForFirstActivation={waitingForFirstActivation} waitingForReenrollment={waitingForReenrollment} shouldDisable={shouldDisable} requiresProfileReview={requiresProfileReview} mustDisable={mustDisable} reasonIsValid={reasonIsValid} />
    <a className="button button-secondary" href={`/finance/beneficiary-settlement/field?search=${encodeURIComponent(field.actorId)}`}>كشف المحفظة والحركات المالية</a>
  </div></details> : <span className="muted">راجع الأهلية قبل إتاحة العمل الميداني.</span>;
}

type FieldAcquisitionDisclosureProps = Readonly<{
  fieldActorId: string;
  page: JoiningCaseListResponse | undefined;
  error: string;
  busy: boolean;
  onLoad: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldAcquisitionDisclosure({ fieldActorId, page, error, busy, onLoad }: FieldAcquisitionDisclosureProps) {
  return <details className="field-row-disclosure" onToggle={(event) => {
    if (event.currentTarget.open && !page && !busy) onLoad(fieldActorId);
  }}>
    <summary className="button button-secondary">الشركاء ورحلات الانضمام</summary>
    <div className="field-row-actions">
      {busy && !page ? <output className="muted">جارٍ قراءة رحلات DSH…</output> : null}
      {error ? <><span className="identity-error" role="alert">{error}</span><button type="button" className="button button-secondary" disabled={busy} onClick={() => onLoad(fieldActorId)}>إعادة المحاولة</button></> : null}
      {page?.cases.map((partnerCase: FieldAcquisitionCase) => <div key={partnerCase.id} className="field-row-actions">
        <strong>{partnerCase.businessName}</strong>
        <span>{partnerCase.firstStoreName}</span>
        <span className="muted">حالة طلب الشريك: {joiningCaseStateLabel(partnerCase.state)}</span>
        {partnerCase.state === "needs_correction" && partnerCase.correctionReason ? <span className="muted">المطلوب استكماله: {partnerCase.correctionReason}</span> : null}
        {partnerCase.partnerActorId ? <span className="muted">حساب الشريك مرتبط</span> : null}
      </div>)}
      {!busy && !error && page?.cases.length === 0 ? <span className="muted">لا توجد رحلات انضمام منسوبة إلى هذا الحساب في DSH.</span> : null}
      {page?.nextCursor ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => onLoad(fieldActorId, page.nextCursor, true)}>{busy ? "جارٍ تحميل المزيد…" : "تحميل رحلات أقدم"}</button> : null}
    </div>
  </details>;
}

type FieldAccountRowProps = Readonly<{
  field: FieldAccount;
  name: string;
  reason: string;
  busy: string;
  acquisitionPage: JoiningCaseListResponse | undefined;
  acquisitionError: string;
  acquisitionBusy: boolean;
  onNameChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onMutate: (field: FieldAccount, action: FieldAccountAction) => void;
  onLoadAcquisitionCases: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldAccountRow({ field, name, reason, busy, acquisitionPage, acquisitionError, acquisitionBusy, onNameChange, onReasonChange, onMutate, onLoadAcquisitionCases }: FieldAccountRowProps) {
  const admission = field.admission;
  return <tr>
    <th scope="row"><strong>{admission?.fullNameAr || "حساب بلا ملف اسم مكتمل"}</strong><br /><bdi dir="ltr">{field.phoneE164}</bdi></th>
    <td>{admissionStatusLabel(admission)}{admission ? <><br /><span className="muted">الإصدار {admission.version}</span></> : null}</td>
    <td>{identityStatusLabel(field)}</td>
    <td>
      <FieldAccountMutationActions field={field} name={name} reason={reason} busy={busy} onNameChange={onNameChange} onReasonChange={onReasonChange} onMutate={onMutate} />
      <FieldAcquisitionDisclosure fieldActorId={field.actorId} page={acquisitionPage} error={acquisitionError} busy={acquisitionBusy} onLoad={onLoadAcquisitionCases} />
    </td>
  </tr>;
}

type FieldAdmissionRosterProps = Readonly<{
  items: ReadonlyArray<FieldWorkbenchItem>;
  query: string;
  notice: string;
  error: string;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string;
  busy: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  candidateEdits: Record<string, string>;
  profileEdits: Record<string, string>;
  reasons: Record<string, string>;
  acquisitionCases: Record<string, JoiningCaseListResponse>;
  acquisitionCaseErrors: Record<string, string>;
  acquisitionCaseBusy: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onCandidateNameChange: (admissionId: string, value: string) => void;
  onCandidateMutate: (admission: FieldAdmission, action: FieldCandidateAction) => void;
  onProfileNameChange: (actorId: string, value: string) => void;
  onReasonChange: (actorId: string, value: string) => void;
  onAccountMutate: (field: FieldAccount, action: FieldAccountAction) => void;
  onLoadAcquisitionCases: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldEmptyRoster({ query }: Readonly<{ query: string }>) {
  const title = query ? "لا توجد نتائج مطابقة" : "لا توجد ملفات أو حسابات ميدانية";
  const description = query ? "امسح البحث لعرض السجل كاملًا." : "أنشئ ملفًا جديدًا لبدء مسار الأهلية.";
  return <div className="collection-state"><strong>{title}</strong><p>{description}</p></div>;
}

function FieldAdmissionRoster({ items, query, notice, error, loading, loadingMore, nextCursor, busy, serviceCities, candidateEdits, profileEdits, reasons, acquisitionCases, acquisitionCaseErrors, acquisitionCaseBusy, onQueryChange, onRefresh, onLoadMore, onCandidateNameChange, onCandidateMutate, onProfileNameChange, onReasonChange, onAccountMutate, onLoadAcquisitionCases }: FieldAdmissionRosterProps) {
  return <div className="field-workbench-pane">
    <div className="field-list-heading"><div><h3 id="field-roster-title">سجل الميدانيين</h3><p className="muted">كل شخص يظهر مرة واحدة، مع مرحلته والخطوة التالية.</p></div></div>
    <div className="workspace-toolbar"><label className="field-label" htmlFor="field-search">بحث بالاسم أو الهاتف<input id="field-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="ابحث في ملفات وحسابات الميدانيين" /></label><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={onRefresh}>{loading ? "جارٍ التحديث…" : "إعادة القراءة"}</button></div>
    {notice ? <output className="success-inline">{notice}</output> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading && items.length === 0 ? <output>جارٍ قراءة سجل الميدانيين…</output> : null}
    {!loading && !error && items.length === 0 ? <FieldEmptyRoster query={query} /> : null}
    {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الميداني</th><th scope="col">مرحلة الملف</th><th scope="col">حساب التطبيق</th><th scope="col">الإجراء</th></tr></thead><tbody>
      {items.map((item) => item.kind === "candidate"
        ? <FieldCandidateRow key={`candidate:${item.admission.id}`} profile={item.admission} name={candidateEdits[item.admission.id] ?? item.admission.fullNameAr ?? ""} changed={(candidateEdits[item.admission.id] ?? item.admission.fullNameAr ?? "").trim() !== (item.admission.fullNameAr ?? "")} busy={busy} serviceCities={serviceCities} onNameChange={(value) => onCandidateNameChange(item.admission.id, value)} onMutate={onCandidateMutate} />
        : <FieldAccountRow key={`account:${item.account.actorId}`} field={item.account} name={profileEdits[item.account.actorId] ?? item.account.admission?.fullNameAr ?? ""} reason={reasons[item.account.actorId] ?? ""} busy={busy} acquisitionPage={acquisitionCases[item.account.actorId]} acquisitionError={acquisitionCaseErrors[item.account.actorId] ?? ""} acquisitionBusy={acquisitionCaseBusy[item.account.actorId] ?? false} onNameChange={(value) => onProfileNameChange(item.account.actorId, value)} onReasonChange={(value) => onReasonChange(item.account.actorId, value)} onMutate={onAccountMutate} onLoadAcquisitionCases={onLoadAcquisitionCases} />)}
    </tbody></table></div> : null}
    {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={onLoadMore}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
  </div>;
}

export function FieldAdmissionPanel() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ReadonlyArray<FieldWorkbenchItem>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [phone, setPhone] = useState("");
  const [walletProviderKey, setWalletProviderKey] = useState("");
  const [serviceCityId, setServiceCityId] = useState("");
  const [serviceCities, setServiceCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [serviceCitiesLoading, setServiceCitiesLoading] = useState(true);
  const [serviceCitiesError, setServiceCitiesError] = useState("");
  const [candidateEdits, setCandidateEdits] = useState<Record<string, string>>({});
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acquisitionCases, setAcquisitionCases] = useState<Record<string, JoiningCaseListResponse>>({});
  const [acquisitionCaseErrors, setAcquisitionCaseErrors] = useState<Record<string, string>>({});
  const [acquisitionCaseBusy, setAcquisitionCaseBusy] = useState<Record<string, boolean>>({});
  const loadRequestID = useRef(0);

  useEffect(() => {
    let current = true;
    void identityFetch("/api/service-cities", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as ServiceCityListResponse;
      if (current) setServiceCities(result.cities.filter((city) => city.active));
    }).catch((cause: unknown) => {
      if (current) setServiceCitiesError(fieldRequestError(cause, "تعذر تحميل مدن الخدمة النشطة."));
    }).finally(() => { if (current) setServiceCitiesLoading(false); });
    return () => { current = false; };
  }, []);

  const load = useCallback(async (cursor = "", append = false) => {
    const requestID = ++loadRequestID.current;
    if (append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope: "workbench", limit: "25", q: query.trim() });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/fields?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (loadRequestID.current === requestID) {
          setError(message);
        }
        return;
      }
      const page = await response.json() as FieldPage;
      if (loadRequestID.current !== requestID) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestID.current === requestID) setError(fieldRequestError(cause, "تعذرت قراءة سجل الميدانيين."));
    } finally {
      if (loadRequestID.current === requestID) { setLoading(false); setLoadingMore(false); }
    }
  }, [query]);

  async function loadAcquisitionCases(fieldActorId: string, cursor = "", append = false) {
    setAcquisitionCaseBusy((current) => ({ ...current, [fieldActorId]: true }));
    setAcquisitionCaseErrors((current) => ({ ...current, [fieldActorId]: "" }));
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/fields/${encodeURIComponent(fieldActorId)}/acquisition-cases?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const page = await response.json() as JoiningCaseListResponse;
      setAcquisitionCases((current) => ({
        ...current,
        [fieldActorId]: append && current[fieldActorId] ? {
          cases: [...current[fieldActorId].cases, ...page.cases],
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        } : page,
      }));
    } catch (cause) {
      setAcquisitionCaseErrors((current) => ({ ...current, [fieldActorId]: fieldRequestError(cause, "تعذرت قراءة رحلات ضم الشركاء لهذا الميداني.") }));
    } finally {
      setAcquisitionCaseBusy((current) => ({ ...current, [fieldActorId]: false }));
    }
  }

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const syncQuery = () => setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    syncQuery();
    window.addEventListener("popstate", syncQuery);
    return () => window.removeEventListener("popstate", syncQuery);
  }, []);

  function updateQuery(value: string) {
    setQuery(value);
    const params = new URLSearchParams(window.location.search);
    if (value.trim()) params.set("q", value); else params.delete("q");
    params.delete("cursor");
    window.history.replaceState(window.history.state, "", window.location.pathname + (params.size ? `?${params.toString()}` : ""));
  }

  async function createProfile() {
    const name = fullNameAr.trim();
    const contactPhoneE164 = fieldPhoneE164(phone);
    const providerKey = walletProviderKey.trim();
    const activeCity = serviceCities.find((city) => city.id === serviceCityId && city.active);
    if (Array.from(name).length < 2 || Array.from(name).length > 120) {
      setError("أدخل الاسم الكامل بالعربية قبل حفظ الملف.");
      return;
    }
    if (!isFieldPhoneE164(contactPhoneE164)) {
      setError("اكتب رقم الهاتف بصيغته الدولية مع + ورمز البلد؛ مثال: +967 777 765 432.");
      return;
    }
    if (!activeCity) {
      setError("اختر مدينة خدمة نشطة قبل حفظ الملف.");
      return;
    }
    if (Array.from(providerKey).length < 1 || Array.from(providerKey).length > 64 || /\p{Cc}/u.test(providerKey)) {
      setError("أدخل اسم مزوّد المحفظة الذي حدده الميداني، من دون رقم محفظة أو اسم قانوني.");
      return;
    }
    setBusy("create"); setError(""); setNotice("");
    try {
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admit", fullNameAr: name, contactPhoneE164, serviceCityId: activeCity.id, walletProviderKey: providerKey }) });
      if (!response.ok) { const message = await responseMessage(response); await load(); setError(message); return; }
      const created = (await response.json() as AdmissionMutationResponse).admission;
      if (!created?.id || created.state !== "pending_review" || created.contactPhoneE164 !== contactPhoneE164 || created.fullNameAr !== name || created.serviceCityId !== activeCity.id || created.walletProviderKey !== providerKey) {
        await load(); setError("استجاب DSH للحفظ لكن سجل العملية لا يطابق الملف المطلوب. أعد القراءة قبل أي إجراء آخر."); return;
      }
      const page = await readWorkbench(contactPhoneE164);
      if (!page.items.some((item) => item.kind === "candidate" && item.admission.id === created.id && item.admission.state === "pending_review" && item.admission.fullNameAr === name && item.admission.serviceCityId === activeCity.id && item.admission.walletProviderKey === providerKey)) {
        await load(); setError("حُفظ الملف لكن إعادة قراءة السجل الموحّد لا تطابق الملف المنشأ."); return;
      }
      setFullNameAr(""); setPhone(""); setServiceCityId(""); setWalletProviderKey(""); updateQuery(contactPhoneE164);
      setNotice("أُنشئ الملف وظهر في سجل الميدانيين بانتظار المراجعة.");
      await load();
    } catch (cause) {
      await load(); setError(fieldRequestError(cause, "تعذر حفظ ملف الميداني."));
    } finally { setBusy(""); }
  }

  async function mutateCandidate(admission: FieldAdmission, action: FieldCandidateAction) {
    const nextName = (candidateEdits[admission.id] ?? admission.fullNameAr ?? "").trim();
    if (action === "update-profile" && (Array.from(nextName).length < 2 || Array.from(nextName).length > 120)) { setError("أدخل الاسم الكامل قبل حفظ الملف."); return; }
    setBusy(admission.id); setError(""); setNotice("");
    try {
      const body: { action: typeof action; admissionId: string; fullNameAr?: string; expectedVersion?: number } = { action, admissionId: admission.id };
      if (action === "update-profile") { body.fullNameAr = nextName; body.expectedVersion = admission.version; }
      if (action === "approve") body.expectedVersion = admission.version;
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const message = await responseMessage(response); await load(); setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الملف بالتزامن. ${message}` : message); return; }
      const result = (await response.json() as AdmissionMutationResponse).admission;
      const expectedState = expectedCandidateState(action, admission.state);
      if (!result?.id || result.id !== admission.id || result.state !== expectedState || (action === "update-profile" && result.fullNameAr !== nextName)) { setError("استجاب DSH لكن حالة الملف المرجعة لا تطابق الخطوة المطلوبة."); await load(); return; }
      const page = await readWorkbench(admission.contactPhoneE164 ?? "");
      if (action === "provision") {
        if (!result.actorId || !page.items.some((item) => item.kind === "account" && item.account.actorId === result.actorId && item.account.admission?.id === admission.id && item.account.admission.state === "eligible")) { setError("مُنح الدور لكن إعادة القراءة لا تثبت ربط حساب Identity بأهلية DSH."); await load(); return; }
      } else if (!page.items.some((item) => item.kind === "candidate" && item.admission.id === admission.id && item.admission.state === expectedState && (action !== "update-profile" || item.admission.fullNameAr === nextName))) {
        setError("نُفذ الإجراء لكن إعادة القراءة لا تثبت حالة الملف المطلوبة."); await load(); return;
      }
      setCandidateEdits((current) => { const next = { ...current }; delete next[admission.id]; return next; });
      await load();
      setNotice(candidateMutationNotice(action));
    } catch (cause) { setError(fieldRequestError(cause, "تعذر إكمال الإجراء.")); await load(); }
    finally { setBusy(""); }
  }

  async function mutateAccount(field: FieldAccount, action: FieldAccountAction) {
    const reason = reasons[field.actorId]?.trim() ?? "";
    const admission = field.admission;
    const fullNameAr = (profileEdits[field.actorId] ?? admission?.fullNameAr ?? "").trim();
    const validationError = accountMutationValidation(field, action, reason, fullNameAr);
    if (validationError) { setError(validationError); return; }
    setBusy(field.actorId); setError(""); setNotice("");
    try {
      const body = accountMutationBody(field, action, reason, fullNameAr);
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const message = await responseMessage(response); await load(); setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الحساب بالتزامن. أُعيد تحميل الحالة الحالية؛ راجعها قبل المحاولة مجددًا. ${message}` : message); return; }
      const page = await readWorkbench(field.phoneE164);
      const canonical = page.items.find((item): item is Extract<FieldWorkbenchItem, { kind: "account" }> => item.kind === "account" && item.account.actorId === field.actorId)?.account;
      if (!canonical) { setError("نُفذ الإجراء لكن الحساب لم يظهر في إعادة القراءة الموحّدة."); await load(); return; }
      if (!accountReadbackMatches(action, fullNameAr, canonical)) {
        setError("نُفذ الإجراء لكن إعادة القراءة لا تطابق الحالة المطلوبة."); await load(); return;
      }
      setReasons((current) => ({ ...current, [field.actorId]: "" }));
      setProfileEdits((current) => { const next = { ...current }; delete next[field.actorId]; return next; });
      setNotice(accountMutationNotice(action));
      await load();
    } catch (cause) { setError(fieldRequestError(cause, "تعذر إكمال الإجراء؛ أعد قراءة الحالة.")); await load(); }
    finally { setBusy(""); }
  }

  const normalizedCandidatePhone = fieldPhoneE164(phone);
  const candidatePhoneValid = isFieldPhoneE164(normalizedCandidatePhone);
  const candidateNameValid = Array.from(fullNameAr.trim()).length >= 2 && Array.from(fullNameAr.trim()).length <= 120;
  const candidateProviderValid = Array.from(walletProviderKey.trim()).length >= 1 && Array.from(walletProviderKey.trim()).length <= 64 && !/\p{Cc}/u.test(walletProviderKey);
  const candidateCityValid = serviceCities.some((city) => city.id === serviceCityId && city.active);

  return <section className={`access-card field-workbench ${styles.root}`} aria-labelledby="field-workbench-title">
    <header className="field-workbench-heading">
      <div><span className="step-chip">مساحة الشركاء</span><h2 id="field-workbench-title">إدارة الميدانيين</h2><p className="muted">قائمة واحدة تجمع ملفات الأهلية والحسابات. DSH يملك الأهلية وIdentity يملك دور الدخول.</p></div>
      <details className="field-create-disclosure"><summary className="button button-primary">إنشاء ملف ميداني</summary><div className="field-create-content"><div className="access-card-heading"><h3>ملف ميداني جديد</h3><p className="muted">إنشاء الملف يحفظ أهلية DSH للمراجعة فقط؛ لا ينشئ حساب الدخول ولا يرسل رمز التفعيل.</p></div><form className="access-form" onSubmit={(event) => { event.preventDefault(); void createProfile(); }}><label className="field-label" htmlFor="field-candidate-name">الاسم الكامل بالعربية<input id="field-candidate-name" autoComplete="name" maxLength={120} value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} disabled={Boolean(busy)} /></label><label className="field-label" htmlFor="field-candidate-phone">رقم الهاتف الدولي<input id="field-candidate-phone" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} disabled={Boolean(busy)} placeholder="+967 777 765 432" aria-invalid={Boolean(phone.trim()) && !candidatePhoneValid} aria-describedby="field-candidate-phone-help" /><span id="field-candidate-phone-help" className={phone.trim() && !candidatePhoneValid ? "identity-error" : "muted"}>{phone.trim() && !candidatePhoneValid ? "أدخل الرقم مع + ورمز البلد؛ الرقم المحلي وحده لا يُقبل. مثال: +967 777 765 432." : "يُستخدم هذا الرقم لإثبات الهاتف وتفعيل الدخول، ثم لتسجيل الدخول اليومي."}</span></label><label className="field-label" htmlFor="field-candidate-wallet-provider">مزوّد المحفظة الذي حدده الميداني<input id="field-candidate-wallet-provider" autoComplete="off" maxLength={64} value={walletProviderKey} onChange={(event) => setWalletProviderKey(event.target.value)} disabled={Boolean(busy)} /><small>المزوّد فقط؛ لا تدخل رقم محفظة أو اسمًا قانونيًا.</small></label><label className="field-label" htmlFor="field-candidate-city">مدينة الخدمة<select id="field-candidate-city" value={serviceCityId} onChange={(event) => setServiceCityId(event.target.value)} disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError)}><option value="">{serviceCitiesLoading ? "جارٍ تحميل المدن…" : "اختر مدينة نشطة"}</option>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>{serviceCitiesError ? <p className="identity-error" role="alert">{serviceCitiesError}</p> : null}<button type="submit" className="button button-primary" disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError) || !candidateNameValid || !candidatePhoneValid || !candidateProviderValid || !candidateCityValid}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ للمراجعة"}</button></form></div></details>
    </header>
    <section className={styles.lifecycleGuide} aria-labelledby="field-lifecycle-title">
      <h3 id="field-lifecycle-title">مسار إنشاء حساب الميداني وتفعيله</h3>
      <ol className={styles.lifecycleSteps}>
        <li><strong>١. إنشاء ملف DSH</strong><span>يحفظ للمراجعة ولا يمنح الدخول.</span></li>
        <li><strong>٢. مراجعة واعتماد الملف</strong><span>بعد الاعتماد تصبح خطوة منح الدور متاحة.</span></li>
        <li><strong>٣. منح دور الميداني</strong><span>يربط المشغّل الأهلية بدور الدخول في Identity.</span></li>
        <li><strong>٤. تفعيل الجهاز</strong><span>الميداني يثبت الهاتف المسجل بالرمز وينشئ كلمة المرور.</span></li>
      </ol>
      <p className={styles.lifecycleNote}>بعد التفعيل: الدخول بالهاتف وكلمة المرور. إعادة التسجيل لا تظهر إلا لدور سبق تفعيله، وبعد إجازة المشغّل.</p>
    </section>
    <FieldAdmissionRoster items={items} query={query} notice={notice} error={error} loading={loading} loadingMore={loadingMore} nextCursor={nextCursor} busy={busy} serviceCities={serviceCities} candidateEdits={candidateEdits} profileEdits={profileEdits} reasons={reasons} acquisitionCases={acquisitionCases} acquisitionCaseErrors={acquisitionCaseErrors} acquisitionCaseBusy={acquisitionCaseBusy} onQueryChange={updateQuery} onRefresh={() => { void load(); }} onLoadMore={() => { void load(nextCursor, true); }} onCandidateNameChange={(id, value) => setCandidateEdits((current) => ({ ...current, [id]: value }))} onCandidateMutate={mutateCandidate} onProfileNameChange={(id, value) => setProfileEdits((current) => ({ ...current, [id]: value }))} onReasonChange={(id, value) => setReasons((current) => ({ ...current, [id]: value }))} onAccountMutate={mutateAccount} onLoadAcquisitionCases={loadAcquisitionCases} />
  </section>;
}
