"use client";

import { type JoiningCaseView, joiningCaseStateLabel, type OperatorOperationsSummary, publicationReadinessBlockedReasonLabel, publicationStateLabel, type StorePublicationResponse } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdaptiveRecordView } from "../../shell/adaptive-record-workspace";
import { OperationalIcon, type OperationalIconName } from "../../shell/workspace-icon";
import { RecordTabs } from "../shared/record-tabs";
import { StoreImageEditor } from "./store-image-editor";
import { PublicationIndicator } from "./store-indicators";
import { StoreLogo } from "./store-logo";
import { StoreModeControls } from "./store-mode-controls";
import { StoreOffersPreview } from "./store-offers-preview";
import { StoreOperationsPreview } from "./store-operations-preview";
import { StoreProfileTabs } from "./store-profile-tabs";

type Store = StorePublicationResponse["store"];
type ProfileProps = Readonly<{
  store: Store;
  partner: Readonly<{ partner: ActorRoleView; joiningCase: JoiningCaseView | null }> | null;
  partnerError: string;
  canViewFinance: boolean;
  canViewOperations: boolean;
  manageOpen: boolean;
  openManagement: () => void;
  management: ReactNode;
  onUpdated: () => void;
}>;

const profileTabIcons: Record<string, OperationalIconName> = {
  overview: "home", basics: "storeDelivery", orders: "operations", products: "catalog",
  promotions: "marketing", branches: "field", coverage: "map", hours: "pending",
  customers: "partners", quality: "review", ratings: "active", documents: "access",
  history: "review", finance: "finance",
};

function profileDate(value: string) {
  return new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium" }).format(new Date(value));
}
function ProfileCard({ title, icon, children, className = "" }: Readonly<{
  title: string; icon: string; children: ReactNode; className?: string;
}>) {
  return <section className={`store-profile-card ${className}`} aria-label={title}>
    <header className="store-profile-card-header">
      <h3>{title}</h3><span className="store-profile-card-icon" aria-hidden="true">{icon}</span>
    </header>
    {children}
  </section>;
}
function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <div className="store-profile-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}
function MissingData({ message }: Readonly<{ message: string }>) {
  return <div className="store-profile-empty"><span aria-hidden="true">◇</span><p>{message}</p></div>;
}

export function StoreProfileDashboard({ store, partner, partnerError, canViewFinance, canViewOperations, manageOpen, openManagement, management, onUpdated }: ProfileProps) {
  const account = partner?.partner;
  const accountState = partnerError ? "تعذرت القراءة" : !account ? "غير متاحة" : !account.enabled || !account.securityEnabled ? "موقوف" : account.activatedAt ? "نشط" : "بانتظار التفعيل";
  const ready = store.publicationReadiness.ready;
  const publication = publicationStateLabel(store.publicationState);
  const blockers = !ready ? (store.publicationReadiness.blockedReasons?.length ? store.publicationReadiness.blockedReasons : store.publicationReadiness.blockedReason ? [store.publicationReadiness.blockedReason] : []) : [];
  const caseView = partner?.joiningCase;
  const cover = store.storeCoverImage?.uri;

  const [activeTab, setActiveTab] = useState("overview");
  const [orderSummary, setOrderSummary] = useState<OperatorOperationsSummary | null>(null);
  const [imageRole, setImageRole] = useState<"primary" | "cover" | null>(null);
  const [imageNotice, setImageNotice] = useState("");
  const imageDialog = useRef<HTMLDialogElement>(null);
  const imageClose = useRef<HTMLButtonElement>(null);
  const imageTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (imageRole) {
      const dialog = imageDialog.current;
      if (dialog && !dialog.open) dialog.showModal();
      imageClose.current?.focus();
    } else {
      imageTrigger.current?.focus();
    }
  }, [imageRole]);
  const recordView = useAdaptiveRecordView();
  const openEditor = () => { setActiveTab("basics"); openManagement(); };
  const selectTab = (tab: string) => {
    setActiveTab(tab);
    if (tab === "basics") openManagement();
    if (tab !== "overview") recordView?.expandForEditing();
    document.querySelector(".adaptive-record-sheet .workspace-side-drawer-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const tabs: ReadonlyArray<readonly [string, string]> = [
    ["overview", "نظرة عامة"], ["basics", "البيانات الأساسية"], ["orders", "الطلبات"],
    ["products", "الكتالوج والمنتجات"], ["promotions", "العروض"], ["branches", "الفروع"],
    ["coverage", "مناطق الخدمة"], ["hours", "أوقات العمل"], ["customers", "العملاء"],
    ["quality", "المراجعة والجودة"], ["ratings", "التقييمات"],
    ["documents", "الوثائق والاعتمادات"], ["history", "السجل والإجراءات"],
    ...(canViewFinance ? [["finance", "المالية"] as const] : []),
  ];

  return <div className="store-profile" data-managing={manageOpen}>
    <section className="store-profile-hero store-sheet-hero" aria-label="هوية المتجر">
      <div className="store-profile-hero-main">
        <div className="store-profile-brand">
          <button type="button" className="store-profile-image-action store-profile-logo-action" onClick={(event) => { imageTrigger.current = event.currentTarget; setImageNotice(""); setImageRole("primary"); }} aria-label="تغيير شعار المتجر">
            <StoreLogo name={store.name} uri={store.storeProfileImage?.uri} allowPreview={false} />
            <span>تغيير الشعار</span>
          </button>
          <div className="store-profile-brand-copy">
            <span className="store-profile-eyebrow">ملف المتجر · الشركاء والمتاجر</span>
            <h2>{store.name}</h2>
            <p>{[store.primaryVerticalName, store.serviceCityName].filter(Boolean).join(" · ") || "سجل متجر"}</p>
            <div className="store-profile-identity-meta"><span className="store-sheet-state" data-status={store.publicationState}>{publication} <PublicationIndicator state={store.publicationState} /></span></div>
          </div>
        </div>
        <div className="store-profile-hero-info">
          <div><span>الشريك المالك</span><strong><Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`} title="فتح الملف الإداري للشريك">{store.partnerName || caseView?.ownerFullName || "مرتبط بحساب"}</Link></strong></div>
          <div><span>آخر تحديث</span><strong><time dateTime={store.updatedAt}>{profileDate(store.updatedAt)}</time></strong></div>
          <button type="button" className="button button-primary store-profile-main-action" aria-expanded={manageOpen} aria-controls="store-inline-management" onClick={openEditor}>{manageOpen ? "أدوات إدارة المتجر" : "إدارة المتجر"}</button>
        </div>
      </div>
      <button type="button" className="store-profile-cover store-profile-image-action" data-empty={!cover} onClick={(event) => { imageTrigger.current = event.currentTarget; setImageNotice(""); setImageRole("cover"); }} aria-label="تغيير غلاف المتجر">
        {cover ? <img src={cover} alt={`غلاف متجر ${store.name}`} loading="lazy" /> : <span className="store-profile-cover-placeholder"><span aria-hidden="true">▧</span><span>لا توجد صورة غلاف</span></span>}
        <span className="store-profile-image-label">تغيير الغلاف</span>
      </button>
    </section>
    {imageRole ? createPortal(<dialog ref={imageDialog} aria-labelledby="store-profile-image-dialog-title" className="store-profile-image-dialog"
        onCancel={() => setImageRole(null)}>
        <div className="store-profile-dialog-heading"><h2 id="store-profile-image-dialog-title">{imageRole === "primary" ? "تغيير شعار المتجر" : "تغيير صورة الغلاف"}</h2>
          <button ref={imageClose} type="button" aria-label="إغلاق تعديل الصورة" onClick={() => setImageRole(null)}>إغلاق ×</button></div>
        <StoreImageEditor key={store.id + imageRole} storeId={store.id} name={store.name} initialRole={imageRole} lockedRole
          onSaved={() => { setImageNotice(imageRole === "primary" ? "تم تحديث شعار المتجر والتحقق من حفظه." : "تم تحديث غلاف المتجر والتحقق من حفظه."); setImageRole(null); onUpdated(); }} />
    </dialog>, document.body) : null}

    {imageNotice ? <output className="store-profile-image-notice">{imageNotice}</output> : null}
    <RecordTabs id="store-profile" ariaLabel="تبويبات ملف المتجر" className="store-profile-sections"
      tabs={tabs.map(([key, label]) => ({ key, label: <><OperationalIcon name={profileTabIcons[key] ?? "review"}/>{label}</> }))}
      active={activeTab} onSelect={selectTab}/>

    <section id="store-profile-panel-overview" role="tabpanel" aria-labelledby="store-profile-tab-overview" hidden={activeTab !== "overview"} className="store-profile-overview">
    {canViewOperations ? <section id="store-profile-overview" className="store-profile-kpis" aria-label="مؤشرات طلبات المتجر المعتمدة">
      <div className="store-profile-kpi"><span className="store-profile-kpi-icon" data-tone="neutral" aria-hidden="true">▤</span><div><span>إجمالي الطلبات</span><strong>{orderSummary?.totalCount ?? "—"}</strong><small>كل طلبات المتجر</small></div></div>
      <div className="store-profile-kpi"><span className="store-profile-kpi-icon" data-tone="warning" aria-hidden="true">!</span><div><span>تحتاج متابعة</span><strong>{orderSummary?.actionableCount ?? "—"}</strong><small>طلبات تستدعي تدخلًا</small></div></div>
      <div className="store-profile-kpi"><span className="store-profile-kpi-icon" data-tone="warning" aria-hidden="true">▣</span><div><span>بانتظار كابتن</span><strong>{orderSummary?.awaitingDispatchCount ?? "—"}</strong><small>قبل الإسناد</small></div></div>
      <div className="store-profile-kpi"><span className="store-profile-kpi-icon" data-tone="success" aria-hidden="true">▥</span><div><span>قيد التنفيذ</span><strong>{orderSummary?.activeCount ?? "—"}</strong><small>حالات جارية</small></div></div>
      <div className="store-profile-kpi"><span className="store-profile-kpi-icon" data-tone="success" aria-hidden="true">✓</span><div><span>تم التسليم</span><strong>{orderSummary?.deliveredCount ?? "—"}</strong><small>ضمن جميع الطلبات</small></div></div>
    </section> : null}

    <section className="store-profile-alert" data-ready={ready} aria-label={ready ? "جاهزية النشر" : "المطلوب قبل النشر"}>
      <div><strong>{ready ? "جاهزية النشر" : "المطلوب قبل النشر"}</strong>
        {ready ? <p>المتجر مستوفٍ لشروط النشر الحالية.</p> : <ul className="store-profile-blockers">
          {blockers.length ? blockers.map((reason,i) => <li key={reason}>
            <span>{publicationReadinessBlockedReasonLabel(reason)}</span>
            <button type="button" className="button button-quiet" onClick={() => {
              if(reason==="CATALOG_NOT_READY")selectTab("products");
              else if(reason==="STORE_SCHEDULE_NOT_READY")selectTab("hours");
              else if(reason==="FINANCIAL_PROFILE_NOT_READY"||reason==="COMMERCIAL_AGREEMENT_NOT_READY")selectTab(canViewFinance?"finance":"documents");
              else selectTab("basics");
            }}>معالجة</button>
          </li>) : <li>{publicationReadinessBlockedReasonLabel(store.publicationReadiness.blockedReason)}</li>}
        </ul>}</div>
      {!ready ? <button type="button" className="button button-secondary" onClick={openEditor}>معالجة النقص</button> : null}
    </section>

    <div className="store-profile-content store-sheet-dashboard">
      <div id="store-profile-information" className="store-profile-information"><ProfileCard title="معلومات المتجر والشريك" icon="♙">
        <dl className="store-profile-facts">
          <Fact label="الشريك المالك"><Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`}>{store.partnerName || caseView?.ownerFullName || "حساب مرتبط"}</Link></Fact>
          {account?.phoneE164 ? <Fact label="رقم التواصل"><a href={`tel:${account.phoneE164}`}><bdi dir="ltr">{account.phoneE164}</bdi></a></Fact> : null}
          <Fact label="المدينة">{store.serviceCityName || "غير محددة"}</Fact>
          <Fact label="النشاط">{store.primaryVerticalName || "غير محدد"}</Fact>
          <Fact label="نوع المتجر">{store.commercialStoreTypeId ? "محدد في سياسة المتجر" : "غير محدد"}</Fact>
        </dl>
        {partnerError ? <p className="store-profile-minor-error">{partnerError}</p> : null}
      </ProfileCard></div>

      <div id="store-profile-delivery" className="store-profile-delivery"><ProfileCard title="حالة المتجر والتوصيل" icon="◉">
        <StoreModeControls store={store} onUpdated={onUpdated} />
      </ProfileCard></div>

      {caseView ? <div id="store-profile-joining" className="store-profile-joining"><ProfileCard title="الانضمام والمراجعة" icon="▤">
        {caseView ? <dl className="store-profile-facts">
          <Fact label="طلب الانضمام">{caseView.businessName}</Fact>
          <Fact label="حالة الانضمام">{joiningCaseStateLabel(caseView.state)}</Fact>
        </dl> : <MissingData message={partnerError ? "تعذرت قراءة طلب الانضمام المرتبط." : "لا يظهر طلب انضمام مرتبط في القراءة الحالية."} />}
      </ProfileCard></div> : null}

      <div className="store-profile-readiness"><ProfileCard title="الطلبات النشطة" icon="▥">
        {canViewOperations ? <StoreOperationsPreview storeId={store.id} compact onSummary={setOrderSummary} />
          : <MissingData message="قراءة طلبات المتجر محصورة بالمشغّل المخوّل بصلاحية العمليات." />}
      </ProfileCard></div>

      <div className="store-profile-products"><ProfileCard title="منتجات المتجر وعروضه" icon="▣"><StoreOffersPreview storeId={store.id} /></ProfileCard></div>

      <div className="store-profile-access"><ProfileCard title="الوصول والصلاحيات" icon="♧">
        <div className="store-profile-state-row"><span>حالة حساب الشريك</span><strong>{accountState}</strong></div>
        <div className="store-profile-state-row"><span>حالة التفعيل</span><strong>{!account ? "غير متاحة" : account.activatedAt ? "مفعّل" : "بانتظار التفعيل"}</strong></div>
        <p className="store-profile-muted">الصلاحيات التفصيلية تُقرأ من مالكها لدى Identity؛ لا يمنح هذا الملف أي وصول جديد.</p>
      </ProfileCard></div>

      {store.deliveryOrigin ? <div className="store-profile-map"><ProfileCard title="موقع المتجر" icon="⌖">
        <dl className="store-profile-map-coordinates">
          <div><dt>خط العرض</dt><dd><bdi dir="ltr">{store.deliveryOrigin.latitude}</bdi></dd></div>
          <div><dt>خط الطول</dt><dd><bdi dir="ltr">{store.deliveryOrigin.longitude}</bdi></dd></div>
        </dl>
        <a href={`https://www.google.com/maps?q=${store.deliveryOrigin.latitude},${store.deliveryOrigin.longitude}`} target="_blank" rel="noopener noreferrer" className="store-profile-action-link">عرض موقع المتجر على الخريطة ↗</a>
      </ProfileCard></div> : null}

    </div>
    </section>
    <StoreProfileTabs activeTab={activeTab} store={store} partner={partner} partnerError={partnerError}
      canViewFinance={canViewFinance} canViewOperations={canViewOperations} manageOpen={manageOpen} openManagement={openEditor} management={management} />
  </div>;
}
