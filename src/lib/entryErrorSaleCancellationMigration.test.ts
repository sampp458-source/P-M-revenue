import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607260001_entry_error_sale_cancellation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("entry error sale cancellation migration", () => {
  it("runs transactionally without classifying legacy cancellations", () => {
    expect(migration.trimStart().startsWith("begin;")).toBe(true);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain(
      "add column if not exists cancellation_type text",
    );
    expect(migration).toContain(
      "add column if not exists cancellation_request_id uuid",
    );
    expect(migration).not.toMatch(
      /update public\.sales[\s\S]{0,120}set cancellation_type = 'entry_error'/,
    );
  });

  it("requires an administrator, reason, confirmation and idempotency key", () => {
    expect(migration).toContain(
      "create or replace function public.cancel_sale_as_entry_error",
    );
    expect(migration).toContain(
      "if auth.uid() is null or not public.is_admin() then",
    );
    expect(migration).toContain(
      "if p_confirm_no_payment is distinct from true then",
    );
    expect(migration).toContain("if normalized_reason is null then");
    expect(migration).toContain("if p_request_id is null then");
    expect(migration).toContain(
      "perform pg_advisory_xact_lock(",
    );
    expect(migration).toContain(
      "where cancellation_request_id = p_request_id",
    );
    expect(migration).toContain("return existing_sale;");
    expect(migration).toContain(
      "처리 완료된 취소 요청 ID는 변경할 수 없습니다.",
    );
    expect(migration).toContain(
      "current_setting('app.entry_error_cancel_sale_id', true)",
    );
    expect(migration).toContain(
      "'app.entry_error_cancel_sale_id',\n    sale_row.id::text,\n    true",
    );
  });

  it("blocks refunds, outstanding collections and adjustments", () => {
    expect(migration).toContain(
      "if active_refund_count > 0 or sale_row.refund_amount <> 0 then",
    );
    expect(migration).toContain(
      "and source is distinct from 'initial'",
    );
    expect(migration).toContain(
      "미수 수납 또는 조정 결제 이력이 있는 거래는 오등록 취소할 수 없습니다.",
    );
  });

  it("voids initial ledgers instead of deleting them", () => {
    expect(migration).toContain("voided_at = now()");
    expect(migration).toContain("voided_by = auth.uid()");
    expect(migration).toContain(
      "void_reason = '오등록 취소: ' || normalized_reason",
    );
    expect(migration).not.toMatch(/delete from public\.sale_payments/);
  });

  it("keeps snapshots balanced and records the cancelled sale update", () => {
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("cancellation_type = 'entry_error'");
    expect(migration).toContain("paid_amount = 0");
    expect(migration).toContain("outstanding_amount = final_sale_amount");
    expect(migration).toContain("net_amount = 0");
    expect(migration).toContain(
      "sale.paid_amount + sale.outstanding_amount",
    );
    expect(migration).toContain(
      "sale.original_amount + sale.additional_amount - sale.discount_amount",
    );
  });

  it("keeps direct ledger writes closed and grants only the RPC", () => {
    expect(migration).toContain(
      "revoke all on function public.cancel_sale_as_entry_error(",
    );
    expect(migration).toContain(
      "grant execute on function public.cancel_sale_as_entry_error(",
    );
    expect(migration).toContain("to authenticated;");
  });
});
