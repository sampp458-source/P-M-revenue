import { supabase } from "../lib/supabase";
import {
  fetchOperationSettings,
  type OperationCalendar,
  type OperationScheduleType,
} from "./operationsSettingsRepository";

export type OperationScheduleStatus = "scheduled" | "completed" | "cancelled";
export type OperationRole = "owner" | "manager" | "staff";
export type HotelScheduleEventKind = "check_in" | "check_out";

export interface OperationPerson {
  id: string;
  name: string | null;
  scheduleColor?: string | null;
  operationRole?: OperationRole | null;
}

export interface OperationCustomer extends OperationPerson {
  phone: string | null;
}

export interface OperationDog extends OperationPerson {
  name: string;
  customerId: string | null;
  breed?: string | null;
  sex?: "male" | "female" | null;
}

export interface OperationSchedule {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  calendarScope: "business_unit" | "common" | "personal";
  businessUnitCode: "daycare" | "training" | "hotel" | null;
  businessUnitName: string | null;
  scheduleTypeId: string;
  scheduleTypeName: string;
  scheduleTypeColor: string;
  title: string;
  memo: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeUnspecified: boolean;
  status: OperationScheduleStatus;
  version: number;
  requestId: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  archivedAt: string | null;
  hotelStayId?: string | null;
  hotelEventKind?: HotelScheduleEventKind | null;
  hotelRoomTypeName?: string | null;
  assignees: OperationPerson[];
  dogs: OperationDog[];
  customers: OperationCustomer[];
}

export interface OperationScheduleOptions {
  calendars: OperationCalendar[];
  scheduleTypes: OperationScheduleType[];
  assignees: OperationPerson[];
  customers: OperationCustomer[];
  dogs: OperationDog[];
}

export interface OperationScheduleInput {
  calendarId: string;
  scheduleTypeId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeUnspecified: boolean;
  memo: string;
  assigneeIds: string[];
  customerIds: string[];
  dogIds: string[];
}

export const DEFAULT_OPERATION_SCHEDULE_COLOR = "#2563EB";
const OPERATION_ASSIGNEE_COLOR_PALETTE = [
  "#2563EB",
  "#16A34A",
  "#7C3AED",
  "#EA580C",
  "#0891B2",
  "#DB2777",
  "#DC2626",
  "#92400E",
] as const;
const LEGACY_OPERATION_SCHEDULE_COLORS: Record<string, string> = {
  "#4568B2": "#2563EB",
  "#52B8D0": "#0891B2",
  "#C99845": "#EA580C",
  "#5B7FA3": "#2563EB",
  "#5C7C6F": "#16A34A",
  "#B56A6A": "#DC2626",
  "#7A6FB0": "#7C3AED",
  "#3F7F89": "#0891B2",
  "#B76E79": "#DB2777",
  "#7D8450": "#92400E",
  "#2E8B72": "#16A34A",
  "#C1763D": "#EA580C",
  "#6C63B5": "#7C3AED",
  "#2C879E": "#0891B2",
  "#B85C78": "#DB2777",
  "#75853B": "#16A34A",
  "#8B6A4C": "#92400E",
};

export function operationPersonColor(
  person: Pick<OperationPerson, "id" | "scheduleColor">,
) {
  if (person.scheduleColor?.match(/^#[0-9A-Fa-f]{6}$/)) {
    const storedColor = person.scheduleColor.toUpperCase();
    return LEGACY_OPERATION_SCHEDULE_COLORS[storedColor] ?? storedColor;
  }
  let hash = 0;
  for (const character of person.id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return OPERATION_ASSIGNEE_COLOR_PALETTE[
    hash % OPERATION_ASSIGNEE_COLOR_PALETTE.length
  ];
}

export function isOperationScheduleAssignedTo(
  schedule: Pick<OperationSchedule, "assignees">,
  profileId: string | null | undefined,
) {
  return Boolean(
    profileId && schedule.assignees.some((person) => person.id === profileId),
  );
}

export function canManageOperationSchedule(
  schedule: Pick<OperationSchedule, "assignees" | "createdBy">,
  profileId: string | null | undefined,
  operationRole: OperationRole | null | undefined,
) {
  if (!profileId) return false;
  return (
    operationRole === "owner" ||
    operationRole === "manager" ||
    schedule.createdBy === profileId ||
    isOperationScheduleAssignedTo(schedule, profileId)
  );
}

export function sortOperationSchedulesForViewer(
  schedules: OperationSchedule[],
  profileId: string | null | undefined,
) {
  const rank = (schedule: OperationSchedule) => {
    if (isOperationScheduleAssignedTo(schedule, profileId)) return 0;
    if (schedule.assignees.length === 0 || schedule.calendarScope === "common") {
      return 1;
    }
    return 2;
  };
  return [...schedules].sort((left, right) => {
    const allDayDifference =
      Number(Boolean(right.allDay)) - Number(Boolean(left.allDay));
    if (allDayDifference !== 0) return allDayDifference;
    const unspecifiedDifference =
      Number(Boolean(left.timeUnspecified)) -
      Number(Boolean(right.timeUnspecified));
    if (unspecifiedDifference !== 0) return unspecifiedDifference;
    const rankDifference = rank(left) - rank(right);
    if (rankDifference !== 0) return rankDifference;
    if (left.timeUnspecified && right.timeUnspecified) {
      return (
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    }
    const timeDifference =
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
    return (
      timeDifference ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function compareOperationScheduleChronology(
  left: OperationSchedule,
  right: OperationSchedule,
) {
  const allDayDifference =
    Number(Boolean(right.allDay)) - Number(Boolean(left.allDay));
  if (allDayDifference !== 0) return allDayDifference;
  const unspecifiedDifference =
    Number(Boolean(left.timeUnspecified)) -
    Number(Boolean(right.timeUnspecified));
  if (unspecifiedDifference !== 0) return unspecifiedDifference;
  if (left.timeUnspecified && right.timeUnspecified) {
    return (
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  }
  return (
    left.startsAt.localeCompare(right.startsAt) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function operationScheduleTimeLabel(
  schedule: Pick<
    OperationSchedule,
    "allDay" | "timeUnspecified" | "startsAt"
  >,
) {
  if (schedule.allDay) return "종일";
  if (schedule.timeUnspecified) return "시간 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(schedule.startsAt));
}

export function isHotelReservationSchedule(
  schedule: Pick<
    OperationSchedule,
    "hotelStayId" | "hotelEventKind"
  >,
) {
  return Boolean(
    schedule.hotelStayId &&
      (schedule.hotelEventKind === "check_in" ||
        schedule.hotelEventKind === "check_out"),
  );
}

export function isLegacyHotelSchedule(
  schedule: Pick<
    OperationSchedule,
    "businessUnitCode" | "archivedAt" | "status" | "hotelStayId" | "hotelEventKind"
  >,
) {
  return (
    schedule.businessUnitCode === "hotel" &&
    schedule.archivedAt === null &&
    schedule.status !== "cancelled" &&
    !isHotelReservationSchedule(schedule)
  );
}

export function operationScheduleDisplayTitle(
  schedule: Pick<
    OperationSchedule,
    "title" | "hotelEventKind" | "hotelRoomTypeName" | "dogs"
  >,
) {
  const eventLabel =
    schedule.hotelEventKind === "check_in"
      ? "입실"
      : schedule.hotelEventKind === "check_out"
        ? "퇴실"
        : null;
  if (eventLabel) {
    const dogName = schedule.dogs[0]?.name;
    return [dogName, "호텔링", schedule.hotelRoomTypeName, eventLabel]
      .filter(Boolean)
      .join(" · ");
  }
  return schedule.title;
}

export function shouldDisplayOperationSchedule(
  schedule: Pick<
    OperationSchedule,
    | "status"
    | "hotelStayId"
    | "hotelEventKind"
  >,
) {
  return !(
    schedule.status === "cancelled" && isHotelReservationSchedule(schedule)
  );
}

export function defaultOperationCalendarId(
  calendars: OperationCalendar[],
) {
  return (
    calendars.find((calendar) => calendar.scopeType === "common")?.id ??
    calendars[0]?.id ??
    ""
  );
}

export function defaultOperationScheduleTypeId(
  scheduleTypes: OperationScheduleType[],
) {
  return (
    scheduleTypes.find(
      (scheduleType) => scheduleType.name.trim().toLocaleLowerCase("ko-KR") === "기타",
    )?.id ??
    scheduleTypes[0]?.id ??
    ""
  );
}

interface ScheduleRpcRow {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  calendarScope: OperationSchedule["calendarScope"];
  businessUnitCode: OperationSchedule["businessUnitCode"];
  businessUnitName: string | null;
  scheduleTypeId: string;
  scheduleTypeName: string;
  scheduleTypeColor: string;
  title: string;
  memo: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeUnspecified?: boolean;
  status: OperationScheduleStatus;
  version: number;
  requestId: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  archivedAt: string | null;
  hotelStayId?: string | null;
  hotelEventKind?: HotelScheduleEventKind | null;
  hotelRoomTypeName?: string | null;
  assignees?: OperationPerson[];
  dogs?: Array<{ id: string; name: string; customerId: string | null }>;
  customers?: OperationCustomer[];
}

const mapSchedule = (row: ScheduleRpcRow): OperationSchedule => ({
  ...row,
  timeUnspecified: row.timeUnspecified ?? false,
  hotelStayId: row.hotelStayId ?? null,
  hotelEventKind: row.hotelEventKind ?? null,
  hotelRoomTypeName: row.hotelRoomTypeName ?? null,
  assignees: row.assignees ?? [],
  dogs: row.dogs ?? [],
  customers: row.customers ?? [],
});

const rpcInput = (input: OperationScheduleInput, requestId: string) => ({
  p_calendar_id: input.calendarId,
  p_schedule_type_id: input.scheduleTypeId,
  p_title: input.title,
  p_starts_at: input.startsAt,
  p_ends_at: input.endsAt,
  p_all_day: input.allDay,
  p_time_unspecified: input.timeUnspecified,
  p_memo: input.memo,
  p_assignee_ids: input.assigneeIds,
  p_customer_ids: input.customerIds,
  p_dog_ids: input.dogIds,
  p_request_id: requestId,
});

export class OperationScheduleRepositoryError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "permission"
      | "conflict"
      | "missing_foundation"
      | "unknown" = "unknown",
  ) {
    super(message);
  }
}

const throwScheduleError = (error: {
  code?: string;
  message?: string;
} | null) => {
  if (!error) return;
  if (error.code === "42501") {
    throw new OperationScheduleRepositoryError(
      "Operations 일정 권한이 없습니다.",
      "permission",
    );
  }
  if (error.code === "40001") {
    throw new OperationScheduleRepositoryError(
      "다른 사용자가 먼저 일정을 수정했습니다. 새로고침 후 다시 시도해 주세요.",
      "conflict",
    );
  }
  if (
    error.code === "42883" ||
    error.code === "42P01" ||
    error.message?.includes("schema cache")
  ) {
    throw new OperationScheduleRepositoryError(
      "Operations 일정 기반이 아직 적용되지 않았습니다.",
      "missing_foundation",
    );
  }
  throw new OperationScheduleRepositoryError(
    error.message || "Operations 일정을 처리하지 못했습니다.",
  );
};

const isOptionalAssigneeRpcMissing = (error: {
  code?: string;
  message?: string;
} | null) =>
  Boolean(
    error &&
      (error.code === "42883" ||
        error.code === "PGRST202" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("get_active_operation_assignees")),
  );

interface HotelScheduleLinkRow {
  hotel_stay_id: string;
  operation_schedule_id: string;
  event_kind: HotelScheduleEventKind;
}

interface HotelCapacityLinkRow {
  hotel_stay_id: string;
  room_type_id: string | null;
}

interface HotelRoomTypeNameRow {
  id: string;
  name: string;
}

async function attachHotelScheduleLinks(schedules: OperationSchedule[]) {
  const scheduleIds = schedules.map((schedule) => schedule.id);
  if (scheduleIds.length === 0) return schedules;

  const result = await supabase
    .from("hotel_stay_schedule_events")
    .select("hotel_stay_id, operation_schedule_id, event_kind")
    .in("operation_schedule_id", scheduleIds)
    .is("archived_at", null);
  throwScheduleError(result.error);

  const linkByScheduleId = new Map(
    ((result.data ?? []) as HotelScheduleLinkRow[]).map((link) => [
      link.operation_schedule_id,
      link,
    ]),
  );
  const hotelStayIds = [
    ...new Set(
      [...linkByScheduleId.values()].map((link) => link.hotel_stay_id),
    ),
  ];
  if (hotelStayIds.length === 0) return schedules;
  const [stayResult, capacityResult] = await Promise.all([
    supabase
      .from("hotel_stays")
      .select("id")
      .in("id", hotelStayIds)
      .is("archived_at", null),
    supabase
      .from("hotel_capacity_reservations")
      .select("hotel_stay_id, room_type_id")
      .in("hotel_stay_id", hotelStayIds)
      .is("archived_at", null),
  ]);
  throwScheduleError(stayResult.error ?? capacityResult.error);
  const activeStayIds = new Set(
    (stayResult.data ?? []).map((stay) => stay.id as string),
  );
  const capacityRows = (capacityResult.data ?? []) as HotelCapacityLinkRow[];
  const roomTypeIds = [
    ...new Set(
      capacityRows
        .map((capacity) => capacity.room_type_id)
        .filter(
          (roomTypeId): roomTypeId is string =>
            typeof roomTypeId === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              roomTypeId,
            ),
        ),
    ),
  ];
  const roomTypeResult =
    roomTypeIds.length > 0
      ? await supabase
          .from("hotel_room_types")
          .select("id, name")
          .in("id", roomTypeIds)
          .is("archived_at", null)
      : { data: [], error: null };
  throwScheduleError(roomTypeResult.error);
  const roomTypeNameById = new Map(
    ((roomTypeResult.data ?? []) as HotelRoomTypeNameRow[]).map((roomType) => [
      roomType.id,
      roomType.name,
    ]),
  );
  const roomTypeNameByStayId = new Map(
    capacityRows.map((capacity) => [
      capacity.hotel_stay_id,
      capacity.room_type_id
        ? (roomTypeNameById.get(capacity.room_type_id) ?? null)
        : null,
    ]),
  );
  return schedules
    .map((schedule) => {
      const link = linkByScheduleId.get(schedule.id);
      return link && activeStayIds.has(link.hotel_stay_id)
        ? {
            ...schedule,
            hotelStayId: link.hotel_stay_id,
            hotelEventKind: link.event_kind,
            hotelRoomTypeName:
              roomTypeNameByStayId.get(link.hotel_stay_id) ?? null,
          }
        : schedule;
    })
    .filter(shouldDisplayOperationSchedule);
}

export async function fetchLegacyHotelScheduleCandidates(
  anchor: OperationSchedule,
  options: OperationScheduleOptions,
) {
  const result = await supabase
    .from("operation_schedules")
    .select(
      "id, calendar_id, schedule_type_id, title, description, starts_at, ends_at, all_day, time_unspecified, status, version, request_id, created_by, created_at, updated_by, updated_at, archived_at",
    )
    .eq("calendar_id", anchor.calendarId)
    .eq("status", "scheduled")
    .is("archived_at", null)
    .order("starts_at")
    .order("created_at")
    .limit(500);
  throwScheduleError(result.error);
  const rows = (result.data ?? []) as ScheduleTableRow[];
  if (rows.length === 0) return [];

  const scheduleIds = rows.map((row) => row.id);
  const [assigneeResult, dogResult, customerResult] = await Promise.all([
    supabase.from("operation_schedule_assignees").select("schedule_id, profile_id")
      .in("schedule_id", scheduleIds).is("archived_at", null),
    supabase.from("operation_schedule_dogs").select("schedule_id, dog_id")
      .in("schedule_id", scheduleIds).is("archived_at", null),
    supabase.from("operation_schedule_customers").select("schedule_id, customer_id")
      .in("schedule_id", scheduleIds).is("archived_at", null),
  ]);
  throwScheduleError(
    assigneeResult.error ?? dogResult.error ?? customerResult.error,
  );
  const group = <T extends { schedule_id: string }>(items: T[]) => {
    const grouped = new Map<string, T[]>();
    items.forEach((item) => grouped.set(item.schedule_id, [
      ...(grouped.get(item.schedule_id) ?? []), item,
    ]));
    return grouped;
  };
  const assignees = group(assigneeResult.data ?? []);
  const dogs = group(dogResult.data ?? []);
  const customers = group(customerResult.data ?? []);
  const calendar = options.calendars.find((row) => row.id === anchor.calendarId);
  const scheduleTypes = new Map(options.scheduleTypes.map((row) => [row.id, row]));
  const people = new Map(options.assignees.map((row) => [row.id, row]));
  const dogDirectory = new Map(options.dogs.map((row) => [row.id, row]));
  const customerDirectory = new Map(options.customers.map((row) => [row.id, row]));
  const mapped = rows.map((row): OperationSchedule => {
    const scheduleType = scheduleTypes.get(row.schedule_type_id);
    return {
      id: row.id,
      calendarId: row.calendar_id,
      calendarName: calendar?.name ?? "호텔",
      calendarColor: calendar?.color ?? DEFAULT_OPERATION_SCHEDULE_COLOR,
      calendarScope: calendar?.scopeType ?? "business_unit",
      businessUnitCode: calendar?.businessUnitCode ?? null,
      businessUnitName: calendar?.businessUnitName ?? null,
      scheduleTypeId: row.schedule_type_id,
      scheduleTypeName: scheduleType?.name ?? "기타",
      scheduleTypeColor: scheduleType?.color ?? DEFAULT_OPERATION_SCHEDULE_COLOR,
      title: row.title,
      memo: row.description,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      timeUnspecified: row.time_unspecified,
      status: row.status,
      version: row.version,
      requestId: row.request_id,
      createdBy: row.created_by,
      createdByName: people.get(row.created_by)?.name ?? null,
      createdAt: row.created_at,
      updatedBy: row.updated_by,
      updatedByName: row.updated_by ? people.get(row.updated_by)?.name ?? null : null,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      hotelStayId: null,
      hotelEventKind: null,
      hotelRoomTypeName: null,
      assignees: (assignees.get(row.id) ?? []).map((item) => people.get(item.profile_id))
        .filter((item): item is OperationPerson => Boolean(item)),
      dogs: (dogs.get(row.id) ?? []).map((item) => dogDirectory.get(item.dog_id))
        .filter((item): item is OperationDog => Boolean(item)),
      customers: (customers.get(row.id) ?? []).map((item) => customerDirectory.get(item.customer_id))
        .filter((item): item is OperationCustomer => Boolean(item)),
    };
  });
  return (await attachHotelScheduleLinks(mapped)).filter(isLegacyHotelSchedule);
}

export function sortLegacyHotelCounterparts(
  anchor: OperationSchedule,
  schedules: OperationSchedule[],
  anchorKind: HotelScheduleEventKind,
) {
  const anchorDogIds = new Set(anchor.dogs.map((row) => row.id));
  const anchorCustomerIds = new Set(anchor.customers.map((row) => row.id));
  const anchorTime = new Date(anchor.startsAt).getTime();
  return schedules
    .filter((schedule) => {
      if (schedule.id === anchor.id || !isLegacyHotelSchedule(schedule)) return false;
      const candidateTime = new Date(schedule.startsAt).getTime();
      return anchorKind === "check_in"
        ? candidateTime > anchorTime
        : candidateTime < anchorTime;
    })
    .sort((left, right) => {
      const dog = (schedule: OperationSchedule) =>
        Number(!schedule.dogs.some((row) => anchorDogIds.has(row.id)));
      const customer = (schedule: OperationSchedule) =>
        Number(!schedule.customers.some((row) => anchorCustomerIds.has(row.id)));
      return dog(left) - dog(right) || customer(left) - customer(right) ||
        Math.abs(new Date(left.startsAt).getTime() - anchorTime) -
          Math.abs(new Date(right.startsAt).getTime() - anchorTime) ||
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    });
}

export async function fetchOperationSchedulesForDay(localDate: string) {
  const result = await supabase.rpc("get_operation_schedules_for_day", {
    p_local_date: localDate,
  });
  throwScheduleError(result.error);
  return attachHotelScheduleLinks(
    (((result.data ?? []) as ScheduleRpcRow[]) || []).map(mapSchedule),
  );
}

interface ScheduleTableRow {
  id: string;
  calendar_id: string;
  schedule_type_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  time_unspecified: boolean;
  status: OperationScheduleStatus;
  version: number;
  request_id: string;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  archived_at: string | null;
}

/**
 * 월간 캘린더용 읽기 전용 범위 조회.
 * 쓰기는 기존 Operations RPC만 사용하며, 이 조회는 기존 RLS를 그대로 따른다.
 */
export async function fetchOperationSchedulesForRange(
  startLocalDate: string,
  endLocalDateExclusive: string,
  options: OperationScheduleOptions,
) {
  const result = await supabase
    .from("operation_schedules")
    .select(
      "id, calendar_id, schedule_type_id, title, description, starts_at, ends_at, all_day, time_unspecified, status, version, request_id, created_by, created_at, updated_by, updated_at, archived_at",
    )
    .is("archived_at", null)
    .lt("starts_at", toSeoulInstant(endLocalDateExclusive, "00:00"))
    .gt("ends_at", toSeoulInstant(startLocalDate, "00:00"))
    .order("all_day", { ascending: false })
    .order("time_unspecified")
    .order("starts_at")
    .order("created_at");
  throwScheduleError(result.error);

  const rows = (result.data ?? []) as ScheduleTableRow[];
  if (rows.length === 0) return [];

  const scheduleIds = rows.map((row) => row.id);
  const [assigneeResult, dogResult, customerResult] = await Promise.all([
    supabase
      .from("operation_schedule_assignees")
      .select("schedule_id, profile_id")
      .in("schedule_id", scheduleIds)
      .is("archived_at", null),
    supabase
      .from("operation_schedule_dogs")
      .select("schedule_id, dog_id")
      .in("schedule_id", scheduleIds)
      .is("archived_at", null),
    supabase
      .from("operation_schedule_customers")
      .select("schedule_id, customer_id")
      .in("schedule_id", scheduleIds)
      .is("archived_at", null),
  ]);
  throwScheduleError(
    assigneeResult.error ?? dogResult.error ?? customerResult.error,
  );

  const calendars = new Map(options.calendars.map((row) => [row.id, row]));
  const scheduleTypes = new Map(
    options.scheduleTypes.map((row) => [row.id, row]),
  );
  const people = new Map(options.assignees.map((row) => [row.id, row]));
  const dogs = new Map(options.dogs.map((row) => [row.id, row]));
  const customers = new Map(options.customers.map((row) => [row.id, row]));
  const groupBySchedule = <T extends { schedule_id: string }>(items: T[]) => {
    const grouped = new Map<string, T[]>();
    items.forEach((item) => {
      grouped.set(item.schedule_id, [
        ...(grouped.get(item.schedule_id) ?? []),
        item,
      ]);
    });
    return grouped;
  };
  const assigneesBySchedule = groupBySchedule(assigneeResult.data ?? []);
  const dogsBySchedule = groupBySchedule(dogResult.data ?? []);
  const customersBySchedule = groupBySchedule(customerResult.data ?? []);

  const schedules = rows.map((row): OperationSchedule => {
    const calendar = calendars.get(row.calendar_id);
    const scheduleType = scheduleTypes.get(row.schedule_type_id);
    return {
      id: row.id,
      calendarId: row.calendar_id,
      calendarName: calendar?.name ?? "캘린더",
      calendarColor: calendar?.color ?? DEFAULT_OPERATION_SCHEDULE_COLOR,
      calendarScope: calendar?.scopeType ?? "common",
      businessUnitCode: calendar?.businessUnitCode ?? null,
      businessUnitName: calendar?.businessUnitName ?? null,
      scheduleTypeId: row.schedule_type_id,
      scheduleTypeName: scheduleType?.name ?? "기타",
      scheduleTypeColor:
        scheduleType?.color ?? DEFAULT_OPERATION_SCHEDULE_COLOR,
      title: row.title,
      memo: row.description,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      timeUnspecified: row.time_unspecified ?? false,
      status: row.status,
      version: row.version,
      requestId: row.request_id,
      createdBy: row.created_by,
      createdByName: people.get(row.created_by)?.name ?? null,
      createdAt: row.created_at,
      updatedBy: row.updated_by,
      updatedByName: row.updated_by
        ? (people.get(row.updated_by)?.name ?? null)
        : null,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      hotelStayId: null,
      hotelEventKind: null,
      hotelRoomTypeName: null,
      assignees: (assigneesBySchedule.get(row.id) ?? [])
        .map((item) => people.get(item.profile_id))
        .filter((person): person is OperationPerson => Boolean(person)),
      dogs: (dogsBySchedule.get(row.id) ?? [])
        .map((item) => dogs.get(item.dog_id))
        .filter((dog): dog is OperationDog => Boolean(dog)),
      customers: (customersBySchedule.get(row.id) ?? [])
        .map((item) => customers.get(item.customer_id))
        .filter(
          (customer): customer is OperationCustomer => Boolean(customer),
        ),
    };
  });
  return (await attachHotelScheduleLinks(schedules)).sort(
    compareOperationScheduleChronology,
  );
}

export async function fetchOperationScheduleOptions(): Promise<OperationScheduleOptions> {
  const [settings, assigneesResult, customersResult, dogsResult] =
    await Promise.all([
      fetchOperationSettings(),
      supabase.rpc("get_active_operation_assignees"),
      supabase
        .from("customers")
        .select("id, name, phone")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("dogs")
        .select("id, name, customer_id, breed, sex")
        .eq("is_active", true)
        .order("name"),
    ]);

  let assignees: OperationPerson[];
  if (assigneesResult.error) {
    if (!isOptionalAssigneeRpcMissing(assigneesResult.error)) {
      throwScheduleError(assigneesResult.error);
    }
    // The production database can temporarily lag the optional Operations
    // assignee RPC. Use the existing active-staff directory RPC as the safe
    // fallback so profile RLS does not reduce an employee's result to self.
    const fallbackResult = await supabase.rpc("get_active_staff_directory");
    if (fallbackResult.error) throwScheduleError(fallbackResult.error);
    assignees = (fallbackResult.data ?? []).map((row: {
      id: string;
      name: string | null;
    }) => ({
      id: row.id,
      name: row.name,
      operationRole: null,
      scheduleColor: null,
    }));
  } else {
    assignees = (assigneesResult.data ?? []).map((row: {
      profile_id: string;
      profile_name: string | null;
      operation_role: "owner" | "manager" | "staff";
      schedule_color: string | null;
    }) => ({
      id: row.profile_id,
      name: row.profile_name,
      operationRole: row.operation_role,
      scheduleColor: row.schedule_color,
    }));
  }

  if (
    customersResult.error ||
    dogsResult.error
  ) {
    throwScheduleError(
      customersResult.error ?? dogsResult.error,
    );
  }

  return {
    ...settings,
    assignees,
    customers: (customersResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
    })),
    dogs: (dogsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      customerId: row.customer_id,
      breed: row.breed,
      sex: row.sex as OperationDog["sex"],
    })),
  };
}

export function scheduleDisplayColor(
  schedule: Pick<OperationSchedule, "assignees" | "createdBy" | "calendarColor">,
) {
  const primaryAssignee = schedulePrimaryAssignee(schedule);
  return primaryAssignee
    ? operationPersonColor(primaryAssignee)
    : DEFAULT_OPERATION_SCHEDULE_COLOR;
}

export function schedulePrimaryAssignee(
  schedule: Pick<OperationSchedule, "assignees" | "createdBy">,
) {
  if (schedule.assignees.length === 0) return null;
  if (schedule.assignees.length === 1) return schedule.assignees[0];
  return (
    schedule.assignees.find((row) => row.id === schedule.createdBy) ??
    [...schedule.assignees].sort((left, right) =>
      left.id.localeCompare(right.id),
    )[0]
  );
}

export function attachOperationAssigneeColors(
  schedule: OperationSchedule,
  assignees: OperationPerson[],
) {
  const colorById = new Map(
    assignees.map((assignee) => [assignee.id, assignee.scheduleColor]),
  );
  return {
    ...schedule,
    assignees: schedule.assignees.map((assignee) => ({
      ...assignee,
      scheduleColor: colorById.get(assignee.id) ?? null,
    })),
  };
}

export async function fetchCurrentOperationRole(profileId: string) {
  const result = await supabase
    .from("operation_memberships")
    .select("role")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .maybeSingle();
  throwScheduleError(result.error);
  return (result.data?.role as OperationRole | undefined) ?? null;
}

export async function createOperationSchedule(
  input: OperationScheduleInput,
  requestId: string,
) {
  const result = await supabase.rpc("create_operation_schedule", {
    ...rpcInput(input, requestId),
  });
  throwScheduleError(result.error);
  return mapSchedule(result.data as ScheduleRpcRow);
}

export async function updateOperationSchedule(
  scheduleId: string,
  expectedVersion: number,
  input: OperationScheduleInput,
  requestId: string,
) {
  const result = await supabase.rpc("update_operation_schedule", {
    p_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    ...rpcInput(input, requestId),
  });
  throwScheduleError(result.error);
  return mapSchedule(result.data as ScheduleRpcRow);
}

export async function setOperationScheduleStatus(
  scheduleId: string,
  expectedVersion: number,
  status: OperationScheduleStatus,
  reason: string,
  requestId: string,
) {
  const result = await supabase.rpc("set_operation_schedule_status", {
    p_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_status: status,
    p_reason: reason,
    p_request_id: requestId,
  });
  throwScheduleError(result.error);
  return mapSchedule(result.data as ScheduleRpcRow);
}

export async function archiveOperationSchedule(
  scheduleId: string,
  expectedVersion: number,
  reason: string,
  requestId: string,
) {
  const result = await supabase.rpc("archive_operation_schedule", {
    p_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_reason: reason,
    p_request_id: requestId,
  });
  throwScheduleError(result.error);
  return mapSchedule(result.data as ScheduleRpcRow);
}

export function seoulDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function defaultOperationScheduleWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const start = new Date(
    Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      Math.floor(part("minute") / 30) * 30 + 30,
    ),
  );
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const localDate = (value: Date) =>
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const localTime = (value: Date) =>
    `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;

  return {
    date: localDate(start),
    startTime: localTime(start),
    endDate: localDate(end),
    endTime: localTime(end),
  };
}

export function toSeoulInstant(localDate: string, time: string) {
  return new Date(`${localDate}T${time}:00+09:00`).toISOString();
}

export function nextSeoulDate(localDate: string) {
  const date = new Date(`${localDate}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function oneHourScheduleEnd(localDate: string, startTime: string) {
  const [hour, minute] = startTime.split(":").map(Number);
  if (
    !localDate ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { endDate: localDate, endTime: "" };
  }
  const totalMinutes = hour * 60 + minute + 60;
  const endHour = Math.floor((totalMinutes % (24 * 60)) / 60);
  const endMinute = totalMinutes % 60;
  return {
    endDate:
      totalMinutes >= 24 * 60 ? nextSeoulDate(localDate) : localDate,
    endTime: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
  };
}

export function compactNames(
  rows: Array<{ name: string | null }>,
  emptyLabel: string,
) {
  if (rows.length === 0) return emptyLabel;
  const first = rows[0]?.name || "이름 미등록";
  return rows.length === 1 ? first : `${first} 외 ${rows.length - 1}명`;
}

export function compactDogNames(rows: OperationDog[]) {
  if (rows.length === 0) return "반려견 없음";
  return rows.length === 1
    ? rows[0].name
    : `${rows[0].name} 외 ${rows.length - 1}마리`;
}

export function operationPersonDisplayName(
  person: Pick<OperationPerson, "name">,
) {
  return person.name?.trim() || "이름 미등록";
}

export function operationDogProfileLine(
  dog: Pick<OperationDog, "breed" | "sex">,
) {
  return [
    dog.breed?.trim() || "",
    dog.sex === "male" ? "남아" : dog.sex === "female" ? "여아" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function defaultOperationScheduleTitle(
  dogName: string | null | undefined,
  scheduleTypeName: string | null | undefined,
) {
  const normalizedDogName = dogName?.trim() ?? "";
  const normalizedScheduleTypeName = scheduleTypeName?.trim() ?? "";
  if (!normalizedDogName || !normalizedScheduleTypeName) return "";
  return `${normalizedDogName} ${normalizedScheduleTypeName}`;
}

export function suggestOperationCustomerIds(
  currentCustomerIds: string[],
  previousDogIds: string[],
  nextDogIds: string[],
  dogs: Array<Pick<OperationDog, "id" | "customerId">>,
) {
  const customerIds = new Set(currentCustomerIds);
  nextDogIds
    .filter((dogId) => !previousDogIds.includes(dogId))
    .forEach((dogId) => {
      const customerId = dogs.find((dog) => dog.id === dogId)?.customerId;
      if (customerId) customerIds.add(customerId);
    });
  return [...customerIds];
}

export function calculateOperationTodaySummary(
  schedules: OperationSchedule[],
) {
  const counts = {
    daycare: 0,
    training: 0,
    hotel: 0,
    common: 0,
  };
  schedules.forEach((schedule) => {
    if (schedule.businessUnitCode === "daycare") counts.daycare += 1;
    else if (schedule.businessUnitCode === "training") counts.training += 1;
    else if (schedule.businessUnitCode === "hotel") counts.hotel += 1;
    else counts.common += 1;
  });
  return {
    total: schedules.length,
    counts,
    countSum: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

export function mergeOperationTodaySchedule(
  schedules: OperationSchedule[],
  changed: OperationSchedule,
  localDate: string,
) {
  const dayStart = new Date(toSeoulInstant(localDate, "00:00")).getTime();
  const dayEnd = new Date(
    toSeoulInstant(nextSeoulDate(localDate), "00:00"),
  ).getTime();
  const rows = schedules.filter((schedule) => schedule.id !== changed.id);
  const occursToday =
    changed.archivedAt === null &&
    new Date(changed.startsAt).getTime() < dayEnd &&
    new Date(changed.endsAt).getTime() > dayStart;

  if (occursToday) rows.push(changed);
  return rows.sort(compareOperationScheduleChronology);
}

export function mergeOperationScheduleCollection(
  schedules: OperationSchedule[],
  changed: OperationSchedule,
) {
  const rows = schedules.filter((schedule) => schedule.id !== changed.id);
  if (changed.archivedAt === null) rows.push(changed);
  return rows.sort(compareOperationScheduleChronology);
}
