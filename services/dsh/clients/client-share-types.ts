/** Private one-way, client-to-client shares. Not a chat or payment mandate. */
export type ClientShareKind = "STORE" | "OFFER" | "PROMOTION" | "CONTENT";
export type ClientShareMessage = "LOOK" | "LIKE" | "OFFER" | "TRY";
export type ClientShareSendRequest = Readonly<{
  recipientPhoneE164: string;
  contentKind: ClientShareKind;
  contentId: string;
  messageCode: ClientShareMessage;
}>;
export type ClientShareSendResponse = Readonly<{ accepted: boolean }>;
export type ClientShareEntry = Readonly<{
  id: number;
  senderActorId: string;
  contentKind: ClientShareKind;
  contentId: string;
  storeId: string;
  productId: string;
  messageCode: ClientShareMessage;
  createdAt: string;
  readAt: string | null;
}>;
export type ClientSharePage = Readonly<{
  items: ReadonlyArray<ClientShareEntry>;
  unreadCount: number;
  nextBefore: number;
}>;

export function clientShareMessageLabel(code: ClientShareMessage): string {
  switch (code) {
    case "LIKE": return "قد يعجبك";
    case "OFFER": return "استفد من هذا";
    case "TRY": return "خلينا نجربه";
    default: return "شوف هذا";
  }
}
