import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function StoreAccess({ title = "تفويض المتجر" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="فحص تفويض Store بعد تحقق هوية الممثل والعضوية القانونية لدى DSH." owner="DSH" />;
}
