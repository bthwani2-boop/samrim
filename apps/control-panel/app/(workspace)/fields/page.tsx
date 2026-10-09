import { FieldAdmissionPanel } from "../../../src/features/field/field-admission-panel";

export default function FieldsPage() {
  return (
    <section className="workspace-page" aria-labelledby="fields-page-title">
      <div className="workspace-page-heading">
        <h1 id="fields-page-title">الميدانيون</h1>
      </div>
      <FieldAdmissionPanel />
    </section>
  );
}

export const metadata = { title: "الميدانيون" };
