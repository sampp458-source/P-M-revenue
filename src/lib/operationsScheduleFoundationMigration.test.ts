import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202607290001_operations_schedule_foundation.sql",
  ),
  "utf8",
);

describe("Operations schedule foundation migration", () => {
  it("creates only the four single-schedule tables in one transaction", () => {
    expect(migration).toMatch(/\nbegin;\n/);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);

    [
      "operation_schedules",
      "operation_schedule_assignees",
      "operation_schedule_dogs",
      "operation_schedule_customers",
    ].forEach((table) => {
      expect(migration).toContain(
        `create table if not exists public.${table}`,
      );
    });
  });

  it("keeps calendar scope and schedule type as separate references", () => {
    expect(migration).toContain(
      "references public.operation_calendars(id) on delete restrict",
    );
    expect(migration).toContain(
      "references public.operation_schedule_types(id) on delete restrict",
    );

    const schedulesDefinition = migration.slice(
      migration.indexOf("create table if not exists public.operation_schedules"),
      migration.indexOf("create table if not exists public.operation_schedule_assignees"),
    );
    expect(schedulesDefinition).not.toContain("business_unit_id");
    expect(schedulesDefinition).not.toContain("scope_type");
  });

  it("defines time, retry, and concurrency foundations without recurrence", () => {
    expect(migration).toContain("request_id uuid not null unique");
    expect(migration).toContain("version integer not null default 1");
    expect(migration).toContain("ends_at > starts_at");
    expect(migration).toContain("timezone = 'Asia/Seoul'");
    expect(migration).not.toContain("operation_schedule_series");
    expect(migration).not.toContain("series_id");
    expect(migration).not.toContain("original_occurrence_at");
    expect(migration).not.toContain("recurrence");
  });

  it("links multiple employees, dogs, and customers without copying masters", () => {
    expect(migration).toContain(
      "references public.profiles(id) on delete restrict",
    );
    expect(migration).toContain(
      "references public.dogs(id) on delete restrict",
    );
    expect(migration).toContain(
      "references public.customers(id) on delete restrict",
    );
  });

  it("preserves archive and audit history and blocks physical deletion", () => {
    expect(migration).toContain("archived_at timestamptz null");
    expect(migration).toContain(
      "create or replace function public.record_operation_schedule_audit_event()",
    );
    expect(migration).toContain("'operations'");
    expect(migration).toContain(
      "create or replace function public.block_operation_schedule_delete()",
    );
    expect(migration).toContain(
      "Operations 일정 원장은 물리 삭제할 수 없습니다.",
    );
    expect(migration).toContain(
      "if tg_table_name = 'operation_schedules'",
    );
    expect(migration).toContain("parsed_request_id := null");
    expect(migration).toContain("to_jsonb(new)");
  });

  it("allows active Operations members to read but does not open direct writes", () => {
    expect(migration).toContain("using (public.is_active_operation_member())");
    expect(migration).toContain(
      "grant select on table public.operation_schedules to authenticated",
    );
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete|all)[\s\S]*public\.operation_schedules\s+to authenticated/i,
    );
  });

  it("does not change or reference Finance accounting objects", () => {
    expect(migration).not.toMatch(/\bpublic\.sales\b/);
    expect(migration).not.toContain("sale_payments");
    expect(migration).not.toContain("sale_refunds");
    expect(migration).not.toContain("sale_history");
  });
});
