import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202607310001_operation_schedule_archive_permissions.sql",
  ),
  "utf8",
);

describe("Operations schedule archive permissions migration", () => {
  it("allows managers globally and staff for created or assigned schedules", () => {
    expect(migration).toContain(
      "has_operation_role(array['manager', 'owner'])",
    );
    expect(migration).toContain("schedule.created_by = auth.uid()");
    expect(migration).toContain("assignee.profile_id = auth.uid()");
    expect(migration).toContain("assignee.archived_at is null");
    expect(migration).toContain("operation_schedules_write_permission");
    expect(migration).toContain("using errcode = '42501'");
  });

  it("preserves soft archive, audit context, and optimistic locking", () => {
    expect(migration).toContain("set archived_at = now()");
    expect(migration).toContain("archived_by = actor_id");
    expect(migration).toContain("archive_reason = btrim(p_reason)");
    expect(migration).toContain("schedule_row.version <> p_expected_version");
    expect(migration).toContain("app.operation_request_id");
    expect(migration).not.toMatch(/delete\s+from\s+public\.operation_schedules/i);
  });

  it("does not touch Finance objects", () => {
    expect(migration).not.toMatch(
      /public\.(sales|sale_payments|sale_refunds|sale_history)/,
    );
    expect(migration).not.toContain("profiles.role");
  });
});
