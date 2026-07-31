import { supabase } from "../lib/supabase";
import {
  fetchOperationSettings,
  type OperationCalendar,
  type OperationScheduleType,
} from "./operationsSettingsRepository";

export type OperationScheduleStatus = "scheduled" | "completed" | "cancelled";

export interface OperationPerson {
  id: string;
  name: string | null;
  scheduleColor?: string | null;
  operationRole?: "owner" | "manager" | "staff" | null;
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
  memo: string;
  assigneeIds: string[];
  customerIds: string[];
  dogIds: string[];
}

export const DEFAULT_OPERATION_SCHEDULE_COLOR = "#5B7FA3";

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
  assignees?: OperationPerson[];
  dogs?: Array<{ id: string; name: string; customerId: string | null }>;
  customers?: OperationCustomer[];
}

const mapSchedule = (row: ScheduleRpcRow): OperationSchedule => ({
  ...row,
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

export async function fetchOperationSchedulesForDay(localDate: string) {
  const result = await supabase.rpc("get_operation_schedules_for_day", {
    p_local_date: localDate,
  });
  throwScheduleError(result.error);
  return (((result.data ?? []) as ScheduleRpcRow[]) || []).map(mapSchedule);
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
      "id, calendar_id, schedule_type_id, title, description, starts_at, ends_at, all_day, status, version, request_id, created_by, created_at, updated_by, updated_at, archived_at",
    )
    .is("archived_at", null)
    .lt("starts_at", toSeoulInstant(endLocalDateExclusive, "00:00"))
    .gt("ends_at", toSeoulInstant(startLocalDate, "00:00"))
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

  return rows.map((row): OperationSchedule => {
    const calendar = calendars.get(row.calendar_id);
    const scheduleType = scheduleTypes.get(row.schedule_type_id);
    return {
      id: row.id,
      calendarId: row.calendar_id,
      calendarName: calendar?.name ?? "캘린더",
      calendarColor: calendar?.color ?? DEFAULT_OPERATION_SCHEDULE_COLOR,
      calendarScope: calendar?.scopeType ?? "common",
      businessUnitCode:
        calendar?.businessUnitName === "유치원"
          ? "daycare"
          : calendar?.businessUnitName === "교육센터"
            ? "training"
            : calendar?.businessUnitName === "호텔"
              ? "hotel"
              : null,
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
    const fallbackResult = await supabase
      .from("profiles")
      .select("id, name")
      .eq("is_active", true)
      .eq("account_status", "active")
      .order("name");
    if (fallbackResult.error) throwScheduleError(fallbackResult.error);
    assignees = (fallbackResult.data ?? []).map((row) => ({
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
  return (
    schedulePrimaryAssignee(schedule)?.scheduleColor ??
    DEFAULT_OPERATION_SCHEDULE_COLOR
  );
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
  return rows.sort(
    (left, right) =>
      Number(right.allDay) - Number(left.allDay) ||
      left.startsAt.localeCompare(right.startsAt) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}
