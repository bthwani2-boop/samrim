"use client";

import {
  fulfillmentModeLabel, joiningCaseStateLabel, publicationStateLabel,
  type JoiningCaseView, type StorePublicationResponse,
} from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import type { ReactNode } from "react";
import { StoreAvailabilityControls } from "./store-availability-controls";
import { StoreBranchesPreview } from "./store-branches-preview";
import { StoreModeControls } from "./store-mode-controls";
import { StoreOperationsPreview } from "./store-operations-preview";

type Store = StorePublicationResponse["store"];
type Props = Readonly<{
  activeTab: string;
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

function Panel({ id, activeTab, children }: Readonly<{ id: string; activeTab: string; children: ReactNode }>) {
  const selected = activeTab === id;
  return <section id={`store-profile-panel-${id}`} role="tabpanel"
    aria-labelledby={`store-profile-tab-${id}`} hidden={!selected} className="store-profile-tab-panel">
    {selected ? children : null}
  </section>;
}
function Card({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <section className="store-profile-card"><header className="store-profile-card-header"><h3>{title}</h3></header>{children}</section>;
}
function Fact({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <div className="store-profile-fact"><dt>{title}</dt><dd>{children}</dd></div>;
}
function DateFact({ title, value }: Readonly<{ title: string; value: string }>) {
  return <Fact title={title}><time dateTime={value}>{new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium" }).format(new Date(value))}</time></Fact>;
}

/** All existing management capabilities are reachable, but only three top-level sections remain. */
export function StoreProfileTabs({
  activeTab, store, partner, partnerError, canViewFinance, canViewOperations,
  manageOpen, openManagement, management, onUpdated,
}: Props) {
  const joining = partner?.joiningCase;
  const account = partner?.partner;
  return <>
    <Panel id="operations" activeTab={activeTab}>
      {canViewOperations ? <div className="store-profile-tab-grid store-profile-focused-grid">
        <Card title="استقبال الطلبات وساعات العمل">
          <StoreAvailabilityControls storeId={store.id} enabledModes={store.fulfillmentModes} />
        </Card>
        <Card title="طرق تنفيذ الطلب">
          <StoreModeControls store={store} onUpdated={onUpdated} />
        </Card>
        <Card title="طلبات المتجر">
          <StoreOperationsPreview storeId={store.id} />
          <Link className="store-profile-action-link" href={`/operations?storeId=${encodeURIComponent(store.id)}`}>فتح مركز العمليات ←</Link>
        </Card>
      </div> :
        <p className="store-profile-muted" role="status">ليست لديك صلاحية عرض العمليات لهذا المتجر.</p>}
    </Panel>

    <Panel id="identity" activeTab={activeTab}>
      <div className="store-profile-tab-grid store-profile-focused-grid">
        <Card title="بيانات المتجر">
          <dl className="store-profile-facts">
            <Fact title="اسم المتجر">{store.name}</Fact>
            <Fact title="المدينة">{store.serviceCityName || "غير محددة"}</Fact>
            <Fact title="النشاط">{store.primaryVerticalName || "غير محدد"}</Fact>
            <Fact title="حالة النشر">{publicationStateLabel(store.publicationState)}</Fact>
            <Fact title="طرق التوصيل المعتمدة">{store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"}</Fact>
            <DateFact title="تاريخ الإنشاء" value={store.createdAt} />
            <DateFact title="آخر تعديل" value={store.updatedAt} />
          </dl>
          <button type="button" className="button button-secondary" onClick={openManagement}>تعديل بيانات المتجر</button>
        </Card>
        <Card title="الشريك والاعتمادات">
          <dl className="store-profile-facts">
            <Fact title="مالك المتجر">
              <Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`}>{store.partnerName || joining?.ownerFullName || "ملف المالك"}</Link>
            </Fact>
            {account?.phoneE164 ? <Fact title="الهاتف"><bdi dir="ltr">{account.phoneE164}</bdi></Fact> : null}
            <Fact title="حالة الحساب">{partnerError ? "تعذر قراءة الحساب" : !account ? "غير متاح" : account.enabled ? "نشط" : "موقوف"}</Fact>
            {joining ? <>
              <Fact title="حالة طلب الانضمام">{joiningCaseStateLabel(joining.state)}</Fact>
              <Fact title="إثبات المتجر">{joining.firstStoreProofImageUploaded ? "مرفوع" : "غير مرفوع"}</Fact>
              <Fact title="صورة المراجعة">{joining.reviewPhotoUploaded ? "مرفوعة" : "غير مرفوعة"}</Fact>
            </> : null}
          </dl>
          {joining ? <Link className="store-profile-action-link" href={`/partners/${encodeURIComponent(joining.id)}`}>فتح ملف الانضمام والوثائق ←</Link> : null}
          {!joining && partnerError ? <p role="alert" className="store-profile-minor-error">{partnerError}</p> : null}
        </Card>
        {store.deliveryOrigin ? <Card title="موقع المتجر">
          <a className="store-profile-action-link" href={`https://www.google.com/maps?q=${store.deliveryOrigin.latitude},${store.deliveryOrigin.longitude}`} target="_blank" rel="noopener noreferrer">عرض موقع المتجر على الخريطة ↗</a>
        </Card> : null}
        <Card title="المتاجر المرتبطة">
          <StoreBranchesPreview actorId={store.partnerActorId} currentStoreId={store.id} />
        </Card>
      </div>
      {manageOpen ? <section id="store-inline-management" className="store-profile-management" aria-label="تحرير بيانات المتجر">
        {management}
      </section> : null}
    </Panel>

    {activeTab === "overview" ? <nav className="store-profile-context-links" aria-label="الوظائف المرتبطة بالمتجر">
      <Link href={`/operations?storeId=${encodeURIComponent(store.id)}`}>العمليات <span aria-hidden="true">←</span></Link>
      <Link href={`/catalog?storeId=${encodeURIComponent(store.id)}`}>الكتالوج <span aria-hidden="true">←</span></Link>
      <Link href={`/marketing?storeId=${encodeURIComponent(store.id)}`}>العروض والتسويق <span aria-hidden="true">←</span></Link>
      {canViewFinance ? <Link href={`/finance/partner-store-commissions?storeId=${encodeURIComponent(store.id)}`}>المالية <span aria-hidden="true">←</span></Link> : null}
    </nav> : null}
  </>;
}
