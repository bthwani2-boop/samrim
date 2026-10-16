import { MarketingWorkspace } from "../../../../src/features/marketing/marketing-workspace";
import { MarketingContentWorkspace } from "../../../../src/features/marketing/marketing-content-workspace";

export default function MarketingContentPage() {
  return <MarketingWorkspace resource="content"><MarketingContentWorkspace /></MarketingWorkspace>;
}

export const metadata = { title: "محتوى الاكتشاف" };
