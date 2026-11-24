import styles from "../../../../../src/features/operator-shell/operator-shell.module.css";
import WorkspaceUnavailable from "../../../../../src/features/operator-shell/workspace-unavailable";
import { publicationReviewHref } from "../../../../../src/features/stores/publication-review-query";
import StoreDetails from "../../../../../src/features/stores/store-details";
import { readOperatorPublicationReview } from "../../../../../src/server/operator-publication-review";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: Readonly<{
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { storeId } = await params;
  const review = await readOperatorPublicationReview(await searchParams, storeId);
  if (review.kind === "denied") return <WorkspaceUnavailable title="ملف المتجر"
    description="تتطلب القراءة صلاحية إدارة التجار الحالية من Identity." owner="Identity" />;

  const store = review.kind === "ready" ? review.page.items.find(item => item.id === storeId) : undefined;
  return <main className={styles.workspace}>
    <h1>ملف المتجر غير المنشور</h1>
    {store && review.kind === "ready" ? <StoreDetails store={store} scope={review.scope} /> : <>
      <p role="alert">{review.kind === "invalid" ? "اختر المتجر من قائمة المراجعة لفتح نطاق القراءة الصحيح."
        : review.kind === "ready" ? "تعذّر تأكيد هذا المتجر في صفحة المراجعة الحالية."
          : "تعذّر التحقق من بيانات المتجر لدى DSH."}</p>
      <a href={"scope" in review && review.scope.city ? publicationReviewHref(review.scope) : "/merchants/joining"}>
        العودة إلى مراجعة المتاجر
      </a>
    </>}
  </main>;
}
