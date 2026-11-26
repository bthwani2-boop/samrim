"use server";

import { type EmployeeRegistrationOutcome, employeeRegistrationErrorOutcome, normalizeEmployeeRegistrationDraft, registerCompanyEmployee } from "@bthwani/dsh";
import { employeeOwner } from "./employee-owner";

export type EmployeeRegistrationResult =
  | { status: "confirmed"; id: string; message: string }
  | { status: Exclude<EmployeeRegistrationOutcome, "confirmed">; message: string };

export async function registerEmployee(
  expectedActor: string, operationId: string, form: FormData,
): Promise<EmployeeRegistrationResult> {
  const connection = await employeeOwner();
  if (connection.status === "denied" || (connection.status === "available" && connection.actorId !== expectedActor)) {
    return { status: "denied", message: "تغيرت الجلسة أو انتهت صلاحية الموظفين. افتح الصفحة من جديد قبل المتابعة." };
  }
  if (connection.status === "unavailable") return { status: "unknown", message: "الاتصال بخدمة سجلات الموظفين غير متاح. أعد إرسال الطلب الأصلي دون تعديل البيانات." };
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  try {
    const id = await registerCompanyEmployee(connection.origin, connection.bearer, {
      operationId, ...normalizeEmployeeRegistrationDraft({ displayName: text("displayName"), department: text("department"),
        jobTitle: text("jobTitle"), startDate: text("startDate") }),
    }, AbortSignal.timeout(8000));
    return { status: "confirmed", id, message: "تم تأكيد حفظ سجل الموظف لدى DSH." };
  } catch (error) {
    const status = employeeRegistrationErrorOutcome(error);
    if (status === "invalid") return { status, message: "راجع الاسم والقسم والمسمى الوظيفي وتاريخ بداية العمل." };
    if (status === "denied") return { status, message: "لم تعد الجلسة أو صلاحية الموظفين سارية." };
    if (status === "conflict") return { status, message: "استُخدم هذا الطلب ببيانات مختلفة. راجع قائمة الموظفين قبل إنشاء طلب جديد." };
    return { status: "unknown", message: "لم يصل تأكيد الحفظ من DSH. أعد إرسال الطلب الأصلي دون تعديل البيانات أو مغادرة الصفحة." };
  }
}
