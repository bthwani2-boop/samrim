import { CaptainReadiness } from "../../src/features/captain-operations/captain-readiness";
import { CaptainOpportunities } from "../../src/features/captain-operations/captain-opportunities";
import { CaptainScrollScreen } from "../../src/shell/captain-shell";

export default function CaptainHomeRoute() {
  return <CaptainScrollScreen><CaptainReadiness /><CaptainOpportunities /></CaptainScrollScreen>;
}
