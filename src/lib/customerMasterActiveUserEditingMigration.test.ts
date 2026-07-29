import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607290005_customer_master_editing_active_users.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Customer Master editing for active users", () => {
  it("adds the active-user UPDATE policy with USING and WITH CHECK", () => {
    expect(migration).toContain("create policy customers_update_active_user");
    expect(migration).toContain("using (public.is_active_user())");
    expect(migration).toContain("with check (public.is_active_user())");
    expect(migration).toContain("grant update on table public.customers");
  });

  it("does not replace the admin policy, audit triggers, or Finance objects", () => {
    expect(migration).not.toContain("drop policy if exists customers_update_admin");
    expect(migration).not.toMatch(/\b(drop|create)\s+trigger\b/i);
    expect(migration).not.toMatch(
      /public\.(sales|sale_payments|sale_refunds|sale_history|operation_memberships)/,
    );
  });
});
