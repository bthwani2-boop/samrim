import { CustomerProfile } from "../../../../src/features/customers/customer-profile";

export default async function CustomerPage({ params }: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await params;
  return <CustomerProfile actorId={actorId} />;
}
export const metadata = { title: "ملف العميل" };
