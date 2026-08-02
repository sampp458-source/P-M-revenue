import { supabase } from "../lib/supabase";

export interface OperationCalendar {
  id: string;
  name: string;
  scopeType: "business_unit" | "common" | "personal";
  color: string;
  sortOrder: number;
  businessUnitCode?: "daycare" | "training" | "hotel" | null;
  businessUnitName: string | null;
}

export interface OperationScheduleType {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  calendarIds?: string[];
}

export interface OperationSettings {
  calendars: OperationCalendar[];
  scheduleTypes: OperationScheduleType[];
}

interface CalendarRow {
  id: string;
  name: string;
  scope_type: OperationCalendar["scopeType"];
  color: string;
  sort_order: number;
  business_units:
    | { code: OperationCalendar["businessUnitCode"]; name: string }
    | Array<{
        code: OperationCalendar["businessUnitCode"];
        name: string;
      }>
    | null;
}

const relatedBusinessUnit = (
  relation: CalendarRow["business_units"],
) => {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
};

export const mapOperationCalendar = (
  row: CalendarRow,
): OperationCalendar => {
  const businessUnit = relatedBusinessUnit(row.business_units);
  return {
    id: row.id,
    name: row.name,
    scopeType: row.scope_type,
    color: row.color,
    sortOrder: row.sort_order,
    businessUnitCode: businessUnit?.code ?? null,
    businessUnitName: businessUnit?.name ?? null,
  };
};

const isOptionalScheduleUsabilityObjectMissing = (error: {
  code?: string;
  message?: string;
} | null) =>
  Boolean(
    error &&
      (error.code === "42P01" ||
        error.code === "PGRST205" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("operation_calendar_schedule_types")),
  );

export async function fetchOperationSettings(): Promise<OperationSettings> {
  const [calendarResult, scheduleTypeResult] = await Promise.all([
    supabase
      .from("operation_calendars")
      .select(
        "id, name, scope_type, color, sort_order, business_units(code, name)",
      )
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("operation_schedule_types")
      .select("id, name, color, sort_order")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
  ]);

  if (calendarResult.error || scheduleTypeResult.error) {
    throw new Error("Operations 설정 조회 실패");
  }

  const calendars = ((calendarResult.data ?? []) as CalendarRow[]).map(
    mapOperationCalendar,
  );
  const mappingResult = await supabase
    .from("operation_calendar_schedule_types")
    .select("calendar_id, schedule_type_id")
    .eq("is_active", true)
    .is("archived_at", null);

  if (
    mappingResult.error &&
    !isOptionalScheduleUsabilityObjectMissing(mappingResult.error)
  ) {
    throw new Error("Operations 설정 조회 실패");
  }

  const fallbackCalendarIds = calendars.map((calendar) => calendar.id);
  const mappings = mappingResult.error ? [] : (mappingResult.data ?? []);

  return {
    calendars,
    scheduleTypes: (scheduleTypeResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      sortOrder: row.sort_order,
      calendarIds: mappingResult.error
        ? fallbackCalendarIds
        : mappings
            .filter((mapping) => mapping.schedule_type_id === row.id)
            .map((mapping) => mapping.calendar_id),
    })),
  };
}
