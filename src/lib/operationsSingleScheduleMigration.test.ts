import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202607290002_operations_single_schedule.sql",
  ),
  "utf8",
);

describe("Operations single schedule migration", () => {
  it("is transactional and reuses the approved schedule foundation", () => {
    expect(migration).toMatch(/\nbegin;\n/);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain("to_regclass('public.operation_schedules')");
    expect(migration).not.toContain("create table public.operation_schedules");
  });

  it("provides day query with Seoul-exclusive boundaries and stable ordering", () => {
    expect(migration).toContain(
      "create or replace function public.get_operation_schedules_for_day",
    );
    expect(migration).toContain(
      "p_local_date::timestamp at time zone 'Asia/Seoul'",
    );
    expect(migration).toContain(
      "(p_local_date + 1)::timestamp at time zone 'Asia/Seoul'",
    );
    expect(migration).toContain("schedule.starts_at < day_end");
    expect(migration).toContain("schedule.ends_at > day_start");
    expect(migration).toContain("schedule.all_day desc");
    expect(migration).toContain("schedule.status <> 'cancelled'");
    expect(migration).toContain("'businessUnitCode', business_unit.code");
  });

  it("only exposes security-definer RPCs to active authenticated members", () => {
    expect(migration).toContain("not public.is_active_operation_member()");
    expect(migration).toContain("security definer");
    expect(migration).toContain(
      "grant execute on function public.create_operation_schedule",
    );
    expect(migration).toContain(
      "grant execute on function public.update_operation_schedule",
    );
    expect(migration).toContain(
      "grant execute on function public.set_operation_schedule_status",
    );
    expect(migration).toContain(
      "grant execute on function public.archive_operation_schedule",
    );
    expect(migration).toContain("from public, anon");
  });

  it("uses request ids and expected versions for retry and conflict safety", () => {
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0))",
    );
    expect(migration).toContain("where schedule.request_id = p_request_id");
    expect(migration).toContain("audit.request_id = p_request_id");
    expect(migration).toContain("schedule_row.version <> p_expected_version");
    expect(migration).toContain("using errcode = '40001'");
  });

  it("syncs optional multi-value links without physical deletion", () => {
    expect(migration).toContain("sync_operation_schedule_links");
    expect(migration).toContain("operation_schedule_assignees");
    expect(migration).toContain("operation_schedule_customers");
    expect(migration).toContain("operation_schedule_dogs");
    expect(migration).toContain("archive_reason = '일정 연결 변경'");
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.operation_schedule_(assignees|customers|dogs)/i,
    );
  });

  it("records status, archive reason, updated by, and audit request context", () => {
    expect(migration).toContain("add column if not exists updated_by uuid");
    expect(migration).toContain("set status = p_status");
    expect(migration).toContain("set archived_at = now()");
    expect(migration).toContain(
      "set_config('app.operation_request_id', p_request_id::text, true)",
    );
  });

  it("does not reference Finance accounting objects", () => {
    expect(migration).not.toMatch(/\bpublic\.sales\b/);
    expect(migration).not.toContain("sale_payments");
    expect(migration).not.toContain("sale_refunds");
    expect(migration).not.toContain("sale_history");
    expect(migration).not.toContain("outstanding_amount");
  });
});
