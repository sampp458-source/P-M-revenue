import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const preflight = read(
  "supabase/verification/202608040002_hotel_flexible_reservations_preflight.sql",
).toLowerCase();
const migration = read(
  "supabase/migrations/202608040002_hotel_flexible_reservations.sql",
).toLowerCase();
const postflight = read(
  "supabase/verification/202608040002_hotel_flexible_reservations_postflight.sql",
).toLowerCase();
const runtimeQa = read(
  "supabase/verification/202608040002_hotel_flexible_reservations_runtime_qa.sql",
).toLowerCase();
const rollback = read(
  "supabase/verification/202608040002_hotel_flexible_reservations_rollback.sql",
).toLowerCase();
const transactionQa = read(
  "supabase/verification/202608040002_hotel_flexible_reservations_transaction_qa.sql",
).toLowerCase();
const legacyWorkflow = read(
  "supabase/migrations/202608020002_hotel_operations_workflows.sql",
).toLowerCase();
const operationTimeMigration = read(
  "supabase/migrations/202608010001_operation_schedule_time_unspecified.sql",
).toLowerCase();

function functionBody(source: string, name: string, nextName: string) {
  const start = source.indexOf(`function public.${name}`);
  const end = source.indexOf(`function public.${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectTypeBeforeCapacityWrite(body: string, writeSql: string) {
  const typeLock = body.indexOf("assert_hotel_capacity_available");
  const capacityWrite = body.indexOf(writeSql);
  expect(typeLock).toBeGreaterThanOrEqual(0);
  expect(capacityWrite).toBeGreaterThan(typeLock);
}

describe("Hotel flexible reservation SQL package", () => {
  it("keeps legacy RPCs and adds only extension functions", () => {
    expect(migration).not.toContain("create or replace function");
    expect(migration).toContain("create function public.create_flexible_hotel_reservation");
    expect(migration).toContain("create function public.update_flexible_hotel_reservation");
    expect(migration).toContain("create function public.finalize_and_complete_hotel_check_in");
    expect(migration).toContain("create function public.finalize_and_complete_hotel_check_out");
    expect(migration).toContain("create function public.get_hotel_operations_snapshot_v2");
  });

  it("uses live active room inventory instead of a hard-coded total", () => {
    expect(migration).toContain("select count(*)::integer");
    expect(migration).toContain("room.is_active and room.archived_at is null");
    expect(migration).not.toContain("active_room_count := 11");
    expect(preflight).toContain("room_type.code = 'standard') = 5");
    expect(preflight).toContain("room_type.code = 'deluxe') = 6");
  });

  it("stores one nullable stay Capacity and confirms it by update", () => {
    expect(migration).toContain("alter column room_type_id drop not null");
    expect(migration).toContain("room_type_id is not null\n    or source_kind = 'stay'");
    expect(migration).toContain("set room_type_id = p_room_type_id");
    expect(migration).toContain("reserved_from = capacity_from");
    expect(migration).toContain("reserved_until = capacity_until");
  });

  it("enforces KST conservative bounds and explicit date ordering", () => {
    expect(migration).toContain("p_check_out_date < p_check_in_date");
    expect(migration).toContain("p_check_out_time <= p_check_in_time");
    expect(migration).toContain("p_check_in_date::timestamp at time zone 'asia/seoul'");
    expect(migration).toContain("(p_check_out_date + 1)::timestamp at time zone 'asia/seoul'");
  });

  it("returns separate confirmed, unassigned and safe availability fields", () => {
    [
      "confirmedremainingbytype",
      "unassignedroomtypecount",
      "overallsaferemaining",
      "individualtypeavailabilitywarning",
      "conservativeremaining",
      "affectedbyunspecifiedcount",
    ].forEach((key) => {
      expect(migration).toContain(`'${key}'`);
      expect(`${postflight}\n${runtimeQa}`).toContain(key);
    });
  });

  it("blocks rollback while flexible active data remains", () => {
    expect(rollback).toContain("where capacity.room_type_id is null");
    expect(rollback).toContain("schedule.time_unspecified");
    expect(rollback).toContain("info_only_not_a_rollback_blocker");
    expect(rollback).not.toContain("시간 미정 hotel event schedule %건이 있어 완전 rollback");
    expect(rollback).toContain("raise exception");
  });

  it("keeps legacy and flexible confirmed creates on type then total lock order", () => {
    const legacyCreate = functionBody(
      legacyWorkflow,
      "create_hotel_reservation",
      "update_hotel_reservation",
    );
    expect(legacyCreate.indexOf("assert_hotel_capacity_available")).toBeLessThan(
      legacyCreate.indexOf("insert into public.hotel_capacity_reservations"),
    );
    expectTypeBeforeCapacityWrite(
      functionBody(migration, "create_flexible_hotel_reservation", "update_flexible_hotel_reservation"),
      "insert into public.hotel_capacity_reservations",
    );
    expect(functionBody(migration, "enforce_hotel_total_capacity", "enforce_hotel_allocation_room_type"))
      .toContain("assert_hotel_total_capacity_available");
  });

  it("uses only the total lock when a Flexible create keeps room type unspecified", () => {
    const createBody = functionBody(
      migration,
      "create_flexible_hotel_reservation",
      "update_flexible_hotel_reservation",
    );
    const conditionalTypeLock = createBody.indexOf(
      "if p_room_type_id is not null then\n    perform public.assert_hotel_capacity_available",
    );
    expect(conditionalTypeLock).toBeGreaterThanOrEqual(0);
    expect(createBody).not.toContain("perform public.assert_hotel_total_capacity_available");
    expect(createBody.indexOf("insert into public.hotel_capacity_reservations"))
      .toBeGreaterThan(conditionalTypeLock);
  });

  it("serializes room-type confirmation and new confirmed reservations without lock inversion", () => {
    const updateBody = functionBody(
      migration,
      "update_flexible_hotel_reservation",
      "finalize_and_complete_hotel_check_in",
    );
    expect(updateBody.indexOf("assert_hotel_capacity_available")).toBeLessThan(
      updateBody.indexOf("hotel-room:"),
    );
    expectTypeBeforeCapacityWrite(updateBody, "update public.hotel_capacity_reservations");
    const checkInBody = functionBody(
      migration,
      "finalize_and_complete_hotel_check_in",
      "finalize_and_complete_hotel_check_out",
    );
    expect(checkInBody.indexOf("assert_hotel_capacity_available")).toBeLessThan(
      checkInBody.indexOf("hotel-room:"),
    );
    expectTypeBeforeCapacityWrite(checkInBody, "update public.hotel_capacity_reservations");
  });

  it("keeps finalized checkout on type then total lock order", () => {
    const checkOutBody = functionBody(
      migration,
      "finalize_and_complete_hotel_check_out",
      "get_hotel_operations_snapshot_v2",
    );
    expect(checkOutBody.indexOf("assert_hotel_capacity_available")).toBeLessThan(
      checkOutBody.indexOf("hotel-room:"),
    );
    expectTypeBeforeCapacityWrite(checkOutBody, "update public.hotel_capacity_reservations");
  });

  it("preserves Calendar write triggers and uses room type codes in titles", () => {
    [
      "operation_schedules_protect_metadata",
      "operation_schedules_updated_at",
      "operation_schedules_write_permission",
      "operation_schedules_audit",
    ].forEach((triggerName) => expect(preflight).toContain(triggerName));
    expect(migration).toContain("select room_type.code");
    expect(migration).not.toContain("select room_type.name into room_type_name");
    expect(postflight).toContain("schedule_write_triggers_ready");
  });

  it("normalizes stale unspecified times and validates complete replay payloads", () => {
    const createBody = functionBody(
      migration,
      "create_flexible_hotel_reservation",
      "update_flexible_hotel_reservation",
    );
    expect(createBody).not.toContain("p_title");
    expect(createBody).toContain("then p_check_in_date::timestamp at time zone 'asia/seoul'");
    expect(createBody).toContain("then p_check_out_date::timestamp at time zone 'asia/seoul'");
    expect(createBody).toContain("expected_check_in_ends_at := case");
    expect(createBody).toContain("expected_check_out_ends_at := case");
    expect(createBody).toContain("then check_in_schedule_at + interval '1 day'");
    expect(createBody).toContain("then check_out_schedule_at + interval '1 day'");
    expect(createBody).toContain("check_in_schedule_at + interval '1 hour'");
    expect(createBody).toContain("check_out_schedule_at + interval '1 hour'");
    const operationCreate = functionBody(
      operationTimeMigration,
      "create_operation_schedule",
      "update_operation_schedule",
    );
    expect(operationCreate).toContain(
      "((p_starts_at at time zone 'asia/seoul')::date + 1)::timestamp",
    );
    [
      "existing_stay.dog_id is distinct from p_dog_id",
      "customer_link.customer_id",
      "assignee.profile_id",
      "replay_check_in_schedule.calendar_id",
      "replay_check_in_schedule.schedule_type_id",
      "replay_check_in_schedule.time_unspecified",
      "replay_check_in_schedule.starts_at",
      "replay_check_in_schedule.description",
    ].forEach((contract) => expect(createBody).toContain(contract));
  });

  it("requires the existing Capacity source XOR constraint", () => {
    expect(preflight).toContain("capacity_source_xor_constraint_ready");
    expect(postflight).toContain("capacity_source_xor_constraint_ready");
    expect(preflight).toContain("hotel_capacity_reservations_source_check");
  });

  it("blocks deployment while legacy room/type advisory locks are inverted", () => {
    expect(preflight).toContain("legacy_update_type_before_room_ready");
    expect(preflight).toContain("legacy_checkout_type_before_room_ready");
    expect(preflight).toContain("stop_existing_global_lock_order_conflict");
    expect(postflight).toContain("failed_existing_global_lock_order_conflict");
    expect(preflight).toContain("legacy_reverse_type_room_total_ready");
    expect(preflight).toContain("stop_reverse_completion_global_lock_order_conflict");
    expect(postflight).toContain("failed_reverse_completion_global_lock_order_conflict");
  });

  it("probes Schedule, Audit and statement rollback contracts in a rollback-only transaction", () => {
    expect(transactionQa).toContain("begin;");
    expect(transactionQa).toContain("identical_request_replayed");
    expect(transactionQa).toContain("replay_mutation_free");
    expect(transactionQa).toContain("different_payload_rejected");
    expect(transactionQa).toContain("schedule_version_incremented");
    expect(transactionQa).toContain("schedule_time_confirmed");
    expect(transactionQa).toContain("calendar_audit_created");
    expect(transactionQa).toContain("stay_root_audit_exactly_one");
    expect(transactionQa).toContain("failed_capacity_rolled_back");
    expect(transactionQa).toContain("failed_allocation_rolled_back");
    expect(transactionQa).toContain("failed_schedule_rolled_back");
    expect(transactionQa).toContain("failed_stay_rolled_back");
    expect(transactionQa).toContain("failed_audit_rolled_back");
    expect(transactionQa).toContain("hotel_flexible_transaction_qa_injected_failure");
    expect(transactionQa).toContain(
      "create function pg_temp.fail_hotel_flexible_transaction_qa()",
    );
    expect(transactionQa).toContain(
      "before update on public.hotel_stays",
    );
    expect(transactionQa).not.toContain("conflicting_request");
    expect(transactionQa.trimEnd()).toMatch(/rollback;$/);
  });
});
