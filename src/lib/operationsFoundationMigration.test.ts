import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607280001_operations_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Operations foundation migration", () => {
  it("creates only the Operations foundation tables transactionally", () => {
    expect(migration.trimStart().startsWith("-- P&M OS")).toBe(true);
    expect(migration).toContain("begin;");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain(
      "create table if not exists public.operation_memberships",
    );
    expect(migration).toContain(
      "create table if not exists public.operation_calendars",
    );
    expect(migration).toContain(
      "create table if not exists public.operation_schedule_types",
    );
    expect(migration).toContain(
      "create table if not exists public.entity_audit_events",
    );
    expect(migration).not.toMatch(/alter table public\.(sales|sale_payments|sale_refunds|sale_history)/);
  });

  it("seeds active profiles as staff without inferring owner or manager", () => {
    expect(migration).toContain("from public.profiles profile");
    expect(migration).toContain("profile.is_active = true");
    expect(migration).toContain("profile.account_status = 'active'");
    expect(migration).toContain("'staff'");
    expect(migration).not.toMatch(
      /select[\s\S]{0,300}case[\s\S]{0,120}(owner|manager)/,
    );
  });

  it("keeps membership synchronized with profile approval state", () => {
    expect(migration).toContain(
      "create or replace function public.sync_operation_membership_from_profile",
    );
    expect(migration).toContain(
      "after insert or update of is_active, account_status",
    );
    expect(migration).toContain(
      "new.is_active = true and new.account_status = 'active'",
    );
    expect(migration).toContain("on conflict (profile_id) do update");
    expect(migration).toContain("set is_active = false");
  });

  it("keeps business scope separate from schedule type", () => {
    expect(migration).toContain(
      "scope_type in ('business_unit', 'common', 'personal')",
    );
    expect(migration).toContain(
      "scope_type = 'business_unit'\n      and business_unit_id is not null",
    );
    const scheduleTypeDefinition = migration
      .split("create table if not exists public.operation_schedule_types")[1]
      ?.split("create unique index if not exists operation_schedule_types_name_uidx")[0];
    expect(scheduleTypeDefinition).not.toContain("business_unit_id");
  });

  it("seeds the five calendars and eight schedule types", () => {
    for (const value of ["유치원", "교육센터", "호텔", "공통", "개인"]) {
      expect(migration).toContain(`'${value}'`);
    }
    for (const value of [
      "수업",
      "상담",
      "입실·퇴실",
      "회의",
      "내부 업무",
      "개인 일정",
      "휴무",
      "기타",
    ]) {
      expect(migration).toContain(`'${value}'`);
    }
  });

  it("allows active members to read and managers or owners to write settings", () => {
    expect(migration).toContain(
      "using (public.is_active_operation_member())",
    );
    expect(migration).toContain(
      "public.has_operation_role(array['manager', 'owner'])",
    );
    expect(migration).not.toContain(
      "grant delete on table public.operation_calendars",
    );
    expect(migration).not.toContain(
      "grant delete on table public.operation_schedule_types",
    );
  });

  it("records Operations audit events without exposing direct writes", () => {
    expect(migration).toContain("'operations'");
    expect(migration).toContain("before_data");
    expect(migration).toContain("after_data");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain(
      "revoke all on table public.entity_audit_events from anon, authenticated",
    );
    expect(migration).toContain(
      "grant select on table public.entity_audit_events to authenticated",
    );
  });
});
