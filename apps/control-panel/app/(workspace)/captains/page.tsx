import { CaptainDispatchPanel } from "../../../src/features/captain/captain-dispatch-panel";

export default function CaptainsPage() {
  return (
    <section className="workspace-page" aria-labelledby="captains-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">التشغيل</p>
        <h1 id="captains-page-title">عمليات الكابتن</h1>
        <p className="lead">اقبل الكابتن من خلال صلاحية المشغل، ثم اعرض نتيجة القبول الكانونية بعد استجابة المنصة.</p>
      </div>
      <CaptainDispatchPanel />
    </section>
  );
}
