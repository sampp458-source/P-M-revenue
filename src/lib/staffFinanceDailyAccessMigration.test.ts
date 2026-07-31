import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300004_staff_finance_daily_access.sql",
    import.meta.url,
  ),
  "utf8",
);
const repository = readFileSync(
  new URL("../pages/staffFinanceDayRepository.ts", import.meta.url),
  "utf8",
);

describe("직원 Finance 단일 날짜 접근 Migration", () => {
  it("직원용 날짜 RPC는 날짜 입력과 활성 사용자 권한을 강제한다", () => {
    expect(migration).toContain("get_staff_finance_day");
    expect(migration).toContain("p_date date");
    expect(migration).toContain("if not public.is_active_user()");
    expect(migration).toContain("payment.payment_date = p_date");
    expect(migration).toContain("refund.refund_date = p_date");
  });

  it("기존 Finance Policy를 삭제하거나 교체하지 않는다", () => {
    expect(migration).not.toMatch(/drop\s+policy/i);
    expect(migration).not.toMatch(
      /create\s+policy\s+(sales_select|sale_payments_select|sale_refunds_select_active|sale_history_select|targets_select)/i,
    );
  });

  it("직원 조회는 RPC 실패 시 직접 Finance 테이블로 우회하지 않는다", () => {
    expect(repository).toContain('supabase.rpc("get_staff_finance_day"');
    expect(repository).toContain("if (rpcResult.error) throw rpcResult.error");
    expect(repository).not.toMatch(
      /\.from\("(sales|sale_payments|sale_refunds|sale_history|monthly_targets)"\)/,
    );
  });

  it("회계 원장 구조를 변경하지 않는다", () => {
    expect(migration).not.toMatch(
      /alter\s+table\s+public\.(sales|sale_payments|sale_refunds|sale_history)/i,
    );
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.(sales|sale_payments|sale_refunds|sale_history)/i,
    );
  });

  it("직원용 응답은 수금 업무에 필요한 현재 미수만 별도 제공한다", () => {
    expect(migration).toContain("'outstanding_sales'");
    expect(migration).toContain("sale.status <> 'cancelled'");
    expect(migration).toContain(
      "sale.cancellation_type is distinct from 'entry_error'",
    );
    expect(migration).toContain("sale.outstanding_amount > 0");
    expect(migration).toContain("'sale_id', sale.id");
    expect(migration).toContain("'customer_id', sale.customer_id");
    expect(migration).toContain("'dog_id', sale.dog_id");
    expect(migration).toContain("'outstanding_date', sale.sale_date");
    expect(repository).toContain("outstanding_sales");
  });

  it("현재 미수 추가는 Finance 테이블, Policy, 데이터를 변경하지 않는다", () => {
    expect(migration).not.toMatch(/drop\s+policy/i);
    expect(migration).not.toMatch(/create\s+policy/i);
    expect(migration).not.toMatch(
      /alter\s+table\s+public\.(sales|sale_payments|sale_refunds|sale_history)/i,
    );
    expect(migration).not.toMatch(
      /(insert\s+into|update|delete\s+from)\s+public\.(sales|sale_payments|sale_refunds|sale_history)/i,
    );
  });
});
