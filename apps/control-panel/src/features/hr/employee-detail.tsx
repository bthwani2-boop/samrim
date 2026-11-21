import { DshPublicError, getCompanyEmployee, isCompanyEmployeeId } from "@bthwani/dsh";
import shellStyles from "../operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";
import { employeeOwner } from "./employee-owner";
import styles from "./employees.module.css";

export default async function EmployeeDetail({ id }: Readonly<{ id: string }>) {
  const owner = await employeeOwner();
  if (owner.status !== "available") {
    const description = owner.status === "denied" ? "تتطلب سجلات الموظفين صلاحية الموارد البشرية من Identity."
      : "الاتصال بخدمة سجلات الموظفين غير متاح حاليًا.";
    return <WorkspaceUnavailable title="ملف الموظف" description={description} owner={owner.status === "denied" ? "Identity" : "DSH"} />;
  }
  if (!isCompanyEmployeeId(id)) return <UnavailableRecord message="معرّف سجل الموظف غير صالح." />;
  let record: Awaited<ReturnType<typeof getCompanyEmployee>>;
  try {
    record = await getCompanyEmployee(owner.origin, owner.bearer, id, AbortSignal.timeout(8000));
  } catch (error) {
    if (error instanceof DshPublicError) {
      if (error.status === 404 && error.code === "EMPLOYEE_NOT_FOUND") return <UnavailableRecord message="سجل الموظف غير موجود." />;
      if (error.status === 401 || error.status === 403) return <UnavailableRecord message="انتهت الجلسة أو تغيرت صلاحية الموارد البشرية." />;
    }
    return <UnavailableRecord message="تعذّرت قراءة سجل الموظف من DSH." />;
  }
  return (
    <main className={shellStyles.workspace} aria-labelledby="employee-heading">
      <a href="/hr/employees">موظفو بثواني</a>
      <h1 id="employee-heading">{record.displayName}</h1>
      <dl className={styles.details}>
        <dt>القسم</dt><dd>{record.department}</dd>
        <dt>المسمى الوظيفي</dt><dd>{record.jobTitle}</dd>
        <dt>بدء العمل</dt><dd><time dir="ltr" dateTime={record.startDate}>{record.startDate}</time></dd>
        {record.endDate ? <><dt>انتهاء العمل</dt><dd><time dir="ltr" dateTime={record.endDate}>{record.endDate}</time></dd></> : null}
        <dt>معرّف سجل الموظف</dt><dd><code dir="ltr">{record.id}</code></dd>
      </dl>
    </main>
  );
}

function UnavailableRecord({ message }: Readonly<{ message: string }>) {
  return <main className={shellStyles.workspace}><h1>ملف الموظف</h1><p role="alert">{message}</p>
    <a href="/hr/employees">موظفو بثواني</a></main>;
}
