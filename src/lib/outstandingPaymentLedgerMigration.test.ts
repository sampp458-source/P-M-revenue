import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607250001_outstanding_payment_ledger.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("outstanding payment ledger migration", () => {
  it("runs transactionally and audits legacy balances before schema changes", () => {
    expect(migration.trimStart().startsWith("--")).toBe(true);
    expect(migration).toMatch(/\nbegin;\n/);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain(
      "paid_amount + outstanding_amount\n    <> original_amount + additional_amount - discount_amount",
    );
    expect(migration).toContain(
      "where audited.ledger_paid_amount <> audited.paid_amount",
    );
  });

  it("defines the immutable initial outstanding snapshot from initial ledger rows", () => {
    expect(migration).toContain(
      "add column if not exists initial_outstanding_amount integer",
    );
    expect(migration).toContain(
      "voided_at is null and source = 'initial'",
    );
    expect(migration).toContain("최초 미수금은 변경할 수 없습니다.");
    expect(migration).not.toContain(
      "set initial_outstanding_amount = sale.outstanding_amount",
    );
  });

  it("supports repeated same-method payments without the legacy unique constraint", () => {
    expect(migration).toContain(
      "drop constraint if exists sale_payments_sale_method_unique",
    );
    expect(migration).not.toMatch(
      /add constraint sale_payments_sale_method_unique/,
    );
  });

  it("requires an idempotency key and returns the matching prior collection", () => {
    expect(migration).toContain("p_request_id uuid");
    expect(migration).toContain("if p_request_id is null then");
    expect(migration).toContain(
      "perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0))",
    );
    expect(migration).toContain("return existing_payment;");
    expect(migration).toContain(
      "create unique index if not exists sale_payments_request_id_uidx",
    );
  });

  it("allows normal and partially refunded outstanding sales but blocks invalid states", () => {
    expect(migration).toContain(
      "if sale_row.status not in ('normal', 'partial_refund') then",
    );
    expect(migration).toContain(
      "if sale_row.status = 'cancelled' then",
    );
    expect(migration).toContain(
      "if sale_row.status = 'full_refund' then",
    );
    expect(migration).toContain(
      "if p_amount > sale_row.outstanding_amount then",
    );
  });

  it("recalculates paid, outstanding and net without changing the sale amount", () => {
    expect(migration).toContain(
      "new_outstanding_amount := final_sale_amount - active_paid_amount",
    );
    expect(migration).toContain(
      "net_amount = active_paid_amount - refund_amount",
    );
    expect(migration).not.toMatch(
      /update public\.sales[\s\S]{0,300}set[\s\S]{0,200}original_amount\s*=/,
    );
    expect(migration).not.toMatch(
      /update public\.sales[\s\S]{0,300}set[\s\S]{0,200}sale_date\s*=/,
    );
  });

  it("records collection date and supports carried outstanding balances", () => {
    expect(migration).toContain(
      "payment_date = coalesce(payment.payment_date, sale.sale_date)",
    );
    expect(migration).toContain("'outstanding_collection'");
    expect(migration).toContain("p_payment_date < sale_row.sale_date");
    expect(migration).toContain(
      "current_setting('app.payment_ledger_sync_sale_id', true)",
    );
  });

  it("voids rather than deletes and protects refunded money", () => {
    expect(migration).toContain("create or replace function public.void_sale_payment");
    expect(migration).toContain(
      "if active_paid_amount < sale_row.refund_amount then",
    );
    expect(migration).toContain("voided_at = now()");
    expect(migration).toContain("voided_by = auth.uid()");
    expect(migration).not.toMatch(
      /delete from public\.sale_payments[\s\S]{0,200}p_payment_id/,
    );
  });

  it("keeps direct ledger writes closed and exposes only authenticated RPC execution", () => {
    expect(migration).toContain(
      "revoke all on table public.sale_payments from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.add_sale_payment(uuid, integer, text, date, text, uuid)",
    );
    expect(migration).toContain(
      "grant execute on function public.void_sale_payment(uuid, text)",
    );
    expect(migration).toContain(
      "and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')",
    );
    expect(migration).toContain("if auth.uid() is null or not public.is_admin() then");
  });
});
