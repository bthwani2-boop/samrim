/** Normalize a Yemeni local or international phone number for Identity-facing forms. */
export function normalizeYemenPhoneE164(value: string): string {
  const digits = value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
  let phone = digits.trim().replace(/[\s\-()]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  else if (phone.startsWith("967")) phone = "+" + phone;
  else if (/^0[1-9]\d{8}$/.test(phone)) phone = "+967" + phone.slice(1);
  else if (/^7\d{8}$/.test(phone)) phone = "+967" + phone;
  return phone;
}
