"use client";

import { joiningCaseStateLabel, orderStateLabel, type JoiningCaseSummary, type OperatorOperationListItem } from "@bthwani/dsh";
import Link from "next/link";
import { useEffect, useState } from "react";
import { responseMessage } from "../access/identity-error-message";
import "./operator-home.module.css";

export function OperatorHome() {
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [joiningCases, setJoiningCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/operations?limit=8", { cache: "no-store" }),
      fetch("/api/partners/joining-cases?state=submitted&limit=8", { cache: "no-store" }),
    ]).then(async ([operationsResponse, joiningCasesResponse]) => {
      if (!operationsResponse.ok) throw new Error(await responseMessage(operationsResponse));
      if (!joiningCasesResponse.ok) throw new Error(await responseMessage(joiningCasesResponse));
      const operationsBody = await operationsResponse.json() as { operations?: ReadonlyArray<OperatorOperationListItem> };
      const joiningCasesBody = await joiningCasesResponse.json() as { cases?: ReadonlyArray<JoiningCaseSummary> };
      if (active) {
        setOperations(operationsBody.operations ?? []);
        setJoiningCases(joiningCasesBody.cases ?? []);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "تعذر قراءة مركز العمل.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">مركز العمل الحالي</p>
        <h1 id="workspace-title">الرئيسية</h1>
        <p className="lead">تجمع هذه الصفحة الأعمال التي تحتاج انتباه المشغل الآن من قراءات DSH الكانونية، دون مؤشرات تحليلية مخترعة.</p>
      </div>
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة مركز العمل</strong><p>{error}</p></div> : null}
      {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تجهيز مركز العمل</strong></div> : null}
      {!loading && !error ? (
        <div className="home-work-areas">
          <section className="access-card home-work-area" aria-labelledby="home-operations-title">
            <div className="access-card-heading"><p className="eyebrow">التشغيل</p><h2 id="home-operations-title">أعمال الطلبات الحالية</h2><p className="muted">افتح مركز العمليات لاتخاذ قرار التوزيع أو معالجة فشل التسليم.</p></div>
            {operations.length === 0 ? <p className="empty-inline">لا توجد أعمال تشغيلية تحتاج عرضًا في القراءة الحالية.</p> : <ul className="home-list">{operations.slice(0, 4).map((item) => <li key={item.orderId}><Link href={`/operations/${encodeURIComponent(item.orderId)}`}><span><strong>{item.storeName}</strong><small>طلب يحتاج متابعة</small></span><strong>{orderStateLabel(item.state)}</strong></Link></li>)}</ul>}
            <Link className="button button-secondary home-area-link" href="/operations">فتح العمليات</Link>
          </section>
          <section className="access-card home-work-area" aria-labelledby="home-joining-title">
            <div className="access-card-heading"><p className="eyebrow">الشركاء</p><h2 id="home-joining-title">طلبات الانضمام قيد المراجعة</h2><p className="muted">استأنف طلبًا من الطابور القانوني ثم اعرض المتجر والنشر من تفاصيل الحالة.</p></div>
            {joiningCases.length === 0 ? <p className="empty-inline">لا توجد طلبات انضمام في حالة المراجعة الآن.</p> : <ul className="home-list">{joiningCases.slice(0, 4).map((item) => <li key={item.id}><Link href="/partners"><span><strong>{item.businessName}</strong><small>طلب شريك قيد المتابعة</small></span><strong>{joiningCaseStateLabel(item.state)}</strong></Link></li>)}</ul>}
            <Link className="button button-secondary home-area-link" href="/partners">فتح الشركاء</Link>
          </section>
        </div>
      ) : null}
    </section>
  );
}
