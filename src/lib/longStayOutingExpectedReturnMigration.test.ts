import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migrationPath = "supabase/migrations/202608140002_long_stay_outing_expected_return.sql";
const migration = read(migrationPath);
const preflight = read("supabase/verification/202608140002_long_stay_outing_expected_return_preflight.sql");
const postflight = read("supabase/verification/202608140002_long_stay_outing_expected_return_postflight.sql");
const rollback = read("supabase/verification/202608140002_long_stay_outing_expected_return_rollback.sql");
const runtimeQa = read("supabase/verification/202608140002_long_stay_outing_expected_return_runtime_qa.sql");

describe("Long Stay outing expected-return repair", () => {
  it("adds a compatible V2 command and read projection without dropping legacy RPCs", () => {
    expect(migration).toContain("start_long_stay_absence_v2");
    expect(migration).toContain("get_long_stay_month_v2");
    expect(migration).not.toMatch(/drop function public\.start_long_stay_absence\(/);
    expect(migration).toContain("expected_return_date date null");
    expect(migration).toContain("expected_return_time_unspecified boolean not null default false");
  });

  it("repairs the generic Hotel check-in integration without weakening stale or duplicate guards", () => {
    expect(migration).toContain("contract_row.status not in ('pending','active')");
    expect(migration).toContain("stay_row.checked_in_at is null");
    expect(migration).toContain("stay_row.checked_out_at is not null");
    expect(migration).toContain("set status='active',version=version+1");
    expect(migration).toContain("using errcode='PT409'");
    expect(migration).toContain("using errcode='23505'");
  });

  it("keeps exact, time-unknown, and date-unknown values lossless without a sentinel time", () => {
    expect(migration).toContain("expected_return_at_value:=null");
    expect(migration).toContain("p_expected_return_date::timestamp+p_expected_return_time");
    expect(migration).not.toContain("time '00:00'");
    expect(migration).toContain("expected_return_date is null and (expected_return_at is null or not expected_return_time_unspecified)");
    expect(migration).not.toMatch(/update public\.long_stay_absence_events\s+set expected_return_date/i);
  });

  it("preserves room and capacity by excluding those tables from the outing command", () => {
    const startBody = migration.slice(migration.indexOf("create function public.start_long_stay_absence_v2"));
    expect(startBody).not.toMatch(/update public\.hotel_(capacity_reservations|room_allocations)/);
    expect(startBody).not.toMatch(/delete from public\.hotel_(capacity_reservations|room_allocations)/);
  });

  it("ships fail-closed release and rollback evidence", () => {
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_OUTING_REPAIR");
    expect(postflight).toContain("LONG_STAY_OUTING_REPAIR_READY");
    expect(postflight).toContain("STOP_LONG_STAY_OUTING_RUNTIME_QA_RESIDUE");
    expect(rollback).toContain("drop function if exists public.start_long_stay_absence_v2");
    ["A_exact", "B_time_unknown", "C_date_unknown", "D_duplicate_rejected", "E_stale_pt409", "F_replay", "G_return_in_house", "H_second_outing", "I_allocation_preserved", "J_capacity_preserved", "K_actual_return_later", "L_actual_return_earlier", "M_legacy_read"]
      .forEach((name) => expect(runtimeQa).toContain(`'${name}'`));
    expect(runtimeQa).toContain("rollback;");
  });

  it("has a stable release fingerprint", () => {
    expect(createHash("sha256").update(read(migrationPath)).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
  });
});
