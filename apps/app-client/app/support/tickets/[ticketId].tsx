import { Redirect, useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../../../src/navigation/ClientRouteScreen";
export default function TicketRoute() {
  const { ticketId: rawTicketId } = useLocalSearchParams<{ ticketId?: string | string[] }>();
  const ticketId = singleRouteParam(rawTicketId);
  if (!ticketId) return <Redirect href="/support" />;
  return <ClientRouteScreen route={{ kind: "support-ticket", ticketId }} />;
}
