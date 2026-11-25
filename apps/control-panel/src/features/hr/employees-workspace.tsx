import { DshPublicError, isCompanyEmployeeId, listCompanyEmployees } from "@bthwani/dsh";
import shellStyles from "../operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";
import { employeeOwner } from "./employee-owner";
import EmployeeRegistration from "./employee-registration";
import styles from "./employees.module.css";
import { registerEmployee } from "./register-employee-action";

export default async function EmployeesWorkspace({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const owner = await employeeOwner();
  if (owner.status !== "available") {
    const description = owner.status === "denied" ? "تتطلب سجلات الموظفين صلاحية الموارد البشرية من Identity."
      : "الاتصال بخدمة سجلات الموظفين غير متاح حاليًا.";
    return <WorkspaceUnavailable title="الموظفون" description={description} owner={owner.status === "denied" ? "Identity" : "DSH"} />;
  }
  const query = await searchParams;
  const cursor = query.cursor;
  if (Object.keys(query).some(key => key !== "cursor") || (cursor !== undefined && !isCompanyEmployeeId(cursor))) {
    return <main className={shellStyles.workspace}><h1>موظفو بثواني</h1><p role="alert">رابط الصفحة غير صالح.</p>
      <a href="/hr/employees">صفحة الموظفين الأولى</a></main>;
  }
  let page: Awaited<ReturnType<typeof listCompanyEmployees>>;
  try {
    page = await listCompanyEmployees(owner.origin, owner.bearer, cursor, AbortSignal.timeout(8000));
  } catch (error) {
    const denied = error instanceof DshPublicError && (error.status === 401 || error.status === 403);
    const description = denied ? "انتهت الجلسة أو تغيرت صلاحية الموارد البشرية."
      : error instanceof DshPublicError && error.status === 404 ? "مسار سجلات الموظفين غير مفعّل في خدمة DSH المتصلة."
      : error instanceof DshPublicError && error.status === 502 ? "وصل رد من DSH تعذّر التحقق منه."
      : "تعذّرت قراءة سجلات الموظفين من DSH.";
    if (cursor && !denied) {
      return <main className={shellStyles.workspace}>
        <h1>موظفو بثواني</h1>
        <p role="alert">{description}</p>
        <a href="/hr/employees">صفحة الموظفين الأولى</a>
      </main>;
    }
    return <WorkspaceUnavailable title="الموظفون" owner={denied ? "Identity" : "DSH"}
      description={description} />;
  }
  const submit = registerEmployee.bind(null, owner.actorId);
  return (
    <main className={shellStyles.workspace} aria-labelledby="employees-heading">
      <h1 id="employees-heading">موظفو بثواني</h1>
      {!cursor ? <EmployeeRegistration key={owner.actorId} actorId={owner.actorId} submit={submit} /> : null}
      <h2>سجلات الموظفين</h2>
      {page.items.length === 0 ? <p role="status">{cursor ? "لا توجد سجلات أخرى." : "لم يُسجّل أي موظف حتى الآن."}</p> : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th scope="col">الموظف</th><th scope="col">القسم</th><th scope="col">المسمى الوظيفي</th><th scope="col">الحالة</th></tr></thead>
            <tbody>{page.items.map(employee => (
              <tr key={employee.id}>
                <td><a href={`/hr/employees/${employee.id}`}>{employee.displayName}</a></td>
                <td>{employee.department}</td><td>{employee.jobTitle}</td>
                <td>{employee.endDate ? "له تاريخ انتهاء" : "له سجل عمل مفتوح"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {cursor || page.nextCursor ? (
        <nav className={styles.pagination} aria-label="صفحات الموظفين">
          {cursor ? <a href="/hr/employees">الصفحة الأولى</a> : null}
          {page.nextCursor ? <a href={`/hr/employees?cursor=${page.nextCursor}`}>الصفحة التالية</a> : null}
        </nav>
      ) : null}
    </main>
  );
}
