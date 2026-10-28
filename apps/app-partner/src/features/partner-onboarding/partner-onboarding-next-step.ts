import type { JoiningCaseView } from "@bthwani/dsh";

// Derive guidance only from the current canonical DSH joining-case state.
// Neither an approved intake nor a published Store implies orderability.
export function partnerOnboardingNextStep(state: JoiningCaseView["state"], hasStore: boolean): string {
  switch (state) {
    case "draft":
      return "الطلب مسودة. استكمل بيانات النشاط والموقع والإثباتات عبر مسار الانضمام المصرح به قبل إرساله للمراجعة.";
    case "admission_requested":
      return "الإحالة بانتظار تأكيد قسم الشركاء وربط الحساب؛ لا يعني ذلك نشر المتجر.";
    case "submitted":
      return "الملف قيد مراجعة قسم الشركاء. سيظهر هنا طلب التصحيح إن احتاج المتجر بيانات إضافية.";
    case "needs_correction":
      return "يرجى مراجعة سبب التصحيح واستكمال البيانات المطلوبة أدناه ثم إعادة إرسالها.";
    case "approved":
      return hasStore
        ? "تم اعتماد ملف الانضمام. جهّز الكتالوج والصور، وراجع الشروط التجارية الفعلية لمتجرك، ثم تابع جاهزيته للنشر."
        : "تم اعتماد الملف، لكن متجره لم يظهر في القراءة الحالية. أعد قراءة البيانات قبل متابعة التجهيز.";
    default:
      return "أعد قراءة حالة الانضمام من المنصة قبل اتخاذ إجراء جديد.";
  }
}
