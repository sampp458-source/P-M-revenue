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
  it("creates the five schedule foundation tables in one transaction", () => {
    expect(migration).toMatch(/\nbegin;\n/);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);

    [
      "operation_schedule_series",
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
      migration.indexOf(
        "create unique index if not exists operation_schedules_series_occurrence_uidx",
      ),
    );
    expect(schedulesDefinition).not.toContain("business_unit_id");
    expect(schedulesDefinition).not.toContain("scope_type");
  });

  it("defines recurrence, time, retry, and concurrency foundations", () => {
    expect(migration).toContain(
      "recurrence_frequency in ('daily', 'weekly', 'monthly')",
    );
    expect(migration).toContain("rolling_horizon_months integer not null default 12");
    expect(migration).toContain("request_id uuid not null unique");
    expect(migration).toContain("version integer not null default 1");
    expect(migration).toContain("ends_at > starts_at");
    expect(migration).toContain("timezone = 'Asia/Seoul'");
    expect(migration).toContain(
      "on public.operation_schedules (series_id, original_occurrence_at)",
    );
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
