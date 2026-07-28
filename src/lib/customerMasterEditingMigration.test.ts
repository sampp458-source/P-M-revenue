import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607280002_customer_master_editing.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

const customerUi = readFileSync(
  new URL("../pages/Pets.tsx", import.meta.url),
  "utf8",
);

describe("shared Customer Master editing", () => {
  it("allows every active profile to update the shared customer row", () => {
    expect(migration).toContain("create policy customers_update_active_user");
    expect(migration).toContain("using (public.is_active_user())");
    expect(migration).toContain("with check (public.is_active_user())");
    expect(customerUi).not.toContain(
      'editingCustomer && !isAdmin',
    );
  });

  it("stores the editor, timestamp and before/after audit data", () => {
    expect(migration).toContain(
      "alter table public.customers\n  add column if not exists updated_by uuid",
    );
    expect(migration).toContain("new.updated_by := auth.uid()");
    expect(migration).toContain(
      "insert into public.entity_audit_events",
    );
    expect(migration).toContain("'shared_master'");
    expect(migration).toContain("'customer'");
    expect(migration).toContain("to_jsonb(old)");
    expect(migration).toContain("to_jsonb(new)");
    expect(customerUi).toContain(
      ".select(\"id, name, phone, address, memo, is_active, created_at, updated_at\"",
    );
  });

  it("prevents physical deletion and leaves Finance snapshots untouched", () => {
    expect(migration).toContain(
      "create trigger customers_prevent_delete",
    );
    expect(migration).toContain(
      "revoke delete on table public.customers",
    );
    expect(migration).not.toMatch(/\b(update|alter table)\s+public\.sales\b/);
    expect(migration).not.toContain("sale_payments");
    expect(migration).not.toContain("sale_refunds");
  });
});
