import { isOperatorActorId } from "@bthwani/identity";
import { reviewOperatorPermissions } from "../../server/current-operator-access";
import styles from "../operator-shell/operator-shell.module.css";
import OperatorPermissionForm from "./operator-permission-form";
import OperatorPermissionSummary from "./operator-permission-summary";
import OperatorWorkspaceGate from "./operator-workspace-gate";

export default async function OperatorPermissionEditor({ actorId }: Readonly<{ actorId: string }>) {
  const review = isOperatorActorId(actorId)
    ? await reviewOperatorPermissions(actorId)
    : { status: "invalid" } as const;
  if (review.status === "denied") return <OperatorWorkspaceGate hasWorkspace />;
  const errors = {
    notFound: "لا يوجد مشغّل نشط بهذا المعرّف.",
    invalid: "معرّف المشغّل غير صالح.",
    unavailable: "تعذّرت قراءة الصلاحيات من Identity. أعد تحميل الصفحة للمحاولة.",
  };
  return (
    <main className={styles.workspace}>
      <a href="/access">الوصول والصلاحيات</a>
      <h1>صلاحيات المشغّل</h1>
      {review.status === "available" ? (
        <>
          <p>معرّف المشغّل <bdi>{actorId}</bdi></p>
          <OperatorPermissionSummary permissions={review.permissions} />
          {actorId !== review.originalActorId && (
            <OperatorPermissionForm actorId={actorId} originalActorId={review.originalActorId}
              permissions={review.permissions} />
          )}
        </>
      ) : <p role="alert">{errors[review.status]}</p>}
    </main>
  );
}
