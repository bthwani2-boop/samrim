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
type OperationalReadback = { availability: { storeId: string }; orderabilityByMode: ReadonlyArray<{ state: string }> };
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
  overview: "home", operations: "operations", identity: "storeDelivery",
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
  const [operationalReadback, setOperationalReadback] = useState<OperationalReadback | "unavailable" | null>(null);
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
  useEffect(() => {
    if (!canViewOperations) return;
    let active = true;
    setOperationalReadback(null);
    const check = () => {
      void fetch("/api/stores/" + encodeURIComponent(store.id) + "/operational-availability", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Operational availability unavailable");
          const value = await response.json() as OperationalReadback;
          if (value.availability?.storeId !== store.id || !Array.isArray(value.orderabilityByMode)) throw new Error("Invalid store readback");
          if (active) setOperationalReadback(value);
        })
        .catch(() => { if (active) setOperationalReadback("unavailable"); });
    };
    check();
    const timer = window.setInterval(check, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [canViewOperations, store.id]);
  const visibleModes = operationalReadback && operationalReadback !== "unavailable" ? operationalReadback.orderabilityByMode : [];
  const openModeCount = visibleModes.filter((mode) => mode.state === "OPEN_FOR_ORDERS").length;
  const operationalLabel = store.publicationState !== "published" ? "غير منشور"
    : operationalReadback === "unavailable" ? "حالة التشغيل غير متاحة"
    : !operationalReadback ? "التحقق من التشغيل…"
    : openModeCount === 0 ? "مغلق"
    : openModeCount < visibleModes.length ? "مفتوح جزئيًا" : "مفتوح";
  const recordView = useAdaptiveRecordView();
  const openEditor = () => { setActiveTab("identity"); openManagement(); };
  const selectTab = (tab: string) => {
    setActiveTab(tab);

    if (tab !== "overview") recordView?.expandForEditing();
    document.querySelector(".adaptive-record-sheet .workspace-side-drawer-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const tabs: ReadonlyArray<readonly [string, string]> = [
    ["overview", "نظرة عامة"], ["operations", "التشغيل"], ["identity", "البيانات والاعتمادات"],
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
            <div className="store-profile-identity-meta"><span className="store-sheet-state" data-status={store.publicationState}>{publication} <PublicationIndicator state={store.publicationState} /></span>{canViewOperations ? <button type="button" className="store-profile-operating-state" data-state={openModeCount > 0 && store.publicationState === "published" ? "open" : "closed"} onClick={() => selectTab("operations")} aria-label={"حالة استقبال الطلبات: " + operationalLabel + "، فتح التشغيل"}>{operationalLabel}</button> : null}</div>
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
    {canViewOperations ? <section id="store-profile-overview" className="store-profile-kpis" aria-label="مؤشرات طلبات المتجر">
      <div className="store-profile-kpi"><div><span>طلبات تحتاج متابعة</span><strong>{orderSummary?.actionableCount ?? "—"}</strong></div></div>
      <div className="store-profile-kpi"><div><span>بانتظار الإسناد</span><strong>{orderSummary?.awaitingDispatchCount ?? "—"}</strong></div></div>
      <div className="store-profile-kpi"><div><span>الطلبات النشطة</span><strong>{orderSummary?.activeCount ?? "—"}</strong></div></div>
    </section> : null}

    <section className="store-profile-alert" data-ready={ready} aria-label="جاهزية نشر المتجر" id="store-onboarding-readiness">
      <div>
        <strong>{ready ? "متطلبات النشر مكتملة" : "متطلبات نشر تحتاج متابعة"}</strong>
        <p>حالة النشر: {publication}. {ready ? "تُحدد إمكانية استقبال الطلبات بصورة مستقلة وفق حالة التشغيل." : "العوائق: " + (blockers.length || 1)}</p>
      </div>
      {!ready && blockers.length ? <details className="store-profile-readiness-detail">
        <summary>عرض أسباب عدم الجاهزية</summary>
        <ul>{blockers.map((reason) => <li key={reason}>{publicationReadinessBlockedReasonLabel(reason)}</li>)}</ul>
      </details> : null}
    </section>

    <div className="store-profile-content store-sheet-dashboard">
      <div className="store-profile-information"><ProfileCard title="بيانات المتجر" icon="⌂">
        <dl className="store-profile-facts">
          <Fact label="المالك"><Link href={"/partners/actors/" + encodeURIComponent(store.partnerActorId)}>{store.partnerName || caseView?.ownerFullName || "ملف الشريك"}</Link></Fact>
          <Fact label="المدينة">{store.serviceCityName || "غير محددة"}</Fact>
          <Fact label="النشاط">{store.primaryVerticalName || "غير محدد"}</Fact>
        </dl>
        {partnerError ? <p className="store-profile-minor-error">{partnerError}</p> : null}
      </ProfileCard></div>
      {canViewOperations ? <div className="store-profile-readiness"><ProfileCard title="طلبات المتجر" icon="▤">
        <StoreOperationsPreview storeId={store.id} compact onSummary={setOrderSummary} />
      </ProfileCard></div> : null}
      <div className="store-profile-access"><ProfileCard title="حالة حساب الشريك" icon="○">
        <div className="store-profile-state-row"><span>حساب المالك</span><strong>{accountState}</strong></div>
        <Link className="store-profile-action-link" href={"/partners/actors/" + encodeURIComponent(store.partnerActorId)}>فتح ملف الشريك ←</Link>
      </ProfileCard></div>
    </div>
    </section>
    <StoreProfileTabs activeTab={activeTab} store={store} partner={partner} partnerError={partnerError}
      canViewFinance={canViewFinance} canViewOperations={canViewOperations} manageOpen={manageOpen} openManagement={openEditor} management={management} onUpdated={onUpdated} />
  </div>;
}
