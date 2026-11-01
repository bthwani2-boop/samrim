import { parseStudioThemePublication } from "@bthwani/design-system/theme";
import { NextResponse } from "next/server";
import { requestDshJson } from "../../../../src/server/dsh/dsh-bff";

const noStore = { "Cache-Control": "no-store" };

/**
 * A read-only same-origin projection of DSH's public publication.
 * Theme publication never requires an operator session or exposes unpublished drafts.
 */
export async function GET() {
  try {
    const result = await requestDshJson<unknown>("GET", "/dsh/public/studio-theme", undefined, {});
    const publication = parseStudioThemePublication(result.payload);
    if (!publication) {
      return NextResponse.json({ error: { code: "INVALID_PUBLICATION" } }, { status: 502, headers: noStore });
    }
    return NextResponse.json(publication, { headers: noStore });
  } catch {
    return NextResponse.json({ error: { code: "STUDIO_THEME_UNAVAILABLE" } }, { status: 503, headers: noStore });
  }
}
