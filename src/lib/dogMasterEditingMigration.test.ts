import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607290003_dog_master_editing_active_users.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

const dogManagement = readFileSync(
  new URL("../pages/DogManagement.tsx", import.meta.url),
  "utf8",
);

describe("shared Dog Master editing for active users", () => {
  it("allows every active profile to update Dog Master fields", () => {
    expect(migration).toContain("create policy dogs_update_active_user");
    expect(migration).toContain("using (public.is_active_user())");
    expect(migration).toContain("with check (public.is_active_user())");
    expect(dogManagement).toContain(
      "const canEditDog = profile?.isActive === true",
    );
    expect(dogManagement).toContain("canEditDog={canEditDog}");
  });

  it("keeps dog editing separate from administrator-only deactivation", () => {
    expect(dogManagement).toContain(
      'const canDeactivateDog = profile?.role === "admin"',
    );
    expect(dogManagement).toContain(
      "canDeactivateDog && dog.active",
    );
    expect(migration).not.toContain("drop trigger if exists protect_dog_active_status");
    expect(migration).not.toContain("create or replace function public.protect_dog_active_status");
  });

  it("records the editor, timestamp and before/after history", () => {
    expect(migration).toContain(
      "create table if not exists public.entity_audit_events",
    );
    expect(migration).toContain(
      "alter table public.dogs\n  add column if not exists updated_by uuid",
    );
    expect(migration).toContain("new.updated_by := auth.uid()");
    expect(migration).toContain("insert into public.entity_audit_events");
    expect(migration).toContain("'shared_master'");
    expect(migration).toContain("'dog'");
    expect(migration).toContain("to_jsonb(old)");
    expect(migration).toContain("to_jsonb(new)");
    expect(migration).toContain(
      "revoke all on table public.entity_audit_events from anon, authenticated",
    );
  });

  it("does not touch Finance or settings permissions", () => {
    expect(migration).not.toMatch(/\b(update|alter table)\s+public\.sales\b/);
    expect(migration).not.toContain("sale_payments");
    expect(migration).not.toContain("sale_refunds");
    expect(migration).not.toContain("products");
    expect(migration).not.toContain("business_units");
  });
});
