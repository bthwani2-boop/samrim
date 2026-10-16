"use client";

import { fulfillmentModeLabel, type JoiningCaseView, joiningCaseStateLabel, publicationStateLabel, type StorePublicationResponse } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import type { ReactNode } from "react";
import { StoreAvailabilityControls } from "./store-availability-controls";
import { StoreBranchesPreview } from "./store-branches-preview";
import { StoreOffersPreview } from "./store-offers-preview";
import { StoreOperationsPreview } from "./store-operations-preview";

type Store = StorePublicationResponse["store"];
type StoreProfileTabsProps = Readonly<{
  activeTab: string;
  store: Store;
  partner: Readonly<{ partner: ActorRoleView; joiningCase: JoiningCaseView | null }> | null;
  partnerError: string;
  canViewFinance: boolean;
  canViewOperations: boolean;
  manageOpen: boolean;
  openManagement: () => void;
  management: ReactNode;
}>;

function Card({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <section className="store-profile-card"><header className="store-profile-card-header"><h3>{title}</h3></header>{children}</section>;
}
function Fact({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <div className="store-profile-fact"><dt>{title}</dt><dd>{children}</dd></div>;
}
function DateFact({ title, value }: Readonly<{ title: string; value: string }>) {
  return <Fact title={title}><time dateTime={value}>{new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}</time></Fact>;
}
function Unavailable({ title, reason }: Readonly<{ title: string; reason: string }>) {
  return <Card title={title}><div className="store-profile-empty"><span aria-hidden="true">◇</span><p>{reason}</p></div></Card>;
}
function Panel({ id, selected, children }: Readonly<{ id: string; selected: boolean; children: ReactNode }>) {
  return <section id={`store-profile-panel-${id}`} role="tabpanel" aria-labelledby={`store-profile-tab-${id}`} hidden={!selected}
    className="store-profile-tab-panel">{selected ? children : null}</section>;
}

const intakeWeekdays = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"] as const;

export function StoreProfileTabs({ activeTab, store, partner, partnerError, canViewFinance, canViewOperations, manageOpen, openManagement, management }: StoreProfileTabsProps) {
  const joining = partner?.joiningCase;
  const account = partner?.partner;
  const hasOrigin = Boolean(store.deliveryOrigin);
  const basicContent = <div className="store-profile-tab-grid">
    <Card title="الهوية والعلاقة بالشريك">
      <dl className="store-profile-facts">
        <Fact title="اسم المتجر">{store.name}</Fact>
        <Fact title="الشريك المالك">{store.partnerName || joining?.ownerFullName || "حساب مرتبط"}</Fact>
        <Fact title="مدينة الخدمة">{store.serviceCityName || "غير محددة"}</Fact>
        <Fact title="النشاط">{store.primaryVerticalName || "غير محدد"}</Fact>
        <Fact title="حالة الحساب">{partnerError ? "تعذرت قراءة الحساب" : !account ? "غير متاحة" : account.enabled ? "مفعّل لدى Identity" : "موقوف"}</Fact>
        {account?.phoneE164 ? <Fact title="رقم التواصل"><bdi dir="ltr">{account.phoneE164}</bdi></Fact> : null}
        <DateFact title="تاريخ الإنشاء" value={store.createdAt}/>
        <DateFact title="آخر تحديث" value={store.updatedAt}/>
      </dl>
    </Card>
    <Card title="حالة النشر وإمكانية تنفيذ الطلب">
      <dl className="store-profile-facts">
        <Fact title="حالة النشر">{publicationStateLabel(store.publicationState)}</Fact>
        <Fact title="جاهزية النشر">{store.publicationReadiness.ready ? "جاهز" : "غير جاهز"}</Fact>
        <Fact title="أوضاع التنفيذ">{store.fulfillmentModes.map(fulfillmentModeLabel).join(" · ") || "غير محددة"}</Fact>
      </dl>
      <button type="button" className="button button-primary" onClick={openManagement}>تحرير إعدادات المتجر والصور</button>
    </Card>
  </div>;

  return <>
    <Panel id="basics" selected={activeTab === "basics"}>
      {!manageOpen ? basicContent : null}
      {manageOpen ? <section id="store-inline-management" className="store-profile-management" aria-label="إدارة بيانات المتجر" >
        <header className="store-profile-card-header"><h3>تحرير المتجر</h3></header>{management}
      </section> : null}
    </Panel>

    <Panel id="orders" selected={activeTab === "orders"}>
      <div className="store-profile-tab-grid">
        <Card title="حالة استقبال الطلبات">
          <dl className="store-profile-facts">
            <Fact title="حالة نشر المتجر">{publicationStateLabel(store.publicationState)}</Fact>
            <Fact title="تنفيذ الطلبات">{store.fulfillmentModes.map(fulfillmentModeLabel).join(" · ") || "لم تُحدد طرق التنفيذ"}</Fact>
            <Fact title="جاهزية المتجر">{store.publicationReadiness.ready ? "جاهز" : "توجد متطلبات غير مكتملة"}</Fact>
          </dl>
        </Card>
        {canViewOperations ? <Card title="طلبات هذا المتجر"><StoreOperationsPreview storeId={store.id}/></Card> : <Unavailable title="طلبات المتجر" reason="قراءة الطلبات تتطلب صلاحية العمليات لدى المشغّل."/>}
      </div>
    </Panel>

    <Panel id="products" selected={activeTab === "products"}>
      <div className="store-profile-tab-grid">
        <Card title="المنتجات والأسعار والتوفر"><StoreOffersPreview storeId={store.id}/></Card>
      </div>
    </Panel>

    <Panel id="promotions" selected={activeTab === "promotions"}>
      <div className="store-profile-tab-grid">
        <Unavailable title="الحملات والخصومات" reason="لا تتوفر قراءة متجر مأذونة للحملات التسويقية والخصومات في هذا الملف حاليًا. لن تُعرض نسب خصم أو إيرادات غير مثبتة."/>
      </div>
    </Panel>

    <Panel id="branches" selected={activeTab === "branches"}>
      <div className="store-profile-tab-grid">
        <StoreBranchesPreview actorId={store.partnerActorId} currentStoreId={store.id}/>
      </div>
    </Panel>

    <Panel id="coverage" selected={activeTab === "coverage"}>
      <div className="store-profile-tab-grid">
        <Card title="موقع نقطة تنفيذ الطلب">
          {hasOrigin ? <>
            <div className="store-profile-map-frame"><iframe title={`موقع ${store.name}`} loading="lazy" referrerPolicy="no-referrer" src={`https://maps.google.com/maps?q=${store.deliveryOrigin?.latitude},${store.deliveryOrigin?.longitude}&z=14&output=embed`}/></div>
            <p className="store-profile-muted">نقطة المتجر لا تمثل وحدها حدود التغطية أو نطاقات الخدمة.</p>
          </> : <p className="store-profile-muted">لا يوجد موقع جغرافي مثبت لهذا المتجر.</p>}
        </Card>
        <Card title="خيارات توصيل المتجر">
          <dl className="store-profile-facts"><Fact title="المدينة">{store.serviceCityName || "غير محددة"}</Fact>
            <Fact title="طرق التنفيذ">{store.fulfillmentModes.map(fulfillmentModeLabel).join(" · ") || "غير محددة"}</Fact>
          </dl>
          <button type="button" className="button button-primary" onClick={openManagement}>ضبط أوضاع التنفيذ</button>
          <p className="store-profile-muted">حدود التغطية التفصيلية لا تعرض إلا بعد إضافة قراءة معتمدة من سياسة التغطية.</p>
        </Card>
      </div>
    </Panel>


    <Panel id="hours" selected={activeTab === "hours"}>
      {canViewOperations ? <StoreAvailabilityControls storeId={store.id} enabledModes={store.fulfillmentModes}/> :
        <Unavailable title="أوقات التشغيل وإدارة الاستقبال" reason="تعديل أوقات التشغيل وإيقاف استقبال الطلبات يتطلب صلاحية العمليات."/>}
      {joining?.firstStoreWorkingHours?.intervals.length ? <details className="store-intake-archive">
        <summary>ساعات الانضمام الأصلية (للمراجعة فقط)</summary>
        <p>هذه بيانات الطلب الأولي وليست أوقات التشغيل المعتمدة حاليًا.</p>
        <ul>{[...joining.firstStoreWorkingHours.intervals].sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.opensAt.localeCompare(right.opensAt)).map((interval) =>
          <li key={`${interval.dayOfWeek}-${interval.opensAt}-${interval.closesAt}`}><span>{intakeWeekdays[interval.dayOfWeek - 1] ?? `اليوم ${interval.dayOfWeek}`}</span>
            <bdi dir="ltr">{interval.opensAt}–{interval.closesAt}{interval.closesNextDay ? " · ينتهي اليوم التالي" : ""}</bdi></li>)}</ul>
      </details> : null}
    </Panel>

    <Panel id="customers" selected={activeTab === "customers"}>
      <div className="store-profile-tab-grid">
        <Unavailable title="عملاء هذا المتجر" reason="لا توجد قراءة مصرح بها تُعيد عملاء المتجر وتكرار طلباتهم مع حدود خصوصية مناسبة. لا يُكشف العميل أو رقم هاتفه من سجل عام."/>
        <Card title="معلومات المتجر"><p className="store-profile-muted">عند توافر قراءة تحليلية آمنة ستظهر المقاييس الإجمالية ومعدل العودة والعملاء الجدد هنا، منفصلة عن هوية العميل الشخصية.</p></Card>
      </div>
    </Panel>

    <Panel id="documents" selected={activeTab === "documents"}>
      <div className="store-profile-tab-grid">
        <Card title="طلب الانضمام والمستندات">
          {joining ? <dl className="store-profile-facts">
            <Fact title="حالة الانضمام">{joiningCaseStateLabel(joining.state)}</Fact>
            <Fact title="نوع الإثبات">{joining.firstStoreProofType || "غير محدد"}</Fact>
            <Fact title="صورة الإثبات">{joining.firstStoreProofImageUploaded ? "مرفقة" : "غير مرفقة"}</Fact>
            <Fact title="صورة المراجعة">{joining.reviewPhotoUploaded ? "مرفقة" : "غير مرفقة"}</Fact>
          </dl> : <p className="store-profile-muted">{partnerError || "لا يظهر طلب انضمام مرتبط بهذا المتجر."}</p>}
          {joining ? <Link className="button button-secondary" href={`/partners/${encodeURIComponent(joining.id)}`}>فتح ملف الانضمام والوثائق</Link> : null}
          <p className="store-profile-muted">تظل صور الإثبات محمية؛ لا تعرض بدون قراءة وثيقة مخولة.</p>
        </Card>
        <Card title="أهلية النشر"><dl className="store-profile-facts"><Fact title="الجاهزية">{store.publicationReadiness.ready ? "مستوفٍ للشروط" : "غير مستوفٍ بعد"}</Fact>
          <Fact title="الحالة">{publicationStateLabel(store.publicationState)}</Fact></dl></Card>
      </div>
    </Panel>

    <Panel id="quality" selected={activeTab === "quality"}>
      <div className="store-profile-tab-grid">
        <Card title="مراجعة الجاهزية">
          <dl className="store-profile-facts">
            <Fact title="جاهزية النشر">{store.publicationReadiness.ready ? "جاهز للنشر" : "لم تكتمل الشروط"}</Fact>
            <Fact title="حالة النشر">{publicationStateLabel(store.publicationState)}</Fact>
            <Fact title="المستندات الأولية">{joining ? joining.firstStoreProofImageUploaded ? "تم رفع مستند إثبات" : "لم يُرفع إثبات" : "لا يوجد طلب انضمام في القراءة"}</Fact>
            <Fact title="صورة المراجعة">{joining?.reviewPhotoUploaded ? "مرفقة" : "غير مرفقة"}</Fact>
          </dl>
          <button type="button" className="button button-secondary" onClick={openManagement}>معالجة إعدادات المتجر</button>
        </Card>
        <Unavailable title="تقييم الجودة التشغيلي" reason="حالة استيفاء مستندات الانضمام تختلف عن تقييم الجودة الفعلي. لم تتوفر قراءة معتمدة لمراجعات الجودة الخاصة بهذا المتجر."/>
      </div>
    </Panel>

    <Panel id="ratings" selected={activeTab === "ratings"}>
      <div className="store-profile-tab-grid">
        <Unavailable title="تقييمات العملاء" reason="لا تتوفر قراءة مصرح بها لتقييمات عملاء هذا المتجر ومتوسطها وعددها. لا يمكن اعتماد تقييم ظاهر في نموذج تصميم على أنه بيانات النظام."/>
        <Card title="حماية الخصوصية"><p className="store-profile-muted">عند توافر عقد معتمد ستعرض مؤشرات التقييم وملاحظات العملاء المخوّل بها فقط، مع الفصل بين تقييم المنتج والمتجر والكابتن.</p></Card>
      </div>
    </Panel>

    <Panel id="history" selected={activeTab === "history"}>
      <div className="store-profile-tab-grid">
        <Card title="محطات موثوقة">
          <dl className="store-profile-facts">
            <DateFact title="إنشاء سجل المتجر" value={store.createdAt}/>
            <DateFact title="آخر تعديل في السجل" value={store.updatedAt}/>

          </dl>
        </Card>
        <Unavailable title="سجل الإجراءات التفصيلي" reason="هذه التواريخ ليست سجل تدقيق. يلزم ربط أحداث المالك المصرح بها قبل إظهار أسماء المشغلين أو تسلسل تغييرات النشر والبيانات."/>
      </div>
    </Panel>

    {canViewFinance ? <Panel id="finance" selected={activeTab === "finance"}>
      <div className="store-profile-tab-grid"><Unavailable title="الحسابات والتسويات" reason="قراءة الأرصدة والإيرادات وعمولات هذا المتجر تتطلب عقدًا ماليًا محميًا من WLT. لا تُعرض أرقام تجريبية هنا على أنها قيود حقيقية."/>
        <Card title="الحدود المالية"><p className="store-profile-muted">البيانات المالية مرئية فقط لمن يملك صلاحية المالية. عمليات التسوية لا تُنفذ تلقائيًا من صفحة المتجر.</p></Card></div>
    </Panel> : null}
  </>;
}
