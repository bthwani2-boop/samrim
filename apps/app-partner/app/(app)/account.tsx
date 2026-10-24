import { Redirect, type Href } from "expo-router";

/** Preserve old account links; settings now live in More. */
export default function PartnerAccountRoute() {
  return <Redirect href={"/more" as Href} />;
}
