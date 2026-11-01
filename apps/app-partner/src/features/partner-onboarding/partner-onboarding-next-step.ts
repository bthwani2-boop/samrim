import type { JoiningCaseView } from "@bthwani/dsh";
import type { StoreAgreementReadback } from "./store-agreement-readiness";

type StoreSetupFacts = Readonly<{
  ownsStore: boolean;
  canEditCatalog: boolean;
  canManageAvailability: boolean;
  publicationState: string;
  catalogReady: boolean | null;
  agreement: StoreAgreementReadback;
  operationalKnown: boolean;
  operationalState: string;
}>;

export type StoreSetupFocus = Readonly<{
  title: string;
  detail: string;
  href: "/products" | "/store?section=settings" | "/store?section=operations" | null;
}>;

// Excluded steps are outside this actor's scope; unknown steps stay in the denominator.
export function storeReadinessProgress(steps: readonly (boolean | null)[]) {
  return {
    total: steps.length,
    completed: steps.filter(step => step === true).length,
    unknown: steps.filter(step => step === null).length,
  };
}

// This is guidance, never a substitute for DSH/WLT publication or orderability checks.
// Unknown data does not count as completion, and a closed schedule is not a fault.
export function nextStoreSetupFocus(facts: StoreSetupFacts): StoreSetupFocus | null {
  if (facts.ownsStore && facts.agreement === "AWAITING_PARTNER") {
    return { title: "راجع الاتفاقية التجارية", detail: "راجع الشروط المالية واقبلها إن وافقت عليها. الاعتماد النهائي للمالية.", href: "/store?section=settings" };
  }
  if (facts.canEditCatalog && facts.catalogReady === false) {
    return { title: "جهّز منتجات المتجر", detail: "أضف منتجًا متاحًا بسعر صحيح ليتمكن العملاء من الطلب بعد النشر.", href: "/products" };
  }
  if (facts.ownsStore) {
    if (facts.agreement === "AWAITING_FINANCE") {
      return { title: "بانتظار اعتماد المالية", detail: "تم قبول الاتفاقية. لا يلزم تقديم قبول جديد؛ أكمل بقية الإعدادات أثناء المراجعة.", href: null };
    }
    if (facts.agreement === "NOT_ACTIVE") {
      return { title: "بانتظار مقترح الاتفاقية", detail: "يتولى قسم الشركاء إعداد الشروط التجارية. لا تنشأ اتفاقية تلقائيًا.", href: null };
    }
    if (facts.agreement === null || facts.agreement === "UNAVAILABLE") {
      return { title: "تعذر التحقق من الاتفاقية", detail: "راجع قسم الاتفاقية وأعد قراءة بياناتها قبل متابعة النشر.", href: "/store?section=settings" };
    }
    if (facts.publicationState !== "published") {
      return { title: "راجع متطلبات نشر المتجر", detail: "تحقق من الشعار والغلاف وساعات العمل وبيانات المتجر قبل طلب النشر.", href: "/store?section=settings" };
    }
  }
  if (facts.canManageAvailability && facts.operationalKnown && facts.operationalState === "متوقف مؤقتًا") {
    return { title: "راجع إيقاف استقبال الطلبات", detail: "المتجر متوقف مؤقتًا؛ افتح إعدادات التشغيل لتقييم استئناف الاستقبال.", href: "/store?section=operations" };
  }
  return null;
}

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
