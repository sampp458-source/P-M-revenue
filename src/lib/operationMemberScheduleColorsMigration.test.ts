import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202607300002_operation_member_schedule_colors.sql",
  ),
  "utf8",
);

describe("Operations member schedule colors migration", () => {
  it("stores a nullable validated HEX color on Operations membership only", () => {
    expect(migration).toContain(
      "alter table public.operation_memberships",
    );
    expect(migration).toContain("add column if not exists schedule_color");
    expect(migration).toContain("^#[0-9A-Fa-f]{6}$");
    expect(migration).not.toContain("profiles.role");
    expect(migration).not.toMatch(
      /\b(update|alter table)\s+public\.(sales|sale_payments|sale_refunds)\b/i,
    );
  });

  it("keeps reads open to active members and writes manager-only", () => {
    expect(migration).toContain("get_active_operation_assignees");
    expect(migration).toContain("membership.is_active = true");
    expect(migration).toContain("profile.account_status = 'active'");
    expect(migration).toContain(
      "has_operation_role(array['manager', 'owner'])",
    );
  });

  it("keeps color updates idempotent, audited, and concurrency-safe", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("p_expected_updated_at");
    expect(migration).toContain("app.operation_request_id");
    expect(migration).toContain("app.operation_change_reason");
    expect(migration).toContain("entity_audit_events");
  });
});
