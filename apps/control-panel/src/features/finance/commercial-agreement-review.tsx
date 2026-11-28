import { type CommercialAgreementReview, readOperatorCommercialAgreementReview } from "@bthwani/wlt";
import { cookies } from "next/headers";
import { currentOperatorAccess } from "../../server/current-operator-access";
import { OPERATOR_COOKIE } from "../../server/operator-passkey-config";
import styles from "../operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

const states = {
  AWAITING_MERCHANT_CONSENT: "بانتظار موافقة التاجر",
  AWAITING_FINANCE_REVIEW: "بانتظار مراجعة المالية",
  DECLINED: "رفض التاجر المقترح",
  FINANCE_REJECTED: "رفض المالية",
  REVIEW_APPROVED_PENDING_ACTIVATION: "تمت المراجعة — بانتظار التفعيل",
} as const;
const modes = { BTHWANI_CAPTAIN: "توصيل بثواني", PARTNER_CAPTAIN: "توصيل المتجر", CUSTOMER_PICKUP: "استلام من المتجر" } as const;
type Query = Record<string, string | string[] | undefined>;

export default async function CommercialAgreementReviewPage({ title, query }: Readonly<{ title: string; query: Query }>) {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("finance")) {
    return <WorkspaceUnavailable title={title} description="تتطلب مراجعة الشروط المالية صلاحية finance الحالية." owner="Identity" />;
  }
  const raw = query.storeId;
  const valid = Object.keys(query).every(key => key === "storeId") &&
    (raw === undefined || (typeof raw === "string" && /^[a-z0-9-]{1,64}$/.test(raw)));
  const storeId = valid && typeof raw === "string" ? raw : "";
  let result: CommercialAgreementReview | null = null;
  let message = valid ? "" : "معرّف المتجر أو معاملات البحث غير صالحة.";
  if (storeId) {
    const origin = process.env.OPERATOR_FINANCE_WLT_ORIGIN;
    const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
    // Never forward an Operator bearer to the Android alias or an unconfigured owner.
    if (!origin || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin) || !bearer) {
      message = "اتصال WLT المعزول غير مهيأ؛ لا يمكن إثبات حالة الاتفاقية.";
    } else {
      try {
        result = await readOperatorCommercialAgreementReview(origin,bearer,storeId,AbortSignal.timeout(5000));
      } catch {
        message = "رفض المالك القراءة أو تعذر التحقق من الاتفاقية. لا تُعرض بيانات غير مؤكدة.";
      }
    }
  }
  const proposal = result?.proposal;
  return (
    <main className={styles.workspace} aria-labelledby="agreement-heading">
      <h1 id="agreement-heading">{title}</h1>
      <p>قراءة أحدث مقترح وشروطه من WLT. المراجعة لا تعني تفعيل اتفاقية أو استحقاق مبلغ أو السماح بالتحصيل.</p>
      <form action="/finance/merchant-store-commissions" method="get" style={{ display:"flex",gap:"0.75rem",flexWrap:"wrap",alignItems:"end",marginBlock:"1rem" }}>
        <label style={{ display:"grid",gap:"0.25rem",flex:"1 1 15rem" }}>
          معرّف المتجر
          <input name="storeId" required maxLength={64} pattern="[a-z0-9\-]{1,64}" defaultValue={storeId} style={{minHeight:44,width:"100%"}} />
        </label>
        <button type="submit" style={{minHeight:44,paddingInline:"1rem",cursor:"pointer"}}>قراءة الاتفاقية</button>
      </form>
      {!storeId && !message ? <p role="status">حدد معرّف متجر لمراجعة مقترحه المالي.</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      {result && !proposal ? <p role="status" data-owner-readback="absent">لا يوجد مقترح اتفاقية مسجل لهذا المعرّف لدى WLT.</p> : null}
      {proposal && <section data-owner-readback="ready" aria-labelledby="agreement-review-heading">
        <h2 id="agreement-review-heading">أحدث مقترح مسجل — الإصدار {proposal.version}</h2>
        <p role="status">{states[proposal.reviewState]}</p>
        <dl className={styles.sectionGrid}>
          <div className={styles.sectionCard}><dt>المتجر</dt><dd dir="ltr">{storeId}</dd></div>
          <div className={styles.sectionCard}><dt>علاقة المتجر</dt><dd>{proposal.storeRelation === "MARKETPLACE" ? "السوق" : "مباشر"}</dd></div>
          <div className={styles.sectionCard}><dt>المقابل المقترح</dt><dd>{proposal.feeModel === "COMMISSION" ? `${proposal.commissionBasisPoints / 100}% عمولة` : `${proposal.subscriptionAmountYer} ريال يمني لكل ${proposal.subscriptionPeriodDays} يومًا`}</dd></div>
          <div className={styles.sectionCard}><dt>مسؤولية التحصيل المقترحة</dt><dd>{proposal.collector === "PLATFORM_MANAGED" ? "المنصة" : "المتجر"}</dd></div>
          <div className={styles.sectionCard}><dt>طرق التنفيذ المقترحة</dt><dd>{proposal.fulfillmentModes.map(mode=>modes[mode]).join("، ")}</dd></div>
          <div className={styles.sectionCard}><dt>موعد النفاذ المقترح (UTC)</dt><dd dir="ltr">{proposal.proposedEffectiveAt}</dd></div>
        </dl>
        <p>هذه شروط مقترحة وليست اتفاقية مفعّلة؛ لا توجد عملية خصم أو إصدار فاتورة من هذه الصفحة.</p>
      </section>}
    </main>
  );
}
