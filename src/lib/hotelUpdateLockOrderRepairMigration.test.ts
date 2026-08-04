import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read(
  "supabase/migrations/202608040003_hotel_update_lock_order_repair.sql",
).toLowerCase();
const preflight = read(
  "supabase/verification/202608040003_hotel_update_lock_order_repair_preflight.sql",
).toLowerCase();
const postflight = read(
  "supabase/verification/202608040003_hotel_update_lock_order_repair_postflight.sql",
).toLowerCase();
const rollback = read(
  "supabase/verification/202608040003_hotel_update_lock_order_repair_rollback.sql",
).toLowerCase();

function standaloneDefinition(source: string) {
  const start = source.indexOf("function public.update_hotel_reservation");
  const dollarTag = source.indexOf("$function$", start) >= 0
    ? "$function$"
    : "$$";
  const bodyStart = source.indexOf(dollarTag, start);
  const end = source.indexOf(dollarTag, bodyStart + dollarTag.length)
    + dollarTag.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(bodyStart).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const repairedBody = standaloneDefinition(migration);
const rollbackBody = standaloneDefinition(rollback);
const addedLockBlock = [
  "\n    -- global advisory lock order: room type -> room -> total capacity.",
  "\n    -- the later capacity assertion reuses this transaction-level lock.",
  "\n    perform pg_advisory_xact_lock(",
  "\n      hashtextextended(",
  "\n        'hotel-capacity:' || p_room_type_id::text,",
  "\n        0",
  "\n      )",
  "\n    );\n",
].join("");

describe("Hotel update lock-order repair package", () => {
  it("detects the original Room -> Type order and the repaired Type -> Room order", () => {
    expect(rollbackBody.indexOf("hotel-room:")).toBeLessThan(
      rollbackBody.indexOf("assert_hotel_capacity_available"),
    );
    expect(repairedBody.indexOf("hotel-capacity:")).toBeLessThan(
      repairedBody.indexOf("hotel-room:"),
    );
    expect(repairedBody.indexOf("hotel-room:")).toBeLessThan(
      repairedBody.indexOf("assert_hotel_capacity_available"),
    );
    expect(preflight).toContain("current_room_before_type_detected");
    expect(postflight).toContain("repaired_type_before_room_ready");
  });

  it("adds only the early room-type advisory lock to the production body", () => {
    expect(repairedBody).toContain(addedLockBlock);
    expect(repairedBody.replace(addedLockBlock, "")).toBe(rollbackBody);
  });

  it("preserves the function signature and security contract", () => {
    [preflight, postflight].forEach((source) => {
      expect(source.replace(/\s+/g, "")).toContain(
        "uuid,integer,uuid,uuid,text,timestampwithtimezone,timestampwithtimezone,uuid,uuid,uuid,uuid[],text,uuid",
      );
    });
    [migration, rollback].forEach((source) => {
      expect(source).toContain("p_check_in_at timestamp with time zone");
      expect(source).toContain("p_check_out_at timestamp with time zone");
      expect(source).toContain("p_assignee_ids uuid[]");
    });
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path to 'public', 'pg_temp'");
    expect(preflight).toContain("authenticated_execute_ready");
    expect(postflight).toContain("authenticated_execute_preserved");
  });

  it("uses exact before/after body fingerprints and restores the original", () => {
    expect(preflight).toContain("11bfba2f2cf38dc814908bff25e38f8f");
    expect(migration).toContain("11bfba2f2cf38dc814908bff25e38f8f");
    expect(postflight).toContain("321e35c3ac5180215086adf5d0f7d5ac");
    expect(rollback).toContain("321e35c3ac5180215086adf5d0f7d5ac");
  });

  it("keeps all non-lock mutation and error contracts", () => {
    [
      "is_replayed_hotel_stay_request",
      "stay_row.version <> p_expected_version",
      "can_manage_operation_schedule",
      "update_operation_schedule",
      "update public.hotel_room_allocations",
      "update public.hotel_capacity_reservations",
      "update public.hotel_stays",
      "return public.hotel_stay_json",
      "42501",
      "40001",
      "23p01",
    ].forEach((contract) => {
      expect(repairedBody).toContain(contract);
      expect(rollbackBody).toContain(contract);
    });
  });

  it("blocks standalone repair rollback while Flexible is applied", () => {
    expect(rollback).toContain("stop_rollback_flexible_extension_still_applied");
    expect(rollback).toContain("flexible rollback 후 lock repair rollback");
  });
});
