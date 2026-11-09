import type { StorePublicContact } from "@bthwani/dsh";

type PublicContactFields = Pick<StorePublicContact, "phoneE164" | "email" | "whatsappEnabled" | "whatsappPhoneE164">;
export type PublicContactAction = Readonly<{ label: string; href: string; icon: "account" | "notifications" }>;

// Only approved, public Store contact fields may become user-initiated external links.
export function buildPublicContactActions(contact: PublicContactFields): PublicContactAction[] {
  const actions: PublicContactAction[] = [];
  const phone = contact.phoneE164 ?? "";
  if (/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    actions.push({ label: "اتصال بالمتجر", href: "tel:" + phone, icon: "account" });
  }
  const email = contact.email ?? "";
  const atSign = email.indexOf("@");
  const domain = email.slice(atSign + 1);
  const dot = domain.indexOf(".");
  const validEmail = atSign > 0 && atSign === email.lastIndexOf("@") &&
    dot > 0 && dot < domain.length - 1 &&
    !Array.from(email).some((character) => /[\s?#/%]/u.test(character));
  if (validEmail) {
    actions.push({ label: "مراسلة المتجر", href: "mailto:" + encodeURIComponent(email), icon: "notifications" });
  }
  const whatsApp = contact.whatsappPhoneE164 ?? "";
  if (contact.whatsappEnabled && /^\+[1-9][0-9]{7,14}$/.test(whatsApp)) {
    actions.push({ label: "واتساب المتجر", href: "https://wa.me/" + whatsApp.slice(1), icon: "account" });
  }
  return actions;
}
