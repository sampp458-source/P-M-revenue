import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSql = (name: string) =>
  readFileSync(
    new URL(`../../supabase/verification/${name}`, import.meta.url),
    "utf8",
  );

const preflight = readSql("202607290002_operations_apply_preflight.sql");
const postflight = readSql("202607290002_operations_apply_postflight.sql");
const rollback = readSql("202607290002_operations_schedule_rollback.sql");

describe("Operations production deployment package", () => {
  it("keeps preflight and postflight verification read-only", () => {
    for (const sql of [preflight, postflight]) {
      expect(sql).not.toMatch(
        /^\s*(insert|update|delete|alter|drop|create\s+table)\b/gim,
      );
      expect(sql).toContain("operation_memberships");
      expect(sql).toContain("operation_schedules");
      expect(sql).toContain("entity_audit_events");
    }
  });

  it("checks the membership audit identifier compatibility", () => {
    expect(preflight).toContain("supports_profile_id_and_id");
    expect(postflight).toContain("supports_membership_profile_id");
    expect(postflight).toContain("supports_standard_id");
  });

  it("recognizes an applied Foundation with no schedule tables as ready", () => {
    expect(preflight).toContain("FOUNDATION_READY");
    expect(preflight).toContain("STOP_FOUNDATION_INCOMPLETE");
    expect(preflight).toContain("PARTIAL_SCHEDULE_STOP_AND_REVIEW");
  });

  it("verifies direct writes stay blocked and all-day storage uses Seoul boundaries", () => {
    expect(postflight).toContain("authenticated_can_insert_directly");
    expect(postflight).toContain("authenticated_can_update_directly");
    expect(postflight).toContain("authenticated_can_delete_directly");
    expect(postflight).toContain("all_day_start_is_seoul_midnight");
    expect(postflight).toContain("all_day_end_is_exclusive_next_day");
  });

  it("blocks rollback once schedule data exists", () => {
    expect(rollback).toContain("select count(*) from public.operation_schedules");
    expect(rollback).toContain("Rollback을 중단합니다");
    expect(rollback).not.toContain("drop table if exists public.operation_memberships");
    expect(rollback).not.toContain("drop table if exists public.entity_audit_events");
  });

  it("does not mutate Finance or shared master tables", () => {
    for (const sql of [preflight, postflight, rollback]) {
      expect(sql).not.toMatch(
        /\b(insert into|update|delete from|alter table|drop table)\s+public\.(sales|sale_payments|sale_refunds|sale_history|customers|dogs)\b/i,
      );
    }
  });
});
