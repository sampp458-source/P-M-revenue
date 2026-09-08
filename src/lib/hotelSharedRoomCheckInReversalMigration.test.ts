import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const migrationPath = "supabase/migrations/202609080001_hotel_shared_room_member_check_in_reversal.sql";
const preflightPath = "supabase/verification/202609080001_hotel_shared_room_member_check_in_reversal_preflight.sql";
const postflightPath = "supabase/verification/202609080001_hotel_shared_room_member_check_in_reversal_postflight.sql";
const runtimePath = "supabase/verification/202609080001_hotel_shared_room_member_check_in_reversal_runtime_qa.sql";

describe("Shared Room member check-in reversal migration", () => {
  const migration = read(migrationPath);
  const lower = migration.toLowerCase();

  it("is one append-only transaction with one exact RPC signature", () => {
    expect((lower.match(/^begin;$/gm) ?? [])).toHaveLength(1);
    expect((lower.match(/^commit;$/gm) ?? [])).toHaveLength(1);
    expect(lower).toContain("create function public.reverse_shared_hotel_member_check_in(");
    expect(lower).not.toContain("create or replace function public.reverse_shared_hotel_member_check_in");
    expect(lower).toContain("p_occupancy_id uuid");
    expect(lower).toContain("p_hotel_stay_id uuid");
    expect(lower).toContain("p_expected_occupancy_version integer");
    expect(lower).toContain("p_expected_stay_version integer");
    expect(lower).toContain("p_reason text");
    expect(lower).toContain("p_request_id uuid");
  });

  it("uses Owner/Manager authorization, SECURITY DEFINER, fixed search path, and closed ACL", () => {
    expect(lower).toContain("security definer");
    expect(lower).toContain("set search_path = public, pg_temp");
    expect(lower).toContain("has_operation_role(array['owner','manager'])");
    expect(lower).toContain("from public, anon");
    expect(lower).toContain("to authenticated, service_role");
  });

  it("adds an idempotent reverse_check_in request kind and preserves same-request replay", () => {
    expect(lower).toContain("'reverse_check_in'");
    expect(lower).toContain("claim_shared_hotel_request_internal");
    expect(lower).toContain("finish_shared_hotel_request_internal");
    expect(lower).toContain("if replay is not null then return replay; end if;");
  });

  it("fails closed on state, relationship, version, DELUXE, capacity, and allocation guards", () => {
    [
      "occupancy.status <> 'active'",
      "occupancy.version <> p_expected_occupancy_version",
      "shared_group.status <> 'allocated'",
      "stay.checked_in_at is null",
      "stay.checked_out_at is not null",
      "stay.version <> p_expected_stay_version",
      "physical_member.status <> 'active'",
      "family_member.status <> 'checked_in'",
      "capacity.source_kind <> 'shared_occupancy'",
      "capacity.quantity <> 1",
      "upper(btrim(room_type.code)) = 'deluxe'",
    ].forEach((contract) => expect(lower).toContain(contract));
    expect((lower.match(/for update;/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("reverses only Stay and Family member state while retaining the physical contract", () => {
    expect(lower).toContain("set checked_in_at = null");
    expect(lower).toContain("checked_in_by = null");
    expect(lower).toContain("set status = 'confirmed'");
    expect(lower).toContain("update public.hotel_physical_occupancies target");
    expect(lower).not.toContain("update public.hotel_physical_occupancy_members");
    expect(lower).not.toContain("update public.family_shared_room_groups");
    expect(lower).not.toContain("update public.hotel_capacity_reservations");
    expect(lower).not.toContain("update public.hotel_room_allocations");
    expect(lower).not.toMatch(/delete\s+from\s+public\./);
  });

  it("keeps a reproducible SHA available for the production review gate", () => {
    expect(createHash("sha256").update(migration).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Shared Room member check-in reversal verification artifacts", () => {
  const preflight = read(preflightPath).toLowerCase();
  const postflight = read(postflightPath).toLowerCase();
  const runtime = read(runtimePath).toLowerCase();

  it("keeps preflight and postflight read-only and transaction-bounded", () => {
    for (const sql of [preflight, postflight]) {
      expect(sql).toContain("begin transaction read only;");
      expect(sql.trimEnd().endsWith("rollback;")).toBe(true);
      expect(sql).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke)\b\s+(?:into\s+|table\s+|function\s+|on\s+)?public\./);
    }
  });

  it("checks the semantic RPC contract without formatting-sensitive exact source matching", () => {
    expect(postflight).toContain("regexp_replace(");
    expect(postflight).toContain("'[[:space:]]+'");
    expect(postflight).toContain("has_operation_role(%");
    expect(postflight).toContain("'reverse_check_in'");
    expect(postflight).toContain("exact_new_operation_kinds_ok");
  });

  it("runs a rollback-only isolated partial/full member lifecycle matrix", () => {
    expect(runtime).toContain("hotel_qa.assert_isolated_environment()");
    expect(runtime.trimEnd().endsWith("rollback;")).toBe(true);
    [
      "partial_member_reversal",
      "physical_contract_preserved",
      "checkin_schedule_restored",
      "same_request_replay",
      "request_collision_rejected",
      "partial_checkin_blocks_unassign",
      "all_members_reversed",
      "unassign_after_all_reversed",
    ].forEach((scenario) => expect(runtime).toContain(`'${scenario}'`));
  });
});

describe("Hotel check-in reversal frontend contract", () => {
  const operations = read("src/pages/HotelOperations.tsx");
  const sharedModal = read("src/pages/SharedHotelRoomModal.tsx");
  const singleRepository = read("src/pages/hotelOperationsRepository.ts");
  const sharedRepository = read("src/platform/multiDogSharedRoomRepository.ts");

  it("reuses the existing Single reverse_hotel_completion RPC", () => {
    expect(singleRepository).toContain('"reverse_hotel_completion"');
    expect(singleRepository).toContain('p_completion_kind: "check_in"');
    expect(operations).toContain("canReverseSingleHotelCheckIn");
  });

  it("shows approved explicit reversal copy and requires a reason", () => {
    expect(operations).toContain("입실 완료를 취소할까요?");
    expect(operations).toContain("입실 완료 상태만 되돌립니다.");
    expect(operations).toContain("객실 배정과 예약은 그대로 유지됩니다.");
    expect(sharedModal).toContain("해당 반려견의 입실 완료 상태만 되돌립니다.");
    expect(sharedModal).toContain("객실 배정과 함께 투숙 예약은 그대로 유지됩니다.");
    expect(sharedModal).toContain("reverseCheckInReason.trim()");
  });

  it("routes Shared reversal through one versioned idempotent RPC", () => {
    expect(sharedRepository).toContain('"reverse_shared_hotel_member_check_in"');
    expect(sharedRepository).toContain("p_expected_occupancy_version: occupancyVersion");
    expect(sharedRepository).toContain("p_expected_stay_version: stayVersion");
    expect(sharedRepository).toContain("p_request_id: requestId");
  });
});
