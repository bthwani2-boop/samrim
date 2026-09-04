const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));

export function secureRandomId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function") {
    throw new TypeError("Secure randomness is unavailable in this runtime");
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const byte = (index: number): number => bytes[index]!;
  bytes[6] = (byte(6) & 0x0f) | 0x40;
  bytes[8] = (byte(8) & 0x3f) | 0x80;
  const hex = (index: number): string => HEX[byte(index)]!;
  return `${hex(0)}${hex(1)}${hex(2)}${hex(3)}-${hex(4)}${hex(5)}-${hex(6)}${hex(7)}-${hex(8)}${hex(9)}-${hex(10)}${hex(11)}${hex(12)}${hex(13)}${hex(14)}${hex(15)}`;
}
