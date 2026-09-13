export async function partnerErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  switch (body?.error?.code) {
    case "PARTNER_NOT_FOUND": return "لم يتم العثور على دور شريك نشط بهذا الرقم.";
    case "PARTNER_NOT_ACTIVE": return "يجب تفعيل دور الشريك قبل تهيئة المتجر.";
    case "IDEMPOTENCY_CONFLICT": return "مفتاح العملية مستخدم لطلب مختلف. أعد بدء الطلب بمفتاح جديد.";
    case "PARTNER_ALREADY_BOOTSTRAPPED": return "تمت تهيئة المتجر الأول لهذا الشريك مسبقًا.";
    case "FORBIDDEN": return "هذا الإجراء متاح لموظف لوحة التحكم المصرح فقط.";
    case "READINESS_BLOCKED": return "لا يمكن نشر المتجر قبل اجتياز جاهزية النشر الحالية.";
    case "IDENTITY_UNAVAILABLE": return "تعذر التحقق من أهلية هوية الشريك حاليًا. أعد المحاولة بعد عودة Identity.";
    case "VERSION_CONFLICT": return "تغيرت حالة النشر من عملية أخرى. أعد قراءة الحالة ثم حاول مرة أخرى.";
    case "STORE_NOT_FOUND":
    case "NOT_FOUND": return "لم يعد المتجر موجودًا في الحالة الكانونية.";
    case "DSH_UNAVAILABLE": return "خدمة DSH غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    default: return "تعذر تنفيذ عملية تهيئة الشريك. تحقق من البيانات ثم أعد المحاولة.";
  }
}
