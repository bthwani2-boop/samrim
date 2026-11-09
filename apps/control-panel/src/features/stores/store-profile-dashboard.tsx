"use client";

import { type JoiningCaseView, joiningCaseStateLabel, type OperatorOperationsSummary, publicationReadinessBlockedReasonLabel, publicationStateLabel, type StorePublicationResponse } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Tabs } from "antd";
import { createPortal } from "react-dom";
import { useAdaptiveRecordView } from "../../shell/adaptive-record-workspace";
import { OperationalIcon, type OperationalIconName } from "../../shell/workspace-icon";
import { StoreImageEditor } from "./store-image-editor";
import { StoreInventorySummary } from "./store-inventory-summary";
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
  overview: "home", operations: "operations", catalog: "catalog", identity: "storeDelivery", quality: "review", documents: "access", finance: "finance",
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
  const isMarketplaceStore = store.relationModel === "BTHWANI_PARTNER";
  const canViewMarketplaceOperations = isMarketplaceStore && canViewOperations;
  const canViewMarketplaceFinance = isMarketplaceStore && canViewFinance;
  const ready = isMarketplaceStore && store.publicationReadiness.ready;
  const publication = isMarketplaceStore ? publicationStateLabel(store.publicationState) : "نشر الموقع المستقل غير مفعّل";
  const blockers = isMarketplaceStore && !ready ? (store.publicationReadiness.blockedReasons?.length ? store.publicationReadiness.blockedReasons : store.publicationReadiness.blockedReason ? [store.publicationReadiness.blockedReason] : []) : [];
  const caseView = partner?.joiningCase;
  const cover = store.storeCoverImage?.uri;

  const [activeTab, setActiveTab] = useState("overview");
  const orderSummaryScope = JSON.stringify([store.id, store.relationModel, store.version]);
  const [orderSummary, setOrderSummary] = useState<{ scope: string; summary: OperatorOperationsSummary | null } | null>(null);
  const currentOrderSummary = orderSummary?.scope === orderSummaryScope ? orderSummary.summary : null;
  const recordOrderSummary = useCallback((summary: OperatorOperationsSummary | null) => {
    setOrderSummary({ scope: orderSummaryScope, summary });
  }, [orderSummaryScope]);
  const [operationalReadback, setOperationalReadback] = useState<{ scope: string; value: OperationalReadback | "unavailable" } | null>(null);
  const currentOperationalReadback = operationalReadback?.scope === orderSummaryScope ? operationalReadback.value : null;
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
    if (!canViewMarketplaceOperations) return;
    let active = true;
    setOperationalReadback(null);
    const check = () => {
      void fetch("/api/stores/" + encodeURIComponent(store.id) + "/operational-availability", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Operational availability unavailable");
          const value = await response.json() as OperationalReadback;
          if (value.availability?.storeId !== store.id || !Array.isArray(value.orderabilityByMode)) throw new Error("Invalid store readback");
          if (active) setOperationalReadback({ scope: orderSummaryScope, value });
        })
        .catch(() => { if (active) setOperationalReadback({ scope: orderSummaryScope, value: "unavailable" }); });
    };
    check();
    const timer = window.setInterval(check, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [canViewMarketplaceOperations, store.id, orderSummaryScope]);
  const visibleModes = currentOperationalReadback && currentOperationalReadback !== "unavailable" ? currentOperationalReadback.orderabilityByMode : [];
  const openModeCount = visibleModes.filter((mode) => mode.state === "OPEN_FOR_ORDERS").length;
  const operationalLabel = store.publicationState !== "published" ? "غير منشور"
    : currentOperationalReadback === "unavailable" ? "حالة التشغيل غير متاحة"
    : !currentOperationalReadback ? "التحقق من التشغيل…"
    : openModeCount === 0 ? "مغلق"
    : openModeCount < visibleModes.length ? "مفتوح جزئيًا" : "مفتوح";
  const recordView = useAdaptiveRecordView();
  const openEditor = () => { setActiveTab("identity"); openManagement(); };
  const selectTab = (tab: string) => {
    const group = ({ orders: "operations", hours: "operations", products: "catalog", promotions: "catalog",
      basics: "identity", branches: "identity", coverage: "identity", customers: "quality",
      ratings: "quality", history: "documents" } as Record<string, string>)[tab] ?? tab;
    setActiveTab(group);
    // Customer activity is read-only: expanding would remount the split record panel and reset this tab.
    if (group !== "overview" && group !== "quality") recordView?.expandForEditing();
    document.querySelector(".adaptive-record-sheet .workspace-side-drawer-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const tabs: ReadonlyArray<readonly [string, string]> = [
    ["overview", "نظرة عامة"], ["operations", "التشغيل والطلبات"],
    ["catalog", "المنتجات والعروض"], ["identity", "بيانات المتجر"],
    ["quality", "العملاء والجودة"], ["documents", "الوثائق والسجل"],
    ...(canViewMarketplaceFinance ? [["finance", "المالية"] as const] : []),
  ];
  const overview = (
    <section className="store-profile-overview">
    {canViewMarketplaceOperations ? <section id="store-profile-overview" className="store-profile-kpis" aria-label="مؤشرات طلبات المتجر">
      <div className="store-profile-kpi"><div><span>طلبات تحتاج متابعة</span><strong>{currentOrderSummary?.actionableCount ?? "—"}</strong></div></div>
      <div className="store-profile-kpi"><div><span>بانتظار الإسناد</span><strong>{currentOrderSummary?.awaitingDispatchCount ?? "—"}</strong></div></div>
      <div className="store-profile-kpi"><div><span>الطلبات النشطة</span><strong>{currentOrderSummary?.activeCount ?? "—"}</strong></div></div>
    </section> : store.relationModel === "INDEPENDENT_STORE" ? <p role="status" className="store-profile-muted">هذا متجر مستقل؛ لا تُعرض له مؤشرات طلبات سوق بثواني أو إسناد الكباتن.</p> : null}

    <section className="store-profile-alert" data-ready={ready} aria-label="جاهزية نشر المتجر" id="store-onboarding-readiness">
      <div>
        <strong>{isMarketplaceStore ? ready ? "متطلبات النشر مكتملة" : "متطلبات نشر تحتاج متابعة" : "الموقع المستقل غير منشور للعامة"}</strong>
        <p>حالة النشر: {publication}. {isMarketplaceStore ? ready ? "تُحدد إمكانية استقبال الطلبات بصورة مستقلة وفق حالة التشغيل." : "العوائق: " + (blockers.length || 1) : "جاهزية سوق بثواني لا تمنح إذن نشر موقع مستقل أو استقبال طلبات مباشرة."}</p>
      </div>
      {!ready && blockers.length ? <details className="store-profile-readiness-detail">
        <summary>عرض أسباب عدم الجاهزية</summary>
        <ul>{blockers.map((reason) => <li key={reason}>{publicationReadinessBlockedReasonLabel(reason)}</li>)}</ul>
      </details> : null}
    </section>

    <StoreInventorySummary storeId={store.id} onOpenCatalog={() => selectTab("catalog")} />
    <div className="store-profile-content store-sheet-dashboard">
      <div className="store-profile-information"><ProfileCard title="بيانات المتجر" icon="⌂">
        <dl className="store-profile-facts">
          <Fact label="المالك"><Link href={"/partners/actors/" + encodeURIComponent(store.partnerActorId)}>{store.partnerName || caseView?.ownerFullName || "ملف الشريك"}</Link></Fact>
          <Fact label="المدينة">{store.serviceCityName || "غير محددة"}</Fact>
          <Fact label="النشاط">{store.primaryVerticalName || "غير محدد"}</Fact>
        </dl>
        {partnerError ? <p className="store-profile-minor-error">{partnerError}</p> : null}
      </ProfileCard></div>
      {canViewMarketplaceOperations ? <div className="store-profile-readiness"><ProfileCard title="طلبات المتجر" icon="▤">
        <StoreOperationsPreview storeId={store.id} compact onSummary={recordOrderSummary} />
      </ProfileCard></div> : null}
      <div className="store-profile-access"><ProfileCard title="حالة حساب الشريك" icon="○">
        <div className="store-profile-state-row"><span>حساب المالك</span><strong>{accountState}</strong></div>
        <Link className="store-profile-action-link" href={"/partners/actors/" + encodeURIComponent(store.partnerActorId)}>فتح ملف الشريك ←</Link>
      </ProfileCard></div>
    </div>
    </section>
  );
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
            <div className="store-profile-identity-meta"><span className="store-sheet-state" data-status={isMarketplaceStore ? store.publicationState : "unpublished"}>{publication} {isMarketplaceStore ? <PublicationIndicator state={store.publicationState} /> : null}</span>{canViewMarketplaceOperations ? <button type="button" className="store-profile-operating-state" data-state={openModeCount > 0 && store.publicationState === "published" ? "open" : "closed"} onClick={() => selectTab("operations")} aria-label={"حالة استقبال الطلبات: " + operationalLabel + "، فتح التشغيل"}>{operationalLabel}</button> : null}</div>
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
    <div className="store-profile-navigation" data-has-finance={canViewMarketplaceFinance}>
      <Tabs id="store-profile" aria-label={"\u0623\u0642\u0633\u0627\u0645 \u0645\u0644\u0641 \u0627\u0644\u0645\u062a\u062c\u0631"} className="store-profile-sections" activeKey={activeTab} onChange={selectTab} size="small" tabBarGutter={8}
        items={tabs.map(([key, label]) => ({
          key,
          label: <><OperationalIcon name={profileTabIcons[key] ?? "review"}/>{label}</>,
          forceRender: key === "overview",
          children: key === "overview" ? <>{overview}<StoreProfileTabs activeTab="overview" store={store} partner={partner} partnerError={partnerError}
            canViewFinance={canViewMarketplaceFinance} canViewOperations={canViewOperations} manageOpen={manageOpen} openManagement={openEditor} management={management} onUpdated={onUpdated} onSelectTab={selectTab}/></> :
            activeTab === key ? <StoreProfileTabs activeTab={key} store={store} partner={partner} partnerError={partnerError}
              canViewFinance={canViewMarketplaceFinance} canViewOperations={canViewOperations} manageOpen={manageOpen} openManagement={openEditor} management={management} onUpdated={onUpdated} onSelectTab={selectTab}/> : null,
        }))}/>
    </div>
  </div>;
}
