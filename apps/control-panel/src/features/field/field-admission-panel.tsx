"use client";

import { normalizeYemenPhoneE164, toAsciiDigits } from "@bthwani/design-system";
import { type FieldAdmission, type JoiningCaseListResponse, type OperatorFieldLatestJoiningCase, type ServiceCity, type ServiceCityListResponse, fieldAdmissionStateLabel, joiningCaseStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./field-workbench.module.css";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";
import { useWalletProviders, type WalletProviderOption } from "../wallet-provider/use-wallet-providers";

type LatestStore = Readonly<{ storeId: string; storeName: string; joiningCaseId: string; createdAt: string }>;
type FieldAccount = ActorRoleView & Readonly<{ admission: FieldAdmission | null; latestStore?: LatestStore | null; joiningCaseCount?: number; latestJoiningCase?: OperatorFieldLatestJoiningCase | null }>;
type FieldWorkbenchItem = Readonly<{ kind: "candidate"; admission: FieldAdmission }> | Readonly<{ kind: "account"; account: FieldAccount }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldWorkbenchItem>; nextCursor?: string }>;
type FieldAcquisitionCase = JoiningCaseListResponse["cases"][number];
type FieldCandidateAction = "update-profile" | "approve" | "provision";
type FieldAccountAction = "update-profile" | "review-profile" | "activate" | "disable" | "reenroll";
type AdmissionMutationResponse = Readonly<{ admission?: FieldAdmission }>;
type FieldProfileDraft = Readonly<{ fullNameAr: string; walletProviderKey: string; allServiceCities: boolean; serviceCityIds: ReadonlyArray<string> }>;

function fieldProfile(admission: FieldAdmission): FieldProfileDraft {
  return { fullNameAr: admission.fullNameAr ?? "", walletProviderKey: admission.walletProviderKey ?? "", allServiceCities: admission.allServiceCities === true, serviceCityIds: admission.serviceCityIds ?? [] };
}

function sameFieldProfile(a: FieldProfileDraft, b: FieldProfileDraft): boolean {
  return a.fullNameAr.trim() === b.fullNameAr.trim() && a.walletProviderKey.trim() === b.walletProviderKey.trim() && a.allServiceCities === b.allServiceCities && [...a.serviceCityIds].sort((left, right) => left.localeCompare(right)).join("|") === [...b.serviceCityIds].sort((left, right) => left.localeCompare(right)).join("|");
}

function fieldRequestError(cause: unknown, fallback: string): string {
  if (isRequestFailure(cause)) return cause.message;
  if (cause instanceof TypeError) return "تعذر الوصول إلى خدمة الميدانيين الآن. أعد المحاولة لاحقًا.";
  if (cause instanceof Error) return cause.message;
  return fallback;
}

async function fieldResponseMessage(response: Response): Promise<string> {
  const body = await response.clone().json().catch(() => null) as { error?: { code?: unknown } } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  if (response.status >= 500) {
    if (code === "DSH_STORAGE_UNAVAILABLE") return "تعذر إكمال طلب الميدانيين من النظام الآن. أعد المحاولة لاحقًا.";
    if (code === "IDENTITY_UNAVAILABLE") return "تعذر التحقق من الهوية الآن. أعد المحاولة لاحقًا.";
    if (code === "DSH_UNAVAILABLE" || code === "DSH_CONFIG_ERROR") return responseMessage(response);
    return "تعذر إكمال طلب الميدانيين الآن. أعد المحاولة لاحقًا.";
  }
  return responseMessage(response);
}

function fieldPhoneE164(value: string): string {
  return normalizeYemenPhoneE164(value);
}

function fieldTimestamp(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
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
  if (!admission) return "لا توجد أهلية تشغيل ";
  if (admission.requiresProfileReview) return "الملف يحتاج استكمالًا ومراجعة";
  return fieldAdmissionStateLabel(admission.state);
}

function readbackQuery(query: string, limit = 25): string {
  const params = new URLSearchParams({ scope: "workbench", limit: String(limit), q: query });
  return `/api/fields?${params.toString()}`;
}

async function readWorkbench(currentQuery: string): Promise<FieldPage> {
  const response = await identityFetch(readbackQuery(currentQuery, 50), { cache: "no-store" });
  if (!response.ok) throw new Error(await fieldResponseMessage(response));
  return await response.json() as FieldPage;
}

function expectedCandidateState(action: FieldCandidateAction, currentState: FieldAdmission["state"]): FieldAdmission["state"] {
  if (action === "approve") return "pending_identity";
  if (action === "provision") return "eligible";
  return currentState;
}

function candidateMutationNotice(action: FieldCandidateAction): string {
  if (action === "approve") return "اعتُمد الملف وأُعيدت قراءته؛ أصبح منح الدور خطوته التالية.";
  if (action === "provision") return "مُنح دور الدخول وربط بأهلية النظام. الخطوة التالية للميداني: يفتح التطبيق، ويدخل رقم الهاتف المسجل، ثم يختار تفعيل الجهاز لإثبات الهاتف وإنشاء كلمة المرور.";
  return "حُفظ الاسم وأُعيدت قراءة الملف .";
}

function accountMutationNotice(action: FieldAccountAction): string {
  if (action === "reenroll") return "أُجيزت إعادة تسجيل دور سبق تفعيله بعد التحقق من أهلية النظام. الخطوة التالية للميداني: تفعيل الجهاز من التطبيق برمز الهاتف.";
  if (action === "activate") return "أُعيد تفعيل دور الدخول وأُعيدت قراءة حساب الميداني وأهليته.";
  if (action === "disable") return "أُوقف دور الدخول وأُعيدت قراءة حالة الحساب وأهلية النظام.";
  if (action === "review-profile") return "اعتُمدت مراجعة الملف وأُعيدت قراءة حالته.";
  if (action === "update-profile") return "حُفظ ملف الميداني ومزوّد المحفظة ونطاق المدن، وأُعيدت قراءة البيانات المعتمدة.";
  return "تم الإجراء وأُعيدت قراءة حالة الحساب وأهلية النظام.";
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
  if (action === "update-profile" && !admission) return "لا يوجد ملف أهلية مرتبط بهذا الحساب لتعديله.";
  if (action === "review-profile" && (admission?.state !== "suspended" || !admission.requiresProfileReview)) return "هذا الملف لا يحتاج مراجعة حاليًا.";
  if (action === "update-profile" && (Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120)) return "أدخل اسم العرض الكامل قبل الحفظ.";
  if (action === "reenroll" && (admission?.state !== "eligible" || !field.enabled || !field.securityEnabled || !field.activatedAt)) return "إعادة التسجيل تتطلب دورًا مفعّلًا سبق تفعيله وأهلية النظام سارية.";
  return undefined;
}

function accountMutationBody(field: FieldAccount, action: FieldAccountAction, reason: string, profile: FieldProfileDraft): Record<string, unknown> {
  const admission = field.admission;
  const body: Record<string, unknown> = { action, actorId: field.actorId, admissionId: admission?.id, reason };
  if (action === "update-profile") { Object.assign(body, profile); body.expectedVersion = admission?.version; }
  if (action === "review-profile") { body.fullNameAr = profile.fullNameAr; body.expectedVersion = admission?.version; }
  if (action === "activate" || action === "disable") body.expectedVersion = field.roleVersion;
  if (action === "reenroll") { body.expectedActorVersion = field.actorVersion; body.expectedRoleVersion = field.roleVersion; body.expectedAdmissionVersion = admission?.version; }
  return body;
}

function accountReadbackMatches(action: FieldAccountAction, profile: FieldProfileDraft, canonical: FieldAccount): boolean {
  return !(
    (action === "update-profile" && (!canonical.admission || !sameFieldProfile(fieldProfile(canonical.admission), profile))) ||
    (action === "review-profile" && canonical.admission?.requiresProfileReview) ||
    (action === "disable" && canonical.enabled) ||
    (action === "activate" && !canonical.enabled) ||
    (action === "reenroll" && canonical.activatedAt)
  );
}

type FieldCandidateRowProps = Readonly<{
  profile: FieldAdmission;
  draft: FieldProfileDraft;
  changed: boolean;
  busy: string;
  rowNotice: string;
  rowError: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  walletProviders: ReadonlyArray<WalletProviderOption>;
  onDraftChange: (value: FieldProfileDraft) => void;
  onMutate: (admission: FieldAdmission, action: FieldCandidateAction) => void;
}>;

function FieldCandidateRow({ profile, draft, changed, busy, rowNotice, rowError, serviceCities, walletProviders, onDraftChange, onMutate }: FieldCandidateRowProps) {
  const pendingReview = profile.state === "pending_review";
  const pendingIdentity = profile.state === "pending_identity";
  const cities = profile.allServiceCities ? "جميع المدن النشطة" : (profile.serviceCityIds ?? []).map((id) => serviceCities.find((city) => city.id === id)?.displayNameAr ?? "مدينة غير متاحة").join("، ") || "لا توجد مدينة محددة";
  const providerName = walletProviders.find((provider) => provider.key === profile.walletProviderKey)?.displayNameAr || profile.walletProviderKey || "غير محدد";
  return <tr className="field-agent-row">
    <th scope="row"><strong>{profile.fullNameAr || "ملف بلا اسم مكتمل"}</strong><br /><bdi dir="ltr">{profile.contactPhoneE164 || "—"}</bdi></th>
    <td>{cities}<br /><span className="muted">المحفظة: {providerName}</span></td>
    <td><span className="field-agent-badge">{fieldAdmissionStateLabel(profile.state)}</span>{profile.requiresProfileReview ? <p className="field-agent-blocker">تحتاج استكمالًا ومراجعة</p> : null}</td>
    <td>لا يوجد دور دخول بعد</td><td>غير متاح قبل إنشاء الحساب</td><td>لا يوجد متجر مسجل</td><td>لا توجد ملفات ضم</td><td>غير متاح قبل إنشاء الحساب</td>
    <td>
      {busy === profile.id ? <output className="muted">جارٍ تنفيذ الإجراء وإعادة القراءة…</output> : null}{rowNotice ? <output className="success-inline">{rowNotice}</output> : null}{rowError ? <p className="identity-error" role="alert">{rowError}</p> : null}
      {pendingReview ? <><details className="field-agent-edit"><summary className="button button-secondary">تعديل بيانات الملف</summary><div className="field-row-actions"><label className="field-label" htmlFor={`candidate-name-${profile.id}`}>اسم العرض<input id={`candidate-name-${profile.id}`} value={draft.fullNameAr} maxLength={120} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, fullNameAr: event.target.value })} /></label><label className="field-label" htmlFor={`candidate-wallet-${profile.id}`}>مزوّد المحفظة<select id={`candidate-wallet-${profile.id}`} value={draft.walletProviderKey} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, walletProviderKey: event.target.value })}><option value="">اختر محفظة رسمية</option>{draft.walletProviderKey && !walletProviders.some((provider) => provider.key === draft.walletProviderKey) ? <option value={draft.walletProviderKey}>{draft.walletProviderKey} · قيمة سابقة</option> : null}{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select></label><label className="field-label" htmlFor={`candidate-all-cities-${profile.id}`}><input id={`candidate-all-cities-${profile.id}`} type="checkbox" checked={draft.allServiceCities} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, allServiceCities: event.target.checked, serviceCityIds: event.target.checked ? [] : draft.serviceCityIds })} /> جميع المدن النشطة</label>{!draft.allServiceCities ? <label className="field-label" htmlFor={`candidate-cities-${profile.id}`}>مدن الخدمة<select id={`candidate-cities-${profile.id}`} multiple value={[...draft.serviceCityIds]} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, serviceCityIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label> : null}<button type="button" className="button button-secondary" disabled={Boolean(busy) || !changed} onClick={() => onMutate(profile, "update-profile")}>حفظ الملف والمدن</button></div></details><button type="button" className="button button-primary" disabled={Boolean(busy) || changed} onClick={() => onMutate(profile, "approve")}>{busy === profile.id ? "جارٍ الاعتماد…" : "اعتماد الملف"}</button></> : null}
      {pendingIdentity ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => onMutate(profile, "provision")}>{busy === profile.id ? "جارٍ منح الدور…" : "منح دور الميداني"}</button> : null}
      {!pendingReview && !pendingIdentity ? <span className="muted">لا توجد خطوة متاحة لهذه المرحلة.</span> : null}
    </td>
  </tr>;
}

type FieldAccountMutationActionsProps = Readonly<{
  field: FieldAccount;
  name: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  walletProviders: ReadonlyArray<WalletProviderOption>;
  reason: string;
  busy: string;
  onNameChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onMutate: (field: FieldAccount, action: FieldAccountAction, profile?: FieldProfileDraft) => void;
}>;

type FieldAccountProfileActionsProps = Readonly<Pick<FieldAccountMutationActionsProps, "field" | "serviceCities" | "walletProviders" | "busy" | "onMutate">>;

function FieldAccountProfileActions({ field, serviceCities, walletProviders, busy, onMutate }: FieldAccountProfileActionsProps) {
  const admission = field.admission;
  const saved = admission ? fieldProfile(admission) : { fullNameAr: "", walletProviderKey: "", allServiceCities: false, serviceCityIds: [] };
  const [draft, setDraft] = useState(saved);
  if (!admission) return null;
  const unchanged = sameFieldProfile(draft, saved);
  const valid = Array.from(draft.fullNameAr.trim()).length >= 2 && Array.from(draft.fullNameAr.trim()).length <= 120 && Array.from(draft.walletProviderKey.trim()).length >= 1 && Array.from(draft.walletProviderKey.trim()).length <= 64 && (draft.allServiceCities || draft.serviceCityIds.length > 0 && draft.serviceCityIds.every((id) => serviceCities.some((city) => city.id === id)));
  return <>
    <label className="field-label" htmlFor={`field-profile-name-${field.actorId}`}>اسم العرض<input id={`field-profile-name-${field.actorId}`} value={draft.fullNameAr} maxLength={120} disabled={Boolean(busy)} onChange={(event) => setDraft((current) => ({ ...current, fullNameAr: event.target.value }))} /></label>
    <label className="field-label" htmlFor={`field-profile-wallet-${field.actorId}`}>مزوّد المحفظة<select id={`field-profile-wallet-${field.actorId}`} value={draft.walletProviderKey} disabled={Boolean(busy)} onChange={(event) => setDraft((current) => ({ ...current, walletProviderKey: event.target.value }))}><option value="">اختر محفظة رسمية</option>{draft.walletProviderKey && !walletProviders.some((provider) => provider.key === draft.walletProviderKey) ? <option value={draft.walletProviderKey}>{draft.walletProviderKey} · قيمة سابقة</option> : null}{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select></label>
    <label className="field-label" htmlFor={`field-profile-all-cities-${field.actorId}`}><input id={`field-profile-all-cities-${field.actorId}`} type="checkbox" checked={draft.allServiceCities} disabled={Boolean(busy)} onChange={(event) => setDraft((current) => ({ ...current, allServiceCities: event.target.checked, serviceCityIds: event.target.checked ? [] : current.serviceCityIds }))} /> جميع المدن النشطة</label>
    {!draft.allServiceCities ? <label className="field-label" htmlFor={`field-profile-cities-${field.actorId}`}>مدن الخدمة<select id={`field-profile-cities-${field.actorId}`} multiple value={[...draft.serviceCityIds]} disabled={Boolean(busy)} onChange={(event) => setDraft((current) => ({ ...current, serviceCityIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) }))}>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label> : null}
    <button type="button" className="button button-secondary" disabled={Boolean(busy) || !valid || unchanged} onClick={() => onMutate(field, "update-profile", draft)}>حفظ الملف والمدن</button>
    {admission.requiresProfileReview && admission.state === "suspended" ? <button type="button" className="button button-primary" disabled={Boolean(busy) || !unchanged || !valid} onClick={() => onMutate(field, "review-profile", draft)}>اعتماد مراجعة الملف</button> : null}
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
  const canReactivate = !field.enabled && !requiresProfileReview && field.securityEnabled && (field.admission?.state === "eligible" || field.admission?.state === "suspended");
  return <>
    {waitingForFirstActivation ? <p className="muted" role="status">الدور جاهز. الخطوة التالية للميداني: يفتح تطبيق الميدان، يدخل رقم الهاتف المسجل، ثم يختار «تفعيل الجهاز» لإثبات الهاتف وإنشاء كلمة المرور.</p> : null}
    {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || !reasonIsValid} onClick={() => onMutate(field, "reenroll")}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
    {canDisable || canReactivate ? <button type="button" className={shouldDisable ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || !reasonIsValid} onClick={() => onMutate(field, accessAction)}>{accessActionButtonLabel(busy === field.actorId, shouldDisable)}</button> : null}
    {requiresProfileReview && !mustDisable && !field.enabled ? <span className="muted">أكمل مراجعة الملف قبل إعادة التفعيل.</span> : null}
  </>;
}

function FieldAccountMutationActions({ field, name, reason, busy, serviceCities, walletProviders, onNameChange, onReasonChange, onMutate }: FieldAccountMutationActionsProps) {
  const admission = field.admission;
  const requiresProfileReview = admission?.requiresProfileReview === true;
  const mustDisable = requiresProfileReview && admission?.state === "eligible";
  const shouldDisable = field.enabled || mustDisable;
  const waitingForFirstActivation = !requiresProfileReview && field.securityEnabled && field.enabled && !field.activatedAt && admission?.state === "eligible";
  const waitingForReenrollment = !requiresProfileReview && field.securityEnabled && field.enabled && Boolean(field.activatedAt) && admission?.state === "eligible";
  const reasonIsValid = Array.from(reason.trim()).length >= 5;

  return admission ? <div className="field-agent-controls">
    <details className="field-agent-edit" open={admission.requiresProfileReview}><summary className="button button-secondary">تعديل الملف والتغطية</summary><div className="field-row-actions"><FieldAccountProfileActions key={admission.version} field={field} serviceCities={serviceCities} walletProviders={walletProviders} busy={busy} onMutate={onMutate} /></div></details>
    <label className="field-label field-agent-reason" htmlFor={`field-reason-${field.actorId}`}>سبب الإجراء<input id={`field-reason-${field.actorId}`} maxLength={500} value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={Boolean(busy)} placeholder="مطلوب لتغيير الوصول" /></label>
    <FieldAccountAccessActions field={field} busy={busy} reason={reason} onMutate={onMutate} waitingForFirstActivation={waitingForFirstActivation} waitingForReenrollment={waitingForReenrollment} shouldDisable={shouldDisable} requiresProfileReview={requiresProfileReview} mustDisable={mustDisable} reasonIsValid={reasonIsValid} />
  </div> : <span className="muted">راجع الأهلية قبل إتاحة العمل الميداني.</span>;
}

type FieldAcquisitionDisclosureProps = Readonly<{
  fieldActorId: string;
  page: JoiningCaseListResponse | undefined;
  error: string;
  busy: boolean;
  onLoad: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldAcquisitionDisclosure({ fieldActorId, page, error, busy, onLoad }: FieldAcquisitionDisclosureProps) {
  return <div className="field-agent-cases">
      {!page && !error ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => onLoad(fieldActorId)}>{busy ? "جارٍ القراءة…" : "قراءة ملفات ضم الشركاء"}</button> : null}
      {error ? <><span className="identity-error" role="alert">{error}</span><button type="button" className="button button-secondary" disabled={busy} onClick={() => onLoad(fieldActorId)}>إعادة المحاولة</button></> : null}
      {page ? <strong>الملفات المحمّلة الآن: {page.cases.length}{page.nextCursor ? " · توجد ملفات أقدم" : ""}</strong> : null}
      {page?.cases.map((partnerCase: FieldAcquisitionCase) => <div key={partnerCase.id} className="field-agent-case">
        <a href={`/partners/${encodeURIComponent(partnerCase.id)}`}>{partnerCase.businessName || partnerCase.firstStoreName}</a>
        <span>{joiningCaseStateLabel(partnerCase.state)}</span>
        {partnerCase.partnerActorId ? <span>حساب الشريك مرتبط</span> : null}
        {partnerCase.state === "needs_correction" && partnerCase.correctionReason ? <span className="field-agent-blocker">{partnerCase.correctionReason}</span> : null}
      </div>)}
      {!busy && !error && page?.cases.length === 0 ? <span className="muted">لا توجد ملفات ضم</span> : null}
      {page?.nextCursor ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => onLoad(fieldActorId, page.nextCursor, true)}>{busy ? "جارٍ تحميل المزيد…" : "تحميل ملفات ضم أقدم"}</button> : null}
  </div>;
}

function FieldJourneySummary({ field }: Readonly<{ field: FieldAccount }>) {
  const latest = field.latestJoiningCase;
  return <div className="field-agent-journey-summary">
    <strong>عدد ملفات ضم الشركاء: {field.joiningCaseCount ?? 0}</strong>
    {latest ? <><a href={`/partners/${encodeURIComponent(latest.id)}`}>{latest.displayName}</a><span>{joiningCaseStateLabel(latest.state)}</span><time className="muted" dateTime={latest.createdAt}>{fieldTimestamp(latest.createdAt)}</time></> : null}
  </div>;
}

type FieldAccountRowProps = Readonly<{
  field: FieldAccount;
  serviceCities: ReadonlyArray<ServiceCity>;
  walletProviders: ReadonlyArray<WalletProviderOption>;
  name: string;
  reason: string;
  busy: string;
  rowNotice: string;
  rowError: string;
  acquisitionPage: JoiningCaseListResponse | undefined;
  acquisitionError: string;
  acquisitionBusy: boolean;
  onNameChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onMutate: (field: FieldAccount, action: FieldAccountAction, profile?: FieldProfileDraft) => void;
  onLoadAcquisitionCases: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldAccountRow({ field, serviceCities, walletProviders, name, reason, busy, rowNotice, rowError, acquisitionPage, acquisitionError, acquisitionBusy, onNameChange, onReasonChange, onMutate, onLoadAcquisitionCases }: FieldAccountRowProps) {
  const admission = field.admission;
  const cities = admission?.allServiceCities ? "جميع المدن النشطة" : (admission?.serviceCityIds ?? []).map((id) => serviceCities.find((city) => city.id === id)?.displayNameAr ?? "مدينة غير متاحة").join("، ") || "لا توجد مدينة محددة";
  const providerName = walletProviders.find((provider) => provider.key === admission?.walletProviderKey)?.displayNameAr || admission?.walletProviderKey || "غير محدد";
  return <tr className="field-agent-row">
    <th scope="row"><strong>{admission?.fullNameAr || "حساب بلا ملف اسم مكتمل"}</strong><br /><bdi dir="ltr">{field.phoneE164}</bdi></th>
    <td>{cities}<br /><span className="muted">المحفظة: {providerName}</span></td>
    <td><span className="field-agent-badge">{admissionStatusLabel(admission)}</span>{admission?.requiresProfileReview ? <p className="field-agent-blocker">استكمال الملف مطلوب</p> : null}</td>
    <td><span className={`field-agent-badge ${field.enabled ? "is-enabled" : "is-disabled"}`}>{identityStatusLabel(field)}</span><br /><span className="muted">{field.activatedAt ? "سبق تفعيله" : "لم يفعّل الجهاز"}</span></td>
    <td>{field.lastAppOpenedAt ? <time dateTime={field.lastAppOpenedAt}>{fieldTimestamp(field.lastAppOpenedAt)}</time> : <span className="muted">لم يفتح التطبيق بعد</span>}</td>
    <td>{field.latestStore ? <><a href={`/partners/${encodeURIComponent(field.latestStore.joiningCaseId)}`}>{field.latestStore.storeName}</a><br /><time className="muted" dateTime={field.latestStore.createdAt}>{fieldTimestamp(field.latestStore.createdAt)}</time></> : <span className="muted">لا يوجد متجر مسجل</span>}</td>
    <td><FieldJourneySummary field={field} /><FieldAcquisitionDisclosure fieldActorId={field.actorId} page={acquisitionPage} error={acquisitionError} busy={acquisitionBusy} onLoad={onLoadAcquisitionCases} /></td>
    <td><a className="button button-secondary" href={`/finance/beneficiary-settlement/field?search=${encodeURIComponent(field.actorId)}`}>الملف المالي</a></td>
    <td>{busy === field.actorId ? <output className="muted">جارٍ تنفيذ الإجراء وإعادة القراءة…</output> : null}{rowNotice ? <output className="success-inline">{rowNotice}</output> : null}{rowError ? <p className="identity-error" role="alert">{rowError}</p> : null}<FieldAccountMutationActions field={field} name={name} reason={reason} busy={busy} serviceCities={serviceCities} walletProviders={walletProviders} onNameChange={onNameChange} onReasonChange={onReasonChange} onMutate={onMutate} /></td>
  </tr>;
}

type FieldAdmissionRosterProps = Readonly<{
  items: ReadonlyArray<FieldWorkbenchItem>;
  query: string;
  cityFilter: string;
  notice: string;
  error: string;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string;
  busy: string;
  feedbackActorId: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  walletProviders: ReadonlyArray<WalletProviderOption>;
  candidateEdits: Record<string, FieldProfileDraft>;
  profileEdits: Record<string, string>;
  reasons: Record<string, string>;
  acquisitionCases: Record<string, JoiningCaseListResponse>;
  acquisitionCaseErrors: Record<string, string>;
  acquisitionCaseBusy: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onCityFilterChange: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onCandidateNameChange: (admissionId: string, value: FieldProfileDraft) => void;
  onCandidateMutate: (admission: FieldAdmission, action: FieldCandidateAction) => void;
  onProfileNameChange: (actorId: string, value: string) => void;
  onReasonChange: (actorId: string, value: string) => void;
  onAccountMutate: (field: FieldAccount, action: FieldAccountAction, profile?: FieldProfileDraft) => void;
  onLoadAcquisitionCases: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldEmptyRoster({ query }: Readonly<{ query: string }>) {
  const title = query ? "لا توجد نتائج مطابقة" : "لا توجد ملفات أو حسابات ميدانية";
  const description = query ? "امسح البحث لعرض السجل كاملًا." : "أنشئ ملفًا جديدًا لبدء مسار الأهلية.";
  return <div className="collection-state"><strong>{title}</strong><p>{description}</p></div>;
}

function FieldAdmissionRoster({ items, query, cityFilter, notice, error, loading, loadingMore, nextCursor, busy, feedbackActorId, serviceCities, walletProviders, candidateEdits, profileEdits, reasons, acquisitionCases, acquisitionCaseErrors, acquisitionCaseBusy, onQueryChange, onCityFilterChange, onRefresh, onLoadMore, onCandidateNameChange, onCandidateMutate, onProfileNameChange, onReasonChange, onAccountMutate, onLoadAcquisitionCases }: FieldAdmissionRosterProps) {
  const [admissionFilter, setAdmissionFilter] = useState("");
  const [accessFilter, setAccessFilter] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [storeQuery, setStoreQuery] = useState("");
  const [journeyFilter, setJourneyFilter] = useState("");
  const [journeyQuery, setJourneyQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "city" | "provider" | "admission" | "access" | "activity" | "store" | "journey">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const visibleItems = useMemo(() => {
    const matches = items.filter((item) => {
      if (item.kind === "candidate") {
        if (accessFilter || activityFilter || storeFilter || storeQuery.trim()) return false;
        if (admissionFilter && (admissionFilter === "none" || item.admission.state !== admissionFilter)) return false;
        if (journeyFilter === "has" || journeyFilter === "needs_correction" || journeyQuery.trim()) return false;
        return !providerFilter || item.admission.walletProviderKey === providerFilter;
      }
      if (accessFilter === "enabled" && !item.account.enabled) return false;
      if (accessFilter === "disabled" && item.account.enabled) return false;
      if (admissionFilter === "none" && item.account.admission) return false;
      if (admissionFilter && admissionFilter !== "none" && item.account.admission?.state !== admissionFilter) return false;
      if (providerFilter && item.account.admission?.walletProviderKey !== providerFilter) return false;
      const openedAt = item.account.lastAppOpenedAt ? Date.parse(item.account.lastAppOpenedAt) : NaN;
      if (activityFilter === "opened" && !Number.isFinite(openedAt)) return false;
      if (activityFilter === "never" && Number.isFinite(openedAt)) return false;
      if (activityFilter === "recent" && (!Number.isFinite(openedAt) || Date.now() - openedAt > 30 * 24 * 60 * 60 * 1000)) return false;
      if (storeFilter === "has" && !item.account.latestStore) return false;
      if (storeFilter === "none" && item.account.latestStore) return false;
      if (storeFilter === "recent" && (!item.account.latestStore || Date.now() - Date.parse(item.account.latestStore.createdAt) > 30 * 24 * 60 * 60 * 1000)) return false;
      if (storeQuery.trim() && !item.account.latestStore?.storeName.toLocaleLowerCase("ar").includes(storeQuery.trim().toLocaleLowerCase("ar"))) return false;
      const joiningCaseCount = item.account.joiningCaseCount ?? 0;
      const latestJoiningCase = item.account.latestJoiningCase;
      if (journeyFilter === "has" && joiningCaseCount === 0) return false;
      if (journeyFilter === "none" && joiningCaseCount > 0) return false;
      if (journeyFilter === "needs_correction" && latestJoiningCase?.state !== "needs_correction") return false;
      if (journeyQuery.trim() && !latestJoiningCase?.displayName.toLocaleLowerCase("ar").includes(journeyQuery.trim().toLocaleLowerCase("ar"))) return false;
      return true;
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...matches].sort((a, b) => {
      const nameA = a.kind === "candidate" ? a.admission.fullNameAr : a.account.admission?.fullNameAr;
      const nameB = b.kind === "candidate" ? b.admission.fullNameAr : b.account.admission?.fullNameAr;
      if (sortBy === "name") return direction * (nameA ?? "").localeCompare(nameB ?? "", "ar");
      if (sortBy === "access") {
        const enabledA = a.kind === "account" && a.account.enabled ? 1 : 0;
        const enabledB = b.kind === "account" && b.account.enabled ? 1 : 0;
        return direction * (enabledA - enabledB);
      }
      if (sortBy === "provider" || sortBy === "city") {
        const getValue = (item: FieldWorkbenchItem) => {
          const admission = item.kind === "candidate" ? item.admission : item.account.admission;
          if (sortBy === "provider") return walletProviders.find((provider) => provider.key === admission?.walletProviderKey)?.displayNameAr ?? admission?.walletProviderKey ?? "";
          if (!admission) return "";
          if (admission.allServiceCities) return "جميع المدن النشطة";
          const cityIDs = admission.serviceCityIds ?? [];
          return cityIDs.map((cityID) => serviceCities.find((city) => city.id === cityID)?.displayNameAr ?? "").sort((a, b) => a.localeCompare(b, "ar")).join("، ");
        };
        return direction * getValue(a).localeCompare(getValue(b), "ar");
      }
      if (sortBy === "activity") {
        const openedA = a.kind === "account" && a.account.lastAppOpenedAt ? Date.parse(a.account.lastAppOpenedAt) : 0;
        const openedB = b.kind === "account" && b.account.lastAppOpenedAt ? Date.parse(b.account.lastAppOpenedAt) : 0;
        return direction * (openedA - openedB);
      }
      if (sortBy === "store") {
        const createdA = a.kind === "account" && a.account.latestStore ? Date.parse(a.account.latestStore.createdAt) : 0;
        const createdB = b.kind === "account" && b.account.latestStore ? Date.parse(b.account.latestStore.createdAt) : 0;
        return direction * (createdA - createdB);
      }
      if (sortBy === "journey") {
        const countA = a.kind === "account" ? a.account.joiningCaseCount ?? 0 : 0;
        const countB = b.kind === "account" ? b.account.joiningCaseCount ?? 0 : 0;
        if (countA !== countB) return direction * (countA - countB);
        const createdA = a.kind === "account" && a.account.latestJoiningCase ? Date.parse(a.account.latestJoiningCase.createdAt) : 0;
        const createdB = b.kind === "account" && b.account.latestJoiningCase ? Date.parse(b.account.latestJoiningCase.createdAt) : 0;
        return direction * (createdA - createdB);
      }
      const stateA = a.kind === "candidate" ? a.admission.state : a.account.admission?.state ?? "";
      const stateB = b.kind === "candidate" ? b.admission.state : b.account.admission?.state ?? "";
      return direction * stateA.localeCompare(stateB, "ar");
    });
  }, [items, admissionFilter, accessFilter, activityFilter, storeFilter, storeQuery, journeyFilter, journeyQuery, providerFilter, sortBy, sortDirection, serviceCities, walletProviders]);
  function toggleSort(column: "name" | "city" | "provider" | "admission" | "access" | "activity" | "store" | "journey") {
    if (sortBy === column) setSortDirection((value) => value === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortDirection("asc"); }
  }
  const sortButton = (column: "name" | "city" | "provider" | "admission" | "access" | "activity" | "store" | "journey", label: string) => <button type="button" className="field-column-sort" onClick={() => toggleSort(column)} aria-label={`ترتيب حسب ${label}`} aria-pressed={sortBy === column}>{label}{sortBy === column ? <span aria-hidden="true"> {sortDirection === "asc" ? "↑" : "↓"}</span> : null}</button>;
  const hasFilters = Boolean(query || cityFilter || admissionFilter || accessFilter || activityFilter || storeFilter || storeQuery || journeyFilter || journeyQuery || providerFilter);
  const hasLoadedPageFilters = Boolean(admissionFilter || accessFilter || activityFilter || storeFilter || storeQuery || journeyFilter || journeyQuery || providerFilter);
  return <div className="field-workbench-pane">
    <div className="field-roster-tools">{hasFilters ? <button type="button" className="button button-secondary" onClick={() => { onQueryChange(""); onCityFilterChange(""); setAdmissionFilter(""); setAccessFilter(""); setActivityFilter(""); setStoreFilter(""); setStoreQuery(""); setJourneyFilter(""); setJourneyQuery(""); setProviderFilter(""); }}>مسح المرشحات</button> : null}<button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={onRefresh}>{loading ? "جارٍ التحديث…" : "تحديث السجل"}</button></div>
    {notice && !feedbackActorId ? <output className="success-inline">{notice}</output> : null}{error && !feedbackActorId ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading && items.length === 0 ? <output>جارٍ قراءة سجل الميدانيين…</output> : null}
    {!loading && !error && items.length === 0 ? <FieldEmptyRoster query={query} /> : null}
    {items.length > 0 ? <section className="operations-table-wrap field-agent-table-wrap" aria-label="سجل الميدانيين، تحرك أفقيًا عند الحاجة لعرض الأعمدة"><table className="operations-table field-agent-table"><caption className="visually-hidden">سجل الميدانيين، أدوات التصفية والترتيب داخل عناوين الأعمدة</caption><thead><tr>
      <th scope="col"><div className="field-column-heading">{sortButton("name", "الميداني والهاتف")}<input id="field-search" type="search" aria-label="بحث بالاسم أو الهاتف" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="اسم أو هاتف" /></div></th>
      <th scope="col"><div className="field-column-heading">{sortButton("city", "مدينة الخدمة")}<select aria-label="تصفية حسب مدينة الخدمة" value={cityFilter} onChange={(event) => onCityFilterChange(event.target.value)}><option value="">كل المدن</option>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select>{sortButton("provider", "مزوّد المحفظة")}<select aria-label="تصفية حسب مزوّد المحفظة" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="">كل المزوّدين</option>{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select></div></th>
      <th scope="col"><div className="field-column-heading">{sortButton("admission", "أهلية النظام")}<select aria-label="تصفية حسب حالة الأهلية" value={admissionFilter} onChange={(event) => setAdmissionFilter(event.target.value)}><option value="">كل الحالات</option><option value="none">لا توجد أهلية مرتبطة</option><option value="pending_review">بانتظار المراجعة</option><option value="pending_identity">بانتظار إنشاء الحساب</option><option value="eligible">مؤهل</option><option value="suspended">موقوفة</option></select></div></th>
      <th scope="col"><div className="field-column-heading">{sortButton("access", "دخول التطبيق")}<select aria-label="تصفية حسب حالة دخول التطبيق" value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}><option value="">كل الحسابات</option><option value="enabled">الدخول مفعّل</option><option value="disabled">الدخول موقوف</option></select></div></th>
      <th scope="col"><div className="field-column-heading">{sortButton("activity", "آخر فتح للتطبيق")}<select aria-label="تصفية حسب فتح التطبيق" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="">كل الأنشطة</option><option value="opened">سبق فتح التطبيق</option><option value="recent">خلال 30 يومًا</option><option value="never">لم يفتح التطبيق</option></select></div></th>
      <th scope="col"><div className="field-column-heading">{sortButton("store", "أحدث متجر")}<select aria-label="تصفية حسب وجود المتجر أو حداثته" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="">كل المتاجر</option><option value="has">أضاف متجرًا</option><option value="recent">خلال 30 يومًا</option><option value="none">لم يضف متجرًا</option></select><input type="search" aria-label="بحث باسم أحدث متجر" placeholder="اسم المتجر" value={storeQuery} onChange={(event) => setStoreQuery(event.target.value)} /></div></th>
      <th scope="col"><div className="field-column-heading">{sortButton("journey", "ملفات ضم الشركاء")}<select aria-label="تصفية حسب ملفات ضم الشركاء" value={journeyFilter} onChange={(event) => setJourneyFilter(event.target.value)}><option value="">كل الملفات</option><option value="has">لديه ملفات ضم</option><option value="none">بلا ملفات ضم</option><option value="needs_correction">أحدث ملف يحتاج تصحيحًا</option></select><input type="search" aria-label="بحث باسم آخر شريك" placeholder="اسم الشريك" value={journeyQuery} onChange={(event) => setJourneyQuery(event.target.value)} /></div></th><th scope="col">المالية</th><th scope="col">الإجراءات</th>
    </tr></thead><tbody>
      {visibleItems.map((item) => item.kind === "candidate"
        ? <FieldCandidateRow key={`candidate:${item.admission.id}`} profile={item.admission} draft={candidateEdits[item.admission.id] ?? fieldProfile(item.admission)} changed={!sameFieldProfile(candidateEdits[item.admission.id] ?? fieldProfile(item.admission), fieldProfile(item.admission))} busy={busy} rowNotice={feedbackActorId === item.admission.id ? notice : ""} rowError={feedbackActorId === item.admission.id ? error : ""} serviceCities={serviceCities} walletProviders={walletProviders} onDraftChange={(value) => onCandidateNameChange(item.admission.id, value)} onMutate={onCandidateMutate} />
        : <FieldAccountRow key={`account:${item.account.actorId}`} field={item.account} serviceCities={serviceCities} walletProviders={walletProviders} name={profileEdits[item.account.actorId] ?? item.account.admission?.fullNameAr ?? ""} reason={reasons[item.account.actorId] ?? ""} busy={busy} rowNotice={feedbackActorId === item.account.actorId ? notice : ""} rowError={feedbackActorId === item.account.actorId ? error : ""} acquisitionPage={acquisitionCases[item.account.actorId]} acquisitionError={acquisitionCaseErrors[item.account.actorId] ?? ""} acquisitionBusy={acquisitionCaseBusy[item.account.actorId] ?? false} onNameChange={(value) => onProfileNameChange(item.account.actorId, value)} onReasonChange={(value) => onReasonChange(item.account.actorId, value)} onMutate={onAccountMutate} onLoadAcquisitionCases={onLoadAcquisitionCases} />)}
    </tbody></table>{visibleItems.length === 0 && !loading ? <output className="field-filter-empty">لا تطابق السجلات المحمّلة هذه المرشحات.</output> : null}{hasLoadedPageFilters ? <output className="field-filter-count" aria-live="polite">{visibleItems.length} من {items.length} سجل محمّل</output> : null}</section> : null}
    {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={onLoadMore}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
  </div>;
}

export function FieldAdmissionPanel() {
  const { walletProviders, walletProvidersLoading, walletProvidersError } = useWalletProviders();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ReadonlyArray<FieldWorkbenchItem>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [phone, setPhone] = useState("");
  const [walletProviderKey, setWalletProviderKey] = useState("");
  const [allServiceCities, setAllServiceCities] = useState(true);
  const [serviceCityIds, setServiceCityIds] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("serviceCityId") ?? "");
  const [serviceCities, setServiceCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [serviceCitiesLoading, setServiceCitiesLoading] = useState(true);
  const [serviceCitiesError, setServiceCitiesError] = useState("");
  const [candidateEdits, setCandidateEdits] = useState<Record<string, FieldProfileDraft>>({});
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedbackActorId, setFeedbackActorId] = useState("");
  const [acquisitionCases, setAcquisitionCases] = useState<Record<string, JoiningCaseListResponse>>({});
  const [acquisitionCaseErrors, setAcquisitionCaseErrors] = useState<Record<string, string>>({});
  const [acquisitionCaseBusy, setAcquisitionCaseBusy] = useState<Record<string, boolean>>({});
  const loadRequestID = useRef(0);

  useEffect(() => {
    let current = true;
    void identityFetch("/api/service-cities", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await fieldResponseMessage(response));
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
      if (cityFilter) params.set("serviceCityId", cityFilter);
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/fields?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const message = await fieldResponseMessage(response);
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
  }, [query, cityFilter]);

  async function loadAcquisitionCases(fieldActorId: string, cursor = "", append = false) {
    setAcquisitionCaseBusy((current) => ({ ...current, [fieldActorId]: true }));
    setAcquisitionCaseErrors((current) => ({ ...current, [fieldActorId]: "" }));
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/fields/${encodeURIComponent(fieldActorId)}/acquisition-cases?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await fieldResponseMessage(response));
      const page = await response.json() as JoiningCaseListResponse;
      setAcquisitionCases((current) => ({
        ...current,
        [fieldActorId]: append && current[fieldActorId] ? {
          cases: [...current[fieldActorId].cases, ...page.cases],
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        } : page,
      }));
    } catch (cause) {
      setAcquisitionCaseErrors((current) => ({ ...current, [fieldActorId]: fieldRequestError(cause, "تعذرت قراءة ملفات ضم الشركاء لهذا الميداني.") }));
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

  function updateCityFilter(value: string) {
    setCityFilter(value);
    const params = new URLSearchParams(window.location.search);
    if (value) params.set("serviceCityId", value); else params.delete("serviceCityId");
    params.delete("cursor");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }

  async function createProfile() {
    const name = fullNameAr.trim();
    const contactPhoneE164 = fieldPhoneE164(phone);
    const providerKey = walletProviderKey.trim();
    const selectedCities = serviceCities.filter((city) => serviceCityIds.includes(city.id) && city.active);
    if (Array.from(name).length < 2 || Array.from(name).length > 120) {
      setError("أدخل الاسم الكامل بالعربية قبل حفظ الملف.");
      return;
    }
    if (!isFieldPhoneE164(contactPhoneE164)) {
      setError("اكتب الرقم اليمني مثل 777 765 432 أو بصيغته الدولية +967 777 765 432.");
      return;
    }
    if (!allServiceCities && selectedCities.length === 0) {
      setError("اختر مدينة نشطة واحدة على الأقل أو فعّل جميع المدن النشطة.");
      return;
    }
    if (!walletProviders.some((provider) => provider.key === providerKey)) {
      setError("اختر مزوّدًا نشطًا من قائمة المحافظ الرسمية.");
      return;
    }
    setFeedbackActorId(""); setBusy("create"); setError(""); setNotice("");
    try {
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admit", fullNameAr: name, contactPhoneE164, walletProviderKey: providerKey, allServiceCities, serviceCityIds: selectedCities.map((city) => city.id) }) });
      if (!response.ok) { const message = await fieldResponseMessage(response); await load(); setError(message); return; }
      const created = (await response.json() as AdmissionMutationResponse).admission;
      if (!created?.id || created.state !== "pending_review" || created.contactPhoneE164 !== contactPhoneE164 || created.fullNameAr !== name || created.allServiceCities !== allServiceCities || created.walletProviderKey !== providerKey || (!allServiceCities && selectedCities.some((city) => !created.serviceCityIds?.includes(city.id)))) {
        await load(); setError("استجاب النظام للحفظ لكن سجل العملية لا يطابق الملف المطلوب. أعد القراءة قبل أي إجراء آخر."); return;
      }
      const page = await readWorkbench(contactPhoneE164);
      if (!page.items.some((item) => item.kind === "candidate" && item.admission.id === created.id && item.admission.state === "pending_review" && item.admission.fullNameAr === name && item.admission.allServiceCities === allServiceCities && item.admission.walletProviderKey === providerKey)) {
        await load(); setError("حُفظ الملف لكن إعادة قراءة السجل الموحّد لا تطابق الملف المنشأ."); return;
      }
      setFullNameAr(""); setPhone(""); setServiceCityIds([]); setAllServiceCities(true); setWalletProviderKey(""); updateQuery(contactPhoneE164);
      setNotice("أُنشئ الملف وظهر في سجل الميدانيين بانتظار المراجعة.");
      await load();
    } catch (cause) {
      await load(); setError(fieldRequestError(cause, "تعذر حفظ ملف الميداني."));
    } finally { setBusy(""); }
  }

  async function mutateCandidate(admission: FieldAdmission, action: FieldCandidateAction) {
    setFeedbackActorId(admission.id);
    const draft = candidateEdits[admission.id] ?? fieldProfile(admission);
    const nextName = draft.fullNameAr.trim();
    if (action === "update-profile" && (Array.from(nextName).length < 2 || Array.from(nextName).length > 120)) { setError("أدخل الاسم الكامل قبل حفظ الملف."); return; }
    setBusy(admission.id); setError(""); setNotice("");
    try {
      const body: { action: typeof action; admissionId: string; fullNameAr?: string; walletProviderKey?: string; allServiceCities?: boolean; serviceCityIds?: ReadonlyArray<string>; expectedVersion?: number } = { action, admissionId: admission.id };
      if (action === "update-profile") { Object.assign(body, draft); body.expectedVersion = admission.version; }
      if (action === "approve") body.expectedVersion = admission.version;
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const message = await fieldResponseMessage(response); await load(); setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الملف بالتزامن. ${message}` : message); return; }
      const result = (await response.json() as AdmissionMutationResponse).admission;
      const expectedState = expectedCandidateState(action, admission.state);
      const profileReadbackMismatch = action === "update-profile" && (
        result?.fullNameAr !== nextName ||
        result.walletProviderKey !== draft.walletProviderKey.trim() ||
        result.allServiceCities !== draft.allServiceCities ||
        (!draft.allServiceCities && draft.serviceCityIds.some((id) => !result.serviceCityIds?.includes(id)))
      );
      if (!result?.id || result.id !== admission.id || result.state !== expectedState || profileReadbackMismatch) { setError("استجاب النظام لكن حالة الملف المرجعة لا تطابق الخطوة المطلوبة."); await load(); return; }
      const page = await readWorkbench(admission.contactPhoneE164 ?? "");
      if (action === "provision") {
        if (!result.actorId || !page.items.some((item) => item.kind === "account" && item.account.actorId === result.actorId && item.account.admission?.id === admission.id && item.account.admission.state === "eligible")) { setError("مُنح الدور لكن إعادة القراءة لا تثبت ربط حساب الحسابات بأهلية النظام."); await load(); return; }
        // Once provisioned, feedback belongs to the new account row rather than the removed candidate row.
        setFeedbackActorId(result.actorId);
      } else if (!page.items.some((item) => item.kind === "candidate" && item.admission.id === admission.id && item.admission.state === expectedState && (action !== "update-profile" || item.admission.fullNameAr === nextName))) {
        setError("نُفذ الإجراء لكن إعادة القراءة لا تثبت حالة الملف المطلوبة."); await load(); return;
      }
      setCandidateEdits((current) => { const next = { ...current }; delete next[admission.id]; return next; });
      await load();
      setNotice(candidateMutationNotice(action));
    } catch (cause) { setError(fieldRequestError(cause, "تعذر إكمال الإجراء.")); await load(); }
    finally { setBusy(""); }
  }

  async function mutateAccount(field: FieldAccount, action: FieldAccountAction, profileDraft?: FieldProfileDraft) {
    setFeedbackActorId(field.actorId);
    const reason = reasons[field.actorId]?.trim() ?? "";
    const admission = field.admission;
    const profile = profileDraft ?? (admission ? fieldProfile(admission) : { fullNameAr: "", walletProviderKey: "", allServiceCities: false, serviceCityIds: [] });
    const fullNameAr = profile.fullNameAr.trim();
    const validationError = accountMutationValidation(field, action, reason, fullNameAr);
    if (validationError) { setError(validationError); return; }
    const invalidProfileAssignment = profile.walletProviderKey.trim().length < 1 || profile.walletProviderKey.trim().length > 64 || (!profile.allServiceCities && !profile.serviceCityIds.length) || (!profile.allServiceCities && profile.serviceCityIds.some((id) => !serviceCities.some((city) => city.active && city.id === id)));
    if (action === "update-profile" && invalidProfileAssignment) { setError("أدخل مزوّد المحفظة واختر مدينة نشطة واحدة على الأقل أو جميع المدن."); return; }
    setBusy(field.actorId); setError(""); setNotice("");
    try {
      const body = accountMutationBody(field, action, reason, profile);
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const message = await fieldResponseMessage(response); await load(); setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الحساب بالتزامن. أُعيد تحميل الحالة الحالية؛ راجعها قبل المحاولة مجددًا. ${message}` : message); return; }
      const page = await readWorkbench(field.phoneE164);
      const canonical = page.items.find((item): item is Extract<FieldWorkbenchItem, { kind: "account" }> => item.kind === "account" && item.account.actorId === field.actorId)?.account;
      if (!canonical) { setError("نُفذ الإجراء لكن الحساب لم يظهر في إعادة القراءة الموحّدة."); await load(); return; }
      if (!accountReadbackMatches(action, profile, canonical)) {
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
  const candidateProviderValid = walletProviders.some((provider) => provider.key === walletProviderKey);
  const candidateCityValid = allServiceCities || serviceCityIds.length > 0 && serviceCityIds.every((id) => serviceCities.some((city) => city.id === id && city.active));

  return <section className={`access-card field-workbench ${styles.root}`} aria-label="إدارة الميدانيين">
    <header className="field-workbench-heading">
      <details className="field-create-disclosure"><summary className="button button-primary">إنشاء ملف ميداني</summary><div className="field-create-content"><div className="access-card-heading"><h3>ملف ميداني جديد</h3><p className="muted">إنشاء الملف يحفظ أهلية النظام للمراجعة فقط؛ لا ينشئ حساب الدخول ولا يرسل رمز التفعيل.</p></div><form className="access-form" onSubmit={(event) => { event.preventDefault(); void createProfile(); }}><label className="field-label" htmlFor="field-candidate-name">الاسم الكامل بالعربية<input id="field-candidate-name" autoComplete="name" maxLength={120} value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} disabled={Boolean(busy)} /></label><label className="field-label" htmlFor="field-candidate-phone">رقم الجوال<input id="field-candidate-phone" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} disabled={Boolean(busy)} placeholder="مثال: 777 765 432 أو +967 777 765 432" aria-invalid={Boolean(phone.trim()) && !candidatePhoneValid} aria-describedby="field-candidate-phone-help" /><span id="field-candidate-phone-help" className={phone.trim() && !candidatePhoneValid ? "identity-error" : "muted"}>{phone.trim() && !candidatePhoneValid ? "أدخل رقمًا يمنيًا صحيحًا، محليًا مثل 777 765 432 أو دوليًا مثل +967 777 765 432." : "يُستخدم هذا الرقم لإثبات الهاتف وتفعيل الدخول، ثم لتسجيل الدخول اليومي."}</span></label><label className="field-label" htmlFor="field-candidate-wallet-provider">مزوّد المحفظة الذي حدده الميداني<select id="field-candidate-wallet-provider" value={walletProviderKey} onChange={(event) => setWalletProviderKey(event.target.value)} disabled={Boolean(busy) || walletProvidersLoading || Boolean(walletProvidersError)}><option value="">اختر محفظة رسمية</option>{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select><small>المزوّد فقط؛ لا تدخل رقم محفظة أو اسمًا قانونيًا.</small></label>{walletProvidersError ? <p className="identity-error" role="alert">{walletProvidersError}</p> : null}<label className="field-label" htmlFor="field-candidate-all-cities"><input id="field-candidate-all-cities" type="checkbox" checked={allServiceCities} onChange={(event) => setAllServiceCities(event.target.checked)} disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError)} /> جميع المدن النشطة، بما فيها المدن التي ستضاف لاحقًا</label>{!allServiceCities ? <label className="field-label" htmlFor="field-candidate-cities">مدن الخدمة<select id="field-candidate-cities" multiple value={serviceCityIds} onChange={(event) => setServiceCityIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError)}>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label> : null}{serviceCitiesError ? <p className="identity-error" role="alert">{serviceCitiesError}</p> : null}<button type="submit" className="button button-primary" disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError) || walletProvidersLoading || Boolean(walletProvidersError) || !candidateNameValid || !candidatePhoneValid || !candidateProviderValid || !candidateCityValid}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ للمراجعة"}</button></form></div></details>
    </header>
    <FieldAdmissionRoster items={items} query={query} cityFilter={cityFilter} notice={notice} error={error} loading={loading} loadingMore={loadingMore} nextCursor={nextCursor} busy={busy} feedbackActorId={feedbackActorId} serviceCities={serviceCities} walletProviders={walletProviders} candidateEdits={candidateEdits} profileEdits={profileEdits} reasons={reasons} acquisitionCases={acquisitionCases} acquisitionCaseErrors={acquisitionCaseErrors} acquisitionCaseBusy={acquisitionCaseBusy} onQueryChange={updateQuery} onCityFilterChange={updateCityFilter} onRefresh={() => { setFeedbackActorId(""); void load(); }} onLoadMore={() => { void load(nextCursor, true); }} onCandidateNameChange={(id, value) => setCandidateEdits((current) => ({ ...current, [id]: value }))} onCandidateMutate={mutateCandidate} onProfileNameChange={(id, value) => setProfileEdits((current) => ({ ...current, [id]: value }))} onReasonChange={(id, value) => setReasons((current) => ({ ...current, [id]: value }))} onAccountMutate={mutateAccount} onLoadAcquisitionCases={loadAcquisitionCases} />
  </section>;
}
