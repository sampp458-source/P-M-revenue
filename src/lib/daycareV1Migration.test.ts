import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/202608140001_daycare_v1.sql");
const preflight = read("supabase/verification/202608140001_daycare_v1_preflight.sql");
const postflight = read("supabase/verification/202608140001_daycare_v1_postflight.sql");
const rollback = read("supabase/verification/202608140001_daycare_v1_rollback.sql");
const qa = read("supabase/verification/202608140001_daycare_v1_transaction_qa.sql");
const productionPreflight = read("supabase/verification/202608140001_daycare_v1_production_preflight.sql");
const productionPostflight = read("supabase/verification/202608140001_daycare_v1_production_postflight.sql");

describe("Daycare V1 append-only contract", () => {
  it("keeps operation_schedule as the only reservation root", () => {
    expect(migration).toContain("create table public.daycare_operation_states");
    expect(migration).toContain("operation_schedule_id uuid primary key");
    expect(migration).not.toMatch(/create table public\.daycare_reservations\b/);
    expect(migration).not.toMatch(/insert into public\.hotel_stays\b/);
  });

  it("enforces same-day exact-time capacity and optional room assignment", () => {
    expect(migration).toContain("p_check_out_time<=p_check_in_time");
    expect(migration).toContain("time_unspecified");
    expect(migration).toContain("register_hotel_daycare_capacity");
    expect(migration).toContain("if p_room_id is not null then");
    expect(migration).toContain("assert_hotel_room_allocation_available");
  });

  it("provides atomic create, update, cancel, room and lifecycle RPCs", () => {
    for (const name of [
      "create_daycare_reservation",
      "update_daycare_reservation",
      "cancel_daycare_reservation",
      "assign_daycare_room",
      "unassign_daycare_room",
      "complete_daycare_check_in",
      "complete_daycare_check_out",
      "get_daycare_operations_for_date",
    ]) expect(migration).toMatch(new RegExp(`create function public\\.${name}\\b`));
    expect(migration).toContain("using errcode='PT409'");
  });

  it("protects generic schedule mutations and locks down ACL/RLS", () => {
    expect(migration).toContain("operation_schedules_daycare_guard");
    expect(migration).toContain("객실형 Daycare 예약은 Daycare 전용 화면에서 변경해 주세요.");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.daycare_operation_states from public,anon,authenticated,service_role");
    expect(migration).toContain("public.is_active_operation_member()");
  });

  it("ships fail-closed lifecycle artifacts and A-P scenario names", () => {
    expect(preflight).toContain("READY_TO_APPLY_DAYCARE_V1");
    expect(postflight).toContain("DAYCARE_V1_READY");
    expect(rollback).toContain("DAYCARE_V1_ROLLBACK_READY");
    for (const label of [
      "A_UNASSIGNED_CREATE", "B_ASSIGNED_CREATE", "C_HOTEL_OVERLAP",
      "D_HOTEL_AFTER_BOUNDARY", "E_DAYCARE_ROOM_OVERLAP", "F_EXACT_BOUNDARY",
      "G_UPDATE_SYNC", "H_UPDATE_CONFLICT_ROLLBACK", "I_STALE_PT409",
      "J_CANCEL_RELEASE", "K_ASSIGNED_CHECKIN", "L_UNASSIGNED_CHECKIN_REJECT",
      "M_CHECKOUT_COMPLETE", "N_REPLAY_DUPLICATE_0", "O_REPLAY_PAYLOAD_REJECT",
    ]) expect(qa).toContain(label);
  });

  it("ships production-only read-only gates with exact binding and ACL assertions", () => {
    for (const artifact of [productionPreflight, productionPostflight]) {
      expect(artifact).toContain("begin read only");
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("a94b254bad910f7e89ba2581189a5b421c96e9ac361a9d22a29f84ee18a521ef");
      expect(artifact).toContain("hotel_qa.environment_guard");
    }
    expect(productionPreflight).toContain("READY_TO_APPLY_DAYCARE_V1");
    expect(productionPostflight).toContain("DAYCARE_V1_READY");
    expect(productionPostflight).toContain("array['authenticated','postgres','service_role']::text[]");
    expect(productionPostflight).toContain("array['postgres']::text[]");
  });
});
