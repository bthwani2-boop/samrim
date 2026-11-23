"use server";

import { DshPublicError, registerCompanyEmployee } from "@bthwani/dsh";
import { redirect } from "next/navigation";
import { employeeOwner } from "./employee-owner";

export async function registerEmployee(
  expectedActor: string, operationId: string, form: FormData,
): Promise<string> {
  const connection = await employeeOwner();
  if (connection.status === "denied" || (connection.status === "available" && connection.actorId !== expectedActor)) {
    return "تغيرت الجلسة أو انتهت صلاحية الموظفين. افتح الصفحة من جديد قبل المتابعة.";
  }
  if (connection.status === "unavailable") return "الاتصال بخدمة سجلات الموظفين غير متاح.";
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  let id: string;
  try {
    id = await registerCompanyEmployee(connection.origin, connection.bearer, {
      operationId, displayName: text("displayName"), department: text("department"),
      jobTitle: text("jobTitle"), startDate: text("startDate"),
    }, AbortSignal.timeout(8000));
  } catch (error) {
    if (error instanceof DshPublicError) {
      if (error.status === 400) return "راجع الاسم والقسم والمسمى الوظيفي وتاريخ بداية العمل.";
      if (error.status === 401 || error.status === 403) return "لم تعد الجلسة أو صلاحية الموظفين سارية.";
      if (error.status === 409) return "استُخدم هذا الطلب ببيانات مختلفة. راجع قائمة الموظفين قبل إنشاء طلب جديد.";
    }
    return "لم يصل تأكيد الحفظ من DSH. أعد الإرسال بالبيانات نفسها من هذه الصفحة.";
  }
  redirect(`/hr/employees/${id}`);
}
