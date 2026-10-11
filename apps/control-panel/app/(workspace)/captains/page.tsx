import { PageHeader } from "../../../src/shell/page-header";
import { CaptainAdmissionPanel } from "../../../src/features/captain/captain-admission-panel";

export default function CaptainsPage() {
  return (
    <section className="workspace-page" aria-labelledby="captains-page-title">
      <PageHeader id="captains-page-title" title="قبول الكباتن" />
      <CaptainAdmissionPanel />
    </section>
  );
}

export const metadata = { title: "قبول الكباتن" };
