import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607270002_correct_sale_refund_date.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("refund date correction migration", () => {
  it("creates an admin-only security definer RPC", () => {
    expect(migration).toContain(
      "create or replace function public.correct_sale_refund_date",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("auth.uid() is null or not public.is_admin()");
    expect(migration).toContain("to authenticated");
  });

  it("locks and validates the exact refund ledger before changing only its date", () => {
    expect(migration).toContain("where id = p_refund_id\n  for update");
    expect(migration).toContain("refund_row.sale_id <> p_expected_sale_id");
    expect(migration).toContain("refund_row.amount <> p_expected_amount");
    expect(migration).toContain(
      "refund_row.refund_date is distinct from p_expected_refund_date",
    );
    expect(migration).toMatch(
      /update public\.sale_refunds\s+set refund_date = p_new_refund_date/,
    );
    expect(migration).not.toMatch(/delete from public\.sale_refunds/);
    expect(migration).not.toMatch(/set[\s\S]{0,80}amount\s*=/);
  });

  it("preserves an idempotent audit trail with the reason", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'operation', 'refund_date_correction'");
    expect(migration).toContain("'reason', normalized_reason");
    expect(migration).toContain("'request_id', p_request_id");
    expect(migration).toContain("auth.uid()");
  });
});
