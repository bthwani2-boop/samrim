import { PageHeader } from "../../../src/shell/page-header";
import Link from "next/link";
import { PartnerDirectory } from "../../../src/features/partner-onboarding/partner-directory";
import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";
export default function PartnersPage() {
  return (
    <PartnerOperatorBoundary>
      <section className="workspace-page" aria-labelledby="partners-page-title">
        <PageHeader id="partners-page-title" title="الشركاء" actions={<Link className="button button-primary" href="/partners/new">إضافة شريك</Link>} />
        <PartnerDirectory />
      </section>
    </PartnerOperatorBoundary>
  );
}

export const metadata = { title: "الشركاء" };
