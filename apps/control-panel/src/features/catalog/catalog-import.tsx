import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function CatalogImport({ title = "استيراد الكتالوج" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="فحص المدخلات ومعاينة الأخطاء قبل أي استيراد موثّق إلى DSH." owner="DSH" />;
}
