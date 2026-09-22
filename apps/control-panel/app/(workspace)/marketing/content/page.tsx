"use client";

import { MarketingContentWorkspace, MarketingWorkspace } from "../../../../src/features/marketing/marketing-workspace";

export default function MarketingContentPage() {
  return <MarketingWorkspace resource="content"><MarketingContentWorkspace /></MarketingWorkspace>;
}
