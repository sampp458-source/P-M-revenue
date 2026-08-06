import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Hotel Room Board cross-type append migration", () => {
  const migration = read(
    "supabase/migrations/202608050001_hotel_room_board_cross_type_operations.sql",
  );

  it("only appends the three approved RPCs", () => {
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(migration.match(/create function public\./g)).toHaveLength(3);
    expect(migration).toContain("unassign_hotel_room_before_check_in(");
    expect(migration).toContain("change_room_type_before_check_in(");
    expect(migration).toContain("change_room_type_after_check_in(");
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("keeps membership and role permissions intentionally separate", () => {
    expect(migration).toContain("not public.is_active_operation_member()");
    expect(migration.match(/has_operation_role\(array\['owner', 'manager'\]\)/g)).toHaveLength(2);
  });

  it("normalizes reason, rejects same types, and validates exact allocations", () => {
    expect(migration.match(/nullif\(btrim\(p_reason\), ''\)/g)).toHaveLength(3);
    expect(migration).toContain("allocation_count <> 1");
    expect(migration).toContain("current_allocation_count <> 1");
    expect(migration).toContain("같은 객실 유형은 기존 호실 재배정");
    expect(migration).toContain("같은 객실 유형은 기존 객실 이동");
    expect(migration).toContain("p_effective_at > clock_timestamp()");
    expect(migration).toContain("allocation.allocated_from < p_effective_at");
    expect(migration).toContain("allocation.allocated_until > p_effective_at");
  });

  it("uses the existing request/type/room advisory keys and deterministic UUID ordering", () => {
    expect(migration).toContain("'hotel-request:' || p_request_id::text");
    expect(migration).toContain("'hotel-capacity:' || lock_id::text");
    expect(migration).toContain("'hotel-room:' || lock_id::text");
    expect(migration.match(/order by candidate\.id/g)).toHaveLength(4);
    expect(migration.indexOf("'hotel-capacity:' || lock_id::text")).toBeLessThan(
      migration.indexOf("'hotel-room:' || lock_id::text"),
    );
  });

  it("preserves the single Capacity row and the root request-id audit contract", () => {
    expect(migration).not.toMatch(/insert into public\.hotel_capacity_reservations/i);
    expect(migration).toContain("set room_type_id = new_room_type.id");
    expect(migration.match(/Hotel Stay Root Audit이 정확히 한 건/g)).toHaveLength(3);
    expect(migration.match(/app\.operation_request_id', p_request_id::text/g)).toHaveLength(3);
    expect(migration).not.toMatch(/update public\.operation_schedules schedule/i);
    expect(migration).toContain("No Schedule mutation");
    expect(migration).toContain("room=%s · type=%s");
    expect(migration).toContain("effective_at=%s");
  });

  it("ships read-only diagnostics, append rollback, and explicit statuses", () => {
    const preflight = read(
      "supabase/verification/202608050001_hotel_room_board_cross_type_preflight.sql",
    );
    const postflight = read(
      "supabase/verification/202608050001_hotel_room_board_cross_type_postflight.sql",
    );
    const rollback = read(
      "supabase/verification/202608050001_hotel_room_board_cross_type_rollback.sql",
    );
    const transactionQa = read(
      "supabase/verification/202608050001_hotel_room_board_cross_type_transaction_qa.sql",
    );
    expect(preflight).toContain("begin read only;");
    expect(preflight).toContain("READY_TO_APPLY_HOTEL_ROOM_BOARD_CROSS_TYPE");
    expect(postflight).toContain("begin read only;");
    expect(postflight).toContain("HOTEL_ROOM_BOARD_CROSS_TYPE_READY");
    expect(rollback).toContain("drop function if exists public.change_room_type_after_check_in");
    expect(rollback).not.toMatch(/drop\s+(table|trigger|policy)/i);
    expect(transactionQa).toContain("select hotel_qa.assert_isolated_environment()");
    expect(transactionQa).toContain("HOTEL_ROOM_BOARD_CROSS_TYPE_TRANSACTION_QA_READY");
    expect(transactionQa).toContain("target_type_capacity_conflict_rolled_back");
    expect(transactionQa).toContain("target_room_conflict_rolled_back");
    expect(transactionQa).toContain("before_standard_deluxe_standard_round_trip");
    expect(transactionQa).toContain("failure_injection_full_rollback");
    expect(transactionQa.trimEnd()).toMatch(/rollback;$/);
  });
});
