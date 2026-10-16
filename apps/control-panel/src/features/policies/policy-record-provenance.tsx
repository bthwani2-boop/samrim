import type { DeliveryFeePolicy, FieldAcquisitionRewardPolicy, PartnerFinancialTermsPolicy } from "@bthwani/dsh";

type PolicyRecord = Pick<DeliveryFeePolicy | FieldAcquisitionRewardPolicy | PartnerFinancialTermsPolicy,
  "version" | "state" | "createdBy" | "createdAt">;

/** Read-only provenance of the CURRENT policy version, not a fabricated history timeline. */
export function PolicyRecordProvenance({ record }: Readonly<{ record: PolicyRecord }>) {
  const at = record.createdAt ? new Date(record.createdAt) : null;
  const timestamp = at && Number.isFinite(at.getTime())
    ? new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(at)
    : null;

  return <section className="policy-version-facts" aria-label="بيانات الإصدار المعتمد">
    <h3>الإصدار الحالي من السجل المالي</h3>
    <dl>
      <div><dt>الإصدار</dt><dd><bdi dir="ltr">v{record.version}</bdi></dd></div>
      <div><dt>حالة السجل</dt><dd>{record.state === "ACTIVE" ? "مفعّل في السجل المالي" : "متقاعد"}</dd></div>
      {timestamp ? <div><dt>تاريخ إنشاء هذا الإصدار</dt><dd><time dateTime={record.createdAt}>{timestamp}</time></dd></div> : null}
      {record.createdBy ? <div><dt>معرّف منفّذ التفعيل</dt><dd><bdi dir="ltr" title={record.createdBy}>{record.createdBy}</bdi></dd></div> : null}
    </dl>
    <p className="muted">هذه بيانات الإصدار الحالي فقط، وليست سجل التعديلات الكامل أو إثباتًا لتطبيق السياسة على الطلبات السابقة.</p>
  </section>;
}
