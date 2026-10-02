import { expect, request, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CDPClient, type CDPSession as MonocartCDPSession } from "monocart-coverage-reports";
import { addCoverageReport } from "monocart-reporter";

const test = base.extend<{ sonarCoverage: void }>({
  sonarCoverage: [async ({ page }, use) => {
    if (process.env.BTHWANI_SONAR_COVERAGE !== "1") {
      await use();
      return;
    }

    const session = await page.context().newCDPSession(page);
    const client = await CDPClient({ session: session as unknown as MonocartCDPSession });
    if (!client) throw new Error("Control Panel browser coverage client could not attach to Chromium");
    await client.startJSCoverage();
    try {
      await use();
    } finally {
      const coverage = await client.stopJSCoverage();
      await session.detach();
      await addCoverageReport(coverage, test.info());
    }
  }, { auto: true }],
});

export { expect, request, test };
export type { Page };
