// Format checks for the checkout's phone and ZIP fields. They accept the
// common international shapes and refuse text that cannot be either.

/** 7 to 15 digits (E.164 allows 15), with an optional leading + and the usual separators. */
export function isPhoneNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?[0-9 ().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/** A postal code: 3 to 10 letters, digits, spaces or hyphens, with at least one digit. */
export function isPostalCode(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/.test(trimmed) && /\d/.test(trimmed);
}
