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
        .select("id, name, customer_id")
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
    changed.status !== "cancelled" &&
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
