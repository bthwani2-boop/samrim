import { CaptainAdmissionPanel } from "../../../src/features/captain/captain-admission-panel";

export default function CaptainsPage() {
  return (
    <section className="workspace-page" aria-labelledby="captains-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">العمليات</p>
        <h1 id="captains-page-title">قبول الكباتن</h1>
        <p className="lead">أنشئ أهلية كابتن من خلال DSH ثم اعرض نتيجة القبول المقروءة. التوزيع والاستعادة مكانهما في العمليات.</p>
      </div>
      <CaptainAdmissionPanel />
    </section>
  );
}
