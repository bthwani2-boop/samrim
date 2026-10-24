"use client";

import { normalizeYemenPhoneE164, toAsciiDigits } from "@bthwani/design-system";
import { type BeneficiaryPayoutState, type FieldAdmission, fieldAdmissionStateLabel, formatMoney, type JoiningCaseListResponse, joiningCaseStateLabel, type OperatorFieldLatestJoiningCase, officialWalletDestinationStatusLabel, payoutStatusLabel, type ServiceCity, type ServiceCityListResponse } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { responseMessage } from "../access/identity-error-message";
import { RecordTabs } from "../shared/record-tabs";
import { OfficialWalletDestinationManager } from "../finance/official-wallet-destination-manager";
import { ActorWalletStatement } from "../finance/actor-wallet-statement";
import { RecordIndicator } from "../shared/record-indicator";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { useWalletProviders, type WalletProviderOption } from "../wallet-provider/use-wallet-providers";

type LatestStore = Readonly<{ storeId: string; storeName: string; joiningCaseId: string; createdAt: string }>;
type FieldAccount = ActorRoleView & Readonly<{ admission: FieldAdmission | null; latestStore?: LatestStore | null; joiningCaseCount?: number; latestJoiningCase?: OperatorFieldLatestJoiningCase | null }>;
type FieldWorkbenchItem = Readonly<{ kind: "candidate"; admission: FieldAdmission }> | Readonly<{ kind: "account"; account: FieldAccount }>;
type FieldPage = Readonly<{ items: ReadonlyArray<FieldWorkbenchItem>; nextCursor?: string }>;

function parseFieldPage(payload: unknown): FieldPage {
  const page = payload as FieldPage | null;
  const validItems = Array.isArray(page?.items) && page.items.every((item) => {
    if (!item) return false;
    if (item.kind === "candidate") return typeof item.admission?.id === "string" && typeof item.admission?.fullNameAr === "string" && typeof item.admission?.state === "string";
    if (item.kind === "account") return typeof item.account?.actorId === "string" && typeof item.account?.phoneE164 === "string" && typeof item.account?.enabled === "boolean" && typeof item.account?.securityEnabled === "boolean" && (item.account.admission === null || typeof item.account.admission?.id === "string");
    return false;
  });
  if (!validItems || (page?.nextCursor !== undefined && (typeof page.nextCursor !== "string" || page.nextCursor.length > 2048))) {
    throw new Error("استجابة سجل الميدانيين غير مكتملة. أعد المحاولة.");
  }
  return page as FieldPage;
}

type FieldAcquisitionCase = JoiningCaseListResponse["cases"][number];
type FieldCandidateAction = "update-profile" | "approve" | "provision";
type FieldAccountAction = "update-profile" | "review-profile" | "activate" | "disable" | "reenroll";
type AdmissionMutationResponse = Readonly<{ admission?: FieldAdmission }>;
type FieldProfileDraft = Readonly<{ fullNameAr: string; walletProviderKey: string; allServiceCities: boolean; serviceCityIds: ReadonlyArray<string> }>;
type VersionedFieldProfileDraft = Readonly<{ version: number; draft: FieldProfileDraft }>;

function fieldProfile(admission: FieldAdmission): FieldProfileDraft {
  return { fullNameAr: admission.fullNameAr ?? "", walletProviderKey: admission.walletProviderKey ?? "", allServiceCities: admission.allServiceCities === true, serviceCityIds: admission.serviceCityIds ?? [] };
}

function currentAccountProfileDraft(field: FieldAccount, drafts: Readonly<Record<string, VersionedFieldProfileDraft>>): FieldProfileDraft {
  const admission = field.admission;
  const saved = admission ? drafts[field.actorId] : undefined;
  if (admission && saved?.version === admission.version) return saved.draft;
  return admission ? fieldProfile(admission) : { fullNameAr: "", walletProviderKey: "", allServiceCities: false, serviceCityIds: [] };
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

function admissionIndicator(admission: FieldAdmission | null) {
  const state = !admission ? "unknown" : admission.requiresProfileReview || admission.state === "pending_review" || admission.state === "pending_identity" ? "pending" : admission.state === "eligible" ? "active" : admission.state === "suspended" ? "paused" : "unknown";
  return <RecordIndicator icon={state} label={admissionStatusLabel(admission)} tone={state === "active" ? "success" : state === "pending" || state === "paused" ? "warning" : "neutral"} />;
}

function readbackQuery(query: string, limit = 25): string {
  const params = new URLSearchParams({ scope: "workbench", limit: String(limit), q: query });
  return `/api/fields?${params.toString()}`;
}

async function readWorkbench(currentQuery: string): Promise<FieldPage> {
  const response = await identityFetch(readbackQuery(currentQuery, 50), { cache: "no-store" });
  if (!response.ok) throw new Error(await fieldResponseMessage(response));
  return parseFieldPage(await response.json());
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

type FieldAccountMutationActionsProps = Readonly<{
  field: FieldAccount;
  profileDraft: FieldProfileDraft;
  idPrefix: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  walletProviders: ReadonlyArray<WalletProviderOption>;
  reason: string;
  busy: string;
  onProfileDraftChange: (value: FieldProfileDraft) => void;
  onReasonChange: (value: string) => void;
  onMutate: (field: FieldAccount, action: FieldAccountAction, profile?: FieldProfileDraft) => void;
}>;

type FieldAccountProfileActionsProps = Readonly<Pick<FieldAccountMutationActionsProps, "field" | "serviceCities" | "walletProviders" | "busy" | "onMutate"> & { draft: FieldProfileDraft; idPrefix: string; onDraftChange: (value: FieldProfileDraft) => void }>;

function FieldAccountProfileActions({ field, serviceCities, walletProviders, busy, draft, idPrefix, onDraftChange, onMutate }: FieldAccountProfileActionsProps) {
  const admission = field.admission;
  const saved = admission ? fieldProfile(admission) : { fullNameAr: "", walletProviderKey: "", allServiceCities: false, serviceCityIds: [] };
  if (!admission) return null;
  const unchanged = sameFieldProfile(draft, saved);
  const valid = Array.from(draft.fullNameAr.trim()).length >= 2 && Array.from(draft.fullNameAr.trim()).length <= 120 && Array.from(draft.walletProviderKey.trim()).length >= 1 && Array.from(draft.walletProviderKey.trim()).length <= 64 && (draft.allServiceCities || draft.serviceCityIds.length > 0 && draft.serviceCityIds.every((id) => serviceCities.some((city) => city.id === id)));
  return <>
    <label className="field-label" htmlFor={`${idPrefix}-field-profile-name-${field.actorId}`}>اسم العرض<input id={`${idPrefix}-field-profile-name-${field.actorId}`} value={draft.fullNameAr} maxLength={120} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, fullNameAr: event.target.value })} /></label>
    <label className="field-label" htmlFor={`${idPrefix}-field-profile-wallet-${field.actorId}`}>مزوّد المحفظة<select id={`${idPrefix}-field-profile-wallet-${field.actorId}`} value={draft.walletProviderKey} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, walletProviderKey: event.target.value })}><option value="">اختر محفظة رسمية</option>{draft.walletProviderKey && !walletProviders.some((provider) => provider.key === draft.walletProviderKey) ? <option value={draft.walletProviderKey}>{draft.walletProviderKey} · قيمة سابقة</option> : null}{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select></label>
    <label className="field-label" htmlFor={`${idPrefix}-field-profile-all-cities-${field.actorId}`}><input id={`${idPrefix}-field-profile-all-cities-${field.actorId}`} type="checkbox" checked={draft.allServiceCities} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, allServiceCities: event.target.checked, serviceCityIds: event.target.checked ? [] : draft.serviceCityIds })} /> جميع المدن النشطة</label>
    {!draft.allServiceCities ? <label className="field-label" htmlFor={`${idPrefix}-field-profile-cities-${field.actorId}`}>مدن الخدمة<select id={`${idPrefix}-field-profile-cities-${field.actorId}`} multiple value={[...draft.serviceCityIds]} disabled={Boolean(busy)} onChange={(event) => onDraftChange({ ...draft, serviceCityIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label> : null}
    <button type="button" className="button button-secondary" disabled={Boolean(busy) || !valid || unchanged} onClick={() => onMutate(field, "update-profile", draft)}>حفظ الملف والمدن</button>
    {admission.requiresProfileReview && admission.state === "suspended" ? <button type="button" className="button button-primary" disabled={Boolean(busy) || !unchanged || !valid} onClick={() => onMutate(field, "review-profile", draft)}>اعتماد مراجعة الملف</button> : null}
  </>;
}

type FieldAccountAccessActionsProps = Readonly<Pick<FieldAccountMutationActionsProps, "field" | "busy" | "reason" | "onMutate"> & Readonly<{
  waitingForReenrollment: boolean;
  shouldDisable: boolean;
  requiresProfileReview: boolean;
  mustDisable: boolean;
  reasonIsValid: boolean;
}>>;

function FieldAccountAccessActions({ field, busy, onMutate, waitingForReenrollment, shouldDisable, requiresProfileReview, mustDisable, reasonIsValid }: FieldAccountAccessActionsProps) {
  const accessAction: FieldAccountAction = shouldDisable ? "disable" : "activate";
  const canDisable = shouldDisable;
  const canReactivate = !field.enabled && !requiresProfileReview && field.securityEnabled && (field.admission?.state === "eligible" || field.admission?.state === "suspended");
  return <>

    {waitingForReenrollment ? <button type="button" className="button button-primary" disabled={Boolean(busy) || !reasonIsValid} onClick={() => onMutate(field, "reenroll")}>{busy === field.actorId ? "جارٍ الإجازة…" : "إجازة إعادة التسجيل"}</button> : null}
    {canDisable || canReactivate ? <button type="button" className={shouldDisable ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || !reasonIsValid} onClick={() => onMutate(field, accessAction)}>{accessActionButtonLabel(busy === field.actorId, shouldDisable)}</button> : null}
    {requiresProfileReview && !mustDisable && !field.enabled ? <span className="muted">أكمل مراجعة الملف قبل إعادة التفعيل.</span> : null}
  </>;
}

function FieldAccountMutationActions({ field, reason, busy, serviceCities, walletProviders, profileDraft, idPrefix, onProfileDraftChange, onReasonChange, onMutate }: FieldAccountMutationActionsProps) {
  const admission = field.admission;
  const requiresProfileReview = admission?.requiresProfileReview === true;
  const mustDisable = requiresProfileReview && admission?.state === "eligible";
  const shouldDisable = field.enabled || mustDisable;
  const waitingForFirstActivation = !requiresProfileReview && field.securityEnabled && field.enabled && !field.activatedAt && admission?.state === "eligible";
  const waitingForReenrollment = !requiresProfileReview && field.securityEnabled && field.enabled && Boolean(field.activatedAt) && admission?.state === "eligible";
  const reasonIsValid = Array.from(reason.trim()).length >= 5;

  return admission ? <div className="field-agent-controls">
    {waitingForFirstActivation ? <p className="muted" role="status">بانتظار تفعيل الجهاز من تطبيق الميدان برقم الهاتف المسجّل.</p> : null}
    <details className="field-agent-edit" open={admission.requiresProfileReview}><summary className="button button-secondary">تعديل الملف والتغطية</summary><div className="field-row-actions"><FieldAccountProfileActions key={`${idPrefix}-${admission.version}`} field={field} draft={profileDraft} idPrefix={idPrefix} onDraftChange={onProfileDraftChange} serviceCities={serviceCities} walletProviders={walletProviders} busy={busy} onMutate={onMutate} /></div></details>
    <details className="field-agent-edit" open={mustDisable}><summary className="button button-secondary">إدارة الوصول</summary><div className="field-row-actions">
    <label className="field-label field-agent-reason" htmlFor={`${idPrefix}-field-reason-${field.actorId}`}>سبب الإجراء<input id={`${idPrefix}-field-reason-${field.actorId}`} maxLength={500} value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={Boolean(busy)} placeholder="مطلوب لتغيير الوصول" /></label>
    <FieldAccountAccessActions field={field} busy={busy} reason={reason} onMutate={onMutate} waitingForReenrollment={waitingForReenrollment} shouldDisable={shouldDisable} requiresProfileReview={requiresProfileReview} mustDisable={mustDisable} reasonIsValid={reasonIsValid} />
    </div></details>
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

type FieldAdmissionRosterProps = Readonly<{
  items: ReadonlyArray<FieldWorkbenchItem>;
  query: string;
  cityFilter: string;
  accessFilter: string;
  notice: string;
  error: string;
  loading: boolean;
  cursor: string;
  previousPageKnown: boolean;
  nextCursor: string;
  busy: string;
  feedbackActorId: string;
  serviceCities: ReadonlyArray<ServiceCity>;
  walletProviders: ReadonlyArray<WalletProviderOption>;
  candidateEdits: Record<string, FieldProfileDraft>;
  accountProfileDrafts: Record<string, VersionedFieldProfileDraft>;
  reasons: Record<string, string>;
  acquisitionCases: Record<string, JoiningCaseListResponse>;
  acquisitionCaseErrors: Record<string, string>;
  acquisitionCaseBusy: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onCityFilterChange: (value: string) => void;
  onAccessFilterChange: (value: string) => void;
  onResetServerFilters: () => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onCandidateNameChange: (admissionId: string, value: FieldProfileDraft) => void;
  onCandidateMutate: (admission: FieldAdmission, action: FieldCandidateAction) => void;
  onAccountProfileDraftChange: (actorId: string, version: number, value: FieldProfileDraft) => void;
  onReasonChange: (actorId: string, value: string) => void;
  onAccountMutate: (field: FieldAccount, action: FieldAccountAction, profile?: FieldProfileDraft) => void;
  onLoadAcquisitionCases: (fieldActorId: string, cursor?: string, append?: boolean) => void;
}>;

function FieldEmptyRoster({ query, pageScoped }: Readonly<{ query: string; pageScoped: boolean }>) {
  const title = pageScoped ? "لا توجد نتائج في هذه الصفحة" : query ? "لا توجد نتائج مطابقة" : "لا توجد ملفات أو حسابات ميدانية";
  const description = query ? "امسح البحث لعرض السجل كاملًا." : "أنشئ ملفًا جديدًا لبدء مسار الأهلية.";
  return <div className="collection-state"><strong>{title}</strong>{pageScoped ? null : <p>{description}</p>}</div>;
}

function FieldAdmissionRoster(props: FieldAdmissionRosterProps) {
  const { items, query, cityFilter, accessFilter, notice, error, loading, cursor, previousPageKnown, nextCursor, busy, feedbackActorId, serviceCities, walletProviders, candidateEdits, accountProfileDrafts, reasons, acquisitionCases, acquisitionCaseErrors, acquisitionCaseBusy, onQueryChange, onCityFilterChange, onAccessFilterChange, onResetServerFilters, onNextPage, onPreviousPage, onCandidateNameChange, onCandidateMutate, onAccountProfileDraftChange, onReasonChange, onAccountMutate, onLoadAcquisitionCases } = props;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [admissionFilter, setAdmissionFilter] = useState("");
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
        if (activityFilter || storeFilter || storeQuery.trim()) return false;
        if (admissionFilter && (admissionFilter === "none" || item.admission.state !== admissionFilter)) return false;
        if (journeyFilter === "has" || journeyFilter === "needs_correction" || journeyQuery.trim()) return false;
        return !providerFilter || item.admission.walletProviderKey === providerFilter;
      }
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
  }, [items, admissionFilter, activityFilter, storeFilter, storeQuery, journeyFilter, journeyQuery, providerFilter, sortBy, sortDirection, serviceCities, walletProviders]);
  const selectedIndex = visibleItems.findIndex((item) => fieldRecordKey(item) === selectedKey);
  const selectedItem = selectedIndex >= 0 ? visibleItems[selectedIndex] : undefined;
  useEffect(() => {
    // Continue on the same record after a reviewed candidate becomes an account.
    if (selectedKey?.startsWith("candidate:") && !selectedItem && feedbackActorId && visibleItems.some((item) => item.kind === "account" && item.account.actorId === feedbackActorId)) {
      setSelectedKey("account:" + feedbackActorId);
    }
  }, [selectedKey, selectedItem, feedbackActorId, visibleItems]);
  function toggleSort(column: "name" | "city" | "provider" | "admission" | "access" | "activity" | "store" | "journey") {
    if (sortBy === column) setSortDirection((value) => value === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortDirection("asc"); }
  }
  const sortButton = (column: "name" | "city" | "provider" | "admission" | "access" | "activity" | "store" | "journey", label: string) => <button type="button" className="field-column-sort" onClick={() => toggleSort(column)} aria-label={`ترتيب الصفحة حسب ${label}`} aria-pressed={sortBy === column}>{label}{sortBy === column ? <span aria-hidden="true"> {sortDirection === "asc" ? "↑" : "↓"}</span> : null}</button>;
  const hasFilters = Boolean(query || cityFilter || admissionFilter || accessFilter || activityFilter || storeFilter || storeQuery || journeyFilter || journeyQuery || providerFilter);
  const activeFilterCount = [cityFilter, admissionFilter, accessFilter, activityFilter, storeFilter, storeQuery, journeyFilter, journeyQuery, providerFilter].filter(Boolean).length;
  const previousLabel = cursor && !previousPageKnown ? "الأولى" : "السابقة";
  return <AdaptiveRecordWorkspace open={Boolean(selectedItem)} preferenceKey="field" onClose={() => setSelectedKey(null)} detail={selectedItem ? <FieldRecordProfile item={selectedItem} data={props} onClose={() => setSelectedKey(null)} onPrevious={selectedIndex > 0 ? () => setSelectedKey(fieldRecordKey(visibleItems[selectedIndex - 1]!)) : undefined} onNext={selectedIndex >= 0 && selectedIndex < visibleItems.length - 1 ? () => setSelectedKey(fieldRecordKey(visibleItems[selectedIndex + 1]!)) : undefined} /> : null}><div className="field-workbench-pane">
    <div className="field-roster-tools registry-toolbar">
      <label className="field-roster-search" htmlFor="field-search">
        <span>بحث بالهاتف</span>
        <input id="field-search" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="رقم الهاتف" />
      </label>
      <details className="field-roster-filter-disclosure">
        <summary aria-label={activeFilterCount ? `المرشحات، ${activeFilterCount} مرشح نشط` : "المرشحات"}>المرشحات{activeFilterCount ? <span className="field-filter-active-count" aria-hidden="true">{activeFilterCount}</span> : null}</summary>
        <fieldset className="field-roster-filter-panel form-grid">
          <legend className="visually-hidden">مرشحات سجل الميدانيين</legend>
          <p className="field-roster-filter-note">تُطبَّق المدينة ودخول التطبيق على السجل الكامل؛ بقية المرشحات والترتيب للصفحة الحالية.</p>
          <label htmlFor="field-city-filter">مدينة الخدمة<select id="field-city-filter" value={cityFilter} onChange={(event) => onCityFilterChange(event.target.value)}><option value="">كل المدن</option>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <label htmlFor="field-provider-filter">مزوّد المحفظة<select id="field-provider-filter" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="">كل المزوّدين</option>{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select></label>
          <label htmlFor="field-admission-filter">أهلية النظام<select id="field-admission-filter" value={admissionFilter} onChange={(event) => setAdmissionFilter(event.target.value)}><option value="">كل الحالات</option><option value="none">لا توجد أهلية مرتبطة</option><option value="pending_review">بانتظار المراجعة</option><option value="pending_identity">بانتظار إنشاء الحساب</option><option value="eligible">مؤهل</option><option value="suspended">موقوفة</option></select></label>
          <label htmlFor="field-access-filter">دخول التطبيق<select id="field-access-filter" value={accessFilter} onChange={(event) => onAccessFilterChange(event.target.value)}><option value="">كل الحسابات</option><option value="enabled">الدخول مفعّل</option><option value="disabled">الدخول موقوف</option></select></label>
          <label htmlFor="field-activity-filter">فتح التطبيق<select id="field-activity-filter" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="">كل الأنشطة</option><option value="opened">سبق فتح التطبيق</option><option value="recent">خلال 30 يومًا</option><option value="never">لم يفتح التطبيق</option></select></label>
          <label htmlFor="field-store-filter">أحدث متجر<select id="field-store-filter" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="">كل المتاجر</option><option value="has">أضاف متجرًا</option><option value="recent">خلال 30 يومًا</option><option value="none">لم يضف متجرًا</option></select></label>
          <label htmlFor="field-store-search">بحث باسم أحدث متجر<input id="field-store-search" type="search" placeholder="اسم المتجر" value={storeQuery} onChange={(event) => setStoreQuery(event.target.value)} /></label>
          <label htmlFor="field-journey-filter">ملفات ضم الشركاء<select id="field-journey-filter" value={journeyFilter} onChange={(event) => setJourneyFilter(event.target.value)}><option value="">كل الملفات</option><option value="has">لديه ملفات ضم</option><option value="none">بلا ملفات ضم</option><option value="needs_correction">أحدث ملف يحتاج تصحيحًا</option></select></label>
          <label htmlFor="field-journey-search">بحث باسم آخر شريك<input id="field-journey-search" type="search" placeholder="اسم الشريك" value={journeyQuery} onChange={(event) => setJourneyQuery(event.target.value)} /></label>
        </fieldset>
      </details>
      {hasFilters ? <button type="button" className="button button-secondary" onClick={() => { onResetServerFilters(); setAdmissionFilter(""); setActivityFilter(""); setStoreFilter(""); setStoreQuery(""); setJourneyFilter(""); setJourneyQuery(""); setProviderFilter(""); }}>مسح البحث والمرشحات</button> : null}

    </div>
    {notice && !feedbackActorId ? <output className="success-inline">{notice}</output> : null}{error && !feedbackActorId ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading && items.length === 0 ? <output>جارٍ قراءة سجل الميدانيين…</output> : null}
    {!loading && !error && items.length === 0 ? <FieldEmptyRoster query={query} pageScoped={Boolean(nextCursor || cursor || cityFilter)} /> : null}
    {items.length > 0 ? <>
      <section className="operations-table-wrap table-wrap field-record-compact-table-wrap" aria-label="سجل الميدانيين">
        <p className="field-filter-count" aria-live="polite">{visibleItems.length} من {items.length} في هذه الصفحة</p>
        <table className="data-table field-record-compact-table">
          <caption className="visually-hidden">سجل الميدانيين، افتح الملف لمراجعة بيانات الميداني وإدارتها</caption>
          <thead><tr>
            <RegistryColumnHeader label="الميداني" active={Boolean(query || sortBy === "name" && sortDirection === "desc")} scope="page">
              {sortButton("name", "الميداني")}
            </RegistryColumnHeader>
            <RegistryColumnHeader label="الأهلية" active={Boolean(admissionFilter)} scope="page">
              <label>حالة الأهلية<select value={admissionFilter} onChange={(event) => setAdmissionFilter(event.target.value)}>
                <option value="">الكل</option><option value="none">بلا أهلية</option><option value="pending_review">بانتظار المراجعة</option><option value="pending_identity">بانتظار الهوية</option><option value="eligible">مؤهل</option><option value="suspended">موقوف</option>
              </select></label>
              {sortButton("admission", "الأهلية")}
            </RegistryColumnHeader>
            <RegistryColumnHeader label="الوصول" active={Boolean(accessFilter)}>
              <label>دخول التطبيق<select value={accessFilter} onChange={(event) => onAccessFilterChange(event.target.value)}>
                <option value="">كل الحسابات</option><option value="enabled">الدخول مفعّل</option><option value="disabled">الدخول موقوف</option>
              </select></label>
              {sortButton("access", "الوصول")}
            </RegistryColumnHeader>
            <RegistryColumnHeader label="آخر فتح للتطبيق" active={Boolean(activityFilter)} scope="page">
              <label>نشاط الصفحة<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
                <option value="">كل الأنشطة</option><option value="opened">سبق فتح التطبيق</option><option value="recent">خلال 30 يومًا</option><option value="never">لم يفتح التطبيق</option>
              </select></label>
              {sortButton("activity", "آخر فتح للتطبيق")}
            </RegistryColumnHeader>
            <RegistryColumnHeader label="ملفات الضم" active={Boolean(journeyFilter || journeyQuery)} scope="page">
              <label>ملفات الشركاء<select value={journeyFilter} onChange={(event) => setJourneyFilter(event.target.value)}>
                <option value="">جميع الملفات</option><option value="has">لديه ملفات ضم</option><option value="none">بلا ملفات</option><option value="needs_correction">آخر ملف يحتاج تصحيحًا</option>
              </select></label>
              <label>اسم آخر شريك<input type="search" value={journeyQuery} onChange={(event) => setJourneyQuery(event.target.value)} /></label>
              {sortButton("journey", "ملفات الضم")}
            </RegistryColumnHeader>
            <th scope="col">الملف</th>
          </tr></thead>
          <tbody>{visibleItems.map((item) => {
            const key = fieldRecordKey(item);
            const account = item.kind === "account" ? item.account : null;
            const admission = item.kind === "candidate" ? item.admission : item.account.admission;
            return <tr key={key} data-selected={selectedKey === key}>
              <th scope="row"><strong>{admission?.fullNameAr || "ملف غير مكتمل"}</strong><br /><bdi dir="ltr">{account?.phoneE164 ?? admission?.contactPhoneE164 ?? "—"}</bdi></th>
              <td>{admissionIndicator(admission)}</td>
              <td>{account ? <RecordIndicator icon={!account.securityEnabled || !account.enabled ? "paused" : account.activatedAt ? "active" : "pending"} label={identityStatusLabel(account)} tone={account.enabled && account.securityEnabled && account.activatedAt ? "success" : "warning"} /> : <span className="muted">بانتظار الحساب</span>}</td>
              <td>{account?.lastAppOpenedAt ? fieldTimestamp(account.lastAppOpenedAt) : "—"}</td>
              <td>{account ? (account.joiningCaseCount ?? 0).toLocaleString("ar-YE") : "—"}</td>
              <td className="field-record-select"><button type="button" className="button button-secondary" aria-pressed={selectedKey === key} onClick={() => setSelectedKey(key)}>{selectedKey === key ? "الملف مفتوح" : "فتح الملف"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </section>
      <ul className="field-record-mobile-list" aria-label="ملفات الميدانيين">
        {visibleItems.map((item) => {
          const key = fieldRecordKey(item);
          const admission = item.kind === "candidate" ? item.admission : item.account.admission;
          const account = item.kind === "account" ? item.account : null;
          return <li key={key}><div className="field-record-mobile-head">
            <div><strong>{admission?.fullNameAr || "ملف غير مكتمل"}</strong><bdi dir="ltr">{account?.phoneE164 ?? admission?.contactPhoneE164 ?? "—"}</bdi></div>
            {admissionIndicator(admission)}
          </div><div className="field-record-mobile-head"><span>{account ? identityStatusLabel(account) : "بانتظار الحساب"}</span><span>{account ? (account.joiningCaseCount ?? 0).toLocaleString("ar-YE") + " ملفات ضم" : "—"}</span></div>
          <button type="button" className="button button-secondary" aria-pressed={selectedKey === key} onClick={() => setSelectedKey(key)}>فتح الملف وإدارته</button>
          </li>;
        })}
      </ul>
      {visibleItems.length === 0 && !loading ? <output className="field-filter-empty">لا تطابق سجلات هذه الصفحة المرشحات.</output> : null}
    </> : null}
    <nav className="field-roster-footer" aria-label="صفحات الميدانيين"><aside className="record-legend" aria-label="دليل رموز الأهلية ودخول التطبيق"><div><strong>الأهلية</strong><RecordIndicator legend icon="active" label="مؤهل" tone="success" /><RecordIndicator legend icon="pending" label="بانتظار إجراء" tone="warning" /><RecordIndicator legend icon="paused" label="موقوف" tone="warning" /><RecordIndicator legend icon="unknown" label="غير متاح" /></div><div><strong>دخول التطبيق</strong><RecordIndicator legend icon="active" label="مفعّل" tone="success" /><RecordIndicator legend icon="pending" label="بانتظار تفعيل الجهاز" tone="warning" /><RecordIndicator legend icon="paused" label="موقوف أو غير متاح أمنيًا" tone="warning" /></div></aside><div className="action-row"><button type="button" className="button button-secondary" disabled={!cursor || loading || Boolean(busy)} onClick={onPreviousPage}>{previousLabel}</button><button type="button" className="button button-secondary" disabled={!nextCursor || loading || Boolean(busy)} onClick={onNextPage}>التالية</button></div></nav>
  </div></AdaptiveRecordWorkspace>;
}

export function FieldAdmissionPanel() {
  const { walletProviders, walletProvidersLoading, walletProvidersError } = useWalletProviders();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState("");
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [previousPageKnown, setPreviousPageKnown] = useState(false);
  const [items, setItems] = useState<ReadonlyArray<FieldWorkbenchItem>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [phone, setPhone] = useState("");
  const [walletProviderKey, setWalletProviderKey] = useState("");
  const [allServiceCities, setAllServiceCities] = useState(true);
  const [serviceCityIds, setServiceCityIds] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("serviceCityId") ?? "");
  const [accessFilter, setAccessFilter] = useState("");
  const [serviceCities, setServiceCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [serviceCitiesLoading, setServiceCitiesLoading] = useState(true);
  const [serviceCitiesError, setServiceCitiesError] = useState("");
  const [candidateEdits, setCandidateEdits] = useState<Record<string, FieldProfileDraft>>({});
  const [accountProfileDrafts, setAccountProfileDrafts] = useState<Record<string, VersionedFieldProfileDraft>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    const requestID = ++loadRequestID.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope: "workbench", limit: "25", q: query.trim() });
      if (cityFilter) params.set("serviceCityId", cityFilter);
      if (accessFilter) params.set("enabled", accessFilter === "enabled" ? "true" : "false");
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/fields?${params}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await fieldResponseMessage(response));
      }
      const page = parseFieldPage(await response.json());
      if (loadRequestID.current !== requestID) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestID.current === requestID) {
        setItems([]);
        setNextCursor("");
        setError(fieldRequestError(cause, "تعذرت قراءة سجل الميدانيين."));
      }
    } finally {
      if (loadRequestID.current === requestID) setLoading(false);
    }
  }, [query, cityFilter, accessFilter, cursor]);

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

  useEffect(() => {
    if (navigationVersion === 0) return;
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [load, navigationVersion]);
  useReadOnReturn(() => load(), navigationVersion > 0 && !loading && !busy && !feedbackActorId);
  useEffect(() => {
    const syncQuery = (event?: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const state = event?.state ?? window.history.state;
      const saved = state?.fieldRegistry;
      const url = `${window.location.pathname}${window.location.search}`;
      const restored = !params.has("q") && !params.has("cursor") && saved?.url === url && typeof saved.query === "string" && typeof saved.cursor === "string" && [undefined, "", "enabled", "disabled"].includes(saved.accessFilter) && Number.isSafeInteger(saved.page) && saved.page >= 1 && (saved.page === 1 ? saved.cursor === "" && !params.has("fieldPage") : Boolean(saved.cursor) && params.get("fieldPage") === String(saved.page));
      ++loadRequestID.current;
      setNavigationVersion((current) => current + 1);
      setLoading(true);
      setItems([]);
      setNextCursor("");
      setError("");
      setFeedbackActorId("");
      setQuery(restored ? saved.query : "");
      setCityFilter(params.get("serviceCityId") ?? "");
      setAccessFilter(restored ? saved.accessFilter ?? "" : "");
      setCursor(restored ? saved.cursor : "");
      setPageNumber(restored ? saved.page : 1);
      setPreviousPageKnown(restored && saved.previous === true);
      // Bookmarks cannot restore private search or server cursors without this tab's history state.
      if (!restored) {
        params.delete("q"); params.delete("cursor"); params.delete("fieldPage");
        const firstURL = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
        window.history.replaceState({ ...state, fieldPageURL: undefined, fieldRegistry: { url: firstURL, query: "", accessFilter: "", cursor: "", page: 1, previous: false } }, "", firstURL);
      }
    };
    syncQuery();
    window.addEventListener("popstate", syncQuery);
    return () => window.removeEventListener("popstate", syncQuery);
  }, []);

  function writePage(nextQuery: string, nextCity: string, nextAccess: string, nextCursor: string, page: number, previous: boolean, replace: boolean) {
    const params = new URLSearchParams(window.location.search);
    params.delete("q"); params.delete("cursor"); params.delete("fieldPage");
    if (nextCity) params.set("serviceCityId", nextCity); else params.delete("serviceCityId");
    if (page > 1) params.set("fieldPage", String(page));
    const url = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    const state = { ...window.history.state, fieldPageURL: undefined, fieldRegistry: { url, query: nextQuery, accessFilter: nextAccess, cursor: nextCursor, page, previous } };
    if (replace) window.history.replaceState(state, "", url); else window.history.pushState(state, "", url);
    ++loadRequestID.current;
    setNavigationVersion((current) => current + 1);
    setLoading(true); setItems([]); setNextCursor(""); setError(""); setFeedbackActorId("");
    setQuery(nextQuery); setCityFilter(nextCity); setAccessFilter(nextAccess); setCursor(nextCursor); setPageNumber(page); setPreviousPageKnown(previous);
  }

  function updateQuery(value: string) {
    if (value === query && !cursor) return;
    writePage(value, cityFilter, accessFilter, "", 1, false, true);
  }

  function updateCityFilter(value: string) {
    if (value === cityFilter && !cursor) return;
    writePage(window.history.state?.fieldRegistry?.query ?? query, value, accessFilter, "", 1, false, false);
  }

  function updateAccessFilter(value: string) {
    if (value === accessFilter && !cursor) return;
    writePage(query, cityFilter, value, "", 1, false, false);
  }

  function resetServerFilters() {
    writePage("", "", "", "", 1, false, true);
  }

  function nextPage() {
    if (!nextCursor || loading || busy) return;
    writePage(query, cityFilter, accessFilter, nextCursor, pageNumber + 1, true, false);
  }

  function previousPage() {
    if (previousPageKnown) {
      window.history.back();
      return;
    }
    writePage(query, cityFilter, accessFilter, "", 1, false, true);
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
      setAccountProfileDrafts((current) => { const next = { ...current }; delete next[field.actorId]; return next; });
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

  return <section className="access-card field-workbench work-stack" aria-label="إدارة الميدانيين">
    <header className="field-workbench-heading">
      <details className="field-create-disclosure"><summary className="button button-primary">إنشاء ملف ميداني</summary><div className="field-create-content"><div className="access-card-heading"><h3>ملف ميداني جديد</h3><p className="muted">ملف للمراجعة؛ إنشاء حساب الدخول بعد الاعتماد.</p></div><form className="access-form" noValidate onSubmit={(event) => { event.preventDefault(); void createProfile(); }}><label className="field-label" htmlFor="field-candidate-name">الاسم الكامل بالعربية<input id="field-candidate-name" autoComplete="name" maxLength={120} value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} disabled={Boolean(busy)} /></label><label className="field-label" htmlFor="field-candidate-phone">رقم الجوال<input id="field-candidate-phone" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} disabled={Boolean(busy)} placeholder="مثال: 777 765 432 أو +967 777 765 432" aria-invalid={Boolean(phone.trim()) && !candidatePhoneValid} aria-describedby="field-candidate-phone-help" /><span id="field-candidate-phone-help" className={phone.trim() && !candidatePhoneValid ? "identity-error" : "muted"}>{phone.trim() && !candidatePhoneValid ? "أدخل رقمًا يمنيًا صحيحًا، محليًا مثل 777 765 432 أو دوليًا مثل +967 777 765 432." : "يُستخدم هذا الرقم لإثبات الهاتف وتفعيل الدخول، ثم لتسجيل الدخول اليومي."}</span></label><label className="field-label" htmlFor="field-candidate-wallet-provider">مزوّد المحفظة الذي حدده الميداني<select id="field-candidate-wallet-provider" value={walletProviderKey} onChange={(event) => setWalletProviderKey(event.target.value)} disabled={Boolean(busy) || walletProvidersLoading || Boolean(walletProvidersError)}><option value="">اختر محفظة رسمية</option>{walletProviders.map((provider) => <option key={provider.key} value={provider.key}>{provider.displayNameAr}</option>)}</select><small>المزوّد فقط؛ لا تدخل رقم محفظة أو اسمًا قانونيًا.</small></label>{walletProvidersError ? <p className="identity-error" role="alert">{walletProvidersError}</p> : null}<label className="field-label" htmlFor="field-candidate-all-cities"><input id="field-candidate-all-cities" type="checkbox" checked={allServiceCities} onChange={(event) => setAllServiceCities(event.target.checked)} disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError)} /> جميع المدن النشطة، بما فيها المدن التي ستضاف لاحقًا</label>{!allServiceCities ? <label className="field-label" htmlFor="field-candidate-cities">مدن الخدمة<select id="field-candidate-cities" multiple value={serviceCityIds} onChange={(event) => setServiceCityIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError)}>{serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label> : null}{serviceCitiesError ? <p className="identity-error" role="alert">{serviceCitiesError}</p> : null}<button type="submit" className="button button-primary" disabled={Boolean(busy) || serviceCitiesLoading || Boolean(serviceCitiesError) || walletProvidersLoading || Boolean(walletProvidersError) || !candidateNameValid || !candidatePhoneValid || !candidateProviderValid || !candidateCityValid}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ للمراجعة"}</button></form></div></details>
    </header>
    <FieldAdmissionRoster items={items} query={query} cityFilter={cityFilter} accessFilter={accessFilter} notice={notice} error={error} loading={loading} cursor={cursor} previousPageKnown={previousPageKnown} nextCursor={nextCursor} busy={busy} feedbackActorId={feedbackActorId} serviceCities={serviceCities} walletProviders={walletProviders} candidateEdits={candidateEdits} accountProfileDrafts={accountProfileDrafts} reasons={reasons} acquisitionCases={acquisitionCases} acquisitionCaseErrors={acquisitionCaseErrors} acquisitionCaseBusy={acquisitionCaseBusy} onQueryChange={updateQuery} onCityFilterChange={updateCityFilter} onAccessFilterChange={updateAccessFilter} onResetServerFilters={resetServerFilters} onNextPage={nextPage} onPreviousPage={previousPage} onCandidateNameChange={(id, value) => setCandidateEdits((current) => ({ ...current, [id]: value }))} onCandidateMutate={mutateCandidate} onAccountProfileDraftChange={(id, version, draft) => setAccountProfileDrafts((current) => ({ ...current, [id]: { version, draft } }))} onReasonChange={(id, value) => setReasons((current) => ({ ...current, [id]: value }))} onAccountMutate={mutateAccount} onLoadAcquisitionCases={loadAcquisitionCases} />
  </section>;
}


function fieldRecordKey(item: FieldWorkbenchItem): string {
  return item.kind === "candidate" ? "candidate:" + item.admission.id : "account:" + item.account.actorId;
}

type FieldLedger = Readonly<{
  currency: "YER"; periodStart: string; periodEnd: string; currentBalanceMinor: number;
  openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number;
  nextCursor?: string;
  entries: ReadonlyArray<Readonly<{
    transactionId: string; transactionType: string; amountMinor: number;
    direction: "CREDIT" | "DEBIT"; createdAt: string; balanceAfterMinor: number;
  }>>;
}>;

const fieldRecordTabs = [
  { id: "overview", label: "نظرة عامة" },
  { id: "stores", label: "المتاجر والضم" },
  { id: "performance", label: "الأداء" },
  { id: "finance", label: "المالية" },
  { id: "account", label: "الحساب والتحكم" },
  { id: "history", label: "السجل" },
] as const;
type FieldRecordTab = (typeof fieldRecordTabs)[number]["id"];

function FieldFinancialRecord({ actorId }: Readonly<{ actorId: string }>) {
  const [ledger, setLedger] = useState<FieldLedger | null>(null);
  const [payout, setPayout] = useState<BeneficiaryPayoutState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [from, setFrom] = useState(() => {
    const day = new Date(); day.setUTCDate(day.getUTCDate() - 30);
    return day.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  // biome-ignore lint/correctness/useExhaustiveDependencies: actorId identifies the selected field account whose financial view must reset.
  useEffect(() => { setLedger(null); setPayout(null); setError(""); setOpened(false); }, [actorId]);

  async function readLedger(cursor = "") {
    if (busy || !from || !to || from > to) {
      if (from > to) setError("تاريخ بداية الكشف يجب ألا يتجاوز نهايته.");
      return;
    }
    setBusy(true); setError(""); setOpened(true);
    try {
      const query = new URLSearchParams({ from, to });
      if (cursor) query.set("cursor", cursor);
      const [response, payoutResponse] = await Promise.all([
        identityFetch("/api/finance/beneficiaries/field/" + encodeURIComponent(actorId) + "/financial-statement?" + query, { cache: "no-store" }),
        identityFetch("/api/finance/actor-payout-state?actorType=field&actorId=" + encodeURIComponent(actorId), { cache: "no-store" }),
      ]);
      if (response.status === 403 || payoutResponse.status === 403) {
        setLedger(null); setPayout(null);
        throw new Error("البيانات المالية تتطلب صلاحية المالية.");
      }
      if (!response.ok) throw new Error(await fieldResponseMessage(response));
      if (!payoutResponse.ok) throw new Error(await fieldResponseMessage(payoutResponse));
      const snapshot = await payoutResponse.json() as { state?: BeneficiaryPayoutState };
      const payload = await response.json() as { statement?: FieldLedger };
      const statement = payload.statement;
      if (snapshot.state?.actorId !== actorId || snapshot.state.actorType !== "field" ||
        !statement || statement.currency !== "YER" || !Number.isFinite(statement.currentBalanceMinor) ||
        !Array.isArray(statement.entries)) throw new Error("لم تتطابق بيانات الكشف مع المستفيد.");
      setPayout(snapshot.state);
      setLedger((current) => cursor && current ? { ...statement, entries: [...current.entries, ...statement.entries] } : statement);
    } catch (cause) { setError(fieldRequestError(cause, "تعذرت قراءة المستحقات.")); }
    finally { setBusy(false); }
  }

  return <div className="field-profile-stack">
    <section className="field-profile-section">
      <header className="field-profile-section-heading">
        <div><h3>المستحقات ووجهة الصرف</h3><p>تُقرأ من السجل المالي بصلاحية مستقلة.</p></div>
        <button className="button button-secondary" type="button" onClick={() => void readLedger()} disabled={busy || !from || !to || from > to}>{busy ? "جارٍ التحديث…" : opened ? "تحديث الحساب" : "عرض الكشف المالي"}</button>
      </header>
      <div className="field-profile-date-range">
        <label className="field-label" htmlFor={"field-finance-from-"+actorId}>من تاريخ
          <input id={"field-finance-from-"+actorId} type="date" value={from} onChange={(event) => { setFrom(event.target.value); setLedger(null); setPayout(null); setOpened(false); }} /></label>
        <label className="field-label" htmlFor={"field-finance-to-"+actorId}>إلى تاريخ
          <input id={"field-finance-to-"+actorId} type="date" value={to} onChange={(event) => { setTo(event.target.value); setLedger(null); setPayout(null); setOpened(false); }} /></label>
      </div>
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      {!opened ? <p className="muted">اعرض الرصيد والمكافآت والقيود المالية للفترة المحددة. لن تُعرض أرقام تقديرية.</p> : null}
      {payout ? <>
        <dl className="field-profile-metrics field-profile-four">
          <div><dt>متاجر مستحقة</dt><dd>{payout.acquiredStoreCount === undefined ? "غير متاح" : payout.acquiredStoreCount.toLocaleString("ar-YE")}</dd></div>
          <div><dt>المكافآت المكتسبة</dt><dd>{payout.earnedMinor === undefined ? "غير متاح" : formatMoney(payout.earnedMinor, payout.currency)}</dd></div>
          <div><dt>المتاح للصرف</dt><dd>{formatMoney(payout.eligibleAvailableMinor, payout.currency)}</dd></div>
          <div><dt>المحجوز</dt><dd>{formatMoney(payout.heldMinor, payout.currency)}</dd></div>
        </dl>
        <dl className="field-profile-facts">
          <div><dt>آخر طلب تسوية</dt><dd>{payout.latestPayout ? payoutStatusLabel(payout.latestPayout.status) + " · " + formatMoney(payout.latestPayout.resolvedAmountMinor, payout.latestPayout.currency) : "لا يوجد طلب"}</dd></div>
          <div><dt>وجهة الصرف</dt><dd>{payout.destination ? officialWalletDestinationStatusLabel(payout.destination.status) : "غير مهيأة"}{payout.destination ? <> · <bdi>{payout.destination.walletIdentifierMasked}</bdi></> : null}</dd></div>
        </dl>
        <details className="field-agent-edit"><summary className="button button-secondary">إدارة وجهة الصرف</summary><div className="field-profile-edit-body"><OfficialWalletDestinationManager actorType="field" actorId={actorId} /></div></details>
      </> : null}
    </section>
    {ledger ? <section className="field-profile-section">
      <header className="field-profile-section-heading"><div><h3>حركات الحساب</h3><p>الفترة {ledger.periodStart} — {ledger.periodEnd}</p></div></header>
      <dl className="field-profile-metrics field-profile-four">
        <div><dt>الرصيد الحالي</dt><dd>{formatMoney(ledger.currentBalanceMinor, ledger.currency)}</dd></div>
        <div><dt>إضافات الفترة</dt><dd>{formatMoney(ledger.creditsMinor, ledger.currency)}</dd></div>
        <div><dt>خصومات الفترة</dt><dd>{formatMoney(ledger.debitsMinor, ledger.currency)}</dd></div>
        <div><dt>إقفال الفترة</dt><dd>{formatMoney(ledger.closingBalanceMinor, ledger.currency)}</dd></div>
      </dl>
      <div className="field-profile-transactions">
        {ledger.entries.map((entry) => <div key={entry.transactionId} className="field-profile-transaction">
          <span><strong>{entry.transactionType === "FIELD_ACQUISITION_ENTITLEMENT_POSTED" ? "مكافأة ضم متجر" : entry.transactionType === "PAYOUT_COMPLETED" ? "صرف مستحقات" : "حركة مالية"}</strong><time dateTime={entry.createdAt}>{fieldTimestamp(entry.createdAt)}</time></span>
          <span className="field-profile-transaction-amount">{entry.direction === "CREDIT" ? "+" : "−"}{formatMoney(entry.amountMinor, ledger.currency)}</span>
        </div>)}
        {ledger.entries.length === 0 ? <p className="muted">لا توجد حركات مالية مسجلة لهذه الفترة.</p> : null}
      </div>
      {ledger.nextCursor ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void readLedger(ledger.nextCursor)}>{busy ? "جارٍ التحميل…" : "تحميل الحركات الأقدم"}</button> : null}
    </section> : null}
  </div>;
}

function FieldRecordProfile({ item, data, onClose, onPrevious, onNext }: Readonly<{
  item: FieldWorkbenchItem;
  data: FieldAdmissionRosterProps;
  onClose: () => void;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}>) {
  const admission = item.kind === "candidate" ? item.admission : item.account.admission;
  const field = item.kind === "account" ? item.account : null;
  const id = field?.actorId ?? admission?.id ?? "";
  const name = admission?.fullNameAr || "ميداني بلا اسم مكتمل";
  const phone = field?.phoneE164 ?? admission?.contactPhoneE164 ?? "";
  const cities = admission?.allServiceCities ? "جميع المدن النشطة" : (admission?.serviceCityIds ?? []).map((cityId) => data.serviceCities.find((city) => city.id === cityId)?.displayNameAr ?? "مدينة غير متاحة").join("، ") || "لا توجد مدينة محددة";
  const providerName = data.walletProviders.find((provider) => provider.key === admission?.walletProviderKey)?.displayNameAr || admission?.walletProviderKey || "غير محدد";
  const draft = item.kind === "candidate" ? data.candidateEdits[item.admission.id] ?? fieldProfile(item.admission) : field ? currentAccountProfileDraft(field, data.accountProfileDrafts) : null;
  const changed = admission && draft ? !sameFieldProfile(draft, fieldProfile(admission)) : false;
  const busy = data.busy === id;
  const feedback = data.feedbackActorId === id;
  const [activeTab, setActiveTab] = useState<FieldRecordTab>("overview");
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the selected record resets its local tab context.
  useEffect(() => { setActiveTab("overview"); }, [id]);
  const cases = data.acquisitionCases[id];
  const acquisitionBusy = data.acquisitionCaseBusy[id] ?? false;
  const acquisitionError = data.acquisitionCaseErrors[id] ?? "";
  useEffect(() => {
    if (!field || !["stores", "performance"].includes(activeTab) || cases || acquisitionBusy || acquisitionError) return;
    data.onLoadAcquisitionCases(id);
  }, [id, field, activeTab, cases, acquisitionBusy, acquisitionError, data.onLoadAcquisitionCases]);
  const caseCount = field?.joiningCaseCount;
  const selectTab = (next: FieldRecordTab) => {
    setActiveTab(next);
    const scroll = document.querySelector(".adaptive-record-sheet .workspace-side-drawer-scroll");
    if (scroll) scroll.scrollTop = 0;
  };

  const accountControls = <section className="field-profile-section">
    <header className="field-profile-section-heading"><div><h3>الملف والأهلية والتغطية</h3><p>التعديل هنا يغيّر بيانات التشغيل المعتمدة، وليس مجرد العرض.</p></div></header>
    <dl className="field-profile-facts">
      <div><dt>الهاتف المعتمد</dt><dd><bdi dir="ltr">{phone}</bdi></dd></div>
      <div><dt>نطاق المدن</dt><dd>{cities}</dd></div>
      <div><dt>مزوّد المحفظة</dt><dd>{providerName}</dd></div>
      <div><dt>حالة الأهلية</dt><dd>{admissionStatusLabel(admission)}</dd></div>
      <div><dt>التفعيل الأول</dt><dd>{field?.activatedAt ? fieldTimestamp(field.activatedAt) : field ? "بانتظار التفعيل" : "بانتظار منح الدور"}</dd></div>
      <div><dt>مراجعة البيانات</dt><dd>{admission?.requiresProfileReview ? "مطلوبة" : "لا توجد مراجعة معلقة"}</dd></div>
    </dl>
    {field ? <div className="field-profile-actions"><FieldAccountMutationActions
      field={field}
      profileDraft={draft ?? fieldProfile(admission!)}
      idPrefix="field-profile"
      reason={data.reasons[id] ?? ""}
      busy={data.busy}
      serviceCities={data.serviceCities}
      walletProviders={data.walletProviders}
      onProfileDraftChange={(value) => data.onAccountProfileDraftChange(id, admission?.version ?? 0, value)}
      onReasonChange={(value) => data.onReasonChange(id, value)}
      onMutate={data.onAccountMutate}
    /></div> : admission && draft ? <div className="field-profile-actions">
      {admission.state === "pending_review" ? <details className="field-agent-edit" open={admission.requiresProfileReview}>
        <summary className="button button-secondary">تعديل بيانات الميداني</summary>
        <div className="field-profile-form">
          <label className="field-label" htmlFor={"field-detail-name-" + id}>الاسم الكامل<input id={"field-detail-name-" + id} maxLength={120} value={draft.fullNameAr} disabled={Boolean(data.busy)} onChange={(event) => data.onCandidateNameChange(id, { ...draft, fullNameAr: event.target.value })} /></label>
          <label className="field-label" htmlFor={"field-detail-provider-" + id}>مزوّد المحفظة<select id={"field-detail-provider-" + id} value={draft.walletProviderKey} disabled={Boolean(data.busy)} onChange={(event) => data.onCandidateNameChange(id, { ...draft, walletProviderKey: event.target.value })}><option value="">اختر المحفظة</option>{data.walletProviders.map((option) => <option key={option.key} value={option.key}>{option.displayNameAr}</option>)}</select></label>
          <label className="field-label" htmlFor={"field-detail-allcities-" + id}><input id={"field-detail-allcities-" + id} type="checkbox" checked={draft.allServiceCities} disabled={Boolean(data.busy)} onChange={(event) => data.onCandidateNameChange(id, { ...draft, allServiceCities: event.target.checked, serviceCityIds: event.target.checked ? [] : draft.serviceCityIds })} /> جميع المدن النشطة</label>
          {!draft.allServiceCities ? <label className="field-label" htmlFor={"field-detail-cities-" + id}>مدن الخدمة<select id={"field-detail-cities-" + id} multiple value={[...draft.serviceCityIds]} disabled={Boolean(data.busy)} onChange={(event) => data.onCandidateNameChange(id, { ...draft, serviceCityIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{data.serviceCities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label> : null}
          <button className="button button-secondary" type="button" disabled={Boolean(data.busy) || !changed || draft.fullNameAr.trim().length < 2 || !data.walletProviders.some((option) => option.key === draft.walletProviderKey) || (!draft.allServiceCities && draft.serviceCityIds.length === 0)} onClick={() => data.onCandidateMutate(admission, "update-profile")}>حفظ التغييرات</button>
        </div>
      </details> : null}
      {admission.state === "pending_review" ? <button className="button button-primary" type="button" disabled={Boolean(data.busy) || Boolean(changed)} onClick={() => data.onCandidateMutate(admission, "approve")}>اعتماد الملف</button> : null}
      {admission.state === "pending_identity" ? <button className="button button-primary" type="button" disabled={Boolean(data.busy)} onClick={() => data.onCandidateMutate(admission, "provision")}>منح دور الميداني</button> : null}
    </div> : null}
  </section>;

  return <AdaptiveRecordPanel title={name} subtitle="إدارة الميداني" onClose={onClose} onPrevious={onPrevious} onNext={onNext}>
    <div className="field-profile-root" dir="rtl">
      <header className="field-profile-hero">
        <div className="field-profile-avatar" aria-hidden="true">{Array.from(name.trim())[0] ?? "م"}</div>
        <div className="field-profile-identity">
          <h2>{name}</h2><bdi dir="ltr">{phone}</bdi>
          <div className="field-profile-states">
            {admissionIndicator(admission)}
            {field ? <RecordIndicator icon={!field.securityEnabled || !field.enabled ? "paused" : field.activatedAt ? "active" : "pending"} label={identityStatusLabel(field)} tone={!field.securityEnabled || !field.enabled ? "warning" : field.activatedAt ? "success" : "warning"} /> : <span className="muted">بانتظار إنشاء الحساب</span>}
          </div>
        </div>
        <button className="button button-secondary field-profile-hero-action" type="button" onClick={() => selectTab("account")}>إدارة الملف</button>
      </header>
      {feedback && data.notice ? <output className="success-inline">{data.notice}</output> : null}
      {feedback && data.error ? <p className="identity-error" role="alert">{data.error}</p> : null}
      {busy ? <output className="muted">جارٍ تنفيذ الإجراء والتحقق من النتيجة…</output> : null}
      <RecordTabs id={`field-${id}`} panelId={`field-${id}-panel`} ariaLabel="أقسام ملف الميداني" className="field-profile-tabs"
        tabs={fieldRecordTabs.map(({ id: key, label }) => ({ key, label }))} active={activeTab} onSelect={selectTab}/>
      <div id={`field-${id}-panel`} className="field-profile-tab-content" role="tabpanel" aria-labelledby={`field-${id}-tab-${activeTab}`}>
        {activeTab === "overview" ? <div className="field-profile-stack">
          {field ? <ActorWalletStatement actorType="field" actorId={field.actorId} /> : null}
          <dl className="field-profile-metrics">
            <div><dt>ملفات ضم الشركاء</dt><dd>{caseCount === undefined ? "—" : caseCount.toLocaleString("ar-YE")}</dd></div>
            <div><dt>آخر فتح للتطبيق</dt><dd className="field-profile-metric-small">{field?.lastAppOpenedAt ? fieldTimestamp(field.lastAppOpenedAt) : "غير مسجل"}</dd></div>
            <div><dt>أحدث متجر</dt><dd className="field-profile-metric-small">{field?.latestStore?.storeName ?? "لا يوجد"}</dd></div>
          </dl>
          <section className="field-profile-section">
            <header className="field-profile-section-heading"><div><h3>حالة الميداني</h3><p>الحالة التشغيلية الحالية والقرار التالي.</p></div></header>
            <dl className="field-profile-facts">
              <div><dt>الأهلية</dt><dd>{admissionStatusLabel(admission)}</dd></div>
              <div><dt>دخول التطبيق</dt><dd>{field ? identityStatusLabel(field) : "الحساب لم يُنشأ بعد"}</dd></div>
              <div><dt>مدن الخدمة</dt><dd>{cities}</dd></div>
              <div><dt>المحفظة</dt><dd>{providerName}</dd></div>
            </dl>
            <div className="field-profile-quick-actions">
              <button className="button button-primary" type="button" onClick={() => selectTab("account")}>{admission?.state === "pending_review" ? "مراجعة الملف واعتماده" : admission?.state === "pending_identity" ? "منح دور الميداني" : "إدارة الحساب والتغطية"}</button>
              <button className="button button-secondary" type="button" onClick={() => selectTab("stores")}>متابعة المتاجر والضم</button>
              {field ? <button className="button button-secondary" type="button" onClick={() => selectTab("finance")}>المستحقات المالية</button> : null}
            </div>
          </section>
          {field?.latestJoiningCase ? <section className="field-profile-section">
            <header className="field-profile-section-heading"><h3>آخر ملف ضم</h3><button className="button button-secondary" type="button" onClick={() => selectTab("stores")}>كل الملفات</button></header>
            <div className="field-profile-latest"><strong>{field.latestJoiningCase.displayName}</strong><span>{joiningCaseStateLabel(field.latestJoiningCase.state)}</span><time dateTime={field.latestJoiningCase.createdAt}>{fieldTimestamp(field.latestJoiningCase.createdAt)}</time></div>
          </section> : null}
        </div> : null}

        {activeTab === "stores" ? <div className="field-profile-stack">
          <section className="field-profile-section">
            <header className="field-profile-section-heading"><div><h3>المتاجر وملفات ضم الشركاء</h3><p>سجل الميداني المثبت، مع متابعة حالة كل ملف عند مالكه.</p></div>
              {field ? <button className="button button-secondary" type="button" disabled={acquisitionBusy} onClick={() => data.onLoadAcquisitionCases(id)}>{acquisitionBusy ? "جارٍ التحديث…" : "تحديث الملفات"}</button> : null}
            </header>
            <dl className="field-profile-metrics">
              <div><dt>إجمالي ملفات الضم</dt><dd>{caseCount === undefined ? "غير متاح" : caseCount.toLocaleString("ar-YE")}</dd></div>
              <div><dt>آخر متجر مرتبط</dt><dd className="field-profile-metric-small">{field?.latestStore?.storeName ?? "لا يوجد"}</dd></div>
            </dl>
            {field ? <FieldAcquisitionDisclosure fieldActorId={id} page={cases} error={acquisitionError} busy={acquisitionBusy} onLoad={data.onLoadAcquisitionCases} /> : <p className="muted">تظهر ملفات الضم بعد اعتماد المرشح وإنشاء حسابه.</p>}
          </section>
        </div> : null}

        {activeTab === "performance" ? <div className="field-profile-stack">
          <section className="field-profile-section">
            <header className="field-profile-section-heading"><div><h3>الأداء الموثق</h3><p>تُعرض الوقائع المسجلة، لا درجات أو نسب تقييم مفترضة.</p></div>
              {field ? <button className="button button-secondary" type="button" onClick={() => selectTab("stores")}>مراجعة ملفات الضم</button> : null}
            </header>
            <dl className="field-profile-metrics">
              <div><dt>ملفات الضم المسجلة</dt><dd>{caseCount === undefined ? "غير متاح" : caseCount.toLocaleString("ar-YE")}</dd></div>
              <div><dt>آخر فتح للتطبيق</dt><dd className="field-profile-metric-small">{field?.lastAppOpenedAt ? fieldTimestamp(field.lastAppOpenedAt) : "غير مسجل"}</dd></div>
              <div><dt>آخر متجر أضافه</dt><dd className="field-profile-metric-small">{field?.latestStore?.storeName ?? "لا يوجد"}</dd></div>
            </dl>
            {cases ? <>
              <p className="muted">تفصيل حالات {cases.cases.length.toLocaleString("ar-YE")} ملفًا محملًا{cases.nextCursor ? " (توجد ملفات أقدم)" : ""}؛ لا يمثل مجموع السجل إذا لم تُحمّل كل الصفحات.</p>
              <div className="field-profile-status-grid">
                {Array.from(new Set(cases.cases.map((entry) => entry.state))).map((state) => <div key={state}><strong>{cases.cases.filter((entry) => entry.state === state).length.toLocaleString("ar-YE")}</strong><span>{joiningCaseStateLabel(state)}</span></div>)}
                {cases.cases.length === 0 ? <p className="muted">لا توجد ملفات ضمن النتائج الحالية.</p> : null}
              </div>
            </> : acquisitionError ? <p className="identity-error" role="alert">{acquisitionError}</p> : <p className="muted">جارٍ قراءة ملفات الضم المرتبطة بالميداني…</p>}
          </section>
        </div> : null}

        {activeTab === "finance" ? field ? <FieldFinancialRecord key={id} actorId={id} /> : <div className="field-profile-section"><h3>المالية</h3><p className="muted">تظهر المستحقات بعد إنشاء حساب الميداني.</p></div> : null}
        {activeTab === "account" ? accountControls : null}
        {activeTab === "history" ? <section className="field-profile-section">
          <header className="field-profile-section-heading"><div><h3>سجل الملف والتفعيل</h3><p>الأوقات والنسخة الحالية من المصادر المعتمدة.</p></div></header>
          <dl className="field-profile-facts">
            <div><dt>إنشاء الملف</dt><dd>{admission?.createdAt ? fieldTimestamp(admission.createdAt) : "غير مسجل"}</dd></div>
            <div><dt>آخر تعديل</dt><dd>{admission?.updatedAt ? fieldTimestamp(admission.updatedAt) : "غير مسجل"}</dd></div>
            <div><dt>تفعيل الحساب</dt><dd>{field?.activatedAt ? fieldTimestamp(field.activatedAt) : "لم يُفعّل"}</dd></div>
            <div><dt>آخر فتح للتطبيق</dt><dd>{field?.lastAppOpenedAt ? fieldTimestamp(field.lastAppOpenedAt) : "غير مسجل"}</dd></div>
            <div><dt>نسخة الملف</dt><dd>{admission?.version ?? "—"}</dd></div>
          </dl>
          <p className="muted">لا يُعرض سجل تغييرات تفصيلي دون مصدر تدقيق موثق.</p>
        </section> : null}
      </div>
    </div>
  </AdaptiveRecordPanel>;
}
