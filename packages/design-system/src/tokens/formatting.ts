/** Convert Arabic-Indic and Eastern Arabic-Indic numerals to ASCII digits. */
export function toAsciiDigits(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0x660 && codePoint <= 0x669) return String(codePoint - 0x660);
    if (codePoint >= 0x6f0 && codePoint <= 0x6f9) return String(codePoint - 0x6f0);
    return character;
  }).join("");
}

/** Normalize a Yemeni local or international phone number to E.164. */
export function normalizeYemenPhoneE164(value: string): string {
  let phone = toAsciiDigits(value).trim().replace(/[\s\-()]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  else if (phone.startsWith("967")) phone = `+${phone}`;
  else if (/^0[1-9]\d{8}$/.test(phone)) phone = `+967${phone.slice(1)}`;
  else if (/^7\d{8}$/.test(phone)) phone = `+967${phone}`;
  return phone;
}
