import { PageHeader } from "../../../src/shell/page-header";
import { FieldAdmissionPanel } from "../../../src/features/field/field-admission-panel";

export default function FieldsPage() {
  return (
    <section className="workspace-page" aria-labelledby="fields-page-title">
      <PageHeader id="fields-page-title" title="الميدانيون" />
      <FieldAdmissionPanel />
    </section>
  );
}

export const metadata = { title: "الميدانيون" };
