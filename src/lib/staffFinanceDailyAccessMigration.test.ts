import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300004_staff_finance_daily_access.sql",
    import.meta.url,
  ),
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

  it("회사 전체 직접 조회는 관리자에게만 허용하고 직원 본인 거래는 보존한다", () => {
    expect(migration).toContain("public.is_admin()");
    expect(migration).toContain("staff_id = auth.uid()");
    expect(migration).toContain("created_by = auth.uid()");
    expect(migration).toContain(
      "create policy targets_select",
    );
    expect(migration).toContain("using (public.is_admin())");
  });

  it("회계 원장 구조를 변경하지 않는다", () => {
    expect(migration).not.toMatch(
      /alter\s+table\s+public\.(sales|sale_payments|sale_refunds|sale_history)/i,
    );
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.(sales|sale_payments|sale_refunds|sale_history)/i,
    );
  });
});
