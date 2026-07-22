export function hasCustomerIdentity(name: string, phone: string) {
  return Boolean(name.trim() || phone.trim());
}
