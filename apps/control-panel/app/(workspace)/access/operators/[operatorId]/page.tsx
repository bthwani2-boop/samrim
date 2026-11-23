import OperatorPermissionEditor from "../../../../../src/features/access/operator-permission-editor";

export default async function Page({ params }: Readonly<{ params: Promise<{ operatorId: string }> }>) {
  return <OperatorPermissionEditor actorId={(await params).operatorId} />;
}
