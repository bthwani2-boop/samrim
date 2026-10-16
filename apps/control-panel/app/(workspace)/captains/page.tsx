import { CaptainAdmissionPanel } from "../../../src/features/captain/captain-admission-panel";
import { PageHeader } from "../../../src/shell/page-header";

export default function CaptainsPage() {
  return (
    <section className="workspace-page" aria-labelledby="captains-page-title">
      <PageHeader id="captains-page-title" title="الكباتن — السجل والإدارة" />
      <CaptainAdmissionPanel />
    </section>
  );
}

export const metadata = { title: "الكباتن — السجل والإدارة" };
