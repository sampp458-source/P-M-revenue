export function hasCustomerIdentity(name: string, phone: string) {
  return Boolean(name.trim() || phone.trim());
}

export interface CustomerIdentityRecord {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface DogIdentityRecord {
  id: string;
  customerId: string | null;
  name: string;
}

export const normalizeCustomerPhone = (phone: string | null | undefined) =>
  (phone ?? "").replace(/\D/g, "");

export function findCustomerPhoneDuplicate<T extends CustomerIdentityRecord>(
  customers: T[],
  phone: string,
) {
  const normalized = normalizeCustomerPhone(phone);
  if (!normalized) return null;
  return (
    customers.find(
      (customer) => normalizeCustomerPhone(customer.phone) === normalized,
    ) ?? null
  );
}

export function findDogNameDuplicate<T extends DogIdentityRecord>(
  dogs: T[],
  customerId: string,
  name: string,
) {
  const normalized = name.trim().toLocaleLowerCase("ko");
  if (!customerId || !normalized) return null;
  return (
    dogs.find(
      (dog) =>
        dog.customerId === customerId &&
        dog.name.trim().toLocaleLowerCase("ko") === normalized,
    ) ?? null
  );
}

export function buildSalePartyUpdate(customerId: string, dogId: string) {
  return {
    customer_id: customerId || null,
    dog_id: dogId || null,
    customer_name: null,
    customer_phone: null,
    dog_name: null,
  };
}
