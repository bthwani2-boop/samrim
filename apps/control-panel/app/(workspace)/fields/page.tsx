import { FieldAdmissionPanel } from "../../../src/features/field/field-admission-panel";

export default function FieldsPage() {
  return (
    <section className="workspace-page" aria-labelledby="fields-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">الشركاء</p>
        <h1 id="fields-page-title">قبول الميدان</h1>
        <p className="lead">أنشئ واعتمد ملفات DSH قبل منح الدور، ثم أدر وصول الحسابات وأهليتها من سجل موحّد.</p>
      </div>
      <FieldAdmissionPanel />
    </section>
  );
}
