import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607290006_fix_operation_member_role_profile_id_ambiguity.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Operations membership role ambiguity hotfix", () => {
  it("qualifies membership profile_id references in the role RPC", () => {
    expect(migration).toContain("create or replace function public.set_operation_member_role");
    expect(migration).toContain("where membership.profile_id = p_target_profile_id");
    expect(migration).not.toMatch(/\bwhere\s+profile_id\s*=\s*p_target_profile_id/i);
  });

  it("keeps the owner guard, audit request context, and authenticated grant", () => {
    expect(migration).toContain("public.has_operation_role(array['owner'])");
    expect(migration).toContain("'app.operation_request_id'");
    expect(migration).toContain("active_owner_count <= 1");
    expect(migration).toContain("to authenticated");
  });

  it("does not alter Finance or accounting objects", () => {
    expect(migration).not.toMatch(/update public\.profiles\s+set\s+role/i);
    expect(migration).not.toMatch(/alter table public\.(sales|sale_payments|sale_refunds|sale_history)/i);
  });
});
