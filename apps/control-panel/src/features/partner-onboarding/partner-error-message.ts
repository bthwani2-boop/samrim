export async function partnerErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  switch (body?.error?.code) {
    case "PARTNER_NOT_FOUND": return "لم يتم العثور على دور شريك بهذا الرقم.";
    case "PARTNER_NOT_ACTIVE": return "لا يمكن اعتماد الحالة قبل تفعيل دور الشريك.";
    case "JOINING_CASE_EXISTS": return "توجد حالة انضمام نشطة لهذا الرقم بالفعل.";
	case "ACTOR_CONFLICT": return "هوية الشريك مرتبطة بحالة انضمام أخرى.";
	case "ACTOR_REBIND_FORBIDDEN": return "لا يمكن تغيير هوية الشريك بعد ربطها بالحالة.";
    case "STATE_CONFLICT": return "لا تسمح حالة الانضمام الحالية بهذه العملية.";
    case "INVALID_INPUT": return "بيانات العملية غير صالحة.";
    case "STORE_EXISTS": return "لدى الشريك Store قانوني بالفعل.";
    case "IDEMPOTENCY_CONFLICT": return "مفتاح العملية مستخدم لطلب مختلف. أعد بدء الطلب بمفتاح جديد.";
    case "FORBIDDEN": return "هذا الإجراء متاح لموظف لوحة التحكم المصرح فقط.";
    case "READINESS_BLOCKED": return "لا يمكن نشر المتجر قبل اجتياز جاهزية النشر الحالية.";
    case "IDENTITY_UNAVAILABLE": return "تعذر التحقق من أهلية هوية الشريك حاليًا. أعد المحاولة بعد عودة Identity.";
    case "VERSION_CONFLICT": return "تغيرت حالة النشر من عملية أخرى. أعد قراءة الحالة ثم حاول مرة أخرى.";
    case "STORE_NOT_FOUND":
    case "NOT_FOUND": return "لم يعد المتجر موجودًا في الحالة الكانونية.";
    case "DSH_UNAVAILABLE": return "خدمة DSH غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    default: return "تعذر تنفيذ عملية انضمام الشريك. تحقق من الحالة ثم أعد المحاولة.";
  }
}
