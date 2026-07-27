import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607270001_reclassify_refunded_entry_error.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("refunded entry-error correction migration", () => {
  it("creates an admin-only idempotent RPC", () => {
    expect(migration).toContain(
      "create or replace function public.reclassify_sale_as_entry_error_after_refund",
    );
    expect(migration).toContain("auth.uid() is null or not public.is_admin()");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("where cancellation_request_id = p_request_id");
    expect(migration).toContain(
      "grant execute on function public.reclassify_sale_as_entry_error_after_refund",
    );
    expect(migration).toContain("to authenticated");
  });

  it("requires both operator confirmations and exact ledger totals", () => {
    expect(migration).toContain(
      "p_confirm_no_actual_payment is distinct from true",
    );
    expect(migration).toContain(
      "p_confirm_no_actual_refund is distinct from true",
    );
    expect(migration).toContain(
      "active_payment_amount <> p_expected_payment_amount",
    );
    expect(migration).toContain(
      "active_refund_amount <> p_expected_refund_amount",
    );
    expect(migration).toContain(
      "active_payment_amount <> sale_row.paid_amount",
    );
    expect(migration).toContain(
      "active_refund_amount <> sale_row.refund_amount",
    );
  });

  it("only accepts refunded or strictly unclassified legacy cancelled sales", () => {
    expect(migration).toContain(
      "sale_row.status in ('partial_refund', 'full_refund')",
    );
    expect(migration).toContain("sale_row.status = 'cancelled'");
    expect(migration).toContain("sale_row.cancellation_type is null");
    expect(migration).toContain("active_initial_count = 0");
    expect(migration).toContain("prohibited_payment_count > 0");
    expect(migration).toContain("active_refund_count = 0");
  });

  it("voids both ledgers without deleting audit rows", () => {
    expect(migration).toMatch(
      /update public\.sale_payments[\s\S]*voided_at = now\(\)/,
    );
    expect(migration).toMatch(
      /update public\.sale_refunds[\s\S]*voided_at = now\(\)/,
    );
    expect(migration).not.toMatch(/delete from public\.sale_payments/);
    expect(migration).not.toMatch(/delete from public\.sale_refunds/);
    expect(migration).toContain("cancellation_type = 'entry_error'");
    expect(migration).toContain("paid_amount = 0");
    expect(migration).toContain("refund_amount = 0");
    expect(migration).toContain("outstanding_amount = 0");
    expect(migration).toContain("net_amount = 0");
  });

  it("keeps a readable sale history event for legacy cancelled corrections", () => {
    expect(migration).toContain(
      "old.cancellation_type is null",
    );
    expect(migration).toContain(
      "new.cancellation_type = 'entry_error' then 'updated'",
    );
    expect(migration).toContain(
      "(sale_id, action, previous_data, changed_data, changed_by)",
    );
  });
});
