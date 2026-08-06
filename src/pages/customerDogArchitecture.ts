export type CustomerDogServiceDomain =
  | "hotel"
  | "training"
  | "daycare"
  | "consultation";

export interface CustomerDogServiceStatus {
  dogId: string;
  domain: CustomerDogServiceDomain;
  label: string;
  detail: string | null;
  status: string;
  sourceEntityId: string;
}

export interface CustomerTimelineEntry {
  id: string;
  customerId: string;
  dogId: string;
  dogName: string;
  domain: CustomerDogServiceDomain;
  occurredAt: string;
  title: string;
  detail: string | null;
  sourceEntityId: string;
}

export interface FamilyBookingDraft {
  customerId: string;
  dogs: Array<{
    dogId: string;
    stayId?: string;
  }>;
  sharedMemo?: string;
}

export interface LongStayContractDraft {
  customerId: string;
  dogIds: string[];
  validFrom: string;
  validUntil: string;
  terms?: string;
  linkedStayIds: string[];
}

export interface RoomOccupancyCapacityDraft {
  roomId: string;
  occupancyCapacity: number;
}

export interface RoomOccupancyStateDraft {
  roomId: string;
  occupancyCapacity: number;
  occupiedDogCount: number;
  activeAllocationIds: string[];
}

const combinedDogNameDelimiter = /[,，、;；/\\&＋+\n]/;

export function isSingleDogProfileName(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 && !combinedDogNameDelimiter.test(normalized);
}

export function customerDogCountById(
  dogs: Array<{ customerId: string | null; active: boolean }>,
) {
  const counts = new Map<string, number>();
  dogs.forEach((dog) => {
    if (!dog.active || !dog.customerId) return;
    counts.set(dog.customerId, (counts.get(dog.customerId) ?? 0) + 1);
  });
  return counts;
}

export function customerServiceCounts(
  dogIds: string[],
  services: CustomerDogServiceStatus[],
) {
  const ids = new Set(dogIds);
  const counts = { hotel: 0, training: 0, daycare: 0 };
  const counted = new Set<string>();
  services.forEach((service) => {
    if (!ids.has(service.dogId)) return;
    if (service.domain === "consultation") return;
    const key = `${service.domain}:${service.dogId}`;
    if (counted.has(key)) return;
    counted.add(key);
    counts[service.domain] += 1;
  });
  return counts;
}

export function customerServiceDogNames(
  dogs: Array<{ id: string; name: string }>,
  services: CustomerDogServiceStatus[],
) {
  const namesByDogId = new Map(dogs.map((dog) => [dog.id, dog.name]));
  const grouped = { hotel: [] as string[], training: [] as string[], daycare: [] as string[] };
  const seen = new Set<string>();
  services.forEach((service) => {
    if (service.domain === "consultation") return;
    const dogName = namesByDogId.get(service.dogId);
    if (!dogName) return;
    const key = `${service.domain}:${service.dogId}`;
    if (seen.has(key)) return;
    seen.add(key);
    grouped[service.domain].push(dogName);
  });
  return grouped;
}

export function compactDogNames(names: string[]) {
  if (!names.length) return "";
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}마리`;
}

export function preferredDogService(
  dogId: string,
  services: CustomerDogServiceStatus[],
) {
  const priority: Record<CustomerDogServiceDomain, number> = {
    hotel: 0,
    training: 1,
    daycare: 2,
    consultation: 3,
  };
  return services
    .filter((service) => service.dogId === dogId)
    .sort((left, right) => priority[left.domain] - priority[right.domain])[0] ?? null;
}
