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

  it("checks audit request-id compatibility and Foundation owner state", () => {
    expect(preflight).toContain(
      "root_only_audit_strategy_is_compatible",
    );
    expect(preflight).toContain("STOP_AUDIT_REQUEST_ID_NOT_NULL");
    expect(preflight).toContain("STOP_AUDIT_REQUEST_ID_UNIQUE_MISSING");
    expect(preflight).toContain(
      "NOT_APPLIED_ROOT_ONLY_PACKAGE_COMPATIBLE",
    );
    expect(preflight).toContain("active_owner_rows");
    expect(preflight).toContain("finance_baseline_ready");
    expect(postflight).toContain("supports_membership_profile_id");
    expect(postflight).toContain("supports_standard_id");
    expect(postflight).toContain(
      "request_id_is_limited_to_schedule_root",
    );
    expect(postflight).toContain("link_audit_request_id_is_null");
    expect(postflight).toContain(
      "one_root_and_multiple_null_link_audits_are_supported",
    );
    expect(postflight).toContain(
      "root_request_idempotency_lookup_is_valid",
    );
  });

  it("reports ready only when prerequisites exist and schedule objects are clean", () => {
    expect(preflight).toContain("STOP_FOUNDATION_OBJECT_MISSING");
    expect(preflight).toContain("STOP_REQUIRED_COLUMN_MISSING");
    expect(preflight).toContain(
      "WARNING_EXISTING_SCHEDULE_OBJECTS_REVIEW_REQUIRED",
    );
    expect(preflight).toContain("else 'READY'");
  });

  it("verifies direct writes stay blocked and all-day storage uses Seoul boundaries", () => {
    expect(postflight).toContain("authenticated_can_insert_directly");
    expect(postflight).toContain("authenticated_can_update_directly");
    expect(postflight).toContain("authenticated_can_delete_directly");
    expect(postflight).toContain("all_day_start_is_seoul_midnight");
    expect(postflight).toContain("all_day_end_is_exclusive_next_day");
    expect(postflight).toContain("at_least_one_assignee_required");
    expect(postflight).toContain("inactive_profile_rejected");
    expect(postflight).toContain("membership_is_checked");
    expect(postflight).toContain("inactive_membership_rejected");
    expect(postflight).toContain("cancelled_is_terminal");
  });

  it("blocks rollback when any of the four schedule tables contains data", () => {
    [
      "operation_schedules",
      "operation_schedule_assignees",
      "operation_schedule_customers",
      "operation_schedule_dogs",
    ].forEach((table) => {
      expect(rollback).toContain(`select count(*) from public.${table}`);
    });
    expect(rollback).toContain("Rollback을 중단합니다");
    expect(rollback).not.toContain("drop table if exists public.operation_memberships");
    expect(rollback).not.toContain("drop table if exists public.entity_audit_events");
  });

  it("contains no repeat-schedule schema in the deployment package", () => {
    for (const sql of [preflight, postflight, rollback]) {
      expect(sql).not.toContain("operation_schedule_series");
      expect(sql).not.toContain("series_id");
      expect(sql).not.toContain("original_occurrence_at");
    }
  });

  it("does not mutate Finance or shared master tables", () => {
    for (const sql of [preflight, postflight, rollback]) {
      expect(sql).not.toMatch(
        /\b(insert into|update|delete from|alter table|drop table)\s+public\.(sales|sale_payments|sale_refunds|sale_history|customers|dogs)\b/i,
      );
    }
  });
});
