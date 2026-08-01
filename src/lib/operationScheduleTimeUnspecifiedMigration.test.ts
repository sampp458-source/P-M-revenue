import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202608010001_operation_schedule_time_unspecified.sql",
  ),
  "utf8",
);
const preflight = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608010001_operation_schedule_time_unspecified_preflight.sql",
  ),
  "utf8",
);
const postflight = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608010001_operation_schedule_time_unspecified_postflight.sql",
  ),
  "utf8",
);
const featureRollback = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608010001_operation_schedule_time_unspecified_rollback.sql",
  ),
  "utf8",
);
const fullRollback = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/verification/202608010001_operation_schedule_time_unspecified_full_rollback.sql",
  ),
  "utf8",
);

describe("Operations schedule time-unspecified migration", () => {
  it("stores time uncertainty as a dedicated boolean state", () => {
    expect(migration).toContain(
      "add column if not exists time_unspecified boolean not null default false",
    );
    expect(migration).toContain("not (all_day and time_unspecified)");
    expect(migration).toContain("'timeUnspecified', schedule.time_unspecified");
    expect(migration).toContain("p_time_unspecified boolean");
  });

  it("sorts known times before time-unspecified schedules", () => {
    expect(migration).toContain("schedule.time_unspecified asc");
    expect(migration).toContain("when schedule.time_unspecified then null");
    expect(migration).toContain("schedule.created_at");
    expect(migration).not.toContain("time_unspecified = time '00:00'");
  });

  it("normalizes time-unspecified ranges inside create and update RPCs", () => {
    expect(migration.match(/normalized_starts_at :=/g)).toHaveLength(4);
    expect(migration.match(/normalized_ends_at :=/g)).toHaveLength(4);
    expect(migration).toContain("at time zone 'Asia/Seoul'");
    expect(migration).toContain("starts_at = normalized_starts_at");
    expect(migration).toContain("ends_at = normalized_ends_at");
  });

  it("does not modify Finance or permission objects", () => {
    expect(migration).not.toMatch(
      /public\.(sales|sale_payments|sale_refunds|sale_history)/,
    );
    expect(migration).not.toContain("profiles.role");
    expect(migration).not.toMatch(/create policy|drop policy/i);
  });

  it("fails preflight safely when any required schedule object is missing", () => {
    expect(migration).toContain("public.assert_operation_schedule_input");
    expect(migration).toContain("public.sync_operation_schedule_links");
    expect(preflight).toContain("STOP_MISSING_INPUT_ASSERTION_FUNCTION");
    expect(preflight).toContain("STOP_MISSING_LINK_SYNC_FUNCTION");
    expect(preflight).toContain("if to_regclass('public.operation_schedules') is null then");
    expect(preflight).toContain("pg_get_functiondef(function_oid)");
    expect(preflight).toContain(
      "has_function_privilege('authenticated', function_oid, 'EXECUTE')",
    );
  });

  it("uses the same UTC fingerprint before and after migration", () => {
    const fingerprintExpression =
      "to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')";
    expect(preflight).toContain(fingerprintExpression);
    expect(postflight).toContain(fingerprintExpression);
    expect(migration).toContain(fingerprintExpression);
    expect(postflight).toContain("FAILED_EXISTING_SCHEDULE_COUNT_CHANGED");
    expect(postflight).toContain("FAILED_EXISTING_TIME_VALUES_CHANGED");
  });

  it("postflight validates normalized KST day ranges for unknown times", () => {
    expect(postflight).toContain("where time_unspecified");
    expect(postflight).toContain("starts_at is distinct from");
    expect(postflight).toContain("ends_at is distinct from");
    expect(postflight).toContain("at time zone 'Asia/Seoul'");
    expect(postflight).toContain("FAILED_INVALID_TIME_STATE_DATA");
    expect(postflight).toContain("FAILED_CREATE_TIME_NORMALIZATION");
    expect(postflight).toContain("FAILED_UPDATE_TIME_NORMALIZATION");
    expect(postflight).toContain("FAILED_LEGACY_CREATE_RPC_CHANGED");
    expect(postflight).toContain("FAILED_LEGACY_UPDATE_RPC_CHANGED");
  });

  it("keeps feature and full rollback responsibilities separate", () => {
    expect(featureRollback).toContain("drop function if exists public.create_operation_schedule");
    expect(featureRollback).not.toContain("drop column if exists time_unspecified");
    expect(featureRollback).not.toContain("drop constraint if exists operation_schedules_time_state_check");
    expect(fullRollback).toContain("where time_unspecified = true");
    expect(fullRollback).toContain("drop constraint if exists operation_schedules_time_state_check");
    expect(fullRollback).toContain("drop column if exists time_unspecified");
  });

  it("joins constraint metadata with schema identity", () => {
    expect(postflight).toContain(
      "check_info.constraint_schema = constraint_info.constraint_schema",
    );
  });
});
