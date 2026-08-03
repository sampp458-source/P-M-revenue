import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202608030001_convert_legacy_hotel_schedules.sql",
  ),
  "utf8",
);
const preflight = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608030001_convert_legacy_hotel_schedules_preflight.sql",
  ),
  "utf8",
);
const postflight = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608030001_convert_legacy_hotel_schedules_postflight.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608030001_convert_legacy_hotel_schedules_rollback.sql",
  ),
  "utf8",
);

describe("legacy Hotel schedule conversion SQL package", () => {
  it("is append-only and grants only authenticated execution", () => {
    expect(migration).toContain(
      "create function public.convert_legacy_hotel_schedules_to_reservation",
    );
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(migration).not.toMatch(/create\s+(table|trigger|policy)/i);
    expect(migration).not.toMatch(/alter\s+table/i);
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
  });

  it("locks and reuses exactly two schedules without inserting duplicates", () => {
    expect(migration).toContain("order by schedule.id");
    expect(migration).toContain("for update");
    expect(migration).toContain("locked_schedule_count <> 2");
    expect(migration).toContain("perform public.update_operation_schedule(");
    expect(migration).not.toMatch(/insert\s+into\s+public\.operation_schedules/i);
    expect(migration).toContain("check_in_schedule.id");
    expect(migration).toContain("check_out_schedule.id");
  });

  it("enforces role, identity, link history, capacity, and idempotency contracts", () => {
    expect(migration).toContain("has_operation_role(array['owner', 'manager'])");
    expect(migration).toContain("stay.request_id = p_request_id");
    expect(migration).toContain("entity_audit_events");
    expect(migration).toContain("연결 이력이 있는 일정");
    expect(migration).toContain("dog.customer_id = customer.id");
    expect(migration).toContain("assert_hotel_capacity_available");
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("profile.account_status = 'active'");
    expect(migration).toContain("count(distinct membership.profile_id)");
    expect(migration).toContain("stay.dog_id = p_dog_id");
    expect(migration).toContain("capacity.room_type_id = p_room_type_id");
    expect(migration).toContain(
      "capacity.reserved_from is not distinct from check_in.starts_at",
    );
    expect(migration).toContain(
      "capacity.reserved_until is not distinct from check_out.starts_at",
    );
    expect(migration).toContain("동일 request_id의 입력 계약 불일치");
    expect(migration).toContain("unit.is_active");
  });

  it("preserves valid legacy end times and rejects invalid ranges", () => {
    expect(migration).toContain(
      "check_in_schedule.ends_at <= check_in_schedule.starts_at",
    );
    expect(migration).toContain(
      "check_out_schedule.ends_at <= check_out_schedule.starts_at",
    );
    expect(migration).toContain(
      "check_in_schedule.starts_at, check_in_schedule.ends_at",
    );
    expect(migration).toContain(
      "check_out_schedule.starts_at, check_out_schedule.ends_at",
    );
    expect(migration).not.toContain("starts_at + interval '1 hour'");
  });

  it("creates one Stay, one Capacity reservation and two event links", () => {
    expect(migration).toContain("insert into public.hotel_stays");
    expect(migration).toContain("insert into public.hotel_capacity_reservations");
    expect(migration).toContain("insert into public.hotel_stay_schedule_events");
    expect(migration).toContain("'check_in'");
    expect(migration).toContain("'check_out'");
    expect(migration).toContain("return public.hotel_stay_json(stay_id)");
  });

  it("diagnoses contracts before and after without mutating existing data", () => {
    expect(preflight).toContain("READY_TO_APPLY");
    expect(preflight).toContain("active_schedule_link_unique");
    expect(preflight).toContain("audit_request_id_nullable");
    expect(preflight).toContain("function_fingerprint");
    expect(preflight).toContain("column_contracts_ready");
    expect(preflight).toContain("STOP_MISSING_REQUIRED_COLUMNS");
    expect(postflight).toContain("LEGACY_HOTEL_CONVERSION_READY");
    expect(postflight).toContain("no_new_schedule_insert");
    expect(postflight).toContain("distinct_assignee_guard_present");
    expect(postflight).toContain("existing_end_time_guard_present");
    expect(postflight).toContain("active_hotel_calendar_guard_present");
    expect(postflight).toContain("function_fingerprint");
    expect(preflight).toContain("begin read only");
    expect(postflight).toContain("begin read only");
  });

  it("rolls back only the feature function and preserves converted aggregates", () => {
    expect(rollback).toContain(
      "drop function if exists public.convert_legacy_hotel_schedules_to_reservation",
    );
    expect(rollback).not.toMatch(/delete\s+from|truncate|drop\s+table/i);
  });
});
