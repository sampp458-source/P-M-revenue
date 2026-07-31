export const phoneDigits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 11);

export function formatPhone(value: string) {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function formatPhoneForDisplay(
  value: string | null | undefined,
): string {
  const original = value?.trim() ?? "";
  if (!original) return "";
  const digits = original.replace(/[^0-9]/g, "");
  if (!/^010[0-9]{8}$/.test(digits)) return original;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export const phoneLast4 = (value: string) => phoneDigits(value).slice(-4);

export const isValidPhone = (value: string) => /^010[0-9]{8}$/.test(phoneDigits(value));
