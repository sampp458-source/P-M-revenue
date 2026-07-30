import { supabase } from "../lib/supabase";

export interface OperationCalendar {
  id: string;
  name: string;
  scopeType: "business_unit" | "common" | "personal";
  color: string;
  sortOrder: number;
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
    | { name: string }
    | Array<{ name: string }>
    | null;
}

const relatedBusinessUnitName = (
  relation: CalendarRow["business_units"],
) => {
  if (Array.isArray(relation)) return relation[0]?.name ?? null;
  return relation?.name ?? null;
};

export const mapOperationCalendar = (
  row: CalendarRow,
): OperationCalendar => ({
  id: row.id,
  name: row.name,
  scopeType: row.scope_type,
  color: row.color,
  sortOrder: row.sort_order,
  businessUnitName: relatedBusinessUnitName(row.business_units),
});

export async function fetchOperationSettings(): Promise<OperationSettings> {
  const [calendarResult, scheduleTypeResult, mappingResult] = await Promise.all([
    supabase
      .from("operation_calendars")
      .select(
        "id, name, scope_type, color, sort_order, business_units(name)",
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
    supabase
      .from("operation_calendar_schedule_types")
      .select("calendar_id, schedule_type_id")
      .eq("is_active", true)
      .is("archived_at", null),
  ]);

  if (calendarResult.error || scheduleTypeResult.error || mappingResult.error) {
    throw new Error("Operations 설정 조회 실패");
  }

  return {
    calendars: ((calendarResult.data ?? []) as CalendarRow[]).map(
      mapOperationCalendar,
    ),
    scheduleTypes: (scheduleTypeResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      sortOrder: row.sort_order,
      calendarIds: (mappingResult.data ?? [])
        .filter((mapping) => mapping.schedule_type_id === row.id)
        .map((mapping) => mapping.calendar_id),
    })),
  };
}
