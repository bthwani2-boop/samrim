import { isOperatorActorId } from "@bthwani/identity";
import { redirect } from "next/navigation";
import { currentOriginalOperatorPermissions } from "../../server/current-operator-access";
import styles from "../operator-shell/operator-shell.module.css";
import OperatorPermissionSummary from "./operator-permission-summary";
import OperatorWorkspaceGate from "./operator-workspace-gate";

export default async function AccessWorkspace({ searchParams }: Readonly<{
  searchParams: Promise<{ actorId?: string | string[] }>;
}>) {
  const original = await currentOriginalOperatorPermissions();
  if (!original) return <OperatorWorkspaceGate hasWorkspace />;
  const { actorId } = await searchParams;
  if (isOperatorActorId(actorId)) redirect(`/access/operators/${actorId}`);
  return (
    <main className={styles.workspace}>
      <h1>الوصول والصلاحيات</h1>
      <form action="/access" method="get">
        <label htmlFor="operator-review-actor">معرّف مشغّل في Identity</label>{" "}
        <input id="operator-review-actor" name="actorId" type="text" dir="ltr" required
          maxLength={128} spellCheck={false} autoComplete="off" />{" "}
        <button type="submit">عرض الصلاحيات</button>
      </form>
      {actorId !== undefined && <p role="alert">أدخل معرّف مشغّل صالحًا.</p>}
      <h2>صلاحيات حسابك</h2>
      <OperatorPermissionSummary permissions={original.permissions} />
    </main>
  );
}
