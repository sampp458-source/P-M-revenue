import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608080001_long_stay_hotel_platform.sql",
  "utf8",
);
const preflight = readFileSync(
  "supabase/verification/202608080001_long_stay_hotel_platform_preflight.sql",
  "utf8",
);
const postflight = readFileSync(
  "supabase/verification/202608080001_long_stay_hotel_platform_postflight.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/verification/202608080001_long_stay_hotel_platform_rollback.sql",
  "utf8",
);
const transactionQa = readFileSync(
  "supabase/verification/202608080001_long_stay_hotel_platform_transaction_qa.sql",
  "utf8",
);

describe("Long Stay Hotel Platform append-only migration", () => {
  it("creates only the Long Stay-owned tables", () => {
    for (const table of [
      "long_stay_contracts",
      "long_stay_monthly_occupancies",
      "long_stay_absence_events",
      "long_stay_operation_audit_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
    expect(migration).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.(complete_hotel_check_out|reverse_hotel_completion|get_hotel_operations_snapshot_v2)/i,
    );
  });

  it("uses the approved Hotel helpers and public checkout/reverse adapters", () => {
    expect(migration).toContain(
      "prepare_hotel_reservation_runtime_input_extended_internal",
    );
    expect(migration).toContain(
      "create_hotel_reservation_runtime_extended_internal",
    );
    expect(migration).toContain(
      "change_hotel_room_type_and_allocation_extended_internal",
    );
    expect(migration).toContain("perform public.complete_hotel_check_out(");
    expect(migration).toContain("perform public.reverse_hotel_completion(");
  });

  it("keeps Runtime holds open-ended while hiding infinity at the read boundary", () => {
    expect(migration).toContain("'infinity'::timestamptz");
    expect(migration).toContain("'isOpenEnded'");
    expect(migration).toContain("'runtimeCapacityUntil'");
    expect(migration).toContain("'runtimeAllocationUntil'");
    expect(transactionQa).toContain("read_projection_hides_infinity");
  });

  it("enforces replay, deferred invariants, RLS, and exact postflight gates", () => {
    expect(migration).toContain("long-stay-request:");
    expect(migration).toContain("using errcode='23505'");
    expect(migration).toContain("deferrable initially deferred");
    expect(migration).toContain("enable row level security");
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_HOTEL_PLATFORM");
    expect(postflight).toContain("LONG_STAY_HOTEL_PLATFORM_READY");
    expect(transactionQa).toContain(
      "LONG_STAY_HOTEL_PLATFORM_TRANSACTION_QA_READY",
    );
  });

  it("rolls back only append-only Long Stay objects", () => {
    expect(rollback).toContain("STOP_LONG_STAY_ROLLBACK_DATA_EXISTS");
    expect(rollback).not.toMatch(
      /drop\s+function\s+(?:if\s+exists\s+)?public\.(complete_hotel_check_out|reverse_hotel_completion|get_hotel_operations_snapshot_v2)/i,
    );
  });
});
