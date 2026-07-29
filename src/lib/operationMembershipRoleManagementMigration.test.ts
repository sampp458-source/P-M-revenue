import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607290004_operation_membership_role_management.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Operations membership role management migration", () => {
  it("uses an owner-only RPC with optimistic concurrency and idempotency", () => {
    expect(migration).toContain("public.set_operation_member_role");
    expect(migration).toContain("public.has_operation_role(array['owner'])");
    expect(migration).toContain("p_expected_updated_at");
    expect(migration).toContain("p_request_id");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("protects the last active owner on role change and deactivation", () => {
    expect(migration).toContain("마지막 활성 Operations 최고 관리자의 권한");
    expect(migration).toContain("마지막 활성 Operations 최고 관리자는 비활성화");
    expect(migration).toContain("create or replace function public.sync_operation_membership_from_profile");
    expect(migration).toContain("if active_owner_count = 0 then");
  });

  it("preserves Finance permissions and direct membership writes remain unavailable", () => {
    expect(migration).not.toMatch(/update public\.profiles\s+set\s+role/i);
    expect(migration).not.toMatch(/alter table public\.(sales|sale_payments|sale_refunds|sale_history)/);
    expect(migration).not.toContain("grant update on table public.operation_memberships");
  });
});
