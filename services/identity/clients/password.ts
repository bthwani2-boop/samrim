/**
 * Canonical client-side password input shape validator.
 * Validates exact Unicode code-point length (8 as entered; no normalization), non-whitespace, and optional confirmation matching.
 * Full security validation (blocklists and Argon2id hashing) remains server authority.
 */
export function countUnicodeRunes(text: string): number {
  return Array.from(text).length;
}

export type PasswordShapeValidationResult = Readonly<{
  valid: boolean;
  code?: "EMPTY" | "TOO_SHORT" | "TOO_LONG" | "MISMATCH" | undefined;
  message?: string | undefined;
}>;

export const PASSWORD_LENGTH = 8;

export function limitPasswordInput(password: string): string {
  return Array.from(password).slice(0, PASSWORD_LENGTH).join("");
}

export function validatePasswordInputShape(password: string, confirmation?: string): PasswordShapeValidationResult {
  if (!password?.trim()) {
    return { valid: false, code: "EMPTY", message: "كلمة المرور مطلوبة" };
  }
  const length = countUnicodeRunes(password);
  if (length !== PASSWORD_LENGTH) {
    return { valid: false, code: length < PASSWORD_LENGTH ? "TOO_SHORT" : "TOO_LONG", message: `كلمة المرور يجب أن تكون ${PASSWORD_LENGTH} أحرف بالضبط` };
  }
  if (confirmation !== undefined && password !== confirmation) {
    return { valid: false, code: "MISMATCH", message: "كلمتا المرور غير متطابقتين" };
  }
  return { valid: true };
}
