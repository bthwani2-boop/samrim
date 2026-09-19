/** Convert Arabic-Indic and Eastern Arabic-Indic numerals to ASCII digits. */
export function toAsciiDigits(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0x660 && codePoint <= 0x669) return String(codePoint - 0x660);
    if (codePoint >= 0x6f0 && codePoint <= 0x6f9) return String(codePoint - 0x6f0);
    return character;
  }).join("");
}
