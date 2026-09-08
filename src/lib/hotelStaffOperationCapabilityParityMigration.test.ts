import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const migration = read("supabase/migrations/202609080003_hotel_staff_operation_capability_parity.sql");
const preflight = read("supabase/verification/202609080003_hotel_staff_operation_capability_parity_preflight.sql");
const postflight = read("supabase/verification/202609080003_hotel_staff_operation_capability_parity_postflight.sql");
const runtime = read("supabase/verification/202609080003_hotel_staff_operation_capability_parity_runtime_qa.sql");

const signatures = [
  "public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)",
  "public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)",
  "public.reverse_hotel_completion(uuid,integer,text,text,uuid)",
  "public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)",
  "public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)",
  "public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)",
  "public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)",
  "public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid)",
  "public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)",
  "public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)",
  "public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)",
  "public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)",
];

describe("Hotel staff operation capability parity migration", () => {
  it("uses one explicit 12-RPC Hotel operation allowlist in every artifact", () => {
    for (const signature of signatures) {
      expect(migration).toContain(`'${signature}'`);
      expect(preflight).toContain(`'${signature}'`);
      expect(postflight).toContain(`'${signature}'`);
      expect(runtime).toContain(`'${signature}'`);
    }
    expect(migration).toContain("cardinality(target_signatures) <> 12");
  });

  it("adds a Hotel-scoped helper without redefining global membership helpers", () => {
    expect(migration).toContain("create function public.can_operate_hotel()");
    expect(migration).toContain("select public.is_active_operation_member()");
    expect(migration).not.toMatch(/create or replace function public\.(is_active_operation_member|has_operation_role)/i);
    expect(migration).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(migration).not.toMatch(/\balter\s+table\b/i);
  });

  it("redefines target bodies through one guarded authorization-only substitution", () => {
    expect(migration).toContain("guard_count <> 1");
    expect(migration).toContain("replaced_definition := regexp_replace(");
    expect(migration).toContain("'public.can_operate_hotel()'");
    expect(migration).toContain("execute replaced_definition");
    expect(migration).not.toMatch(/\b(insert|update|delete|merge)\s+(into\s+)?public\./i);
  });

  it("keeps Hotel settings owner/manager-only and target ACL/RLS untouched", () => {
    for (const artifact of [migration, preflight, postflight]) {
      expect(artifact).toContain("public.update_hotel_operation_settings(integer,time without time zone,time without time zone,uuid)");
    }
    expect(migration).not.toMatch(/grant execute on function public\.(change_room_type|reverse_hotel|reverse_shared|create_long_stay|confirm_long_stay|set_long_stay)/i);
    expect(migration).not.toMatch(/grant\s+.+\s+on\s+table/i);
  });

  it("ships read-only Production gates and isolated rollback persona QA", () => {
    expect(preflight).toContain("begin transaction read only;");
    expect(postflight).toContain("begin transaction read only;");
    expect(preflight.trimEnd().endsWith("rollback;")).toBe(true);
    expect(postflight.trimEnd().endsWith("rollback;")).toBe(true);
    expect(runtime).toContain("select hotel_qa.assert_isolated_environment()");
    expect(runtime.trimEnd().endsWith("rollback;")).toBe(true);
    for (const persona of [
      "A_OWNER", "B_MANAGER", "C_ACTIVE_STAFF", "D_INACTIVE_OPERATION_MEMBER",
      "E_INACTIVE_PROFILE", "E_INACTIVE_ACCOUNT", "F_AUTHENTICATED_NON_MEMBER",
    ]) expect(runtime).toContain(persona);
    expect(runtime).toContain("public.cancel_hotel_reservation(uuid,integer,text,uuid)");
    expect(runtime).toContain("public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)");
    expect(runtime).toContain("case when count(*) = 98");
    expect(runtime).toContain("HOTEL_SETTINGS_MUST_REJECT_STAFF");
  });
});
