import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import { CURRENT_ROOM_UNAVAILABLE, fetchCurrentSharedOccupancies, currentHotelRoomLabel, sharedCurrentRelations, validCurrentSharedRelation } from "./hotelCurrentPhysicalPresentation";
import { isMissingCustomerAddressColumn } from "../lib/customerAddressCapability";
import { supabase } from "../lib/supabase";
import {
  activeHotelAllocation,
  hotelStayDayPhase,
} from "./hotelOperationsUi";
import {
  fetchHotelOperationsSnapshot,
  type HotelOperationsSnapshot,
} from "./hotelOperationsRepository";
import {
  fetchOperationSchedulesForDay,
  seoulDateKey,
  type OperationSchedule,
} from "./operationsScheduleRepository";
import type {
  CustomerDogServiceDomain,
  CustomerDogServiceStatus,
  CustomerTimelineEntry,
} from "./customerDogArchitecture";

export interface CustomerDirectoryCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  memo: string | null;
  active: boolean;
  isDaycareStudent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDirectoryDog {
  id: string;
  customerId: string | null;
  name: string;
  breed: string | null;
  sex: "male" | "female" | null;
  birthDate: string | null;
  weight: number | null;
  neutered: boolean | null;
  memo: string | null;
  active: boolean;
}

export interface CustomerDogDirectoryData {
  customers: CustomerDirectoryCustomer[];
  dogs: CustomerDirectoryDog[];
  hotelSnapshot: HotelOperationsSnapshot | null;
  services: CustomerDogServiceStatus[];
  timeline: CustomerTimelineEntry[];
  recentUseByCustomerId: Map<string, string>;
  recentUseDetailByCustomerId: Map<string, CustomerRecentUse>;
  serviceStatusAvailable: boolean;
}

export interface CustomerRecentUse {
  occurredOn: string;
  dogId: string;
  dogName: string;
  domain: CustomerDogServiceDomain;
}

export interface CurrentCustomerDogServices {
  services: CustomerDogServiceStatus[];
  available: boolean;
}

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  address?: string | null;
  memo: string | null;
  is_active: boolean;
  is_daycare_student: boolean;
  created_at: string;
  updated_at: string;
}

interface DogRow {
  id: string;
  customer_id: string | null;
  name: string;
  breed: string | null;
  sex: "male" | "female" | null;
  birth_date: string | null;
  weight: number | string | null;
  neutered: boolean | null;
  memo: string | null;
  is_active: boolean;
}

interface SaleTimelineRow {
  id: string;
  dog_id: string | null;
  sale_date: string;
  created_at: string;
  business_unit_id: string;
  business_unit_name: string;
  product_name: string;
  status: string;
  cancellation_type: string | null;
}

const serviceDomain = (
  code: string | null | undefined,
  name = "",
  context = "",
): CustomerDogServiceDomain | null => {
  const normalized = `${code ?? ""} ${name} ${context}`.toLocaleLowerCase("ko");
  if (normalized.includes("consult") || normalized.includes("상담")) {
    return "consultation";
  }
  if (normalized.includes("hotel") || normalized.includes("호텔")) return "hotel";
  if (normalized.includes("training") || normalized.includes("교육")) return "training";
  if (normalized.includes("daycare") || normalized.includes("유치원")) return "daycare";
  return null;
};

async function fetchCustomers() {
  const result = await supabase
    .from("customers")
    .select("id, name, phone, address, memo, is_active, created_at, updated_at")
    .order("name");
  if (!isMissingCustomerAddressColumn(result.error)) {
    if (result.error) throw result.error;
    return (result.data ?? []) as CustomerRow[];
  }

  const legacyResult = await supabase
    .from("customers")
    .select("id, name, phone, memo, is_active, created_at, updated_at")
    .order("name");
  if (legacyResult.error) throw legacyResult.error;
  return (legacyResult.data ?? []).map((row) => ({
    ...row,
    address: null,
  })) as CustomerRow[];
}

async function fetchDogs() {
  const result = await supabase
    .from("dogs")
    .select(
      "id, customer_id, name, breed, sex, birth_date, weight, neutered, memo, is_active, is_daycare_student",
    )
    .order("name");
  if (result.error) throw result.error;
  return (result.data ?? []) as DogRow[];
}

async function fetchSalesTimeline() {
  const result = await supabase
    .from("sales")
    .select(
      "id, dog_id, sale_date, created_at, business_unit_id, business_unit_name, product_name, status, cancellation_type",
    )
    .not("dog_id", "is", null)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (result.error) throw result.error;
  return (result.data ?? []) as SaleTimelineRow[];
}

export function hotelServices(
  snapshot: HotelOperationsSnapshot,
  localDate: string,
  shared: readonly SharedHotelOccupancy[] | null,
  now = Date.now(),
): CustomerDogServiceStatus[] {
  const stays = new Map([...snapshot.stays, ...snapshot.unassignedFuture].map(stay => [stay.id, stay]));
  const services = new Map<string, CustomerDogServiceStatus>();
  const sharedStayIds = new Set((shared ?? []).flatMap(occupancy => occupancy.members.map(member => member.hotelStayId)));
  const sharedDogIds = new Set((shared ?? []).flatMap(o => o.members.filter(m => m.status === "active").map(m => m.dogId)));
  for (const stay of stays.values()) {
    if (stay.archivedAt || stay.checkedOutAt || sharedStayIds.has(stay.id)
      || (stay.checkedInAt && sharedDogIds.has(stay.dogId))) continue;
    const roomType = stay.capacityReservation?.roomTypeCode ?? stay.capacityReservation?.roomTypeName ?? "객실 미정";
    // Future/pre-check-in records retain reservation intent, not actual occupancy.
    const planned = !stay.checkedInAt ? activeHotelAllocation(stay) : null;
    services.set(stay.id, {
      dogId: stay.dogId, domain: "hotel", label: "호텔",
      detail: stay.checkedInAt ? currentHotelRoomLabel(stay, shared, now)
        : planned ? `${roomType} ${planned.roomName}` : roomType,
      status: hotelStayDayPhase(stay, localDate) ?? "예약", sourceEntityId: stay.id,
    });
  }
  for (const stayId of sharedStayIds) {
    const stay = stays.get(stayId);
    if (stay?.checkedOutAt || stay?.archivedAt) continue;
    const relations = sharedCurrentRelations(shared ?? [], stayId);
    const active = relations.filter(({ member }) => member.status === "active");
    if (!active.length) continue; // Completed/left members are not current services.
    const dogs = new Set(active.map(({ member }) => member.dogId));
    for (const dogId of dogs) {
      const relation = active[0];
      const proven = relations.length === 1 && dogs.size === 1
        && (!stay || stay.dogId === dogId) && validCurrentSharedRelation(relation, now);
      const key = `shared-dog:${dogId}`;
      const existing = services.get(key);
      services.set(key, {
        dogId, domain: "hotel", label: "호텔", sourceEntityId: stayId,
        detail: proven && !existing ? relation.occupancy.roomName : CURRENT_ROOM_UNAVAILABLE,
        status: proven && !existing ? "현재 배정 · 함께 투숙" : "함께 투숙 · 확인 필요",
      });
    }
  }
  return [...services.values()];
}

function scheduleStatus(schedule: OperationSchedule, now: number) {
  if (schedule.status === "completed") return "완료";
  const startsAt = new Date(schedule.startsAt).getTime();
  const endsAt = new Date(schedule.endsAt).getTime();
  if (startsAt <= now && now < endsAt) {
    return schedule.businessUnitCode === "daycare" ? "등원중" : "진행중";
  }
  return "오늘 예정";
}

function scheduleServices(schedules: OperationSchedule[]) {
  const now = Date.now();
  const services: CustomerDogServiceStatus[] = [];
  schedules
    .filter(
      (schedule) =>
        schedule.status !== "cancelled" &&
        (schedule.businessUnitCode === "training" ||
          schedule.businessUnitCode === "daycare"),
    )
    .forEach((schedule) => {
      schedule.dogs.forEach((dog) => {
        services.push({
          dogId: dog.id,
          domain: schedule.businessUnitCode as "training" | "daycare",
          label: schedule.businessUnitCode === "training" ? "교육" : "유치원",
          detail: schedule.title || schedule.scheduleTypeName,
          status: scheduleStatus(schedule, now),
          sourceEntityId: schedule.id,
        });
      });
    });
  return services;
}

function buildTimeline(
  dogs: CustomerDirectoryDog[],
  sales: SaleTimelineRow[],
  schedules: OperationSchedule[],
) {
  const dogsById = new Map(dogs.map((dog) => [dog.id, dog]));
  const timeline: CustomerTimelineEntry[] = [];

  sales.forEach((sale) => {
    if (
      sale.status === "cancelled" ||
      sale.cancellation_type === "entry_error" ||
      !sale.dog_id
    ) {
      return;
    }
    const dog = dogsById.get(sale.dog_id);
    const domain = serviceDomain(
      sale.business_unit_id,
      sale.business_unit_name,
      sale.product_name,
    );
    if (!dog?.customerId || !domain) return;
    timeline.push({
      id: `sale:${sale.id}`,
      customerId: dog.customerId,
      dogId: dog.id,
      dogName: dog.name,
      domain,
      occurredAt: `${sale.sale_date}T00:00:00+09:00`,
      title: sale.product_name,
      detail: sale.business_unit_name,
      sourceEntityId: sale.id,
    });
  });

  schedules
    .filter((schedule) => schedule.status !== "cancelled")
    .forEach((schedule) => {
      const domain = serviceDomain(
        schedule.businessUnitCode,
        schedule.businessUnitName ?? "",
        `${schedule.scheduleTypeName} ${schedule.title}`,
      );
      if (!domain) return;
      schedule.dogs.forEach((scheduleDog) => {
        const dog = dogsById.get(scheduleDog.id);
        if (!dog?.customerId) return;
        timeline.push({
          id: `schedule:${schedule.id}:${dog.id}`,
          customerId: dog.customerId,
          dogId: dog.id,
          dogName: dog.name,
          domain,
          occurredAt: schedule.startsAt,
          title: schedule.title,
          detail: schedule.scheduleTypeName,
          sourceEntityId: schedule.id,
        });
      });
    });

  return timeline.sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) ||
      right.id.localeCompare(left.id),
  );
}

export async function loadCustomerDogDirectory(): Promise<CustomerDogDirectoryData> {
  const localDate = seoulDateKey();
  const [customerRows, dogRows, salesResult, snapshotResult, scheduleResult, sharedResult] =
    await Promise.all([
      fetchCustomers(),
      fetchDogs(),
      fetchSalesTimeline().catch(() => [] as SaleTimelineRow[]),
      fetchHotelOperationsSnapshot(localDate).catch(() => null),
      fetchOperationSchedulesForDay(localDate).catch(() => null),
      fetchCurrentSharedOccupancies(localDate),
    ]);

  const customers = customerRows.map((row): CustomerDirectoryCustomer => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address ?? null,
    memo: row.memo,
    active: row.is_active,
    isDaycareStudent: row.is_daycare_student === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const dogs = dogRows.map((row): CustomerDirectoryDog => ({
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    breed: row.breed,
    sex: row.sex,
    birthDate: row.birth_date,
    weight: row.weight === null ? null : Number(row.weight),
    neutered: row.neutered,
    memo: row.memo,
    active: row.is_active,
  }));
  const schedules = scheduleResult ?? [];
  const services = [
    ...(snapshotResult ? hotelServices(snapshotResult, localDate, sharedResult) : []),
    ...scheduleServices(schedules),
  ];
  const recentUseByCustomerId = new Map<string, string>();
  const recentUseDetailByCustomerId = new Map<string, CustomerRecentUse>();
  const dogsById = new Map(dogs.map((dog) => [dog.id, dog]));
  salesResult.forEach((sale) => {
    if (
      sale.status === "cancelled" ||
      sale.cancellation_type === "entry_error" ||
      !sale.dog_id
    ) {
      return;
    }
    const dog = dogsById.get(sale.dog_id);
    const customerId = dog?.customerId;
    const domain = serviceDomain(
      sale.business_unit_id,
      sale.business_unit_name,
      sale.product_name,
    );
    if (!customerId || !dog || !domain) return;
    const current = recentUseByCustomerId.get(customerId);
    if (!current || sale.sale_date > current) {
      recentUseByCustomerId.set(customerId, sale.sale_date);
      recentUseDetailByCustomerId.set(customerId, {
        occurredOn: sale.sale_date,
        dogId: dog.id,
        dogName: dog.name,
        domain,
      });
    }
  });

  return {
    customers,
    dogs,
    hotelSnapshot: snapshotResult,
    services,
    timeline: buildTimeline(dogs, salesResult, schedules),
    recentUseByCustomerId,
    recentUseDetailByCustomerId,
    serviceStatusAvailable: snapshotResult !== null && scheduleResult !== null && sharedResult !== null,
  };
}

export async function loadCurrentCustomerDogServices(): Promise<CurrentCustomerDogServices> {
  const localDate = seoulDateKey();
  const [snapshotResult, scheduleResult, sharedResult] = await Promise.all([
    fetchHotelOperationsSnapshot(localDate).catch(() => null),
    fetchOperationSchedulesForDay(localDate).catch(() => null),
    fetchCurrentSharedOccupancies(localDate),
  ]);
  return {
    services: [
      ...(snapshotResult ? hotelServices(snapshotResult, localDate, sharedResult) : []),
      ...scheduleServices(scheduleResult ?? []),
    ],
    available: snapshotResult !== null && scheduleResult !== null && sharedResult !== null,
  };
}
