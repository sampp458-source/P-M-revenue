import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/202608130005_hotel_lifecycle_consistency.sql"),
  "utf8",
).toLowerCase();
const preflight = readFileSync(
  resolve(import.meta.dirname, "../../supabase/verification/202608130005_hotel_lifecycle_consistency_preflight.sql"),
  "utf8",
).toLowerCase();
const postflight = readFileSync(
  resolve(import.meta.dirname, "../../supabase/verification/202608130005_hotel_lifecycle_consistency_postflight.sql"),
  "utf8",
).toLowerCase();
const rollback = readFileSync(
  resolve(import.meta.dirname, "../../supabase/verification/202608130005_hotel_lifecycle_consistency_rollback.sql"),
  "utf8",
).toLowerCase();
const runtimeQa = readFileSync(
  resolve(import.meta.dirname, "../../supabase/verification/202608130005_hotel_lifecycle_consistency_runtime_qa.sql"),
  "utf8",
).toLowerCase();

describe("Hotel lifecycle consistency migration", () => {
  it("adds one dedicated checked-in planned-checkout RPC without replacing frozen Hotel RPCs", () => {
    expect(migration).toContain("create function public.update_checked_in_hotel_planned_checkout");
    for (const name of [
      "complete_hotel_check_in",
      "complete_hotel_check_out",
      "reverse_hotel_completion",
      "get_hotel_operations_snapshot_v2",
    ]) {
      expect(migration).not.toMatch(
        new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, "i"),
      );
    }
  });

  it("uses PT409 replay/version conflicts and preserves real 40001 semantics", () => {
    expect(migration).toContain("hotel_planned_checkout_requests");
    expect(migration).toContain("using errcode='pt409'");
    expect(migration).not.toContain("using errcode='40001'");
  });

  it("validates extension room, type, and total capacity before writes", () => {
    const validation = migration.indexOf("assert_hotel_capacity_available");
    const roomValidation = migration.indexOf("other_allocation.allocated_from<capacity_until", validation);
    const totalValidation = migration.indexOf("assert_hotel_total_capacity_available", roomValidation);
    const capacityWrite = migration.indexOf("update public.hotel_capacity_reservations", totalValidation);
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(roomValidation).toBeGreaterThan(validation);
    expect(totalValidation).toBeGreaterThan(roomValidation);
    expect(capacityWrite).toBeGreaterThan(totalValidation);
  });

  it("uses the max active Shared Room member boundary", () => {
    expect(migration).toContain("hotel_physical_occupancy_members");
    expect(migration).toContain("max(case");
    expect(migration).toContain("target_physical_until");
    expect(migration).toContain("member.status='active'");
    expect(migration).toContain("set occupied_until=target_physical_until");
  });

  it("keeps Long Stay on its dedicated lifecycle", () => {
    expect(migration).toContain("long_stay_contracts");
    expect(migration).toContain("장기호텔 전용 기능");
  });

  it("synchronizes Calendar one way from Hotel lifecycle and restores scheduled on reverse", () => {
    expect(migration).toContain("after update of checked_in_at,checked_out_at on public.hotel_stays");
    expect(migration).toContain("when new.checked_in_at is null then 'scheduled' else 'completed'");
    expect(migration).toContain("when new.checked_out_at is null then 'scheduled' else 'completed'");
    expect(migration).not.toMatch(/update\s+public\.hotel_stays[\s\S]*from\s+public\.operation_schedules/i);
  });

  it("keeps the replay ledger private and the public RPC ACL exact", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toMatch(/revoke all on table public\.hotel_planned_checkout_requests[\s\S]*from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant execute on function public\.update_checked_in_hotel_planned_checkout[\s\S]*to authenticated, service_role/);
  });

  it("ships fail-closed preflight, postflight, and guarded rollback artifacts", () => {
    expect(preflight).toContain("ready_to_apply_hotel_lifecycle_consistency");
    expect(preflight).toContain("hotel_qa.assert_isolated_environment");
    expect(postflight).toContain("hotel_lifecycle_consistency_ready");
    expect(postflight).toContain("stop_hotel_lifecycle_calendar_projection");
    expect(rollback).toContain("stop_hotel_lifecycle_rollback_request_history_exists");
    for (const scenario of [
      "a_checked_in_single_extension",
      "b_extension_room_conflict",
      "c_type_capacity_conflict",
      "d_total_capacity_conflict",
      "e_shortening",
      "f_invalid_shortening_rejected",
      "g_replay_duplicate_zero",
      "h_stale_version_pt409",
      "i_shared_room_extension_max_boundary",
      "j_shared_room_shortening_preserves_max",
      "k_checkin_calendar_sync",
      "l_checkout_calendar_sync",
      "m_reverse_calendar_sync",
    ]) expect(runtimeQa).toContain(scenario);
  });
});
