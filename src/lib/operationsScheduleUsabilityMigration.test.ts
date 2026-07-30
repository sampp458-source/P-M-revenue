import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202607300001_operations_schedule_usability.sql",
  ),
  "utf8",
);

describe("Operations schedule usability migration", () => {
  it("adds only Operations classification and color storage", () => {
    expect(migration).toContain(
      "create table if not exists public.operation_calendar_schedule_types",
    );
    expect(migration).toContain("add column if not exists schedule_color");
    expect(migration).not.toContain("profiles.role");
    expect(migration).not.toMatch(/\bpublic\.(sales|sale_payments|sale_refunds)\b/);
  });

  it("keeps global schedule types and maps them to calendars", () => {
    expect(migration).toContain("calendar_id");
    expect(migration).toContain("schedule_type_id");
    expect(migration).toContain("operation_calendar_schedule_types_active_uidx");
    expect(migration).toContain(
      "선택한 캘린더에서 사용할 수 없는 일정 유형입니다.",
    );
  });

  it("validates colors and exposes active membership assignees", () => {
    expect(migration).toContain("^#[0-9A-Fa-f]{6}$");
    expect(migration).toContain("get_active_operation_assignees");
    expect(migration).toContain("membership.is_active = true");
    expect(migration).toContain("profile.account_status = 'active'");
  });
});
