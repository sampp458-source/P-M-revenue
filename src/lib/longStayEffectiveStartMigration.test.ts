import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path,"utf8");
const migration=read("supabase/migrations/202608130003_long_stay_first_assignment_effective_start.sql");
const preflight=read("supabase/verification/202608130003_long_stay_first_assignment_effective_start_preflight.sql");
const postflight=read("supabase/verification/202608130003_long_stay_first_assignment_effective_start_postflight.sql");
const rollback=read("supabase/verification/202608130003_long_stay_first_assignment_effective_start_rollback.sql");
const runtimeQa=read("supabase/verification/202608130003_long_stay_first_assignment_effective_start_runtime_qa.sql");

describe("Long Stay first-assignment effective start repair",()=>{
  it("uses one canonical effective date in availability and first runtime creation",()=>{
    expect(migration).toContain("long_stay_first_assignment_effective_date_internal");
    expect(migration).toContain("select greatest(p_started_on,p_service_month)");
    expect(migration).toContain("contract_row.started_on,p_service_month");
    expect(postflight).toContain("LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_READY");
  });

  it("preserves the contract date, PT409 and the open-ended final guard",()=>{
    expect(migration).not.toMatch(/update\s+public\.long_stay_contracts\s+set\s+started_on/i);
    expect(migration).toContain("using errcode=''PT409''");
    expect(postflight).toContain("''infinity''::timestamptz");
    expect(postflight).toContain("allocation.allocated_until>availability_from");
  });

  it("keeps the helper internal to postgres and supplies fail-closed gates",()=>{
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain("to postgres");
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START");
    expect(preflight).toContain("begin read only;");
    expect(postflight).toContain("begin read only;");
    expect(rollback).toContain("drop function public.long_stay_first_assignment_effective_date_internal");
  });

  it("classifies effective-start overlap without reviving past finished allocations",()=>{
    expect(migration).toContain("effective_start_overlap");
    expect(migration).toContain("배정 시작 구간과 겹침");
    expect(migration).toContain("position('계약 시작 이후 사용 이력과 겹침' in definition_after)>0");
    expect(runtimeQa).toContain("STOP_CASE_A_PAST_JUNE");
    expect(runtimeQa).toContain("STOP_CASE_B_PAST_JULY");
    expect(runtimeQa).toContain("STOP_CASE_C_EFFECTIVE_OVERLAP");
    expect(runtimeQa).toContain("STOP_CASE_D_FUTURE");
  });

  it("proves aligned runtime boundaries and preserves subsequent runtime history",()=>{
    expect(runtimeQa).toContain("STOP_CASE_E_CAPACITY_START");
    expect(runtimeQa).toContain("STOP_CASE_E_ALLOCATION_START");
    expect(runtimeQa).toContain("STOP_CASE_E_SCHEDULE_START");
    expect(runtimeQa).toContain("STOP_CASE_E_OCCUPANCY_START");
    expect(runtimeQa).toContain("STOP_CASE_F_EXISTING_RUNTIME_RESET");
    expect(runtimeQa).toContain("STOP_CASE_G_CONTRACT_START_LATER");
    expect(runtimeQa).toContain("STOP_EFFECTIVE_START_TIME_UNKNOWN");
    expect(runtimeQa).toContain("rollback;");
    expect(runtimeQa).toContain("LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_RUNTIME_QA_READY");
    expect(runtimeQa).toContain("fixture_residue");
  });
});
