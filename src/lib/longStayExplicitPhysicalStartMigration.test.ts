import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migrationPath = "supabase/migrations/202608130004_long_stay_explicit_physical_start.sql";
const migration = read(migrationPath);
const preflight = read("supabase/verification/202608130004_long_stay_explicit_physical_start_preflight.sql");
const postflight = read("supabase/verification/202608130004_long_stay_explicit_physical_start_postflight.sql");
const rollback = read("supabase/verification/202608130004_long_stay_explicit_physical_start_rollback.sql");
const runtimeQa = read("supabase/verification/202608130004_long_stay_explicit_physical_start_runtime_qa.sql");

describe("Long Stay explicit physical start migration", () => {
  it("adds compatible V2 RPCs without replacing the approved legacy signatures", () => {
    expect(migration).toContain("get_long_stay_room_availability_v2");
    expect(migration).toContain("confirm_long_stay_month_v2");
    expect(migration).not.toMatch(/drop function public\.(get_long_stay_room_availability|confirm_long_stay_month)\(/);
    expect(migration).toContain("p_physical_start_date date");
  });

  it("keeps service-month history separate from the physical runtime boundary", () => {
    expect(migration).toContain("month_from:=public.long_stay_first_assignment_effective_date_internal");
    expect(migration).toContain("p_physical_start_date,p_check_in_time");
    expect(migration).toContain("values(capacity_row.id,p_room_id,capacity_row.reserved_from");
    expect(migration).not.toMatch(/update\s+public\.long_stay_contracts\s+set\s+started_on/i);
  });

  it("validates the explicit date and preserves final exclusion constraints", () => {
    expect(migration).toContain("객실 사용 시작일은 계약 시작일보다 빠를 수 없습니다.");
    expect(migration).toContain("객실 사용 시작일은 선택한 운영 월 안이어야 합니다.");
    expect(migration).toContain("기존 Runtime의 객실 사용 시작일은 다시 설정할 수 없습니다.");
    expect(migration).toContain("assert_hotel_room_allocation_available");
    expect(migration).toContain("using errcode='PT409'");
  });

  it("excludes finished-before-start rows and retains source-aware conflicts", () => {
    expect(migration).toContain("allocation.allocated_until>availability_from");
    expect(migration).toContain("객실 사용 시작 시점에 사용 중");
    expect(migration).toContain("미래 예약 있음");
    expect(migration).not.toContain("계약 시작 이후 사용 이력과 겹침");
    ["shared_room", "long_stay", "hotel"].forEach((source) => expect(migration).toContain(`'${source}'`));
  });

  it("ships fail-closed verification and rollback artifacts", () => {
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_EXPLICIT_PHYSICAL_START");
    expect(preflight).toContain("begin read only;");
    expect(postflight).toContain("LONG_STAY_EXPLICIT_PHYSICAL_START_READY");
    expect(postflight).toContain("begin read only;");
    expect(rollback).toContain("drop function public.confirm_long_stay_month_v2");
    expect(rollback).toContain("drop function public.get_long_stay_room_availability_v2");
    ["CASE_A", "CASE_B", "CASE_C", "CASE_D", "CASE_E", "CASE_F", "CASE_G", "CASE_H", "CASE_I", "CASE_J"]
      .forEach((name) => expect(runtimeQa).toContain(`STOP_${name}`));
    expect(runtimeQa).toContain("LONG_STAY_EXPLICIT_PHYSICAL_START_RUNTIME_QA_READY");
    expect(runtimeQa).toContain("rollback;");
  });

  it("has a stable release fingerprint", () => {
    expect(createHash("sha256").update(read(migrationPath)).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
  });
});
